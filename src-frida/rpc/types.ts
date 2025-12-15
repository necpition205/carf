export type RequestPayload = {
  id: number;
  method: string;
  params?: unknown;
};

export type RequestMessage = {
  type: "carf:request";
  payload: RequestPayload;
};

export type RpcResponsePayload = {
  type: "carf:response";
  id: number;
  result: "ok" | "error";
  returns: unknown;
};

export type RpcEventPayload = {
  type: "carf:event";
  id: number;
  result: "ok" | "error";
  returns: unknown;
};

export type MethodHandler = (args: {
  params?: unknown;
}) => unknown;
