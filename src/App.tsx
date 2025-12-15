import { useEffect, useMemo, useState } from "react";

import { useFridaStore } from "./features/frida";
import { useInputStore } from "./features/input";

function App() {
  const [processFilter, setProcessFilter] = useState<string>("");
  const [pidInput, setPidInput] = useState<string>("");

  const [spawnProgram, setSpawnProgram] = useState<string>("");
  const [spawnArgvRaw, setSpawnArgvRaw] = useState<string>("");
  const [spawnedPid, setSpawnedPid] = useState<number | null>(null);

  const [rpcMethod, setRpcMethod] = useState<string>("get_arch");
  const [rpcParamsRaw, setRpcParamsRaw] = useState<string>("{}");
  const [rpcResult, setRpcResult] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const inputListenerReady = useInputStore((s) => s.listenerReady);
  const inputError = useInputStore((s) => s.error);
  const lastKeyEvent = useInputStore((s) => s.lastKeyEvent);
  const startInputListener = useInputStore((s) => s.startListener);

  const {
    busy,
    error,
    version: fridaVersion,
    devices,
    selectedDeviceId,
    processes,
    attachedSessionId,
    loadedScriptId,

    init,
    clearError,
    setSelectedDeviceId,
    refreshDevices,
    refreshProcesses,
    attach: attachSession,
    detach: detachSession,
    spawn: spawnProcess,
    resume,
    kill,
    loadDefaultScript,
    unloadScript,
    agentRequest,
  } = useFridaStore();

  const filteredProcesses = useMemo(() => {
    const q = processFilter.trim().toLowerCase();
    if (!q) return processes;

    return processes.filter((p) =>
      `${p.pid} ${p.name}`.toLowerCase().includes(q),
    );
  }, [processFilter, processes]);

  async function attach() {
    const pid = Number(pidInput);
    if (!selectedDeviceId || !Number.isFinite(pid) || pid <= 0) {
      setValidationError("Select a device and enter a valid PID.");
      return;
    }

    setValidationError(null);
    clearError();
    await attachSession(pid);
  }

  async function detach() {
    if (attachedSessionId == null) return;

    setValidationError(null);
    clearError();
    await detachSession();
  }

  function parseArgv(raw: string): string[] | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error("argv JSON must be an array of strings");
      }
      return parsed.map((v) => String(v));
    }

    return trimmed.split(/\s+/).filter(Boolean);
  }

  async function spawn() {
    if (!selectedDeviceId) {
      setValidationError("Select a device first.");
      return;
    }

    const program = spawnProgram.trim();
    if (!program) {
      setValidationError("Enter a program to spawn.");
      return;
    }

    let argv: string[] | null = null;
    try {
      argv = parseArgv(spawnArgvRaw);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setValidationError(message);
      return;
    }

    setValidationError(null);
    clearError();
    const pid = await spawnProcess(program, argv);
    setSpawnedPid(pid);
    setPidInput(String(pid));
    await refreshProcesses();
  }

  useEffect(() => {
    (async () => {
      try {
        await init();
      } catch {
        // errors are stored in the Frida store
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void startInputListener();
  }, [startInputListener]);

  useEffect(() => {
    (async () => {
      try {
        await refreshProcesses(selectedDeviceId);
      } catch {
        // errors are stored in the Frida store
      }
    })();
  }, [selectedDeviceId]);

  const showError = validationError ?? error ?? inputError;

  return (
    <main className="container">
      <header className="topbar">
        <div>
          <h1 className="title">CARF (MVP)</h1>
          <div className="subtitle">Frida core: {fridaVersion || "-"}</div>
        </div>

        <div className="topbarActions">
          <button
            type="button"
            onClick={async () => {
              try {
                await refreshDevices();
                await refreshProcesses(selectedDeviceId);
              } catch {
                // errors are stored in the Frida store
              }
            }}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </header>

      {showError ? <div className="error">{showError}</div> : null}

      <section className="panel">
        <div className="fieldRow">
          <div className="hint">Input: {inputListenerReady ? "listening" : "stopped"}</div>
          <div className="mono">
            {lastKeyEvent
              ? `${lastKeyEvent.action} ${lastKeyEvent.key} (ctrl=${lastKeyEvent.modifiers.ctrl}, shift=${lastKeyEvent.modifiers.shift}, alt=${lastKeyEvent.modifiers.alt}, meta=${lastKeyEvent.modifiers.meta})`
              : "-"}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="fieldRow">
          <label className="label" htmlFor="device-select">
            Device
          </label>
          <select
            id="device-select"
            value={selectedDeviceId}
            onChange={(e) => {
              setValidationError(null);
              clearError();
              setSelectedDeviceId(e.currentTarget.value);
            }}
            disabled={busy}
          >
            <option value="">(select)</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.device_type}) [{d.id}]
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={async () => {
              try {
                await refreshProcesses(selectedDeviceId);
              } catch {
                // errors are stored in the Frida store
              }
            }}
            disabled={busy || !selectedDeviceId}
          >
            Processes
          </button>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardTitle">Attach / Session</div>
            <div className="fieldRow">
              <label className="label" htmlFor="pid-input">
                PID
              </label>
              <input
                id="pid-input"
                value={pidInput}
                onChange={(e) => {
                  setValidationError(null);
                  setPidInput(e.currentTarget.value);
                }}
                placeholder="1234"
              />
              <button type="button" onClick={attach} disabled={busy || !selectedDeviceId}>
                Attach
              </button>
              <button
                type="button"
                onClick={detach}
                disabled={busy || attachedSessionId == null}
              >
                Detach
              </button>
            </div>
            <div className="kv">
              <div className="kvKey">session_id</div>
              <div className="kvVal">{attachedSessionId ?? "-"}</div>
            </div>
          </div>

          <div className="card">
            <div className="cardTitle">Spawn</div>
            <div className="fieldRow">
              <label className="label" htmlFor="spawn-program">
                Program
              </label>
              <input
                id="spawn-program"
                value={spawnProgram}
                onChange={(e) => {
                  setValidationError(null);
                  setSpawnProgram(e.currentTarget.value);
                }}
                placeholder="/path/to/app (or package id)"
              />
            </div>
            <div className="fieldRow">
              <label className="label" htmlFor="spawn-argv">
                argv
              </label>
              <input
                id="spawn-argv"
                value={spawnArgvRaw}
                onChange={(e) => {
                  setValidationError(null);
                  setSpawnArgvRaw(e.currentTarget.value);
                }}
                placeholder='space-separated or ["--flag","x"]'
              />
              <button type="button" onClick={spawn} disabled={busy || !selectedDeviceId}>
                Spawn
              </button>
            </div>
            <div className="kv">
              <div className="kvKey">spawned_pid</div>
              <div className="kvVal">{spawnedPid ?? "-"}</div>
            </div>
            <div className="fieldRow">
              <button
                type="button"
                onClick={async () => {
                  if (spawnedPid == null) return;
                  try {
                    await resume(spawnedPid);
                  } catch {
                    // errors are stored in the Frida store
                  }
                }}
                disabled={busy || spawnedPid == null || !selectedDeviceId}
              >
                Resume
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (spawnedPid == null) return;
                  try {
                    await kill(spawnedPid);
                    setSpawnedPid(null);
                  } catch {
                    // errors are stored in the Frida store
                  }
                }}
                disabled={busy || spawnedPid == null || !selectedDeviceId}
              >
                Kill
              </button>
            </div>

            <div className="fieldRow">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await loadDefaultScript();
                  } catch {
                    // errors are stored in the Frida store
                  }
                }}
                disabled={busy || attachedSessionId == null || loadedScriptId != null}
              >
                Load Script
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await unloadScript();
                  } catch {
                    // errors are stored in the Frida store
                  }
                }}
                disabled={busy || loadedScriptId == null}
              >
                Unload Script
              </button>
              <div className="hint">script_id: {loadedScriptId ?? "-"}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="fieldRow">
          <label className="label" htmlFor="rpc-method">
            RPC
          </label>
          <input
            id="rpc-method"
            value={rpcMethod}
            onChange={(e) => {
              setRpcResult("");
              setRpcMethod(e.currentTarget.value);
            }}
            placeholder="get_arch"
          />
          <input
            value={rpcParamsRaw}
            onChange={(e) => {
              setRpcResult("");
              setRpcParamsRaw(e.currentTarget.value);
            }}
            placeholder='{"k":"v"}'
          />
          <button
            type="button"
            onClick={async () => {
              setRpcResult("");
              setValidationError(null);

              let params: unknown = undefined;
              const raw = rpcParamsRaw.trim();
              if (raw) {
                try {
                  params = JSON.parse(raw);
                } catch (e) {
                  const message = e instanceof Error ? e.message : String(e);
                  setValidationError(message);
                  return;
                }
              }

              try {
                const result = await agentRequest(rpcMethod.trim(), params);
                setRpcResult(JSON.stringify(result, null, 2));
              } catch {
                // errors are stored in the Frida store
              }
            }}
            disabled={busy || loadedScriptId == null}
          >
            Call
          </button>
        </div>

        {rpcResult ? <pre className="mono">{rpcResult}</pre> : null}
      </section>

      <section className="panel">
        <div className="fieldRow">
          <label className="label" htmlFor="proc-filter">
            Filter
          </label>
          <input
            id="proc-filter"
            value={processFilter}
            onChange={(e) => setProcessFilter(e.currentTarget.value)}
            placeholder="pid or name"
          />
          <div className="hint">{filteredProcesses.length} shown</div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProcesses.map((p) => (
                <tr key={p.pid}>
                  <td className="mono">{p.pid}</td>
                  <td>{p.name}</td>
                  <td className="actions">
                    <button
                      type="button"
                      onClick={async () => {
                        setPidInput(String(p.pid));
                        try {
                          await attachSession(p.pid);
                        } catch {
                          // errors are stored in the Frida store
                        }
                      }}
                      disabled={busy || !selectedDeviceId}
                    >
                      Attach
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await resume(p.pid);
                        } catch {
                          // errors are stored in the Frida store
                        }
                      }}
                      disabled={busy || !selectedDeviceId}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await kill(p.pid);
                        } catch {
                          // errors are stored in the Frida store
                        }
                      }}
                      disabled={busy || !selectedDeviceId}
                    >
                      Kill
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty">
                    No processes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
