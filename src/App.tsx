import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import "./App.css";

type DeviceInfo = {
  id: string;
  name: string;
  device_type: string;
};

type ProcessInfo = {
  pid: number;
  name: string;
};

type SessionInfo = {
  session_id: number;
};

function App() {
  const [fridaVersion, setFridaVersion] = useState<string>("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [processFilter, setProcessFilter] = useState<string>("");
  const [pidInput, setPidInput] = useState<string>("");

  const [spawnProgram, setSpawnProgram] = useState<string>("");
  const [spawnArgvRaw, setSpawnArgvRaw] = useState<string>("");
  const [spawnedPid, setSpawnedPid] = useState<number | null>(null);

  const [attachedSessionId, setAttachedSessionId] = useState<number | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const filteredProcesses = useMemo(() => {
    const q = processFilter.trim().toLowerCase();
    if (!q) return processes;

    return processes.filter((p) =>
      `${p.pid} ${p.name}`.toLowerCase().includes(q),
    );
  }, [processFilter, processes]);

  async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>) {
    setError("");
    try {
      return (await invoke(cmd, args)) as T;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    }
  }

  async function refreshVersion() {
    const version = await safeInvoke<string>("frida_version");
    setFridaVersion(version);
  }

  async function refreshDevices() {
    const list = await safeInvoke<DeviceInfo[]>("frida_list_devices");
    setDevices(list);

    if (!selectedDeviceId) {
      const defaultId = list.find((d) => d.id === "local")?.id ?? list[0]?.id ?? "";
      setSelectedDeviceId(defaultId);
    }
  }

  async function refreshProcesses(deviceId: string) {
    if (!deviceId) {
      setProcesses([]);
      return;
    }

    const list = await safeInvoke<ProcessInfo[]>("frida_list_processes", {
      device_id: deviceId,
    });
    setProcesses(list);
  }

  async function attach() {
    const pid = Number(pidInput);
    if (!selectedDeviceId || !Number.isFinite(pid) || pid <= 0) {
      setError("Select a device and enter a valid PID.");
      return;
    }

    setBusy(true);
    try {
      const session = await safeInvoke<SessionInfo>("frida_attach", {
        device_id: selectedDeviceId,
        pid,
      });
      setAttachedSessionId(session.session_id);
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    if (attachedSessionId == null) return;

    setBusy(true);
    try {
      await safeInvoke<void>("frida_detach", {
        session_id: attachedSessionId,
      });
      setAttachedSessionId(null);
    } finally {
      setBusy(false);
    }
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
      setError("Select a device first.");
      return;
    }

    const program = spawnProgram.trim();
    if (!program) {
      setError("Enter a program to spawn.");
      return;
    }

    let argv: string[] | null = null;
    try {
      argv = parseArgv(spawnArgvRaw);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return;
    }

    setBusy(true);
    try {
      const pid = await safeInvoke<number>("frida_spawn", {
        device_id: selectedDeviceId,
        program,
        argv,
      });

      setSpawnedPid(pid);
      setPidInput(String(pid));
      await refreshProcesses(selectedDeviceId);
    } finally {
      setBusy(false);
    }
  }

  async function resume(pid: number) {
    if (!selectedDeviceId) return;
    await safeInvoke<void>("frida_resume", { device_id: selectedDeviceId, pid });
  }

  async function kill(pid: number) {
    if (!selectedDeviceId) return;
    await safeInvoke<void>("frida_kill", { device_id: selectedDeviceId, pid });
    await refreshProcesses(selectedDeviceId);
  }

  useEffect(() => {
    (async () => {
      setBusy(true);
      try {
        await refreshVersion();
        await refreshDevices();
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setBusy(true);
      try {
        await refreshProcesses(selectedDeviceId);
      } finally {
        setBusy(false);
      }
    })();
  }, [selectedDeviceId]);

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
              setBusy(true);
              try {
                await refreshDevices();
                await refreshProcesses(selectedDeviceId);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="fieldRow">
          <label className="label" htmlFor="device-select">
            Device
          </label>
          <select
            id="device-select"
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.currentTarget.value)}
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
              setBusy(true);
              try {
                await refreshProcesses(selectedDeviceId);
              } finally {
                setBusy(false);
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
                onChange={(e) => setPidInput(e.currentTarget.value)}
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
                onChange={(e) => setSpawnProgram(e.currentTarget.value)}
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
                onChange={(e) => setSpawnArgvRaw(e.currentTarget.value)}
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
                  setBusy(true);
                  try {
                    await resume(spawnedPid);
                  } finally {
                    setBusy(false);
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
                  setBusy(true);
                  try {
                    await kill(spawnedPid);
                    setSpawnedPid(null);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy || spawnedPid == null || !selectedDeviceId}
              >
                Kill
              </button>
            </div>
          </div>
        </div>
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
                        setBusy(true);
                        try {
                          const session = await safeInvoke<SessionInfo>("frida_attach", {
                            device_id: selectedDeviceId,
                            pid: p.pid,
                          });
                          setAttachedSessionId(session.session_id);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || !selectedDeviceId}
                    >
                      Attach
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await resume(p.pid);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || !selectedDeviceId}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await kill(p.pid);
                        } finally {
                          setBusy(false);
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
