import { useAtom } from "@effect/atom-react";
import {
  filesSearchOptionsAtom,
  filesSearchQueryAtom,
} from "@t3tools/client-runtime/state/files-search-options";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree, useFileTreeSearch, useFileTreeSelector } from "@pierre/trees/react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import { ChevronsDownUpIcon, ChevronsUpDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { type Ref, useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useFileContextMenu, type FileContextMenuAction } from "~/fileContextMenu";
import { readLocalApi } from "~/localApi";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";

import { joinHostPath } from "./filePath";
import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import {
  areAllDirectoriesExpanded,
  coalesceReentrantCalls,
  readExpandedDirectories,
  setAllDirectoriesExpanded,
  writeExpandedDirectories,
} from "./fileTreeExpansion";
import { buildFileTreePathUpdates, shouldRebuildFileTree } from "./fileTreePathReconciliation";
import { FILE_LINK_CSS, annotateFileLinks } from "./fileTreeLinks";
import { loadFileAncestors } from "./loadFileAncestors";
import { useDirectoryEntries } from "./useDirectoryEntries";
import { useProjectPathSearch } from "~/state/queries";
import { isMacPlatform } from "~/lib/utils";
import { type PreviewAction, subscribePreviewAction } from "../preview/previewActionBus";

interface FileBrowserPanelProps {
  /** Scopes the retained search query and options to one chat; defaults to the folder. */
  chatKey?: string;
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  /** Host-folder entries use absolute paths. Avoid full traversal: disable expand-all and search only
   * loaded folders. */
  hostFolder?: boolean;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId: string | null;
  answersPanelFind?: boolean;
}

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh workspace files"
            onClick={props.onRefresh}
          />
        }
      >
        <RefreshIcon refreshing={props.isPending} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? "Refreshing…" : "Refresh files"}</TooltipPopup>
    </Tooltip>
  );
}

export function FileSearchField({
  ref,
  ...props
}: {
  ariaLabel: string;
  name: string;
  onValueChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        ref={ref}
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Search files"
        data-workspace-focus-default
        data-panel-initial-focus
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
        }}
      />
    </InputGroup>
  );
}

function buildTreeEntries(
  directoryEntries: readonly ProjectEntry[],
  search: {
    readonly entries: readonly ProjectEntry[];
    readonly ancestors: readonly ProjectEntry[];
    readonly isPending: boolean;
  },
  query: string,
  /** A server search replaces the listing; a host folder only filters what is loaded. */
  serverSearch: boolean,
) {
  const searching = query.trim().length > 0 && serverSearch;
  // Search ancestors carry link and ignored details that a bare folder row would lose.
  const known = new Map(
    [...directoryEntries, ...search.ancestors].map((entry) => [entry.path, entry]),
  );
  const result = new Map(
    searching ? [] : directoryEntries.map((entry) => [entry.path, entry] as const),
  );
  if (searching && !search.isPending) {
    for (const entry of search.entries) {
      if (!result.has(entry.path)) result.set(entry.path, entry);
      const segments = entry.path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const path = segments.slice(0, index).join("/");
        if (!result.has(path)) result.set(path, known.get(path) ?? { path, kind: "directory" });
      }
    }
  }
  const entries = [...result.values()];
  const entryKinds: ReadonlyMap<string, ProjectEntry["kind"]> = new Map(
    entries.map((entry) => [entry.path, entry.kind] as const),
  );
  const treePaths = entries.map(treePath);
  // An unavailable link target cannot be listed, so it is never expanded.
  const directories = entries.filter(
    (entry) => entry.kind === "directory" && !entry.link?.unavailable,
  );
  const directoryPaths = directories.map(treePath);
  // Expanding a folder lists it, and an ignored one such as `node_modules` can hold tens of
  // thousands, so expand all skips ignored folders. They still open by hand.
  const expandableDirectoryPaths = directories.filter((entry) => !entry.ignored).map(treePath);
  const unavailableLinks: ReadonlyMap<string, string> = new Map(
    entries
      .filter((entry) => entry.link?.unavailable)
      .map((entry) => [entry.path, entry.link!.target] as const),
  );
  return {
    entries,
    entryKinds,
    treePaths,
    directoryPaths,
    expandableDirectoryPaths,
    unavailableLinks,
  };
}

