import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROVIDERS } from "@ringo/shared";
import { env } from "../env.ts";

// Business search for "Who should Ringvo call?". Google Places (New) Text Search, proxied so the
// API key stays on the server. Well-known national brands also get their customer-service line.

const Query = z.object({ q: z.string().trim().min(2).max(80), near: z.string().trim().max(80).optional() });

export type PlaceHit = { id: string; name: string; number: string; address: string; kind: "service" | "place"; providerId?: string; openNow?: boolean; types?: string[] };

const FIELDS = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryType,places.currentOpeningHours.openNow";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function placesRoutes(app: FastifyInstance) {
  app.get("/v1/places", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { q, near } = Query.parse(req.query);
    const nq = norm(q);
    const brands: PlaceHit[] = PROVIDERS.filter((p) => norm(p.name).includes(nq) || nq.includes(norm(p.name)) || norm(p.id).startsWith(nq))
      .map((p) => ({ id: p.id, providerId: p.id, name: `${p.name} customer service`, number: p.number, address: "National support line", kind: "service" }));

    if (!env.GOOGLE_PLACES_API_KEY) return { configured: false, results: brands };

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({ textQuery: near ? `${q} near ${near}` : q, pageSize: 10, regionCode: "US", languageCode: "en" }),
      signal: AbortSignal.timeout(6000),
    }).catch((e: unknown) => { req.log.warn({ err: e }, "[places] request failed"); return null; });

    if (!res?.ok) {
      if (res) req.log.warn({ status: res.status, body: (await res.text()).slice(0, 300) }, "[places] Google error");
      return brands.length ? { configured: true, results: brands } : reply.code(502).send({ error: "Business search is unavailable right now. Use Other to type a number." });
    }
    const data = (await res.json()) as { places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; internationalPhoneNumber?: string; nationalPhoneNumber?: string; primaryType?: string; currentOpeningHours?: { openNow?: boolean } }[] };
    const places: PlaceHit[] = (Array.isArray(data.places) ? data.places : [])
      .filter((p) => p.id && p.displayName?.text && p.internationalPhoneNumber)
      .map((p) => ({
        id: `place:${p.id}`, name: p.displayName!.text!, number: `+${p.internationalPhoneNumber!.replace(/\D/g, "")}`, address: p.formattedAddress ?? "", kind: "place" as const,
        openNow: p.currentOpeningHours?.openNow, types: p.primaryType ? [p.primaryType] : undefined,
      }))
      .filter((p) => /^\+1\d{10}$/.test(p.number)); // launch scope: US/Canada
    return { configured: true, results: [...brands, ...places] };
  });
}
