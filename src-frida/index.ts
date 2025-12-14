type RequestPayload = {
  id: number;
  method: string;
  params?: unknown;
};

type RequestMessage = {
  type: "carf:request";
  payload: RequestPayload;
};

type RpcSendPayload = {
  type: string;
  id: number;
  result: "ok" | "error";
  returns: unknown;
};

function replyOk(id: number, returns: unknown) {
  const payload: RpcSendPayload = { type: "carf:response", id, result: "ok", returns };
  send(payload);
}

function replyError(id: number, message: string) {
  const payload: RpcSendPayload = {
    type: "carf:response",
    id,
    result: "error",
    returns: { message },
  };
  send(payload);
}

send({ type: "carf:event", id: 0, result: "ok", returns: { event: "agent_loaded" } });

recv("carf:request", function onMessage(message: RequestMessage) {
  const { id, method } = message.payload;

  try {
    if (method === "ping") {
      replyOk(id, { pong: true });
    } else if (method === "get_arch") {
      replyOk(id, { arch: Process.arch });
    } else {
      replyError(id, "Unknown method");
    }
  } catch (e) {
    replyError(id, String(e));
  }

  recv("carf:request", onMessage);
});
