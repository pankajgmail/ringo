import Stripe from "stripe";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { FREE_CALLS, PLAN_PRICE_CENTS } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import type { User } from "../lib/auth.ts";
import { isAdmin } from "../routes/admin.ts";

// Subscriptions with Stripe Checkout (hosted payment page) and the Customer Portal (change card, cancel).
// Card details never touch Ringo. The plan is created inline (price_data), so there's nothing to set up in the
// Stripe dashboard beyond the API key and the webhook. Status is kept in sync by /v1/webhooks/stripe.

export const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
export const billingConfigured = () => !!stripe;

/** Statuses that keep calling switched on. past_due gets the grace period while Stripe retries the card. */
const PAYING = new Set(["active", "trialing", "past_due"]);
export const isSubscribed = (u: Pick<User, "subscriptionStatus">) => PAYING.has(u.subscriptionStatus ?? "");

export class PaymentRequired extends Error {
  statusCode = 402;
  constructor() {
    super(`You've used your ${FREE_CALLS} free calls. Subscribe to keep Ringvo calling for you.`);
  }
}

/** Outbound calls that count toward the free allowance: everything except calls cancelled before they dialled. */
export async function callsUsed(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.outCalls).where(and(
    eq(schema.outCalls.userId, userId),
    or(ne(schema.outCalls.status, "cancelled"), isNotNull(schema.outCalls.startedAt)),
  ));
  return r?.n ?? 0;
}

/** Throws PaymentRequired if this user can't start another outbound call. Billing off or admin: no limit. */
export async function assertCanCall(u: User) {
  if (!billingConfigured() || isAdmin(u) || isSubscribed(u)) return;
  if ((await callsUsed(u.id)) >= FREE_CALLS) throw new PaymentRequired();
}

/** What the app shows on the Plan card and the home screen. */
export async function billingSummary(u: User) {
  const used = await callsUsed(u.id);
  return {
    available: billingConfigured(),
    subscribed: isSubscribed(u) || isAdmin(u),
    status: u.subscriptionStatus,
    renewsAt: u.subscriptionPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: u.subscriptionCancelAtPeriodEnd,
    freeCalls: FREE_CALLS,
    freeLeft: Math.max(0, FREE_CALLS - used),
    priceCents: PLAN_PRICE_CENTS,
  };
}

async function customerFor(u: User) {
  if (u.stripeCustomerId) return u.stripeCustomerId;
  const c = await stripe!.customers.create({ email: u.email, name: u.name || undefined, metadata: { userId: u.id } }, { idempotencyKey: `customer-${u.id}` });
  await db.update(schema.users).set({ stripeCustomerId: c.id }).where(eq(schema.users.id, u.id));
  return c.id;
}

/** A Stripe Checkout page for the monthly plan. */
export async function checkoutUrl(u: User, returnTo: string) {
  const customer = await customerFor(u);
  const s = await stripe!.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: u.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: PLAN_PRICE_CENTS, recurring: { interval: "month" },
        product_data: { name: "Ringvo monthly", description: "Ringvo makes and answers calls for you." },
      },
    }],
    subscription_data: { metadata: { userId: u.id } },
    allow_promotion_codes: true,
    success_url: withParam(returnTo, "billing", "success"),
    cancel_url: withParam(returnTo, "billing", "cancelled"),
  });
  if (!s.url) throw new Error("Stripe didn't return a checkout URL");
  return s.url;
}

/** Stripe's Customer Portal: update the card, see invoices, cancel. */
export async function portalUrl(u: User, returnTo: string) {
  const s = await stripe!.billingPortal.sessions.create({ customer: await customerFor(u), return_url: returnTo });
  return s.url;
}

const withParam = (url: string, k: string, v: string) => {
  const u = new URL(url);
  u.searchParams.set(k, v);
  return u.toString();
};

/** Copies a subscription's state onto the user it belongs to. */
async function syncSubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const end = sub.items.data[0]?.current_period_end;
  const [u] = await db.update(schema.users).set({
    subscriptionId: sub.id, subscriptionStatus: sub.status,
    subscriptionPeriodEnd: end ? new Date(end * 1000) : null, subscriptionCancelAtPeriodEnd: sub.cancel_at_period_end,
  }).where(eq(schema.users.stripeCustomerId, customer)).returning({ id: schema.users.id });
  if (u) await audit(u.id, "billing.subscription", { status: sub.status });
}

/** Handles a verified Stripe webhook event. Always re-reads the subscription, so out-of-order events can't regress it. */
export async function handleStripeEvent(e: Stripe.Event) {
  switch (e.type) {
    case "checkout.session.completed": {
      const s = e.data.object;
      const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
      if (s.client_reference_id && customer) {
        await db.update(schema.users).set({ stripeCustomerId: customer }).where(and(eq(schema.users.id, s.client_reference_id), sql`${schema.users.stripeCustomerId} is null`));
      }
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (subId) await syncSubscription(await stripe!.subscriptions.retrieve(subId));
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(await stripe!.subscriptions.retrieve(e.data.object.id));
      return;
  }
}

/** Account deletion: stop billing straight away. The Stripe customer is deleted too (Stripe keeps its own legal records). */
export async function cancelBilling(u: Pick<User, "id" | "stripeCustomerId">) {
  if (!stripe || !u.stripeCustomerId) return;
  await stripe.customers.del(u.stripeCustomerId).catch(() => undefined); // deleting a customer cancels their subscriptions
}
