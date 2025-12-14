import { useEffect, useState } from "react";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type ScriptMessageEnvelope = {
  session_id: number;
  script_id: number;
  message: unknown;
  data?: number[];
};

export function useFridaScriptMessages(filter?: {
  sessionId?: number | null;
  scriptId?: number | null;
}) {
  const [messages, setMessages] = useState<ScriptMessageEnvelope[]>([]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    (async () => {
      unlisten = await listen<ScriptMessageEnvelope>("frida_script_message", (event) => {
        const msg = event.payload;

        if (filter?.sessionId != null && msg.session_id !== filter.sessionId) return;
        if (filter?.scriptId != null && msg.script_id !== filter.scriptId) return;

        setMessages((prev) => [...prev, msg]);
      });
    })();

    return () => {
      if (!unlisten) return;
      unlisten();
      unlisten = null;
    };
  }, [filter?.scriptId, filter?.sessionId]);

  return {
    messages,
    clear: () => setMessages([]),
  };
}
