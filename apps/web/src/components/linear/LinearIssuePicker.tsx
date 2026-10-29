import { requestLinear } from "./requestLinear";
import type {
  EnvironmentId,
  ProjectId,
  LinearIssue,
  LinearIssueSetupResult,
  LinearIssueView,
  ThreadId,
} from "@t3tools/contracts";
import { Tabs } from "@base-ui/react/tabs";
import { ChevronDownIcon, PlusIcon, UnlinkIcon } from "lucide-react";
import { LinearIssueViewTabs, linearIssueViews, useLinearIssueViews } from "./LinearIssueViews";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  beginLinearCreation,
  setupBackgroundLinearCreation,
  clearLinearCreation,
  useLinearCreations,
  verifyLinearCreation,
} from "./linearCreation";
import { LinearTeamSelect, useLinearTeamFilters } from "./LinearTeamSelect";
import { LinearIcon } from "./LinearIcon";
import { LinearIssueRow } from "./LinearIssueRow";
import { LinearIssueControls } from "./LinearIssueControls";
import {
  defaultLinearIssuePreferences,
  useLinearIssuePreferences,
  type LinearIssuePreferences,
} from "./linearIssuePreferences";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { Group, GroupSeparator } from "../ui/group";
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
  displayMode?: "toolbar" | "panel";
  threadId?: ThreadId;
  onCreate?: () => Promise<string>;
  onBackgroundCreated?: (issue: LinearIssue) => Promise<LinearIssueSetupResult | null>;
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
  onOpenIssue?: (issue: LinearIssue) => Promise<void>;
}

