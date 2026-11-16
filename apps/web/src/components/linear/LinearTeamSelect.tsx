import { requestLinear } from "./requestLinear";
import type { LinearTeam } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "~/lib/storage";
import { Button } from "../ui/button";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

export const useLinearTeamFilters = create<{
  byProject: Record<string, string>;
  select: (key: string, teamId: string) => void;
}>()(
  persist(
    (set) => ({
      byProject: {},
      select: (key, teamId) =>
        set((state) => ({ byProject: { ...state.byProject, [key]: teamId } })),
    }),
    {
      name: "t3code:linear-team-filters:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);

/** Team selection scopes issue queries; it never changes the project's Linear connection. */
export function LinearTeamSelect(props: {
  workspace: string;
  connectionKey: string;
  value: string;
  onChange: (teamId: string) => void;
}) {
  const [teams, setTeams] = useState<readonly LinearTeam[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; error: boolean } | null>(null);
  const loadKey = JSON.stringify([props.workspace, props.connectionKey, attempt]);
  const loading = settled?.key !== loadKey;
  const error = settled?.key === loadKey && settled.error;
  const request = requestLinear;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the workspace's teams through the desktop Linear bridge, ignoring replies after the inputs change
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!request) throw new Error("Linear is unavailable.");
      const loaded: LinearTeam[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await request({
          operation: "teams",
          workspace: props.workspace,
          connectionKey: props.connectionKey,
          ...(cursor ? { cursor } : {}),
        });
        if (cancelled) return;
        loaded.push(...(result.teams ?? []));
        cursor = result.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error("Repeated team cursor.");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      setTeams(
        [...new Map(loaded.map((team) => [team.id, team])).values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    })().then(
      () => {
        if (!cancelled) setSettled({ key: loadKey, error: false });
      },
      () => {
        if (!cancelled) setSettled({ key: loadKey, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.workspace, props.connectionKey, loadKey]);
  const selected = teams.find((team) => team.id === props.value);
  return (
    <div className="flex w-28 shrink-0 flex-col">
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) props.onChange(value);
        }}
      >
        <SelectTrigger
          variant="ghost"
          size="compact"
          className="w-full"
          aria-label="Filter Linear teams"
          title={selected?.name}
        >
          <SelectValue>{props.value ? (selected?.key ?? "Saved team") : "All teams"}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value="">All teams</SelectItem>
          {props.value && !selected && (
            <SelectItem value={props.value} disabled>
              {loading ? "Loading saved team…" : "Unavailable team"}
            </SelectItem>
          )}
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.key} · {team.name}
            </SelectItem>
          ))}
          {loading && (
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
              Loading teams…
            </p>
          )}
          {error && (
            <div className="p-1">
              <p role="alert" className="text-xs text-destructive">
                Could not load teams.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                Retry teams
              </Button>
            </div>
          )}
        </SelectPopup>
      </Select>
    </div>
  );
}
