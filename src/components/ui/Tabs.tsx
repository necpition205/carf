import { type ReactNode, createContext, useContext, useState } from "react";
import styled from "@emotion/styled";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { theme } from "../../styles";

// ============================================================================
// Types
// ============================================================================

export type TabSize = "sm" | "md" | "lg";
export type TabVariant = "default" | "pills" | "underline";

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  badge?: string | number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  size?: TabSize;
  variant?: TabVariant;
  fullWidth?: boolean;
  children?: ReactNode;
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  activeTab?: string; // Optional: use this instead of context
}

export interface TabsContextValue {
  activeTab: string;
}

// ============================================================================
// Context
// ============================================================================

const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabsContext() {
  return useContext(TabsContext);
}

// Standalone provider for cases where TabPanel is used outside Tabs component
export function TabsProvider({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContext.Provider value={{ activeTab: value }}>
      {children}
    </TabsContext.Provider>
  );
}

// ============================================================================
// Styles
// ============================================================================

const sizeStyles: Record<TabSize, { padding: string; fontSize: string; iconSize: number }> = {
  sm: { padding: "4px 8px", fontSize: theme.fontSize.xs, iconSize: 12 },
  md: { padding: "6px 12px", fontSize: theme.fontSize.sm, iconSize: 14 },
  lg: { padding: "8px 16px", fontSize: theme.fontSize.md, iconSize: 16 },
};

const TabsContainer = styled.div<{ $fullWidth: boolean }>`
  display: flex;
  gap: ${theme.spacing.xs};
  ${({ $fullWidth }) => $fullWidth && "width: 100%;"}
`;

const TabButton = styled(motion.button)<{
  $active: boolean;
  $size: TabSize;
  $variant: TabVariant;
  $fullWidth: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${theme.spacing.xs};
  padding: ${({ $size }) => sizeStyles[$size].padding};
  font-size: ${({ $size }) => sizeStyles[$size].fontSize};
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all ${theme.transition.fast};
  white-space: nowrap;
  ${({ $fullWidth }) => $fullWidth && "flex: 1;"}

  ${({ $variant, $active }) => {
    switch ($variant) {
      case "pills":
        return `
          background: ${$active ? theme.colors.accent.primary : "transparent"};
          color: ${$active ? "white" : theme.colors.text.secondary};
          border-radius: ${theme.borderRadius.full};
          &:hover:not(:disabled) {
            background: ${$active ? theme.colors.accent.primary : theme.colors.bg.hover};
            color: ${$active ? "white" : theme.colors.text.primary};
          }
        `;
      case "underline":
        return `
          background: transparent;
          color: ${$active ? theme.colors.accent.primary : theme.colors.text.secondary};
          border-radius: 0;
          border-bottom: 2px solid ${$active ? theme.colors.accent.primary : "transparent"};
          &:hover:not(:disabled) {
            color: ${$active ? theme.colors.accent.primary : theme.colors.text.primary};
            border-bottom-color: ${$active ? theme.colors.accent.primary : theme.colors.border.secondary};
          }
        `;
      default:
        return `
          background: ${$active ? theme.colors.accent.muted : "transparent"};
          color: ${$active ? theme.colors.accent.primary : theme.colors.text.secondary};
          border-radius: ${theme.borderRadius.md};
          &:hover:not(:disabled) {
            background: ${$active ? theme.colors.accent.muted : theme.colors.bg.hover};
            color: ${$active ? theme.colors.accent.primary : theme.colors.text.primary};
          }
        `;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  font-size: ${theme.fontSize.xs};
  font-weight: 600;
  background: ${theme.colors.accent.primary};
  color: white;
  border-radius: ${theme.borderRadius.full};
`;

const TabPanelContainer = styled.div`
  width: 100%;
`;

// ============================================================================
// Components
// ============================================================================

export function Tabs({
  items,
  value,
  onChange,
  size = "md",
  variant = "default",
  fullWidth = false,
  children,
}: TabsProps) {
  const iconSize = sizeStyles[size].iconSize;

  return (
    <TabsContext.Provider value={{ activeTab: value }}>
      <TabsContainer $fullWidth={fullWidth}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabButton
              key={item.id}
              $active={value === item.id}
              $size={size}
              $variant={variant}
              $fullWidth={fullWidth}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              whileTap={{ scale: 0.98 }}
            >
              {Icon && <Icon size={iconSize} />}
              {item.label}
              {item.badge !== undefined && <Badge>{item.badge}</Badge>}
            </TabButton>
          );
        })}
      </TabsContainer>
      {children}
    </TabsContext.Provider>
  );
}

export function TabPanel({ value, children, activeTab }: TabPanelProps) {
  const context = useTabsContext();

  // Use prop if provided, otherwise use context
  const currentTab = activeTab ?? context?.activeTab;

  // If no activeTab source, always render (fallback)
  if (currentTab === undefined) return <TabPanelContainer>{children}</TabPanelContainer>;

  // Only render if active
  if (currentTab !== value) return null;

  return <TabPanelContainer>{children}</TabPanelContainer>;
}

// ============================================================================
// Simple hook for tab state
// ============================================================================

export function useTabs(defaultValue: string) {
  const [value, setValue] = useState(defaultValue);
  return { value, onChange: setValue };
}
