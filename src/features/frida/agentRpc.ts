import type { UnlistenFn } from "@tauri-apps/api/event";

import type { ScriptMessageEvent } from "./types";
import { fridaBackendApi } from "./backendApi";
import { fridaEvents } from "./events";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const pending = new Map<number, PendingRequest>();

let unlisten: UnlistenFn | null = null;
let nextRequestId = 1;

function isCarfResponse(event: ScriptMessageEvent): event is ScriptMessageEvent & {
  message: {
    type: "send";
    payload: { type: "carf:response"; id: number; result: "ok" | "error"; returns: unknown };
  };
} {
  const msg = event.message as { type?: unknown; payload?: unknown };
  if (!msg || msg.type !== "send") return false;

  const payload = msg.payload as {
    type?: unknown;
    id?: unknown;
    result?: unknown;
    returns?: unknown;
  };

  return (
    !!payload &&
    payload.type === "carf:response" &&
    typeof payload.id === "number" &&
    (payload.result === "ok" || payload.result === "error")
  );
}

export type AgentRpc = {
  start: () => Promise<void>;
  stop: () => void;
  request: (scriptId: number, method: string, params?: unknown) => Promise<unknown>;
};

// RPC helper for talking to the injected agent.
export const agentRpc: AgentRpc = {
  start: async () => {
    if (unlisten) return;

    unlisten = await fridaEvents.scriptMessage((payload) => {
      if (!isCarfResponse(payload)) return;

      const { id, result, returns } = payload.message.payload;
      const req = pending.get(id);
      if (!req) return;

      pending.delete(id);
      if (result === "ok") req.resolve(returns);
      else req.reject(returns);
    });
  },

  stop: () => {
    if (!unlisten) return;
    const fn = unlisten;
    unlisten = null;
    pending.clear();
    fn();
  },

  request: async (scriptId, method, params) => {
    await agentRpc.start();

    const id = nextRequestId++;
    const message = {
      type: "carf:request",
      payload: {
        id,
        method,
        params,
      },
    };

    const p = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    await fridaBackendApi.scriptPost(scriptId, message);
    return await p;
  },
};
