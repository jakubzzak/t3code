import { requestLinear } from "./requestLinear";
import type { LinearWorkflowState } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowDownWideNarrowIcon, ClockIcon, FilterIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuGroup,
  MenuGroupLabel,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuItem,
} from "../ui/menu";
import { LinearPriorityIcon, LinearStatusIcon } from "./LinearIssueIcons";
import type { LinearIssuePreferences } from "./linearIssuePreferences";

const priorities = [
  { value: 0, label: "No priority" },
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
] as const;
const stateTypes = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
];

function ActiveDot() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
    />
  );
}

export function LinearIssueControls({
  workspace,
  connectionKey,
  teamId,
  value,
  onChange,
}: {
  workspace: string;
  connectionKey: string;
  teamId: string;
  value: LinearIssuePreferences;
  onChange: (value: LinearIssuePreferences) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [states, setStates] = useState<readonly LinearWorkflowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const request = requestLinear;
  const filtered = value.stateIds.length > 0 || value.priorities.length > 0;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const loadStates = () => {
    if (!request) return;
    const version = ++generation.current;
    setLoading(true);
    setError(false);
    setStates([]);
    void (async () => {
      const loaded: LinearWorkflowState[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await request({
          operation: "states",
          workspace,
          connectionKey,
          ...(teamId ? { teamId } : {}),
          ...(cursor ? { cursor } : {}),
        });
        if (version !== generation.current) return;
        loaded.push(...(result.states ?? []));
        cursor = result.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error("Repeated status cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      setStates(
        [...new Map(loaded.map((state) => [state.id, state])).values()].sort(
          (a, b) =>
            stateTypes.indexOf(a.type) - stateTypes.indexOf(b.type) ||
            a.position - b.position ||
            a.name.localeCompare(b.name),
        ),
      );
    })()
      .catch(() => {
        if (version === generation.current) setError(true);
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Menu
        open={filterOpen}
        onOpenChange={(open) => {
          setFilterOpen(open);
          if (open) loadStates();
          else generation.current++;
        }}
      >
        <MenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="Filter issues"
          title={filtered ? "Filter issues (active)" : "Filter issues"}
        >
          <FilterIcon aria-hidden="true" />
          {filtered && <ActiveDot />}
        </MenuTrigger>
        <MenuPopup side="top" align="start">
          <MenuGroup>
            <MenuGroupLabel>Statuses</MenuGroupLabel>
            {loading && <MenuItem disabled>Loading statuses…</MenuItem>}
            {error && (
              <MenuItem closeOnClick={false} onClick={loadStates}>
                Retry statuses
              </MenuItem>
            )}
            {!loading && !error && states.length === 0 && (
              <MenuItem disabled>No statuses available</MenuItem>
            )}
            {states.map((state) => (
              <MenuCheckboxItem
                key={state.id}
                checked={value.stateIds.includes(state.id)}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    stateIds: checked
                      ? [...value.stateIds, state.id]
                      : value.stateIds.filter((id) => id !== state.id),
                  })
                }
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex shrink-0">
                    <LinearStatusIcon
                      state={{
                        ...state,
                        progress:
                          (states.filter(
                            (item) =>
                              item.team.id === state.team.id &&
                              item.type === "started" &&
                              item.position < state.position,
                          ).length +
                            1) /
                          (states.filter(
                            (item) => item.team.id === state.team.id && item.type === "started",
                          ).length +
                            1),
                      }}
                    />
                  </span>
                  {state.name}
                  {!teamId && (
                    <span className="text-xs text-muted-foreground">{state.team.key}</span>
                  )}
                </span>
              </MenuCheckboxItem>
            ))}
            {value.stateIds
              .filter((id) => !states.some((state) => state.id === id))
              .map((id) => (
                <MenuCheckboxItem
                  key={id}
                  checked
                  closeOnClick={false}
                  onCheckedChange={() =>
                    onChange({
                      ...value,
                      stateIds: value.stateIds.filter((selected) => selected !== id),
                    })
                  }
                >
                  Saved status{!loading && " (unavailable for this team)"}
                </MenuCheckboxItem>
              ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Priorities</MenuGroupLabel>
            {priorities.map((priority) => (
              <MenuCheckboxItem
                key={priority.value}
                checked={value.priorities.includes(priority.value)}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    priorities: checked
                      ? [...value.priorities, priority.value]
                      : value.priorities.filter((p) => p !== priority.value),
                  })
                }
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex shrink-0">
                    <LinearPriorityIcon priority={priority.value} />
                  </span>
                  {priority.label}
                </span>
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
          {filtered && (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => onChange({ ...value, stateIds: [], priorities: [] })}>
                Clear filters
              </MenuItem>
            </>
          )}
        </MenuPopup>
      </Menu>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="Sort issues"
          title={value.sort === "priority" ? "Sort issues (priority)" : "Sort issues"}
        >
          <ArrowDownWideNarrowIcon aria-hidden="true" />
          {value.sort !== "updatedAt" && <ActiveDot />}
        </MenuTrigger>
        <MenuPopup side="top" align="start">
          <MenuRadioGroup
            value={value.sort}
            onValueChange={(sort) => {
              if (sort === "updatedAt" || sort === "priority") onChange({ ...value, sort });
            }}
          >
            <MenuRadioItem value="updatedAt">
              <span className="flex items-center gap-2">
                <ClockIcon aria-hidden="true" />
                Latest updated <ArrowDownIcon aria-label="Descending" />
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
            <MenuRadioItem value="priority">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="flex shrink-0">
                  <LinearPriorityIcon priority={2} />
                </span>
                Priority <ArrowDownIcon aria-label="Descending" />
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
