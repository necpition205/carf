import type { MethodHandler } from "../rpc/types";
import { getArch } from "./getArch";
import { ping } from "./ping";

// Map of host-callable RPC methods.
export const methods: Record<string, MethodHandler> = {
  ping,
  get_arch: getArch,
};