export default function FileBrowserPanel({
  chatKey,
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onRefreshSelectedFile,
  workspaceMutationId,
  hostFolder = false,
  answersPanelFind = false,
}: FileBrowserPanelProps) {
  const panelPath = (relativePath: string) =>
    hostFolder ? joinHostPath(cwd, relativePath) : relativePath;
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const fileContextMenu = useFileContextMenu(environmentId);
  const {
    entries: directoryEntries,
    load,
    refresh,
    ready,
    error,
    isPending,
    loadingDirectories,
  } = useDirectoryEntries(environmentId, cwd);
  // The query belongs to the chat, so history navigation and remounts keep it.
  const searchKey = chatKey ?? `${environmentId}:${cwd}`;
  const [query, setQuery] = useAtom(filesSearchQueryAtom(searchKey));
  const [expandAll, setExpandAll] = useState(false);
  const [filesRevision, setFilesRevision] = useState("");
  const [options, setOptions] = useAtom(filesSearchOptionsAtom(searchKey));
  const { includeIgnored, includeTests } = options;
  const pathSearch = useProjectPathSearch(
    {
      environmentId,
      cwd: hostFolder ? null : cwd,
      query: query.slice(0, 256),
      files: { includeIgnored, includeTests },
      filesRevision,
    },
    200,
  );
  const {
    entries,
    entryKinds,
    treePaths,
    directoryPaths,
    expandableDirectoryPaths,
    unavailableLinks,
  } = buildTreeEntries(directoryEntries, pathSearch, query, !hostFolder);
  const entryKindsRef = useRef(entryKinds);
  const previousTreePathsRef = useRef<readonly string[] | null>(null);
  const syncingSelectionRef = useRef(false);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealsRef = useRef(new Map<string, number>());

  // Shadow-DOM row rects are unreliable; capture the composed contextmenu event's viewport position.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const showEntryContextMenu = useStableCallback(
    (item: TreeContextMenuItem, context: TreeContextMenuOpenContext) => {
      const api = readLocalApi();
      if (!api) {
        context.close();
        return;
      }
      const relativePath = item.path.replace(/\/$/, "");
      const mention = serializeComposerFileLink(panelPath(relativePath));
      const pointer = contextMenuPointerRef.current;
      const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
      const anchorRect = context.anchorElement.getBoundingClientRect();
      const position = pointerIsFresh
        ? { x: pointer.x, y: pointer.y }
        : { x: anchorRect.left, y: anchorRect.bottom };
      const fileTarget = { environmentId, filePath: relativePath, workspaceRoot: cwd };
      const fileMenuItems = fileContextMenu.buildItems(fileTarget);
      // The app menu owns focus; the tree's outside-click handler would dismiss it before click.
      context.close({ restoreFocus: !pointerIsFresh });
      void settlePromise(async () => {
        const clicked = await api.contextMenu.show(
          [
            ...fileMenuItems,
            { id: "copy-mention", label: "Copy mention" },
            { id: "add-to-chat", label: "Add to chat" },
          ],
          position,
        );
        if (clicked === null) return;
        // Open-with submenu ids are absent from the top-level item list.
        const isFileMenuAction =
          fileMenuItems.some((entry) => entry.id === clicked) || clicked.startsWith("editor:");
        if (isFileMenuAction) {
          await fileContextMenu.activate(clicked as FileContextMenuAction, fileTarget);
          return;
        }
        if (clicked === "copy-mention") {
          try {
            await writeTextToClipboard(mention);
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Failed to copy mention",
              description: error instanceof Error ? error.message : "An error occurred.",
            });
          }
          return;
        }
        if (clicked === "add-to-chat") {
          const composer = composerRef?.current;
          if (!composer) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "Open a chat for this project and try again.",
            });
            return;
          }
          const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
          if (!inserted) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "The chat isn't ready to accept input right now.",
            });
          }
        }
      }).then((result) => {
        if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
      });
    },
  );

  const loadingDirectoriesRef = useRef(loadingDirectories);
  const unavailableLinksRef = useRef(unavailableLinks);
  const dragMention = createFileTreeDragMentionController(
    hostFolder ? { mentionPath: (path: string) => joinHostPath(cwd, path) } : {},
  );
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          showEntryContextMenu(item, context);
        },
      },
    },
    dragAndDrop: { canDrop: () => false },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      // Update drag selection even for reveals so subsequent drags cannot use stale paths.
      dragMention.handleSelectionChange(selectedPaths);
      if (syncingSelectionRef.current) return;
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        treeSelectionPathRef.current = selectedPath;
        onOpenFile(panelPath(selectedPath));
      }
    },
    paths: [],
    renderRowDecoration: ({ item, row }) =>
      row.kind === "directory" &&
      row.isExpanded &&
      loadingDirectoriesRef.current.has(item.path.replace(/\/$/, ""))
        ? { icon: "t3-tree-icon-loading", title: "Loading…" }
        : unavailableLinksRef.current.has(item.path.replace(/\/$/, ""))
          ? {
              text: "Unavailable",
              title: unavailableLinksRef.current.get(item.path.replace(/\/$/, "")) ?? "",
            }
          : null,
    search: false,
    // The external field owns the query. Pierre closes its internal search
    // after a row click; that must not erase the explorer's history context.
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS + FILE_LINK_CSS,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- makes the Pierre tree model re-render row decorations when loading directories or unavailable links change
  useEffect(() => {
    if (
      loadingDirectoriesRef.current === loadingDirectories &&
      unavailableLinksRef.current === unavailableLinks
    )
      return;
    loadingDirectoriesRef.current = loadingDirectories;
    unavailableLinksRef.current = unavailableLinks;
    model.setComposition(model.getComposition());
  }, [loadingDirectories, unavailableLinks, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the chat-owned query to the imperative Pierre tree search
  useEffect(() => {
    if (query.trim()) model.setSearch(query);
    else model.closeSearch();
  }, [model, query]);
  const search = useFileTreeSearch(model);
  // Pierre restores the unfiltered tree when a search has no matches.
  const hasNoSearchMatches = search.value.trim().length > 0 && search.matchingPaths.length === 0;
  const allDirectoriesExpanded = useFileTreeSelector(model, (currentModel) =>
    areAllDirectoriesExpanded(currentModel, expandableDirectoryPaths),
  );
  const toggleAllDirectories = () => {
    const expanded = !(expandAll || allDirectoriesExpanded);
    setExpandAll(expanded);
    setAllDirectoriesExpanded(
      model,
      expanded ? expandableDirectoryPaths : directoryPaths,
      expanded,
    );
  };
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearch = () => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };
  const onPanelAction = useEffectEvent((action: PreviewAction) => {
    // Hidden panel tabs stay mounted; only the visible Files tab answers.
    if (action === "find" && searchInputRef.current?.getClientRects().length) focusSearch();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the panel find command, which fires while focus is anywhere in the right panel
  useEffect(() => {
    if (!answersPanelFind) return;
    return subscribePreviewAction(onPanelAction);
  }, [answersPanelFind]);
  const expandedPathsRef = useRef(new Set<string>());
  const expansionRoot = `${environmentId}:${cwd}`;
  // Folders expanded when the panel last unmounted; each reopens once lazy loading lists it.
  const [pendingExpandedPaths] = useState(() => new Set(readExpandedDirectories(expansionRoot)));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the Pierre tree model to load directories as they are expanded
  useEffect(() => {
    const currentPaths = new Set(directoryPaths);
    for (const path of expandedPathsRef.current) {
      if (!currentPaths.has(path)) expandedPathsRef.current.delete(path);
    }
    // Restoring calls item.expand(), which notifies subscribers synchronously.
    const loadExpanded = coalesceReentrantCalls(() => {
      if (model.isSearchOpen()) return;
      let changed = false;
      for (const path of directoryPaths) {
        const item = model.getItem(path);
        if (item?.isDirectory() && pendingExpandedPaths.delete(path) && "expand" in item) {
          item.expand();
        }
        if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
          if (!expandedPathsRef.current.has(path)) {
            expandedPathsRef.current.add(path);
            changed = true;
            void load(path.replace(/\/$/, ""));
          }
        } else {
          if (item?.isDirectory() && expandedPathsRef.current.has(path)) setExpandAll(false);
          if (expandedPathsRef.current.delete(path)) changed = true;
        }
      }
      if (changed) {
        writeExpandedDirectories(expansionRoot, [
          ...expandedPathsRef.current,
          ...pendingExpandedPaths,
        ]);
      }
    });
    loadExpanded();
    return model.subscribe(loadExpanded);
  }, [directoryPaths, expansionRoot, load, model, pendingExpandedPaths]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes ignored-file status into the imperative Pierre tree model
  useEffect(() => {
    model.setGitStatus(
      entries
        .filter((entry) => entry.ignored)
        .map((entry) => ({
          path: treePath(entry),
          status: "ignored",
        })),
    );
  }, [entries, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected file's ancestor directories and aborts on cleanup
  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    void loadFileAncestors(selectedPath, load, { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [load, selectedPath]);
  const handleSearchValueChange = (value: string) => {
    // A newer search supersedes even a reveal still waiting for its row to load.
    if (selectedPath) handledRevealsRef.current.set(selectedPath, selectedPathRevealId);
    setQuery(value);
  };
  const handleRefresh = () => {
    refresh();
    if (query.trim()) setFilesRevision(String(Date.now()));
    onRefreshSelectedFile?.();
  };
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: () => {
      refresh();
      if (query.trim()) setFilesRevision(String(Date.now()));
    },
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies tree path changes to the imperative Pierre tree model as a reset or batch update
  useEffect(() => {
    if (!ready) return;
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    const previousTreePaths = previousTreePathsRef.current;
    previousTreePathsRef.current = treePaths;
    if (previousTreePaths === null) {
      model.resetPaths(treePaths);
      return;
    }
    const updates = buildFileTreePathUpdates(previousTreePaths, treePaths);
    if (shouldRebuildFileTree(previousTreePaths, treePaths, updates)) {
      // A reset keeps old search matches, so search closes first and recomputes afterwards.
      const activeSearch = model.isSearchOpen() ? model.getSearchValue() : null;
      if (activeSearch !== null) model.closeSearch();
      model.resetPaths(treePaths, { initialExpandedPaths: [...expandedPathsRef.current] });
      if (activeSearch !== null) model.setSearch(activeSearch);
      return;
    }
    if (updates.length > 0) model.batch(updates);
  }, [ready, entryKinds, model, treePaths]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expands every directory in the Pierre tree model while expand-all is on and no search is active
  useEffect(() => {
    if (expandAll && !query.trim())
      setAllDirectoriesExpanded(model, expandableDirectoryPaths, true);
  }, [expandableDirectoryPaths, expandAll, model, query]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals an externally selected path in the Pierre tree model by expanding, selecting and scrolling
  useEffect(() => {
    if (!selectedPath) return;
    // Search belongs to the chat, not the selected file. An explicit reveal
    // must not clear the filter or override it when the explorer remounts.
    if (query.length > 0) {
      handledRevealsRef.current.set(selectedPath, selectedPathRevealId);
      return;
    }
    // Returning through history, hiding the explorer, and refreshing search
    // results must not replay an already handled reveal or steal search focus.
    if (handledRevealsRef.current.get(selectedPath) === selectedPathRevealId) return;
    const selectedKind = entryKinds.get(selectedPath);
    // An unloaded entry has no row to reveal yet; folders do, and chat links can
    // point at them.
    if (selectedKind === undefined) return;
    const selectedTreePath = selectedKind === "directory" ? `${selectedPath}/` : selectedPath;
    const selectedItem = model.getItem(selectedTreePath);
    if (!selectedItem) return;

    // Reveal only external selections; tree selections are visible and re-revealing would close search.
    const selectedInTree = model
      .getSelectedPaths()
      .some((path) => path.replace(/\/$/, "") === selectedPath);
    if (selectedInTree && treeSelectionPathRef.current === selectedPath) {
      treeSelectionPathRef.current = null;
      handledRevealsRef.current.set(selectedPath, selectedPathRevealId);
      return;
    }
    treeSelectionPathRef.current = null;
    handledRevealsRef.current.set(selectedPath, selectedPathRevealId);

    syncingSelectionRef.current = true;
    model.closeSearch();
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }

    // Directory paths include trailing slashes; ancestor lookups must match.
    const segments = selectedPath.split("/");
    let ancestorPath = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }

    if ("expand" in selectedItem) selectedItem.expand();
    selectedItem.select();
    model.scrollToPath(selectedTreePath, {
      focus: true,
      offset: "center",
    });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [entryKinds, model, query, selectedPath, selectedPathRevealId]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks symbolic link rows inside the Pierre tree's shadow DOM as it recycles them
  useEffect(() => {
    const root = panelRef.current?.querySelector("file-tree-container")?.shadowRoot;
    if (!root) return;
    const update = () => annotateFileLinks(root, entries);
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-path"],
    });
    return () => observer.disconnect();
  }, [entries]);

  return (
    <div
      ref={panelRef}
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
      onClickCapture={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        const row = event.nativeEvent
          .composedPath()
          .find(
            (target): target is HTMLElement =>
              target instanceof HTMLElement && target.hasAttribute("data-item-path"),
          );
        const path = row?.getAttribute("data-item-path");
        // Back preserves the selection. Clicking that row again emits no
        // selection change, but still needs to reopen the file.
        if (
          path &&
          path !== selectedPath &&
          row?.getAttribute("aria-selected") === "true" &&
          entryKinds.get(path) === "file"
        ) {
          treeSelectionPathRef.current = path;
          onOpenFile(panelPath(path));
        }
      }}
      // Capture runs before the tree's shadow-internal row handler opens the menu.
      onContextMenuCapture={(event) => {
        contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
      }}
      // Capture dragstart before the tree selects the row so selection sees the drag flag.
      onDragStartCapture={(event) => dragMention.handleDragStart(event.nativeEvent)}
      onDragEnd={() => dragMention.handleDragEnd((path) => model.getItem(path)?.deselect())}
      onKeyDown={(event) => {
        const isModPressed = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
        if (!isModPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f")
          return;
        event.preventDefault();
        focusSearch();
      }}
    >
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-1 in-data-[preview-panel-mode=inline]:h-9 in-data-[preview-panel-mode=inline]:min-h-9 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <RefreshFilesButton isPending={isPending} onRefresh={handleRefresh} />
        <FileSearchField
          ref={searchInputRef}
          name="project-files-search"
          ariaLabel={`Search ${projectName} files`}
          value={query}
          onValueChange={handleSearchValueChange}
        />
        {hostFolder ? null : (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant={includeIgnored || includeTests ? "secondary" : "ghost"}
                  aria-label="File search options"
                />
              }
            >
              <SlidersHorizontalIcon className="size-3.5" />
            </PopoverTrigger>
            <PopoverPopup width="sm" padding="compact" align="end" aria-label="File search options">
              <div className="flex flex-col gap-3 py-1">
                <label className="flex items-center justify-between gap-4 text-xs">
                  Include ignored files
                  <Switch
                    size="sm"
                    checked={includeIgnored}
                    onCheckedChange={(includeIgnored) => setOptions({ ...options, includeIgnored })}
                    aria-label="Include ignored files"
                  />
                </label>
                <label className="flex items-center justify-between gap-4 text-xs">
                  Include test files
                  <Switch
                    size="sm"
                    checked={includeTests}
                    onCheckedChange={(includeTests) => setOptions({ ...options, includeTests })}
                    aria-label="Include test files"
                  />
                </label>
                <p className="text-xs text-muted-foreground">node_modules is always excluded</p>
              </div>
            </PopoverPopup>
          </Popover>
        )}
        {directoryPaths.length > 0 && !hostFolder ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    expandAll || allDirectoriesExpanded
                      ? "Collapse all folders"
                      : "Expand all folders"
                  }
                  onClick={toggleAllDirectories}
                />
              }
            >
              {allDirectoriesExpanded ? (
                <ChevronsDownUpIcon className="size-3.5" />
              ) : (
                <ChevronsUpDownIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              {expandAll || allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {error || pathSearch.error ? (
        <button
          type="button"
          onClick={handleRefresh}
          className="p-4 text-left text-xs leading-relaxed text-destructive"
        >
          {error ?? pathSearch.error} Click to retry.
        </button>
      ) : null}
      {query.trim() && pathSearch.truncated && !pathSearch.isPending ? (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          Search results are incomplete. Refine your search or browse folders.
        </div>
      ) : null}
      {(!ready || pathSearch.isPending) && (
        <div
          role="status"
          className={
            entries.length > 0 && !hasNoSearchMatches
              ? "sr-only"
              : "px-3 py-1 text-xs text-muted-foreground"
          }
        >
          Loading files…
        </div>
      )}
      {hasNoSearchMatches ? (
        ready && !isPending && !pathSearch.isPending && !error && !pathSearch.error ? (
          <div role="status" className="px-3 py-4 text-xs text-muted-foreground">
            No matching files.
          </div>
        ) : null
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={pierreTreeStyle(resolvedTheme)}
        />
      )}
    </div>
  );
}
