import { methods } from "./methods";
import { emitEvent } from "./rpc/reply";
import { createRpcRouter } from "./rpc/router";

// Agent boot event (useful for FE to confirm the script is alive).
emitEvent("agent_loaded");

// Start RPC router.
createRpcRouter(methods).start();
