import { useState, useMemo } from "react";
import { Cpu, Package, FileCode, RefreshCw, Copy } from "lucide-react";
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

export interface ModuleInfo {
  name: string;
  base: string;
  size: number;
  path: string;
}

export interface ExportInfo {
  type: string;
  name: string;
  address: string;
}

export interface ImportInfo {
  type: string;
  name: string;
  module: string;
  address: string;
}

export interface NativePageProps {
  hasSession: boolean;
  onRpcCall: (method: string, params?: unknown) => Promise<unknown>;
}

// ============================================================================
// Component
// ============================================================================

export function NativePage({ hasSession, onRpcCall }: NativePageProps) {
  const tabs = useTabs("modules");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Module state
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [selectedModule, setSelectedModule] = useState<ModuleInfo | null>(null);

  // Export/Import state
  const [exports, setExports] = useState<ExportInfo[]>([]);
  const [imports, setImports] = useState<ImportInfo[]>([]);

  const filteredModules = useMemo(() => {
    if (!search) return modules;
    const lower = search.toLowerCase();
    return modules.filter(
      (m) => m.name.toLowerCase().includes(lower) || m.path.toLowerCase().includes(lower)
    );
  }, [modules, search]);

  const filteredExports = useMemo(() => {
    if (!search) return exports;
    const lower = search.toLowerCase();
    return exports.filter((e) => e.name.toLowerCase().includes(lower));
  }, [exports, search]);

  const filteredImports = useMemo(() => {
    if (!search) return imports;
    const lower = search.toLowerCase();
    return imports.filter((i) => i.name.toLowerCase().includes(lower));
  }, [imports, search]);

  const loadModules = async () => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const result = await onRpcCall("enumerate_modules");
      setModules(result as ModuleInfo[]);
    } catch (e) {
      console.error("Failed to load modules:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadExports = async (moduleName: string) => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const result = await onRpcCall("enumerate_exports", { moduleName });
      setExports(result as ExportInfo[]);
    } catch (e) {
      console.error("Failed to load exports:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadImports = async (moduleName: string) => {
    if (!hasSession) return;
    setLoading(true);
    try {
      const result = await onRpcCall("enumerate_imports", { moduleName });
      setImports(result as ImportInfo[]);
    } catch (e) {
      console.error("Failed to load imports:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleSelect = (module: ModuleInfo) => {
    setSelectedModule(module);
    loadExports(module.name);
    loadImports(module.name);
  };

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const tabItems = [
    { id: "modules", label: "Modules", icon: Package, badge: modules.length || undefined },
    { id: "exports", label: "Exports", icon: FileCode, badge: exports.length || undefined },
    { id: "imports", label: "Imports", icon: FileCode, badge: imports.length || undefined },
  ];

  if (!hasSession) {
    return (
      <PageContainer>
        <EmptyState style={{ height: "100%" }}>
          <Cpu size={48} />
          <Text $size="lg" $color="muted">No active session</Text>
          <Text $color="muted">Attach to a process to view native information</Text>
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader>
        <Flex $align="center" $gap="12px">
          <Cpu size={18} />
          <PageTitle>Native</PageTitle>
          {selectedModule && (
            <Badge $variant="primary">{selectedModule.name}</Badge>
          )}
        </Flex>
      </PageHeader>

      <Toolbar>
        <Tabs items={tabItems} value={tabs.value} onChange={tabs.onChange} size="sm" />
        <ToolbarSpacer />
        <ToolbarSearch
          value={search}
          onChange={setSearch}
          placeholder={`Filter ${tabs.value}...`}
        />
        <ToolbarCount
          total={
            tabs.value === "modules"
              ? modules.length
              : tabs.value === "exports"
              ? exports.length
              : imports.length
          }
          filtered={
            tabs.value === "modules"
              ? filteredModules.length
              : tabs.value === "exports"
              ? filteredExports.length
              : filteredImports.length
          }
        />
        <ToolbarGroup>
          <IconButton
            icon={RefreshCw}
            size="sm"
            onClick={loadModules}
            disabled={loading}
            tooltip="Refresh modules"
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
            <TabPanel value="modules" activeTab={tabs.value}>
              {filteredModules.length === 0 ? (
                <EmptyState>
                  <Package size={32} />
                  <Text $color="muted">No modules loaded</Text>
                  <Button size="sm" onClick={loadModules}>
                    Load Modules
                  </Button>
                </EmptyState>
              ) : (
                <Table size="sm" hoverable>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Name</TableHeader>
                      <TableHeader width="120px">Base</TableHeader>
                      <TableHeader width="80px" align="right">Size</TableHeader>
                      <TableHeader>Path</TableHeader>
                      <TableHeader width="60px" align="center">Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredModules.map((module) => (
                      <TableRow
                        key={module.base}
                        selected={selectedModule?.base === module.base}
                        clickable
                        onClick={() => handleModuleSelect(module)}
                      >
                        <TableCell>{module.name}</TableCell>
                        <TableCell mono>{module.base}</TableCell>
                        <TableCell align="right">{formatSize(module.size)}</TableCell>
                        <TableCell truncate>{module.path}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            icon={Copy}
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(module.base);
                            }}
                            tooltip="Copy base address"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabPanel>

            <TabPanel value="exports" activeTab={tabs.value}>
              {!selectedModule ? (
                <EmptyState>
                  <FileCode size={32} />
                  <Text $color="muted">Select a module to view exports</Text>
                </EmptyState>
              ) : filteredExports.length === 0 ? (
                <EmptyState>
                  <FileCode size={32} />
                  <Text $color="muted">No exports found</Text>
                </EmptyState>
              ) : (
                <Table size="sm" hoverable>
                  <TableHead>
                    <TableRow>
                      <TableHeader width="80px">Type</TableHeader>
                      <TableHeader>Name</TableHeader>
                      <TableHeader width="140px">Address</TableHeader>
                      <TableHeader width="60px" align="center">Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredExports.map((exp, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge $variant={exp.type === "function" ? "primary" : "default"}>
                            {exp.type}
                          </Badge>
                        </TableCell>
                        <TableCell mono truncate>{exp.name}</TableCell>
                        <TableCell mono>{exp.address}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            icon={Copy}
                            size="xs"
                            onClick={() => copyToClipboard(exp.address)}
                            tooltip="Copy address"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabPanel>

            <TabPanel value="imports" activeTab={tabs.value}>
              {!selectedModule ? (
                <EmptyState>
                  <FileCode size={32} />
                  <Text $color="muted">Select a module to view imports</Text>
                </EmptyState>
              ) : filteredImports.length === 0 ? (
                <EmptyState>
                  <FileCode size={32} />
                  <Text $color="muted">No imports found</Text>
                </EmptyState>
              ) : (
                <Table size="sm" hoverable>
                  <TableHead>
                    <TableRow>
                      <TableHeader width="80px">Type</TableHeader>
                      <TableHeader>Name</TableHeader>
                      <TableHeader width="120px">Module</TableHeader>
                      <TableHeader width="140px">Address</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredImports.map((imp, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge $variant={imp.type === "function" ? "primary" : "default"}>
                            {imp.type}
                          </Badge>
                        </TableCell>
                        <TableCell mono truncate>{imp.name}</TableCell>
                        <TableCell>{imp.module}</TableCell>
                        <TableCell mono>{imp.address}</TableCell>
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
