import { Tabs } from "@base-ui/react/tabs";
import { LayersIcon, ListTodoIcon, ListFilterIcon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import type { LinearIssueView } from "@t3tools/contracts";
import styles from "./linearIssueViews.module.css";

export const useLinearIssueViews = create<{
  byChat: Record<string, LinearIssueView>;
  select: (key: string, view: LinearIssueView) => void;
}>((set) => ({
  byChat: {},
  select: (key, view) => set((state) => ({ byChat: { ...state.byChat, [key]: view } })),
}));

export const linearIssueViews = [
  {
    value: "assigned",
    label: "Assigned to me",
    placeholder: "Search issues assigned to me…",
    Icon: ListTodoIcon,
    color: "text-muted-foreground",
  },
  {
    value: "triage",
    label: "Triage",
    placeholder: "Search triage issues…",
    Icon: ListFilterIcon,
    color: "text-orange-500",
  },
  {
    value: "all",
    label: "All issues",
    placeholder: "Search all workspace issues…",
    Icon: LayersIcon,
    color: "text-blue-500",
  },
] as const;

export function LinearIssueViewTabs({ view }: { view: LinearIssueView }) {
  const [initialView] = useState(view);
  const [changed, setChanged] = useState(false);
  if (!changed && view !== initialView) setChanged(true);
  return (
    <Tabs.List
      aria-label="Linear issue views"
      className="relative isolate flex shrink-0 rounded-full bg-muted/50 p-1"
    >
      <Tabs.Indicator className={styles.indicator} aria-hidden="true">
        <span
          key={view}
          className={changed ? `${styles.bubble} ${styles.moving}` : styles.bubble}
        />
      </Tabs.Indicator>
      {linearIssueViews.map(({ value, label, Icon, color }) => (
        <Tabs.Tab
          key={value}
          value={value}
          className="relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs whitespace-nowrap text-muted-foreground outline-none data-active:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${color}`} />
          {label}
        </Tabs.Tab>
      ))}
    </Tabs.List>
  );
}
