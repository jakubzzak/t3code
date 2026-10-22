import { useDebouncedValue } from "@tanstack/react-pacer";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useServerConfigs } from "~/state/entities";
import { waitForThreadShell } from "~/state/entities";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { randomUUID } from "~/lib/utils";
import { Tabs } from "@base-ui/react/tabs";
import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  type InboxMutation,
  type InboxNotification,
  type InboxSource,
  type ScopedProjectRef,
  type EnvironmentId,
} from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import {
  BotIcon,
  BotMessageSquareIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  InboxIcon,
  ListFilterIcon,
  MailIcon,
  MailOpenIcon,
  MessageSquareIcon,
  SettingsIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useInboxNavigation } from "./inboxNavigation";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { inboxEnvironment } from "~/state/inbox";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { readLocalApi } from "~/localApi";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";
import { SegmentedViewTabs } from "../ui/segmented-view-tabs";
import { SidebarThreadHeader, SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { InboxNotificationMetadata } from "./InboxNotificationMetadata";
import { InboxSourceLogo } from "./InboxSourceLogo";
import {
  InboxOpenOriginalAction,
  InboxSourceContent,
  InboxSummary,
} from "./InboxNotificationContent";
import { openInboxOriginal } from "./inboxSourceLink";
import { isInboxInitialLoad, isInboxDetailCurrent, nextInboxFocusKey } from "./inboxPresentation";
import styles from "./inboxSidebar.module.css";

type Entry = { environmentId: EnvironmentId; notification: InboxNotification };
const keyOf = (entry: Entry) => `${entry.environmentId}:${entry.notification.id}`;
const sources: InboxSource[] = ["slack", "linear", "superhuman"];
const shelfLabels = { delegated: "Delegated", snoozed: "Snoozed", resolved: "Settled" } as const;

function InboxAnimatedList({ children }: { children: ReactNode }) {
  const [ref] = useAutoAnimate<HTMLDivElement>({ duration: 180, easing: "ease-out" });
  return <div ref={ref}>{children}</div>;
}

export function InboxRow({
  entry,
  focused,
  hints,
  pending,
  onFocus,
  onAction,
}: {
  entry: Entry;
  focused: boolean;
  hints: boolean;
  pending: boolean;
  onFocus: () => void;
  onAction: (action: InboxMutation | "snooze-menu") => void;
}) {
  const { notification: n, environmentId } = entry;
  const config = useServerConfigs().get(environmentId);
  const settings = config ? resolveProjectSettings(config.settings, n.projectId).settings : null;
  const canWrite = useAtomValue(inboxEnvironment.mutate.permissionAtom(environmentId));
  const [opened, setOpened] = useState(false);
  const detail = useEnvironmentQuery(
    opened || focused
      ? inboxEnvironment.get({ environmentId, input: { projectId: n.projectId, id: n.id } })
      : null,
  );
  useEffect(() => {
    if (opened || focused) detail.refresh();
  }, [opened, focused, n.revision, detail.refresh]);
  const item = n.items.at(-1);
  const fullDetail = isInboxDetailCurrent(n, detail.data) ? detail.data : null;
  const content = fullDetail ?? n;
  const actions = [
    {
      label: n.state.threadId ? "Open linked agent chat" : "Agent",
      hint: "↵",
      Icon: BotIcon,
      action: { type: "delegate", startAgent: true } as const,
      primary: true,
    },
    {
      label: n.state.threadId ? "Open linked chat" : "Agent chat",
      hint: "⇧↵",
      Icon: BotMessageSquareIcon,
      action: { type: "delegate", startAgent: false } as const,
    },
    {
      label: n.state.placement === "snoozed" ? "Unsnooze" : "Snooze",
      hint: "⇧H",
      Icon: ClockIcon,
      action: "snooze-menu" as const,
    },
    {
      label: n.state.read ? "Mark as unread" : "Mark as read",
      hint: "⇧U",
      Icon: n.state.read ? MailOpenIcon : MailIcon,
      action: { type: "read", read: !n.state.read } as const,
    },
    {
      label: n.state.placement === "resolved" ? "Un-settle" : "Settle",
      hint: "E",
      Icon: n.state.placement === "resolved" ? Undo2Icon : CheckIcon,
      action: { type: "resolve", resolved: n.state.placement !== "resolved" } as const,
    },
  ];
  return (
    <article
      data-inbox-row={keyOf(entry)}
      tabIndex={focused ? 0 : -1}
      aria-label={`${n.state.read ? "Read" : "Unread"}: ${item?.title}`}
      aria-expanded={focused}
      onFocus={(event) => {
        // Action-button focus must not select, expand, or mark the notification read.
        if (event.target !== event.currentTarget) return;
        setOpened(true);
        onFocus();
      }}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("button,a")))
          event.currentTarget.focus();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.currentTarget.focus();
        void readLocalApi()
          ?.contextMenu.show([{ id: "unread", label: "Mark as unread", disabled: !canWrite }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((id) => {
            if (id === "unread") onAction({ type: "read", read: false });
          });
      }}
      className={`my-1 rounded-lg px-2.5 py-2 text-sidebar-foreground outline-none transition-colors ${focused ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/25" : "hover:bg-sidebar-row-hover/60"}`}
    >
      <InboxNotificationMetadata
        notification={n}
        trailing={
          <ChevronDownIcon
            className={`size-3 shrink-0 transition-transform ${focused ? "rotate-180" : ""}`}
          />
        }
      />
      <div
        className={`mt-1.5 flex items-start gap-1.5 ${n.state.read ? "font-normal" : "font-semibold"}`}
      >
        <span
          aria-hidden
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.state.read ? "bg-transparent" : "bg-primary"}`}
        />
        <InboxSummary
          notification={content}
          expanded={focused}
          enabled={settings?.inboxSummaryEnabled ?? false}
        />
      </div>
      <div className={styles.details} data-open={focused} inert={!focused} aria-hidden={!focused}>
        <div>
          {fullDetail ? (
            <InboxSourceContent notification={fullDetail} />
          ) : (
            <p className="py-2 text-xs text-muted-foreground">
              {detail.error ?? "Loading context…"}
            </p>
          )}
        </div>
      </div>
      {n.agentStatus === "starting" ||
      n.agentStatus === "linking" ||
      n.agentStatus === "stop-requested" ? (
        <p role="status" className="mt-1 text-2xs text-muted-foreground">
          {n.agentStatus === "stop-requested"
            ? "Stop requested…"
            : n.agentStatus === "linking"
              ? "Creating chat…"
              : "Starting agent…"}
        </p>
      ) : null}
      {n.agentError && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {n.agentError}
          <button
            type="button"
            disabled={!canWrite || pending}
            className="ml-2 underline"
            onClick={() => onAction({ type: "retry" })}
          >
            Retry
          </button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1">
        {actions
          .filter((action) => !action.primary || settings?.inboxAgentEnabled)
          .map(({ label, hint, Icon, action, primary }) => (
            <span className={`relative ${action === "snooze-menu" ? "ml-auto" : ""}`} key={label}>
              <Button
                size="icon-xs"
                variant={primary ? "default" : "ghost"}
                disabled={
                  (!canWrite &&
                    !(
                      action !== "snooze-menu" &&
                      action.type === "delegate" &&
                      n.state.threadId
                    )) ||
                  pending
                }
                aria-label={label}
                title={label}
                onClick={() => onAction(action)}
              >
                <Icon className="size-3.5" />
              </Button>
              {hints && focused && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-2 right-0 rounded bg-popover px-1 text-3xs text-popover-foreground shadow-sm"
                >
                  {hint}
                </span>
              )}
            </span>
          ))}
        <InboxOpenOriginalAction notification={n} shortcut hints={hints && focused} />
      </div>
    </article>
  );
}

export function InboxSidebarLayout({
  projects,
  chatCount,
  chatHeader,
  children,
}: {
  projects: ReadonlyArray<ScopedProjectRef>;
  chatCount: number;
  chatHeader: ReactNode;
  children: ReactNode;
}) {
  const serverConfigs = useServerConfigs();
  const tab = useInboxNavigation((state) => state.tab);
  const revealId = useInboxNavigation((state) => state.revealId);
  const revealed = useInboxNavigation((state) => state.revealed);
  const settingsGroups = useSettingsProjectGroups();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, { wait: 350 });
  const [paging, setPaging] = useState({ query: "", pages: 1 });
  const pages = paging.query === debouncedQuery ? paging.pages : 1;
  const [selectedSources, setSources] = useState(sources);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const [hints, setHints] = useState(false);
  const [sections, setSections] = useState<ReadonlySet<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, InboxNotification>>({});
  const overridesRef = useRef(overrides);
  const [undo, setUndo] = useState<Array<{ entry: Entry; commandId: CommandId }>>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingActions = useRef(new Map<string, Promise<boolean>>());
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const command = useAtomCommand(inboxEnvironment.mutate, { reportFailure: true });
  const atoms = useMemo(
    () =>
      projects.flatMap(({ environmentId, projectId }) =>
        Array.from({ length: pages }, (_, page) => ({
          environmentId,
          sourcesAtom: inboxEnvironment.sources({ environmentId, input: { projectId } }),
          atom: inboxEnvironment.list({
            environmentId,
            input: {
              projectId,
              offset: page * 100,
              ...(debouncedQuery ? { search: debouncedQuery } : {}),
            },
          }),
        })),
      ),
    [projects, debouncedQuery, pages],
  );
  const results = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          atoms.map(({ environmentId, atom, sourcesAtom }) => ({
            environmentId,
            result: get(atom),
            connections: get(sourcesAtom),
          })),
        ),
      [atoms],
    ),
  );
  const refresh = () => {
    for (const { atom } of atoms) appAtomRegistry.refresh(atom);
    for (const atom of new Set(atoms.map(({ sourcesAtom }) => sourcesAtom)))
      appAtomRegistry.refresh(atom);
  };
  useEffect(() => {
    if (!projects.length) return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState !== "visible") return;
        for (const { atom } of atoms) appAtomRegistry.refresh(atom);
        for (const atom of new Set(atoms.map(({ sourcesAtom }) => sourcesAtom)))
          appAtomRegistry.refresh(atom);
      },
      pendingOpen ? 1_000 : tab === "inbox" ? 5_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [atoms, pendingOpen, projects.length, tab]);
  const hasMore = results.some(
    ({ result }, index) =>
      index % pages === pages - 1 &&
      (Option.getOrNull(AsyncResult.value(result))?.length ?? 0) === 100,
  );
  const sourceErrors = results
    .filter((_, index) => index % pages === 0)
    .flatMap(({ connections }) =>
      (Option.getOrNull(AsyncResult.value(connections)) ?? []).filter(
        (connection) => connection.enabled && connection.error,
      ),
    );
  const loadedEntries = results
    .flatMap(({ environmentId, result }) =>
      (Option.getOrNull(AsyncResult.value(result)) ?? []).map((notification) => {
        const own = overrides[`${environmentId}:${notification.id}`];
        return {
          environmentId,
          notification: own && own.revision > notification.revision ? own : notification,
        };
      }),
    )
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => keyOf(candidate) === keyOf(entry)) === index,
    )
    .sort((a, b) => b.notification.updatedAt.localeCompare(a.notification.updatedAt));
  const revealedInScope =
    revealed &&
    (revealId !== null || query === "") &&
    projects.some(
      (project) =>
        project.environmentId === revealed.environmentId &&
        project.projectId === revealed.notification.projectId,
    );
  const revealedOverride = revealed ? overrides[keyOf(revealed)] : undefined;
  const entries =
    revealedInScope && !loadedEntries.some((entry) => keyOf(entry) === keyOf(revealed))
      ? [
          ...loadedEntries,
          {
            ...revealed,
            notification:
              revealedOverride && revealedOverride.revision > revealed.notification.revision
                ? revealedOverride
                : revealed.notification,
          },
        ]
      : loadedEntries;
  function openSettings(section: "features" | "integrations") {
    const focused = entries.find((entry) => keyOf(entry) === focusedKey);
    const projectId = focused?.notification.projectId ?? projects[0]?.projectId;
    const environmentId = focused?.environmentId ?? projects[0]?.environmentId;
    const group = settingsGroups.find((group) =>
      group.memberProjects.some(
        (member) => member.environmentId === environmentId && member.id === projectId,
      ),
    );
    const member = group?.memberProjects.find(
      (member) => member.environmentId === environmentId && member.id === projectId,
    );
    void router.navigate({
      to: section === "features" ? "/settings/features" : "/settings/integrations",
      search:
        member && group
          ? {
              project: group.projectKey,
              machine: environmentId,
              checkout: member.physicalProjectKey,
            }
          : {},
    });
  }
  async function openChat(entry: Entry) {
    const threadId = entry.notification.state.threadId;
    if (!threadId) return;
    const ref = { environmentId: entry.environmentId, threadId };
    if (!(await waitForThreadShell(ref))) {
      toastManager.add({
        type: "error",
        title: "Chat is still syncing",
        description:
          "The notification is linked. Try opening the chat again once the environment reconnects.",
      });
      return;
    }
    await router.navigate({ to: "/$environmentId/$threadId", params: ref });
  }
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    if (!pendingOpen) return;
    const entry = entries.find((item) => keyOf(item) === pendingOpen);
    if (!entry || ["starting", "linking"].includes(entry.notification.agentStatus)) return;
    setPendingOpen(null);
    if (entry.notification.agentStatus !== "failed" && entry.notification.state.threadId)
      void openChat(entry);
  }, [entries, pendingOpen, router]);
  useEffect(() => {
    if (!revealId) return;
    const entry = entries.find((candidate) => candidate.notification.id === revealId);
    if (!entry) return;
    setSources(sources);
    setUnreadOnly(false);
    setQuery("");
    setSections((current) =>
      current.has(entry.notification.state.placement)
        ? current
        : new Set(current).add(entry.notification.state.placement),
    );
    const row = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? []),
    ].find((element) => element.dataset.inboxRow === keyOf(entry));
    if (row) {
      row.focus();
      row.scrollIntoView({ block: "nearest" });
      useInboxNavigation.setState({ revealId: null });
    }
  }, [revealId, entries]);
  async function mutate(entry: Entry, action: InboxMutation, recordUndo = true) {
    if (!appAtomRegistry.get(inboxEnvironment.mutate.permissionAtom(entry.environmentId)))
      return false;
    const key = keyOf(entry);
    const previous = pendingActions.current.get(key);
    const work = (async () => {
      await previous;
      setPending((current) => new Set(current).add(key));
      const latest =
        entriesRef.current.find((candidate) => keyOf(candidate) === key)?.notification ??
        entry.notification;
      const own = overridesRef.current[key];
      const n = own && own.revision > latest.revision ? own : latest;
      const settling =
        action.type === "resolve" && action.resolved && n.state.placement !== "resolved";
      const focusOrder = settling
        ? [...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])].map(
            (row) => row.dataset.inboxRow!,
          )
        : [];
      const result = await command({
        environmentId: entry.environmentId,
        input: {
          projectId: n.projectId,
          id: n.id,
          expectedRevision: n.revision,
          commandId: CommandId.make(randomUUID()),
          action,
        },
      });
      if (result._tag === "Success") {
        const next = result.value.notification;
        overridesRef.current = { ...overridesRef.current, [key]: next };
        setOverrides(overridesRef.current);
        if (recordUndo && result.value.undoCommandId)
          setUndo((current) => [
            ...current,
            { entry: { ...entry, notification: next }, commandId: result.value.undoCommandId! },
          ]);
        if (result.value.openThread && next.state.threadId) {
          if (["starting", "linking"].includes(next.agentStatus)) setPendingOpen(key);
          else if (next.agentStatus !== "failed") await openChat({ ...entry, notification: next });
        }
        if (focusedRef.current === key) {
          if (settling && next.state.placement === "resolved") {
            const rows = [
              ...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? []),
            ];
            const visibleKeys = new Set(rows.map((row) => row.dataset.inboxRow));
            const candidates = new Map(
              entriesRef.current
                .filter((candidate) => candidate.notification.state.placement !== "resolved")
                .map((candidate) => [keyOf(candidate), candidate]),
            );
            const remainingOrder = focusOrder.filter(
              (candidate) =>
                candidate === key || (candidates.has(candidate) && visibleKeys.has(candidate)),
            );
            const nextKey = nextInboxFocusKey(remainingOrder, key);
            const nextEntry = nextKey ? candidates.get(nextKey) : undefined;
            const row = rows.find((candidate) => candidate.dataset.inboxRow === nextKey);
            if (nextEntry && row) {
              // The automatic read must leave settling as the next action undone by Cmd+Z.
              focus(nextEntry, false);
              row.focus();
              row.scrollIntoView({ block: "nearest" });
            } else {
              focusedRef.current = null;
              setFocusedKey(null);
              listRef.current?.focus();
            }
          } else if (
            next.state.placement !== n.state.placement &&
            !sections.has(next.state.placement)
          ) {
            focusedRef.current = null;
            setFocusedKey(null);
            listRef.current?.focus();
          }
        }
      }
      refresh();
      return result._tag === "Success";
    })().finally(() => {
      if (pendingActions.current.get(key) === work) {
        pendingActions.current.delete(key);
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    });
    pendingActions.current.set(key, work);
    return work;
  }
  function focus(entry: Entry, recordReadUndo = true) {
    const key = keyOf(entry);
    if (focusedRef.current === key) return;
    focusedRef.current = key;
    setFocusedKey(key);
    if (!entry.notification.state.read)
      void mutate(entry, { type: "read", read: true }, recordReadUndo);
  }
  async function action(entry: Entry, value: InboxMutation | "snooze-menu") {
    if (
      value !== "snooze-menu" &&
      value.type === "delegate" &&
      value.startAgent &&
      !entry.notification.state.threadId
    ) {
      const config = serverConfigs.get(entry.environmentId);
      if (
        !config ||
        !resolveProjectSettings(config.settings, entry.notification.projectId).settings
          .inboxAgentEnabled
      )
        return;
    }

    if (
      value !== "snooze-menu" &&
      value.type === "delegate" &&
      entry.notification.state.threadId &&
      !["linking", "starting"].includes(entry.notification.agentStatus)
    ) {
      await openChat(entry);
      return true;
    }
    if (value !== "snooze-menu") return mutate(entry, value);
    if (entry.notification.state.placement === "snoozed")
      return mutate(entry, { type: "snooze", until: null });
    const presets = resolveSnoozePresets(new Date());
    const selected = await readLocalApi()?.contextMenu.show([
      ...presets.map((preset) => ({ id: preset.id, label: preset.label })),
      { id: "custom", label: "Choose date and time…" },
    ]);
    const until =
      selected === "custom"
        ? (await requestCustomSnooze())?.snoozedUntil
        : presets.find((preset) => preset.id === selected)?.snoozedUntil;
    if (until) return mutate(entry, { type: "snooze", until });
  }
  function undoLast() {
    const last = undo.at(-1);
    if (!last) return;
    void mutate(last.entry, { type: "undo", commandId: last.commandId }, false).then((success) => {
      if (success) setUndo((current) => current.slice(0, -1));
    });
  }
  const filtered = entries.filter(
    (entry) =>
      selectedSources.includes(entry.notification.source) &&
      (!unreadOnly || !entry.notification.state.read || keyOf(entry) === focusedKey),
  );
  const visible = filtered.filter(
    ({ notification: n }) => n.state.placement === "active" || sections.has(n.state.placement),
  );
  const firstShelf = (["delegated", "snoozed", "resolved"] as const).find(
    (placement) =>
      placement === "resolved" ||
      filtered.some((entry) => entry.notification.state.placement === placement),
  );
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest("input,textarea,[contenteditable=true]")
    )
      return;
    const modifier = event.metaKey || event.ctrlKey;
    setHints(modifier);
    const entry = visible.find((candidate) => keyOf(candidate) === focusedKey);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]") ?? [])];
      const index = rows.findIndex((row) => row.dataset.inboxRow === focusedKey);
      rows[
        Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
      ]?.focus();
      return;
    }
    if (!modifier) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      undoLast();
      return;
    }
    if (!entry) return;
    let value: InboxMutation | "snooze-menu" | undefined;
    if (event.shiftKey && !event.altKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) openInboxOriginal(entry.notification);
      return;
    }
    if (event.key === "Enter") value = { type: "delegate", startAgent: !event.shiftKey };
    if (event.shiftKey && event.key.toLowerCase() === "h") value = "snooze-menu";
    if (event.shiftKey && event.key.toLowerCase() === "u")
      value = { type: "read", read: !entry.notification.state.read };
    if (!event.shiftKey && event.key.toLowerCase() === "e")
      value = { type: "resolve", resolved: true };
    if (value) {
      event.preventDefault();
      event.stopPropagation();
      void action(entry, value);
    }
  }
  const enabled = projects.length > 0;
  if (!enabled)
    return (
      <SidebarContent className="min-h-full" fixedHeader={chatHeader}>
        {children}
      </SidebarContent>
    );
  const inbox = tab === "inbox";
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) =>
        useInboxNavigation.setState({ tab: value === "inbox" ? "inbox" : "chats" })
      }
      className={styles.workspace}
    >
      <div className="px-2 pb-1">
        <SegmentedViewTabs
          value={tab}
          label="Sidebar views"
          items={[
            {
              value: "chats",
              label: "Chats",
              icon: <MessageSquareIcon className="size-3.5" />,
              count: chatCount,
            },
            {
              value: "inbox",
              label: "Inbox",
              count: entries.filter((entry) => entry.notification.state.placement === "active")
                .length,
              icon: <InboxIcon className="size-3.5" />,
            },
          ]}
        />
      </div>
      <div hidden={inbox}>{chatHeader}</div>
      <div hidden={!inbox}>
        <SidebarGroup>
          <SidebarThreadHeader
            hasProjects={false}
            projectScope={null}
            onNewProject={() => {}}
            onNewThread={() => {}}
            newThreadDisabled
            newThreadShortcutLabel={null}
            newThreadInProjectShortcutLabel={null}
            showNewThreadInProjectHint={false}
            searchInputRef={searchRef}
            searchLabel="Search notifications"
            searchQuery={query}
            onSearchQueryChange={setQuery}
            onSearchKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current?.querySelector<HTMLElement>("[data-inbox-row]")?.focus();
              }
            }}
            isSearching={query.length > 0}
            searchResultCount={0}
            activeSearchResultIndex={0}
            onClearSearch={() => setQuery("")}
            actions={
              <>
                <Popover>
                  <PopoverTrigger render={<SidebarHeaderIconButton label="Filter notifications" />}>
                    <ListFilterIcon className="size-4" />
                  </PopoverTrigger>
                  <PopoverPopup>
                    <div className="space-y-2 text-xs">
                      {sources.map((source) => (
                        <label key={source} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedSources.includes(source)}
                            onChange={(event) =>
                              setSources((current) =>
                                event.target.checked
                                  ? [...current, source]
                                  : current.filter((value) => value !== source),
                              )
                            }
                          />
                          <InboxSourceLogo source={source} />
                          {source === "superhuman"
                            ? "Superhuman"
                            : source === "slack"
                              ? "Slack"
                              : "Linear"}
                        </label>
                      ))}
                      <label className="flex items-center gap-2 border-t pt-2">
                        <input
                          type="checkbox"
                          checked={unreadOnly}
                          onChange={(event) => setUnreadOnly(event.target.checked)}
                        />
                        Unread only
                      </label>
                    </div>
                  </PopoverPopup>
                </Popover>
                <SidebarHeaderIconButton
                  label="Inbox settings"
                  onClick={() => openSettings("features")}
                >
                  <SettingsIcon className="size-4" />
                </SidebarHeaderIconButton>
              </>
            }
          />
        </SidebarGroup>
      </div>
      <div className={styles.viewport}>
        <div className={styles.track} data-inbox={inbox}>
          <div className={styles.pane} inert={inbox} aria-hidden={inbox}>
            <SidebarContent className="min-h-full">{children}</SidebarContent>
          </div>
          <div className={styles.pane} inert={!inbox} aria-hidden={!inbox}>
            <SidebarContent className="min-h-full">
              <SidebarGroup className="flex-1">
                <div
                  ref={listRef}
                  data-inbox-list
                  tabIndex={0}
                  role="region"
                  aria-label="Notifications"
                  onKeyDownCapture={keyDown}
                  onKeyUp={(event) => setHints(event.metaKey || event.ctrlKey)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setHints(false);
                      focusedRef.current = null;
                    }
                  }}
                  className="flex flex-1 flex-col outline-none"
                >
                  {sourceErrors.map((connection) => (
                    <p
                      role="alert"
                      key={`${connection.projectId}:${connection.source}`}
                      className="px-2 py-2 text-xs text-destructive"
                    >
                      {connection.source}: {connection.error}
                    </p>
                  ))}
                  {!entries.length &&
                    !results.some(({ connections }) =>
                      (Option.getOrNull(AsyncResult.value(connections)) ?? []).some(
                        (connection) => connection.enabled && connection.connected,
                      ),
                    ) && (
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        Choose this project's notification sources.
                        <button
                          type="button"
                          className="ml-1 text-primary underline"
                          onClick={() => openSettings("integrations")}
                        >
                          Open Integrations
                        </button>
                      </div>
                    )}
                  {results.some(({ result }) => result._tag === "Failure") && (
                    <p role="alert" className="px-2 py-3 text-xs text-destructive">
                      Some notifications could not be loaded.{" "}
                      <button className="underline" onClick={refresh}>
                        Retry
                      </button>
                    </p>
                  )}
                  {filtered.filter((entry) => entry.notification.state.placement === "active")
                    .length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {query || unreadOnly || selectedSources.length < sources.length
                        ? "No matching notifications"
                        : results.some(({ result }) => isInboxInitialLoad(result))
                          ? "Loading notifications…"
                          : results.some(({ result }) => result._tag === "Failure")
                            ? "Notifications unavailable"
                            : hasMore
                              ? "No active items on this page"
                              : sourceErrors.length
                                ? "Sources need attention"
                                : "Yay! 🎉 You’re all caught up with your messages."}
                    </p>
                  )}
                  {(["active", "delegated", "snoozed", "resolved"] as const).map((placement) => {
                    const group = filtered.filter(
                      (entry) => entry.notification.state.placement === placement,
                    );
                    if (placement !== "active" && placement !== "resolved" && group.length === 0)
                      return null;
                    const expanded = placement === "active" || sections.has(placement);
                    return (
                      <section
                        key={placement}
                        className={placement === firstShelf ? "mt-auto shrink-0" : "shrink-0"}
                      >
                        {placement !== "active" && (
                          <div className="mx-0.5 h-8">
                            <CollapsibleSectionHeader
                              expanded={expanded}
                              count={group.length}
                              tone={placement === "snoozed" ? "info" : "muted"}
                              onClick={() =>
                                setSections((current) => {
                                  const next = new Set(current);
                                  if (next.has(placement)) next.delete(placement);
                                  else next.add(placement);
                                  return next;
                                })
                              }
                            >
                              {shelfLabels[placement]}
                            </CollapsibleSectionHeader>
                          </div>
                        )}
                        <InboxAnimatedList>
                          {expanded &&
                            group.map((entry) => (
                              <InboxRow
                                key={keyOf(entry)}
                                entry={entry}
                                focused={focusedKey === keyOf(entry)}
                                hints={hints}
                                pending={pending.has(keyOf(entry))}
                                onFocus={() => focus(entry)}
                                onAction={(value) => {
                                  void action(entry, value).catch(() =>
                                    toastManager.add({
                                      type: "error",
                                      title: "Could not update notification",
                                    }),
                                  );
                                }}
                              />
                            ))}
                        </InboxAnimatedList>
                      </section>
                    );
                  })}
                  {hasMore && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPaging({ query: debouncedQuery, pages: pages + 1 })}
                    >
                      Load more notifications
                    </Button>
                  )}
                </div>
              </SidebarGroup>
            </SidebarContent>
          </div>
        </div>
      </div>
    </Tabs.Root>
  );
}
