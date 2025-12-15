import { useState, useMemo } from "react";
import { Apple, RefreshCw, Copy } from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageTitle,
  PageContent,
  Flex,
  Text,
  Badge,
  Spinner,
} from "../../components/ui/Layout";
import {
  Toolbar,
  ToolbarSearch,
  ToolbarCount,
  ToolbarGroup,
  ToolbarSpacer,
} from "../../components/ui/Toolbar";
import { Button, IconButton } from "../../components/ui/Button";
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

// ============================================================================
// Types
// ============================================================================

export interface ObjcPageProps {
  hasSession?: boolean;
  onRpcCall?: (method: string, params?: unknown) => Promise<unknown>;
}

// ============================================================================
// Component
// ============================================================================

export function ObjcPage({ hasSession = false, onRpcCall }: ObjcPageProps) {
  const tabs = useTabs("classes");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);

  const filteredClasses = useMemo(() => {
    if (!search) return classes;
    const lower = search.toLowerCase();
    return classes.filter((c) => c.toLowerCase().includes(lower));
  }, [classes, search]);

  const checkAvailable = async () => {
    if (!onRpcCall) return;
    try {
      const result = await onRpcCall("objc_available");
      setAvailable(result as boolean);
    } catch {
      setAvailable(false);
    }
  };

  const loadClasses = async () => {
    if (!onRpcCall) return;
    setLoading(true);
    try {
      const result = await onRpcCall("objc_enumerate_classes");
      setClasses(result as string[]);
    } catch (e) {
      console.error("Failed to load classes:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadMethods = async (className: string) => {
    if (!onRpcCall) return;
    try {
      const result = await onRpcCall("objc_get_class_methods", { className });
      setMethods((result as { name: string }[]).map((m) => m.name));
    } catch (e) {
      console.error("Failed to load methods:", e);
    }
  };

  const handleClassSelect = (className: string) => {
    setSelectedClass(className);
    loadMethods(className);
  };

  const tabItems = [
    { id: "classes", label: "Classes", badge: classes.length || undefined },
    { id: "methods", label: "Methods", badge: methods.length || undefined },
  ];

  if (!hasSession) {
    return (
      <PageContainer>
        <EmptyState style={{ height: "100%" }}>
          <Apple size={48} />
          <Text $size="lg" $color="muted">No active session</Text>
          <Text $color="muted">Attach to an iOS/macOS process to use ObjC features</Text>
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader>
        <Flex $align="center" $gap="12px">
          <Apple size={18} />
          <PageTitle>Objective-C</PageTitle>
          {available === true && <Badge $variant="success">Available</Badge>}
          {available === false && <Badge $variant="error">Not Available</Badge>}
        </Flex>
      </PageHeader>

      <Toolbar>
        <Tabs items={tabItems} value={tabs.value} onChange={tabs.onChange} size="sm" />
        <ToolbarSpacer />
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Filter..." />
        <ToolbarCount total={classes.length} filtered={filteredClasses.length} />
        <ToolbarGroup>
          <Button size="sm" onClick={checkAvailable}>
            Check
          </Button>
          <IconButton
            icon={RefreshCw}
            size="sm"
            onClick={loadClasses}
            disabled={loading || available === false}
            tooltip="Load classes"
          />
        </ToolbarGroup>
      </Toolbar>

      <PageContent style={{ padding: 0 }}>
        {loading ? (
          <EmptyState>
            <Spinner />
            <Text $color="muted">Loading...</Text>
          </EmptyState>
        ) : (
          <>
            <TabPanel value="classes" activeTab={tabs.value}>
              {filteredClasses.length === 0 ? (
                <EmptyState>
                  <Apple size={32} />
                  <Text $color="muted">No classes loaded</Text>
                  <Button size="sm" onClick={loadClasses} disabled={available === false}>
                    Load Classes
                  </Button>
                </EmptyState>
              ) : (
                <Table size="sm" hoverable>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Class Name</TableHeader>
                      <TableHeader width="60px" align="center">Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredClasses.slice(0, 500).map((cls) => (
                      <TableRow
                        key={cls}
                        selected={selectedClass === cls}
                        clickable
                        onClick={() => handleClassSelect(cls)}
                      >
                        <TableCell mono>{cls}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            icon={Copy}
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(cls);
                            }}
                            tooltip="Copy"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabPanel>

            <TabPanel value="methods" activeTab={tabs.value}>
              {!selectedClass ? (
                <EmptyState>
                  <Text $color="muted">Select a class to view methods</Text>
                </EmptyState>
              ) : methods.length === 0 ? (
                <EmptyState>
                  <Text $color="muted">No methods found</Text>
                </EmptyState>
              ) : (
                <Table size="sm" hoverable>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Method</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {methods.map((method, i) => (
                      <TableRow key={i}>
                        <TableCell mono>{method}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabPanel>
          </>
        )}
      </PageContent>
    </PageContainer>
  );
}
