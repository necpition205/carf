import { create } from "zustand";

export type TabId = "home" | "devices" | "processes" | "session" | "scripts";

export type TabState = {
  id: TabId;
  title: string;
};

export type TabsStoreState = {
  tabs: Record<TabId, TabState>;
  activeTabId: TabId;
  setActiveTabId: (id: TabId) => void;
};

const DEFAULT_TABS: Record<TabId, TabState> = {
  home: { id: "home", title: "Home" },
  devices: { id: "devices", title: "Devices" },
  processes: { id: "processes", title: "Processes" },
  session: { id: "session", title: "Session" },
  scripts: { id: "scripts", title: "Scripts" },
};

export const useTabsStore = create<TabsStoreState>((set) => ({
  tabs: DEFAULT_TABS,
  activeTabId: "home",
  setActiveTabId: (id) => set({ activeTabId: id }),
}));
