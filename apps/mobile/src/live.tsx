import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LiveEvent, Stage, TranscriptLine } from "@ringo/shared";
import { config, devAuth } from "./config.ts";
import { useAuth } from "./auth.tsx";

type Ask = Extract<LiveEvent, { type: "call.ask" }>;
type LiveState = { stageLine: Record<string, { stage: Stage; line: string }>; transcript: Record<string, TranscriptLine[]>; ask: Ask | null; dismissAsk: () => void };

const Ctx = createContext<LiveState>({ stageLine: {}, transcript: {}, ask: null, dismissAsk: () => {} });

/** One WebSocket per signed-in session. Reconnects with backoff; refreshes queries on call updates. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { signedIn, getToken } = useAuth();
  const qc = useQueryClient();
  const [stageLine, setStageLine] = useState<LiveState["stageLine"]>({});
  const [transcript, setTranscript] = useState<LiveState["transcript"]>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const retry = useRef(0);

  useEffect(() => {
    if (!signedIn) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = async () => {
      const q = devAuth ? `dev=${encodeURIComponent(config.devUser)}` : `token=${encodeURIComponent((await getToken()) ?? "")}`;
      ws = new WebSocket(`${config.apiUrl.replace(/^http/, "ws")}/v1/live?${q}`);
      ws.onopen = () => (retry.current = 0);
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data)) as LiveEvent | { type: "hello" };
        if (e.type === "call.updated") qc.invalidateQueries({ queryKey: ["calls"] });
        else if (e.type === "call.stage") setStageLine((s) => ({ ...s, [e.callId]: { stage: e.stage, line: e.line } }));
        else if (e.type === "call.transcript") setTranscript((t) => ({ ...t, [e.callId]: [...(t[e.callId] ?? []), e.line] }));
        else if (e.type === "call.ask") setAsk(e);
        else if (e.type === "call.ask_resolved") setAsk((a) => (a?.askId === e.askId ? null : a));
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry.current++));
      };
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [signedIn, getToken, qc]);

  return <Ctx.Provider value={{ stageLine, transcript, ask, dismissAsk: () => setAsk(null) }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);
