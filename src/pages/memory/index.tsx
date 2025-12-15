import { useState } from "react";
import { HardDrive, Search, Upload, Eye } from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageTitle,
  PageContent,
  Flex,
  Text,
  Code,
  Badge,
  Card,
} from "../../components/ui/Layout";
import {
  Toolbar,
  ToolbarSpacer,
} from "../../components/ui/Toolbar";
import { Button } from "../../components/ui/Button";
import { Input, FormGroup, Label, FormRow } from "../../components/ui/Input";
import { Tabs, TabPanel, useTabs } from "../../components/ui/Tabs";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  EmptyState,
} from "../../components/ui/Table";
import styled from "@emotion/styled";
import { theme } from "../../styles";

// ============================================================================
// Types
// ============================================================================

export interface RangeInfo {
  base: string;
  size: number;
  protection: string;
  file?: { path: string; offset: number; size: number };
}

export interface MemoryPageProps {
  hasSession: boolean;
  onRpcCall: (method: string, params?: unknown) => Promise<unknown>;
}

// ============================================================================
// Styles (hex viewer specific)
// ============================================================================

const HexViewContainer = styled.div`
  font-family: "SF Mono", "Consolas", monospace;
  font-size: ${theme.fontSize.xs};
  background: ${theme.colors.bg.primary};
  padding: ${theme.spacing.md};
  overflow: auto;
  flex: 1;
`;

const HexRow = styled.div`
  display: flex;
  gap: 16px;
  line-height: 1.6;

  &:hover {
    background: ${theme.colors.bg.hover};
  }
`;

const HexAddress = styled.span`
  color: ${theme.colors.text.accent};
  min-width: 100px;
`;

const HexBytes = styled.span`
  color: ${theme.colors.text.primary};
  min-width: 380px;
`;

const HexAscii = styled.span`
  color: ${theme.colors.text.muted};
`;

// ============================================================================
// Component
// ============================================================================

