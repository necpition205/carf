import type { MethodHandler } from "../rpc/types";

export const getArch: MethodHandler = () => {
  return { arch: Process.arch };
};
