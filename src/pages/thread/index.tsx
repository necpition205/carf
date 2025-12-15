import { useState } from "react";
import { Layers, RefreshCw, Eye } from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageTitle,
  PageContent,
  Flex,
  Text,
  Code,
  Badge,
  Spinner,
  Card,
} from "../../components/ui/Layout";
import {
  Toolbar,
  ToolbarSpacer,
} from "../../components/ui/Toolbar";
import { Button } from "../../components/ui/Button";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  EmptyState,
} from "../../components/ui/Table";

// ============================================================================
// Types
// ============================================================================

export interface ThreadInfo {
  id: number;
  state: string;
  context: Record<string, unknown>;
}

export interface BacktraceFrame {
  address?: string;
  moduleName?: string;
  symbol?: string;
  fileName?: string;
  lineNumber?: number;
}

export interface ThreadPageProps {
  hasSession: boolean;
  onRpcCall: (method: string, params?: unknown) => Promise<unknown>;
}

// ============================================================================
// Component
// ============================================================================

export function ThreadPage({ hasSession, onRpcCall }: ThreadPageProps) {
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadInfo | null>(null);
  const [backtrace, setBacktrace] = useState<Array<string | BacktraceFrame>>([]);
  const [loading, setLoading] = useState(false);

  const formatSymbolLike = (value: unknown) => {
    if (!value) return "-";
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    if (typeof value === "object") {
      const v = value as Partial<BacktraceFrame>;
      const addr = v.address ? String(v.address) : "";
      const mod = v.moduleName ? String(v.moduleName) : "";
      const sym = v.symbol ? String(v.symbol) : "";
      const file = v.fileName ? String(v.fileName) : "";
      const line = typeof v.lineNumber === "number" ? v.lineNumber : undefined;

      const left = [addr, mod && sym ? `${mod}!${sym}` : mod || sym].filter(Boolean).join(" ");
      const right = file ? `${file}${line !== undefined ? `:${line}` : ""}` : "";
      const formatted = [left, right && `(${right})`].filter(Boolean).join(" ");

      return formatted || JSON.stringify(value);
    }

    return String(value);
  };

  const loadThreads = async () => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const result = await onRpcCall("enumerate_threads");
      setThreads(result as ThreadInfo[]);
    } catch (e) {
      console.error("Failed to load threads:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadBacktrace = async (threadId: number) => {
    if (!hasSession) return;
    try {
      const result = await onRpcCall("get_backtrace", { threadId });
      if (Array.isArray(result)) {
        setBacktrace(result as Array<string | BacktraceFrame>);
      } else {
        setBacktrace([]);
      }
    } catch (e) {
      console.error("Failed to load backtrace:", e);
      setBacktrace([]);
    }
  };

  const handleThreadSelect = (thread: ThreadInfo) => {
    setSelectedThread(thread);
    loadBacktrace(thread.id);
  };

  const getStateColor = (state: string): "success" | "warning" | "error" | "default" => {
    switch (state.toLowerCase()) {
      case "running":
        return "success";
      case "waiting":
      case "sleeping":
        return "warning";
      case "stopped":
        return "error";
      default:
        return "default";
    }
  };

  if (!hasSession) {
    return (
      <PageContainer>
        <EmptyState style={{ height: "100%" }}>
          <Layers size={48} />
          <Text $size="lg" $color="muted">No active session</Text>
          <Text $color="muted">Attach to a process to view threads</Text>
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader>
        <Flex $align="center" $gap="12px">
          <Layers size={18} />
          <PageTitle>Threads</PageTitle>
          <Badge>{threads.length}</Badge>
        </Flex>
      </PageHeader>

      <Toolbar>
        <Button size="sm" onClick={loadThreads} disabled={loading} leftIcon={RefreshCw}>
          Refresh
        </Button>
        <ToolbarSpacer />
        {selectedThread && (
          <Text $color="muted">Selected: Thread #{selectedThread.id}</Text>
        )}
      </Toolbar>

      <PageContent style={{ padding: 0 }}>
        {loading ? (
          <EmptyState>
            <Spinner />
            <Text $color="muted">Loading threads...</Text>
          </EmptyState>
        ) : threads.length === 0 ? (
          <EmptyState>
            <Layers size={32} />
            <Text $color="muted">No threads loaded</Text>
            <Button size="sm" onClick={loadThreads}>
              Load Threads
            </Button>
          </EmptyState>
        ) : (
          <Flex style={{ height: "100%" }}>
            {/* Thread list */}
            <div style={{ flex: 1, overflow: "auto", borderRight: `1px solid var(--border-primary)` }}>
              <Table size="sm" hoverable>
                <TableHead>
                  <TableRow>
                    <TableHeader width="80px">ID</TableHeader>
                    <TableHeader width="100px">State</TableHeader>
                    <TableHeader>PC</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {threads.map((thread) => (
                    <TableRow
                      key={thread.id}
                      selected={selectedThread?.id === thread.id}
                      clickable
                      onClick={() => handleThreadSelect(thread)}
                    >
                      <TableCell mono>{thread.id}</TableCell>
                      <TableCell>
                        <Badge $variant={getStateColor(thread.state)}>{thread.state}</Badge>
                      </TableCell>
                      <TableCell mono truncate>
                        {formatSymbolLike(thread.context?.pc)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Thread details */}
            <div style={{ width: 400, overflow: "auto", padding: 16 }}>
              {selectedThread ? (
                <Flex $direction="column" $gap="16px">
                  <Card $padding="12px">
                    <Text $weight="semibold" style={{ marginBottom: 8 }}>
                      Registers
                    </Text>
                    <Flex $direction="column" $gap="4px">
                      {Object.entries(selectedThread.context || {}).map(([reg, val]) => (
                        <Flex key={reg} $justify="between">
                          <Text $color="muted" $mono>{reg}</Text>
                          <Code>{formatSymbolLike(val)}</Code>
                        </Flex>
                      ))}
                    </Flex>
                  </Card>

                  <Card $padding="12px">
                    <Text $weight="semibold" style={{ marginBottom: 8 }}>
                      Backtrace
                    </Text>
                    {backtrace.length === 0 ? (
                      <Text $color="muted">No backtrace available</Text>
                    ) : (
                      <Flex $direction="column" $gap="4px">
                        {backtrace.map((frame, i) => (
                          <Flex key={i} $gap="8px">
                            <Text $color="muted" $size="xs">#{i}</Text>
                            <Code style={{ fontSize: 11 }}>{formatSymbolLike(frame)}</Code>
                          </Flex>
                        ))}
                      </Flex>
                    )}
                  </Card>
                </Flex>
              ) : (
                <EmptyState>
                  <Eye size={24} />
                  <Text $color="muted">Select a thread to view details</Text>
                </EmptyState>
              )}
            </div>
          </Flex>
        )}
      </PageContent>
    </PageContainer>
  );
}