export function LinearIssuePicker(props: Props) {
  const displayMode = props.displayMode ?? "panel";
  const isPanel = displayMode === "panel";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, { wait: 350 });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly LinearIssue[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const creationKey = JSON.stringify([
    props.environmentId,
    props.threadId,
    props.projectId,
    props.workspace,
  ]);
  const view = useLinearIssueViews((state) => state.byChat[creationKey] ?? "assigned");
  const teamKey = JSON.stringify([props.environmentId, props.projectId, props.workspace]);
  const teamId = useLinearTeamFilters((state) => state.byProject[teamKey] ?? "");
  const preferences = useLinearIssuePreferences(
    (state) => state.byProject[teamKey] ?? defaultLinearIssuePreferences,
  );
  const queryKey = JSON.stringify([creationKey, teamId, view, query, preferences]);
  const debouncedKey = JSON.stringify([creationKey, teamId, view, debouncedQuery, preferences]);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRequest = useRef<string | null>(null);
  const creation = useLinearCreations((state) => state.entries[creationKey]);
  const error = actionError ?? creation?.error ?? loadError;
  const mounted = useRef(true);
  const latest = useRef(props);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [localConflict, setConflict] = useState<{
    issue: LinearIssue;
    result: LinearIssueSetupResult;
  } | null>(null);
  const conflict = localConflict ?? creation?.conflict ?? null;
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
  const request = requestLinear;
  const connectionKey = JSON.stringify([props.environmentId, props.projectId]);
  const load = useCallback(
    async (after?: string, version = ++generation.current) => {
      if (!request) return;
      setLoading(true);
      if (!after) setCursor(null);
      setLoadError(null);
      try {
        const result = await request({
          operation: "issues",
          workspace: props.workspace,
          connectionKey,
          query: debouncedQuery,
          view,
          sort: preferences.sort,
          ...(preferences.stateIds.length ? { stateIds: preferences.stateIds } : {}),
          ...(preferences.priorities.length ? { priorities: preferences.priorities } : {}),
          ...(teamId ? { teamId } : {}),
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
        setCursor(result.nextCursor === after ? null : (result.nextCursor ?? null));
        setLoadedKey(debouncedKey);
      } catch (cause) {
        if (version === generation.current)
          setLoadError(cause instanceof Error ? cause.message : "Unable to load Linear issues.");
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [
      request,
      props.workspace,
      connectionKey,
      debouncedQuery,
      teamId,
      view,
      debouncedKey,
      preferences,
    ],
  );
  useEffect(() => {
    const version = ++generation.current;
    if (open) void load(undefined, version);
    return () => {
      generation.current++;
    };
  }, [open, load]);
  const observeNextPage = useCallback(
    (sentinel: HTMLDivElement | null) => {
      if (!sentinel || !open || loading || loadError || !cursor || loadedKey !== queryKey) return;
      const key = JSON.stringify([queryKey, cursor]);
      const version = generation.current;
      const observer = new IntersectionObserver(
        (entries) => {
          if (
            version !== generation.current ||
            !entries.some((entry) => entry.isIntersecting) ||
            pageRequest.current === key
          )
            return;
          pageRequest.current = key;
          void load(cursor).finally(() => {
            if (pageRequest.current === key) pageRequest.current = null;
          });
        },
        { root: listRef.current, rootMargin: "0px 0px 96px 0px" },
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    },
    [open, loading, loadError, cursor, loadedKey, queryKey, load],
  );
  const changeTeam = useCallback(
    (value: string) => {
      if (value === teamId) return;
      generation.current++;
      setLoadedKey(null);
      setCursor(null);
      if (listRef.current) listRef.current.scrollTop = 0;
      useLinearTeamFilters.getState().select(teamKey, value);
    },
    [teamKey, teamId],
  );
  const changePreferences = (value: LinearIssuePreferences) => {
    generation.current++;
    setLoadedKey(null);
    setCursor(null);
    if (listRef.current) listRef.current.scrollTop = 0;
    useLinearIssuePreferences.getState().select(teamKey, value);
  };
  const select = async (issue: LinearIssue, takeover: readonly ThreadId[] = []) => {
    if (busy || props.running) return;
    setOpen(false);
    setBusy(true);
    setActionError(null);
    setLoadError(null);
    try {
      const result = await props.onSelect(issue, takeover);
      setConflict(result.status === "conflict" ? { issue, result } : null);
      if (
        result.status === "linked" &&
        useLinearCreations.getState().entries[creationKey]?.issue?.id === issue.id
      )
        clearLinearCreation(creationKey);
      if (result.status === "linked") {
        try {
          await props.onOpenIssue?.(issue);
        } catch (cause) {
          throw new Error(
            `Issue linked to this chat, but Linear could not open: ${cause instanceof Error ? cause.message : "Please retry opening the Linear panel."}`,
            { cause },
          );
        }
      }
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Unable to set up the Linear issue. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const selectCreated = useRef(select);
  useLayoutEffect(() => {
    latest.current = props;
    selectCreated.current = select;
  });
  const createIssue = () => {
    if (!props.onCreate || props.running || busy) return;
    setOpen(false);
    void beginLinearCreation({
      key: creationKey,
      workspace: props.workspace,
      connectionKey,
      open: props.onCreate,
      onCreated: (issue) => {
        if (
          (!mounted.current ||
            latest.current.environmentId !== props.environmentId ||
            latest.current.threadId !== props.threadId) &&
          props.onBackgroundCreated
        ) {
          void setupBackgroundLinearCreation(creationKey, issue, () =>
            props.onBackgroundCreated!(issue),
          );
          return;
        }
        if (
          mounted.current &&
          latest.current.workspace === props.workspace &&
          latest.current.projectId === props.projectId &&
          !latest.current.running &&
          !latest.current.linkedIssue
        )
          void selectCreated.current(issue);
      },
    });
  };
  const dismissConflict = () => {
    if (conflict?.issue.id === creation?.issue?.id) clearLinearCreation(creationKey);
    setConflict(null);
  };
  const targetRunning =
    conflict?.result.conflicts.some((item) => {
      const live = threads.find((thread) => thread.id === item.threadId);
      return live
        ? live.runtime?.status === "starting" || live.runtime?.status === "running"
        : item.running;
    }) ?? false;
  const creationDisabledReason = props.running
    ? "Wait for the agent in this chat to finish before creating an issue."
    : busy
      ? "Wait for issue setup to finish."
      : creation
        ? "Finish or dismiss the current issue creation first."
        : !props.onCreate
          ? "Issue creation is unavailable for this chat."
          : null;
  const changeView = (value: unknown) => {
    if (value === view || !linearIssueViews.some((item) => item.value === value)) return;
    generation.current++;
    setLoadedKey(null);
    setCursor(null);
    if (listRef.current) listRef.current.scrollTop = 0;
    useLinearIssueViews.getState().select(creationKey, value as LinearIssueView);
  };
  const navigateIssues = (event: KeyboardEvent<HTMLElement>) => {
    if (
      (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const index = buttons.findIndex((button) => button === event.target);
    if (index === -1 && (event.target !== searchRef.current || event.key === "ArrowUp")) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && index === 0) {
      searchRef.current?.focus();
    } else {
      buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  };
  const openLinkedIssue = async () => {
    if (!props.linkedIssue || !props.onOpenIssue) {
      return;
    }
    setActionError(null);
    try {
      await props.onOpenIssue(props.linkedIssue);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to open the Linear issue.");
    }
  };
  const ActionGroup = isPanel ? "div" : Group;
  const primaryProps = {
    panel: isPanel,
    part: "primary" as const,
    size: "xs" as const,
    variant: "outline" as const,
    tone: error ? ("destructive" as const) : ("default" as const),
    disabled: busy || creation?.status === "setting-up",
    "aria-label": `${props.linkedIssue ? `Open Linear issue ${props.linkedIssue.identifier}` : "Link Linear issue"}${error ? (props.linkedIssue ? " — error, choose an issue for details" : " — error, open for details") : ""}`,
  };
  const issueLabel = (
    <>
      <LinearIcon
        aria-hidden="true"
        className={isPanel ? THREAD_DETAILS_PANEL_ICON_CLASS : undefined}
      />
      <ComposerContextLabel displayMode={displayMode}>
        {busy ? "Setting up issue…" : (props.linkedIssue?.identifier ?? "Linear issue")}
      </ComposerContextLabel>
    </>
  );
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <ActionGroup
          role="group"
          aria-label="Linear issue"
          {...(isPanel ? { className: THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS } : {})}
        >
          {props.linkedIssue && props.onOpenIssue ? (
            <ThreadDetailsControl {...primaryProps} onClick={() => void openLinkedIssue()}>
              {issueLabel}
            </ThreadDetailsControl>
          ) : (
            <PopoverTrigger render={<ThreadDetailsControl {...primaryProps} />}>
              {issueLabel}
            </PopoverTrigger>
          )}
          {isPanel ? (
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
          ) : (
            <GroupSeparator />
          )}
          <PopoverTrigger
            render={
              <ThreadDetailsControl
                panel={isPanel}
                part="secondary"
                size="icon-xs"
                variant="outline"
                tone={error ? "destructive" : "default"}
              />
            }
            disabled={busy || creation?.status === "setting-up"}
            aria-label="Choose Linear issue"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={isPanel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-4"}
            />
          </PopoverTrigger>
        </ActionGroup>
        <PopoverPopup
          width="lg"
          padding="compact"
          side={isPanel ? "bottom" : "top"}
          align="end"
          initialFocus={searchRef}
        >
          <div className="flex h-96 max-h-[calc(var(--available-height)-1rem)] flex-col">
            <Tabs.Root
              value={view}
              onValueChange={changeView}
              className="flex min-h-0 flex-1 flex-col gap-2"
            >
              <div className="flex shrink-0 items-center gap-1">
                <LinearTeamSelect
                  workspace={props.workspace}
                  connectionKey={connectionKey}
                  value={teamId}
                  onChange={changeTeam}
                />
                <div className="min-w-0 flex-1">
                  <Input
                    ref={searchRef}
                    aria-label="Search Linear issues"
                    placeholder={linearIssueViews.find((item) => item.value === view)?.placeholder}
                    value={query}
                    onKeyDown={navigateIssues}
                    onChange={(event) => {
                      if (listRef.current) listRef.current.scrollTop = 0;
                      setQuery(event.target.value);
                    }}
                  />
                </div>
              </div>
              <LinearIssueViewTabs view={view} />
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
              <Tabs.Panel
                value={view}
                ref={listRef}
                className="min-h-0 flex-1 space-y-1 overflow-y-auto"
                aria-label="Linear issues"
                aria-busy={loading}
                onKeyDown={navigateIssues}
              >
                {(loadedKey === queryKey ? issues : []).map((issue) => (
                  <LinearIssueRow
                    key={issue.id}
                    issue={issue}
                    showAssignee={view !== "assigned"}
                    disabled={props.running || busy || query !== debouncedQuery}
                    onSelect={() => void select(issue)}
                  />
                ))}
                {!loading && !error && loadedKey === queryKey && issues.length === 0 && (
                  <p className="py-3 text-center text-sm text-muted-foreground">No issues found.</p>
                )}
                <div ref={observeNextPage} className="h-px" aria-hidden="true" />
              </Tabs.Panel>
              {loading && (
                <p role="status" className="text-xs text-muted-foreground">
                  Loading issues…
                </p>
              )}
              {error && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => {
                    setActionError(null);
                    void load(loadedKey === queryKey && cursor ? cursor : undefined);
                  }}
                >
                  Retry
                </Button>
              )}
              {creation?.status === "error" && creation.issueId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void verifyLinearCreation(creationKey)}
                >
                  Retry created issue
                </Button>
              )}
            </Tabs.Root>
            <div className="mt-2 flex shrink-0 flex-col gap-2 border-t pt-2">
              {creationDisabledReason && !props.running && (
                <p className="text-xs text-muted-foreground" role="status">
                  {creationDisabledReason}
                </p>
              )}
              {creation?.status === "error" && (
                <Button variant="ghost" size="sm" onClick={() => clearLinearCreation(creationKey)}>
                  Dismiss creation error
                </Button>
              )}
              <div className="flex items-center justify-between gap-2">
                <LinearIssueControls
                  key={JSON.stringify([connectionKey, props.workspace, teamId])}
                  workspace={props.workspace}
                  connectionKey={connectionKey}
                  teamId={teamId}
                  value={preferences}
                  onChange={changePreferences}
                />
                <div className="flex items-center gap-1">
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
                      <UnlinkIcon aria-hidden="true" />
                      Unlink issue
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={creationDisabledReason !== null}
                    title={creationDisabledReason ?? undefined}
                    onClick={createIssue}
                  >
                    <PlusIcon aria-hidden="true" />
                    Create issue
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      <Dialog
        open={creation?.status === "ready" && Boolean(creation.issue) && !conflict && !busy}
        onOpenChange={(value) => {
          if (!value) clearLinearCreation(creationKey);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {props.linkedIssue ? "Switch to the new Linear issue?" : "Use the new Linear issue?"}
            </DialogTitle>
            <DialogDescription>
              {creation?.issue?.identifier}: {creation?.issue?.title}. Set up its branch and
              worktree for this chat. Your conversation is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {props.running && (
              <p role="status">
                Wait for the agent in this chat to finish before switching issues.
              </p>
            )}
            {(actionError || creation?.error) && (
              <p role="alert" className="text-sm text-destructive">
                {actionError ?? creation?.error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => clearLinearCreation(creationKey)}>
              Keep current chat
            </Button>
            <Button
              disabled={props.running || busy}
              onClick={() => {
                if (creation?.issue) void select(creation.issue);
              }}
            >
              Use this issue
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={conflict !== null}
        onOpenChange={(value) => {
          if (!value && !busy) dismissConflict();
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
                      dismissConflict();
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
            <Button variant="ghost" disabled={busy} onClick={dismissConflict}>
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
