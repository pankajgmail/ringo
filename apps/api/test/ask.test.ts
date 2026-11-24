import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
  DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
});

// ---- in-memory fakes ----
type Rec = Record<string, unknown>;
const tables = { outCalls: [] as Rec[], users: [] as Rec[], asks: [] as Rec[] };
const T = Object.fromEntries(Object.keys(tables).map((k) => [k, { __t: k, id: "id", createdAt: "createdAt", outCallId: "outCallId", retellCallId: "retellCallId", status: "status", answeredAt: "answeredAt", infoMode: "infoMode", phone: "phone" }]));
vi.mock("drizzle-orm", () => ({
  eq: (col: string, v: unknown) => (r: Rec) => r[col] === v,
  isNull: (col: string) => (r: Rec) => r[col] == null,
  and: (...fs: ((r: Rec) => boolean)[]) => (r: Rec) => fs.every((f) => f(r)),
  desc: () => undefined,
}));
let n = 0;
vi.mock("../src/db/client.ts", () => {
  const rows = (t: { __t: keyof typeof tables }) => tables[t.__t];
  const q = (list: () => Rec[]) => {
    const p = Promise.resolve().then(list) as Promise<Rec[]> & Rec;
    return Object.assign(p, { orderBy: () => ({ limit: async () => list().slice(-1) }) });
  };
  return {
    schema: T,
    db: {
      select: () => ({ from: (t: never) => ({ where: (f: (r: Rec) => boolean) => q(() => rows(t).filter(f).map((r) => ({ ...r }))) }) }),
      insert: (t: never) => ({ values: (v: Rec) => {
        const r = { id: `ask${++n}`, createdAt: new Date(), answeredAt: null, answer: null, note: null, via: "prompt", ...v };
        rows(t).push(r);
        return Object.assign(Promise.resolve([r]), { returning: async () => [r] });
      } }),
      update: (t: never) => ({ set: (v: Rec) => ({ where: (f: (r: Rec) => boolean) => {
        const hit = rows(t).filter(f); hit.forEach((r) => Object.assign(r, v));
        return Object.assign(Promise.resolve(hit), { returning: async () => hit });
      } }) }),
    },
  };
});
const pushes: string[] = [];
const stop = vi.fn(async () => undefined);
vi.mock("../src/services/retell.ts", () => ({ verifyRetell: async () => true, retell: { call: { stop } } }));
vi.mock("../src/services/live.ts", () => ({ isOnline: () => true, publish: vi.fn(), push: async (_u: string, title: string) => { pushes.push(title); } }));
vi.mock("../src/services/serialize.ts", () => ({ toOutCall: (r: unknown) => r }));
vi.mock("../src/lib/audit.ts", () => ({ audit: vi.fn() }));
vi.mock("../src/jobs/dialer.ts", () => ({ finish: vi.fn(), maybeRedial: vi.fn() }));

const { retellRoutes } = await import("../src/routes/retell.ts");
const app = Fastify();
app.addHook("preParsing", async (req) => { (req as unknown as Rec).rawBody = ""; });
await app.register(retellRoutes);
await app.ready();

const call = { call_id: "c1", metadata: { outCallId: "oc1" } };
const tool = (name: string, args: Rec) => app.inject({ method: "POST", url: `/retell/tools/${name}`, payload: { call, args } }).then((r) => r.json());
const answer = (choice: string, note?: string) => Object.assign(tables.asks.at(-1)!, { answer: choice, note, answeredAt: new Date() });

// Fastify's inject runs on setImmediate (not faked), so let real ticks pass between fake-clock steps.
const tick = () => new Promise((r) => setImmediate(r));
async function advance(ms: number) {
  for (let i = 0; i < 20; i++) await tick();
  for (let t = 0; t < ms; t += 500) { await vi.advanceTimersByTimeAsync(Math.min(500, ms - t)); await tick(); await tick(); }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  tables.outCalls.splice(0, Infinity, { id: "oc1", userId: "u1", name: "Verizon", askMe: "ask", status: "in_progress", retellCallId: "c1" });
  tables.users.splice(0, Infinity, { id: "u1", phone: "+14085074073", infoMode: "prompt" });
  tables.asks.length = 0; n = 0; pushes.length = 0; stop.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("ask_user for missing information", () => {
  it("prompt mode: pushes the question and relays the answer without keeping it", async () => {
    const res = tool("ask_user", { question: "What is your Verizon account PIN?", kind: "info" });
    await advance(3000);
    expect(pushes).toEqual(["Verizon needs information"]);
    answer("reply", "4321");
    await advance(1500);
    const r = await res;
    expect(r).toMatchObject({ answered: true, choice: "reply", note: "4321" });
    expect(tables.asks[0]!.note).toBeNull();
    expect(tables.asks[0]!.expiresAt).toEqual(new Date(new Date(tables.asks[0]!.createdAt as Date).getTime() + 120_000));
  });

  it("prompt mode: says still waiting after ~50s, then times out at 2 minutes and hangs up", async () => {
    const first = tool("ask_user", { question: "How many people?", kind: "info" });
    await advance(52_000);
    const r1 = await first;
    expect(r1).toMatchObject({ answered: false, still_waiting: true, ask_id: "ask1" });

    const second = tool("wait_for_answer", { ask_id: "ask1" });
    await advance(52_000);
    expect(await second).toMatchObject({ still_waiting: true });

    const third = tool("wait_for_answer", { ask_id: "ask1" });
    await advance(20_000);
    const r3 = await third;
    expect(r3.answered).toBe(false);
    expect(r3.still_waiting).toBeUndefined();
    expect(r3.instruction).toMatch(/2 minutes/);
    expect(tables.asks[0]!.answer).toBe("timeout");

    await advance(21_000); // grace period, then Ringo ends the call itself
    expect(stop).toHaveBeenCalledWith("c1");
  });

  it("conference mode: tells the agent to bring the user on instead of prompting", async () => {
    tables.users[0]!.infoMode = "conference";
    const r = await tool("ask_user", { question: "What is your account number?", kind: "info" });
    expect(r).toMatchObject({ answered: false, conference: true });
    expect(r.instruction).toMatch(/conference_user/);
    expect(tables.asks[0]).toMatchObject({ via: "conference", kind: "info" });
    expect(pushes).toEqual(["Verizon: Ringo is calling you"]);
  });

  it("conference mode still asks for texted codes in the app", async () => {
    tables.users[0]!.infoMode = "conference";
    const res = tool("ask_user", { question: "Code?", kind: "code" });
    await advance(3000);
    answer("reply", "998877");
    await advance(1500);
    expect(await res).toMatchObject({ answered: true, note: "998877" });
  });

  it("decisions keep the short 50s wait", async () => {
    const res = tool("ask_user", { question: "Accept $10 credit?" });
    await advance(52_000);
    const r = await res;
    expect(r).toMatchObject({ answered: false });
    expect(r.still_waiting).toBeUndefined();
  });
});