export function MemoryPage({ hasSession, onRpcCall }: MemoryPageProps) {
  const tabs = useTabs("read");

  // Read state
  const [readAddress, setReadAddress] = useState("");
  const [readSize, setReadSize] = useState("256");
  const [readData, setReadData] = useState<number[] | null>(null);

  // Write state
  const [writeAddress, setWriteAddress] = useState("");
  const [writeData, setWriteData] = useState("");

  // Search state
  const [searchPattern, setSearchPattern] = useState("");
  const [searchResults, setSearchResults] = useState<string[]>([]);

  // Ranges state
  const [ranges, setRanges] = useState<RangeInfo[]>([]);
  const [rangeFilter, setRangeFilter] = useState("r--");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRead = async () => {
    if (!hasSession || !readAddress) return;
    setLoading(true);
    setError(null);
    try {
      const result = await onRpcCall("read_memory", {
        address: readAddress,
        size: parseInt(readSize, 10),
      });
      setReadData(result as number[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleWrite = async () => {
    if (!hasSession || !writeAddress || !writeData) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = writeData.split(/[\s,]+/).map((s) => parseInt(s, 16));
      await onRpcCall("write_memory", { address: writeAddress, data: bytes });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!hasSession || !searchPattern) return;
    setLoading(true);
    setError(null);
    try {
      const result = await onRpcCall("search_memory", { pattern: searchPattern });
      setSearchResults(result as string[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRanges = async () => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const result = await onRpcCall("enumerate_ranges", { protection: rangeFilter });
      setRanges(result as RangeInfo[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const formatHexDump = (data: number[], baseAddress: string) => {
    const rows: { address: string; bytes: string; ascii: string }[] = [];
    const base = BigInt(baseAddress);

    for (let i = 0; i < data.length; i += 16) {
      const chunk = data.slice(i, i + 16);
      const addr = "0x" + (base + BigInt(i)).toString(16).padStart(12, "0");
      const bytes = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = chunk
        .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
        .join("");
      rows.push({ address: addr, bytes, ascii });
    }
    return rows;
  };

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const tabItems = [
    { id: "read", label: "Read", icon: Eye },
    { id: "write", label: "Write", icon: Upload },
    { id: "search", label: "Search", icon: Search },
    { id: "ranges", label: "Ranges", icon: HardDrive, badge: ranges.length || undefined },
  ];

  if (!hasSession) {
    return (
      <PageContainer>
        <EmptyState style={{ height: "100%" }}>
          <HardDrive size={48} />
          <Text $size="lg" $color="muted">No active session</Text>
          <Text $color="muted">Attach to a process to access memory</Text>
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader>
        <Flex $align="center" $gap="12px">
          <HardDrive size={18} />
          <PageTitle>Memory</PageTitle>
        </Flex>
      </PageHeader>

      <Toolbar>
        <Tabs items={tabItems} value={tabs.value} onChange={tabs.onChange} size="sm" />
        <ToolbarSpacer />
        {error && <Badge $variant="error">{error}</Badge>}
      </Toolbar>

      <PageContent>
          <TabPanel value="read" activeTab={tabs.value}>
          <Card $padding="16px">
            <FormRow style={{ marginBottom: 16 }}>
              <FormGroup style={{ flex: 1 }}>
                <Label>Address</Label>
                <Input
                  value={readAddress}
                  onChange={(e) => setReadAddress(e.target.value)}
                  placeholder="0x..."
                  inputSize="sm"
                />
              </FormGroup>
              <FormGroup style={{ width: 100 }}>
                <Label>Size</Label>
                <Input
                  value={readSize}
                  onChange={(e) => setReadSize(e.target.value)}
                  placeholder="256"
                  inputSize="sm"
                />
              </FormGroup>
              <Button
                variant="primary"
                onClick={handleRead}
                disabled={loading || !readAddress}
                style={{ alignSelf: "flex-end" }}
              >
                Read
              </Button>
            </FormRow>
          </Card>

          {readData && (
            <HexViewContainer style={{ marginTop: 16 }}>
              {formatHexDump(readData, readAddress).map((row, i) => (
                <HexRow key={i}>
                  <HexAddress>{row.address}</HexAddress>
                  <HexBytes>{row.bytes}</HexBytes>
                  <HexAscii>{row.ascii}</HexAscii>
                </HexRow>
              ))}
            </HexViewContainer>
          )}
        </TabPanel>

        <TabPanel value="write" activeTab={tabs.value}>
          <Card $padding="16px">
            <FormGroup style={{ marginBottom: 16 }}>
              <Label>Address</Label>
              <Input
                value={writeAddress}
                onChange={(e) => setWriteAddress(e.target.value)}
                placeholder="0x..."
                inputSize="sm"
              />
            </FormGroup>
            <FormGroup style={{ marginBottom: 16 }}>
              <Label>Data (hex bytes, space or comma separated)</Label>
              <Input
                value={writeData}
                onChange={(e) => setWriteData(e.target.value)}
                placeholder="90 90 90 or 90,90,90"
                inputSize="sm"
              />
            </FormGroup>
            <Button
              variant="danger"
              onClick={handleWrite}
              disabled={loading || !writeAddress || !writeData}
            >
              Write Memory
            </Button>
          </Card>
        </TabPanel>

        <TabPanel value="search" activeTab={tabs.value}>
          <Card $padding="16px">
            <FormRow style={{ marginBottom: 16 }}>
              <FormGroup style={{ flex: 1 }}>
                <Label>Pattern (hex with ?? wildcards)</Label>
                <Input
                  value={searchPattern}
                  onChange={(e) => setSearchPattern(e.target.value)}
                  placeholder="48 89 5C 24 ?? 48 89 74"
                  inputSize="sm"
                />
              </FormGroup>
              <Button
                variant="primary"
                onClick={handleSearch}
                disabled={loading || !searchPattern}
                style={{ alignSelf: "flex-end" }}
              >
                Search
              </Button>
            </FormRow>
          </Card>

          {searchResults.length > 0 && (
            <Card $padding="16px" style={{ marginTop: 16 }}>
              <Text $weight="semibold" style={{ marginBottom: 8 }}>
                Found {searchResults.length} matches
              </Text>
              <Flex $direction="column" $gap="4px">
                {searchResults.slice(0, 100).map((addr, i) => (
                  <Code key={i}>{addr}</Code>
                ))}
                {searchResults.length > 100 && (
                  <Text $color="muted">...and {searchResults.length - 100} more</Text>
                )}
              </Flex>
            </Card>
          )}
        </TabPanel>

        <TabPanel value="ranges" activeTab={tabs.value}>
          <Toolbar>
            <FormGroup>
              <Input
                value={rangeFilter}
                onChange={(e) => setRangeFilter(e.target.value)}
                placeholder="r-x"
                inputSize="sm"
                style={{ width: 80 }}
              />
            </FormGroup>
            <Button size="sm" onClick={handleLoadRanges} disabled={loading}>
              Load Ranges
            </Button>
            <ToolbarSpacer />
            <Text $color="muted">{ranges.length} ranges</Text>
          </Toolbar>

          {ranges.length === 0 ? (
            <EmptyState>
              <HardDrive size={32} />
              <Text $color="muted">No ranges loaded</Text>
            </EmptyState>
          ) : (
            <Table size="sm" hoverable>
              <TableHead>
                <TableRow>
                  <TableHeader width="140px">Base</TableHeader>
                  <TableHeader width="100px" align="right">Size</TableHeader>
                  <TableHeader width="60px">Prot</TableHeader>
                  <TableHeader>File</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {ranges.map((range, i) => (
                  <TableRow key={i}>
                    <TableCell mono>{range.base}</TableCell>
                    <TableCell align="right">{formatSize(range.size)}</TableCell>
                    <TableCell>
                      <Badge>{range.protection}</Badge>
                    </TableCell>
                    <TableCell truncate>{range.file?.path || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabPanel>
      </PageContent>
    </PageContainer>
  );
}
