import type { RpcEventPayload, RpcResponsePayload } from "./types";

export function replyOk(id: number, returns: unknown) {
  const payload: RpcResponsePayload = { type: "carf:response", id, result: "ok", returns };
  send(payload);
}

export function replyError(id: number, message: string) {
  const payload: RpcResponsePayload = {
    type: "carf:response",
    id,
    result: "error",
    returns: { message },
  };
  send(payload);
}

export function emitEvent(name: string, returns: Record<string, unknown> = {}) {
  const payload: RpcEventPayload = {
    type: "carf:event",
    id: 0,
    result: "ok",
    returns: { event: name, ...returns },
  };
  send(payload);
}
