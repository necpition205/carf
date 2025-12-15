import { Settings, Info, Palette } from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageTitle,
  PageContent,
  Flex,
  Text,
  Card,
  Section,
  SectionTitle,
  Divider,
  Badge,
} from "../../components/ui/Layout";
import { Select, FormGroup, Label } from "../../components/ui/Input";
import { Tabs, TabPanel, useTabs } from "../../components/ui/Tabs";

// ============================================================================
// Types
// ============================================================================

export interface SettingsPageProps {
  fridaVersion: string;
}

// ============================================================================
// Component
// ============================================================================

export function SettingsPage({ fridaVersion }: SettingsPageProps) {
  const tabs = useTabs("general");

  const tabItems = [
    { id: "general", label: "General", icon: Settings },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "about", label: "About", icon: Info },
  ];

  return (
    <PageContainer>
      <PageHeader>
        <Flex $align="center" $gap="12px">
          <Settings size={18} />
          <PageTitle>Settings</PageTitle>
        </Flex>
      </PageHeader>

      <PageContent>
        <Flex $gap="24px" style={{ maxWidth: 800 }}>
          {/* Sidebar tabs */}
          <Flex $direction="column" $gap="4px" style={{ width: 180 }}>
            <Tabs
              items={tabItems}
              value={tabs.value}
              onChange={tabs.onChange}
              size="md"
              variant="default"
            />
          </Flex>

          {/* Content */}
          <Flex $direction="column" $gap="24px" style={{ flex: 1 }}>
            <TabPanel value="general" activeTab={tabs.value}>
              <Section $gap="16px">
                <SectionTitle>General Settings</SectionTitle>

                <Card $padding="16px">
                  <FormGroup>
                    <Label>RPC Timeout (ms)</Label>
                    <Select inputSize="sm" defaultValue="10000">
                      <option value="5000">5000</option>
                      <option value="10000">10000</option>
                      <option value="30000">30000</option>
                      <option value="60000">60000</option>
                    </Select>
                  </FormGroup>
                </Card>

                <Card $padding="16px">
                  <FormGroup>
                    <Label>Auto-refresh interval (ms)</Label>
                    <Select inputSize="sm" defaultValue="0">
                      <option value="0">Disabled</option>
                      <option value="1000">1000</option>
                      <option value="5000">5000</option>
                      <option value="10000">10000</option>
                    </Select>
                  </FormGroup>
                </Card>
              </Section>
            </TabPanel>

            <TabPanel value="appearance" activeTab={tabs.value}>
              <Section $gap="16px">
                <SectionTitle>Appearance</SectionTitle>

                <Card $padding="16px">
                  <FormGroup>
                    <Label>Theme</Label>
                    <Select inputSize="sm" defaultValue="dark">
                      <option value="dark">Dark</option>
                      <option value="light" disabled>Light (coming soon)</option>
                    </Select>
                  </FormGroup>
                </Card>

                <Card $padding="16px">
                  <FormGroup>
                    <Label>Font Size</Label>
                    <Select inputSize="sm" defaultValue="12">
                      <option value="11">Small (11px)</option>
                      <option value="12">Medium (12px)</option>
                      <option value="13">Large (13px)</option>
                    </Select>
                  </FormGroup>
                </Card>
              </Section>
            </TabPanel>

            <TabPanel value="about" activeTab={tabs.value}>
              <Section $gap="16px">
                <SectionTitle>About CARF</SectionTitle>

                <Card $padding="16px">
                  <Flex $direction="column" $gap="12px">
                    <Flex $justify="between" $align="center">
                      <Text $color="muted">Application</Text>
                      <Text $weight="semibold">CARF</Text>
                    </Flex>
                    <Divider $margin="0" />
                    <Flex $justify="between" $align="center">
                      <Text $color="muted">Version</Text>
                      <Badge>0.1.0</Badge>
                    </Flex>
                    <Divider $margin="0" />
                    <Flex $justify="between" $align="center">
                      <Text $color="muted">Frida Version</Text>
                      <Badge $variant="primary">{fridaVersion || "Unknown"}</Badge>
                    </Flex>
                    <Divider $margin="0" />
                    <Flex $justify="between" $align="center">
                      <Text $color="muted">Platform</Text>
                      <Text>{navigator.platform}</Text>
                    </Flex>
                  </Flex>
                </Card>

                <Card $padding="16px">
                  <Text $color="muted" $size="sm">
                    CARF (Cross-platform Application Runtime Framework) is a dynamic debugging GUI
                    built on Frida. It provides a modern interface for reverse engineering and
                    security research.
                  </Text>
                </Card>
              </Section>
            </TabPanel>
          </Flex>
        </Flex>
      </PageContent>
    </PageContainer>
  );
}
