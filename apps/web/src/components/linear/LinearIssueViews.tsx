import { LayersIcon, ListTodoIcon, ListFilterIcon } from "lucide-react";
import { create } from "zustand";
import type { LinearIssueView } from "@t3tools/contracts";
import { SegmentedViewTabs } from "../ui/segmented-view-tabs";

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
  return (
    <SegmentedViewTabs
      value={view}
      label="Linear issue views"
      items={linearIssueViews.map(({ value, label, Icon, color }) => ({
        value,
        label,
        icon: <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${color}`} />,
      }))}
    />
  );
}
