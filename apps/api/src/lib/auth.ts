import type { FastifyReply, FastifyRequest } from "fastify";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";

export type User = typeof schema.users.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}

const verifier = env.COGNITO_USER_POOL_ID
  ? CognitoJwtVerifier.create({ userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, tokenUse: "id" })
  : null;

type Identity = { providerName?: string };

/** Ringo only accepts users who signed in with Google (federated through Cognito) and have a verified email. */
export function isGoogleSignIn(claims: Record<string, unknown>): boolean {
  const identities = Array.isArray(claims.identities) ? (claims.identities as Identity[]) : [];
  const verified = claims.email_verified === true || claims.email_verified === "true";
  return identities.some((i) => i.providerName === "Google") && verified && typeof claims.email === "string";
}

/** Verifies the Cognito ID token and loads (or creates on first login) the user row. */
export async function userFromToken(token: string | undefined, devUser?: string): Promise<User | null> {
  let sub: string, email: string, name = "";
  if (env.AUTH_DEV_BYPASS && devUser) {
    sub = `dev:${devUser}`;
    email = devUser;
  } else {
    if (!verifier || !token) return null;
    try {
      const claims = await verifier.verify(token);
      if (!isGoogleSignIn(claims)) return null;
      sub = claims.sub;
      email = String(claims.email);
      name = typeof claims.name === "string" ? claims.name : "";
    } catch {
      return null;
    }
  }
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.authSub, sub));
  if (existing) return existing.deletedAt ? null : existing;
  const [created] = await db.insert(schema.users).values({ authSub: sub, email, name }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schema.users).where(eq(schema.users.authSub, sub)))[0] ?? null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const user = await userFromToken(token, req.headers["x-dev-user"] as string | undefined);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  req.user = user;
}
