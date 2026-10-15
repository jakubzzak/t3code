import type {
  EnvironmentId,
  ProjectId,
  LinearIssue,
  LinearIssueSetupResult,
  ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { LinearIcon } from "./LinearIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { ComposerControl } from "../chat/ComposerControl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

interface Props {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspace: string;
  linkedIssue: LinearIssue | null;
  running: boolean;
  onSelect: (
    issue: LinearIssue,
    takeoverThreadIds: readonly ThreadId[],
  ) => Promise<LinearIssueSetupResult>;
  onUnlink: () => Promise<void>;
  onOpenThread: (id: ThreadId) => void;
}

export function LinearIssuePicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, { wait: 350 });
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly LinearIssue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? loadError;
  const [conflict, setConflict] = useState<{
    issue: LinearIssue;
    result: LinearIssueSetupResult;
  } | null>(null);
  const generation = useRef(0);
  const refs = useMemo(
    () =>
      [
        ...new Set([
          props.projectId,
          ...(conflict?.result.conflicts.map((item) => item.projectId) ?? []),
        ]),
      ].map((id) => scopeProjectRef(props.environmentId, id)),
    [props.environmentId, props.projectId, conflict],
  );
  const threads = useThreadShellsForProjectRefs(refs);
  const request = window.desktopBridge?.linearRequest;
  const connectionKey = JSON.stringify([props.environmentId, props.projectId]);
  const load = useCallback(
    async (after?: string, version = ++generation.current) => {
      if (!request) return;
      setLoading(true);
      setLoadError(null);
      try {
        const result = await request({
          operation: "issues",
          workspace: props.workspace,
          connectionKey,
          query: debouncedQuery,
          ...(after ? { cursor: after } : {}),
        });
        if (version !== generation.current) return;
        setIssues((previous) =>
          after
            ? [...previous, ...(result.issues ?? [])].filter(
                (issue, index, all) => all.findIndex((entry) => entry.id === issue.id) === index,
              )
            : (result.issues ?? []),
        );
        setCursor(result.nextCursor ?? null);
        setLoadedQuery(debouncedQuery);
      } catch (cause) {
        if (version === generation.current)
          setLoadError(cause instanceof Error ? cause.message : "Unable to load Linear issues.");
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [request, props.workspace, connectionKey, debouncedQuery],
  );
  useEffect(() => {
    const version = ++generation.current;
    if (open) void load(undefined, version);
    return () => {
      generation.current++;
    };
  }, [open, load]);
  const select = async (issue: LinearIssue, takeover: readonly ThreadId[] = []) => {
    if (busy || props.running) return;
    setOpen(false);
    setBusy(true);
    setActionError(null);
    setLoadError(null);
    try {
      const result = await props.onSelect(issue, takeover);
      setConflict(result.status === "conflict" ? { issue, result } : null);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Unable to set up the Linear issue. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const targetRunning =
    conflict?.result.conflicts.some((item) => {
      const live = threads.find((thread) => thread.id === item.threadId);
      return live
        ? live.session?.status === "starting" || live.session?.status === "running"
        : item.running;
    }) ?? false;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <ComposerControl
              size="xs"
              className={
                error
                  ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                  : undefined
              }
            />
          }
          disabled={busy}
          aria-label={`${props.linkedIssue ? `Linear issue ${props.linkedIssue.identifier}` : "Link Linear issue"}${error ? " — error, open for details" : ""}`}
        >
          <LinearIcon aria-hidden="true" />
          <span>
            {busy ? "Setting up issue…" : (props.linkedIssue?.identifier ?? "Linear issue")}
          </span>
        </PopoverTrigger>
        <PopoverPopup width="lg" padding="compact" side="top" align="end">
          <div className="space-y-2">
            <Input
              aria-label="Search Linear issues"
              placeholder="Search all workspace issues…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {query.trim() ? "Workspace search" : "Assigned to me"}
            </p>
            {props.running && (
              <p role="status" className="text-xs text-muted-foreground">
                Wait for the agent in this chat to finish before switching issues.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto" aria-label="Linear issues">
              {(loadedQuery === query ? issues : []).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  disabled={props.running || busy || query !== debouncedQuery}
                  className="flex w-full gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  onClick={() => void select(issue)}
                >
                  <span className="shrink-0 text-xs text-muted-foreground">{issue.identifier}</span>
                  <span className="min-w-0 truncate">{issue.title}</span>
                </button>
              ))}
              {!loading && !error && loadedQuery === query && issues.length === 0 && (
                <p className="py-3 text-center text-sm text-muted-foreground">No issues found.</p>
              )}
            </div>
            {loading && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading issues…
              </p>
            )}
            {cursor && loadedQuery === query && (
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                Load more
              </Button>
            )}
            {error && (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => {
                  setActionError(null);
                  void load();
                }}
              >
                Retry
              </Button>
            )}
            {props.linkedIssue && (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.running || busy}
                onClick={() => {
                  setBusy(true);
                  setActionError(null);
                  void props
                    .onUnlink()
                    .then(
                      () => setOpen(false),
                      (cause) =>
                        setActionError(
                          cause instanceof Error ? cause.message : "Unable to unlink issue.",
                        ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Unlink issue
              </Button>
            )}
          </div>
        </PopoverPopup>
      </Popover>
      <Dialog
        open={conflict !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setConflict(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>This worktree has an active chat</DialogTitle>
            <DialogDescription>
              Open an existing chat, or use this chat and settle the previous one. The worktree and
              conversation histories are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2">
              {conflict?.result.conflicts.map((item) => (
                <div key={item.threadId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm">{item.title}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConflict(null);
                      props.onOpenThread(item.threadId);
                    }}
                  >
                    Open existing chat
                  </Button>
                </div>
              ))}
            </div>
            {(targetRunning || props.running) && (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {props.running
                  ? "Wait for the agent in this chat to finish before switching issues."
                  : "An agent is running in the existing chat. Wait before using its worktree."}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setConflict(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || targetRunning || props.running}
              onClick={() => {
                if (conflict)
                  void select(
                    conflict.issue,
                    conflict.result.conflicts.map((item) => item.threadId),
                  );
              }}
            >
              {busy ? "Setting up…" : "Use this chat"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
