import type { MethodHandler, RequestMessage } from "./types";
import { replyError, replyOk } from "./reply";

export type RpcRouter = {
  start: () => void;
};

export function createRpcRouter(handlers: Record<string, MethodHandler>): RpcRouter {
  function onMessage(message: RequestMessage) {
    const { id, method, params } = message.payload;

    try {
      const handler = handlers[method];
      if (!handler) {
        replyError(id, "Unknown method");
      } else {
        const returns = handler({ params });
        replyOk(id, returns);
      }
    } catch (e) {
      replyError(id, String(e));
    }

    recv("carf:request", onMessage);
  }

  return {
    start: () => {
      recv("carf:request", onMessage);
    },
  };
}
