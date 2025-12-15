import type { MethodHandler } from "../rpc/types";

export const ping: MethodHandler = () => {
  return { pong: true };
};
