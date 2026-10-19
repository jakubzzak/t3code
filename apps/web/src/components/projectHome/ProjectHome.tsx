import { environmentCatalog } from "../../connection/catalog";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_PROJECT_HOME_PREFERENCES,
  type ProjectHomePreferences,
  type ProjectLibraryEntry,
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  BookOpenIcon,
  FileTextIcon,
  LinkIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { projectHomeEnvironment as home } from "../../state/projectHome";
import { useEnvironmentQuery } from "../../state/query";
import { useProject, useThreadShellsForProjectRefs } from "../../state/entities";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { addLibraryToComposer, uploadLibraryFile } from "../../lib/projectLibrary";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import { useAttachmentUploadStore } from "../../lib/attachmentUploadQueue";
import { Button } from "../ui/button";
import styles from "./projectHome.module.css";

export function ProjectHomeFrame(props: {
  enabled: boolean;
  projectRef: ScopedProjectRef | null;
  draftTarget: ComposerThreadTarget;
  onOpenThread: (id: ThreadId) => void;
  onOpenChanges: () => void;
  onOpenPreview: () => void;
  children: ReactNode;
}) {
  if (!props.enabled || !props.projectRef) return props.children;
  return (
    <ProjectHome
      key={`${props.projectRef.environmentId}:${props.projectRef.projectId}`}
      {...props}
      projectRef={props.projectRef}
    />
  );
}

function ProjectHome({
  projectRef,
  draftTarget,
  onOpenThread,
  onOpenChanges,
  onOpenPreview,
  children,
}: Omit<Parameters<typeof ProjectHomeFrame>[0], "enabled"> & { projectRef: ScopedProjectRef }) {
  const { environmentId, projectId } = projectRef;
  const project = useProject(projectRef);
  const refs = useMemo(() => [projectRef], [projectRef]);
  const threads = useThreadShellsForProjectRefs(refs);
  const target = useMemo(
    () => ({ environmentId, input: { projectId } }),
    [environmentId, projectId],
  );
  const query = useEnvironmentQuery(home.snapshot(target));
  const connected =
    useEnvironmentQuery(environmentCatalog.stateAtom(environmentId)).data?.phase === "connected";
  const canOperate = useAtomValue(home.open.permissionAtom(environmentId));
  const canCustomize = useAtomValue(home.customize.permissionAtom(environmentId));
  const [customizing, setCustomizing] = useState(false);
  const [allChats, setAllChats] = useState(false);
  const [allFiles, setAllFiles] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sourcePreview, setSourcePreview] = useState<{ label: string; excerpt: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const completedUploads = useAttachmentUploadStore((state) =>
    Object.entries(state.uploadsByImageId)
      .filter(([, value]) => value.status === "ready")
      .map(([id]) => id)
      .sort()
      .join(","),
  );
  const data = query.data;
  const preferences = data?.preferences ?? DEFAULT_PROJECT_HOME_PREFERENCES;
  const briefing = data?.briefing;
  const files = useEnvironmentQuery(
    allFiles
      ? home.list({
          environmentId,
          input: { projectId, query: search, offset: page * 25, limit: 25 },
        })
      : null,
  );
  const refresh = query.refresh;
  const refreshFiles = files.refresh;
  useEffect(() => {
    if (!canOperate || !connected) return;
    let active = true;
    void runAtomCommand(appAtomRegistry, home.open, target).then(() => {
      if (active) refresh();
    });
    return () => {
      active = false;
    };
  }, [canOperate, connected, target, refresh]);
  useEffect(() => {
    if (completedUploads) refresh();
  }, [completedUploads, refresh]);
  const processing =
    briefing?.status === "generating" ||
    [...(data?.files ?? []), ...(files.data?.entries ?? [])].some(
      (entry) => entry.status === "processing",
    );
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      refresh();
      if (allFiles) refreshFiles();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [processing, refresh, allFiles, refreshFiles]);
  const update = async (value: ProjectHomePreferences) => {
    const result = await runAtomCommand(appAtomRegistry, home.customize, {
      environmentId,
      input: { projectId, preferences: value },
    });
    if (result._tag === "Success") refresh();
    else setError("Could not save customization. Your previous layout is unchanged.");
  };
  const recentChats = (data?.recentThreadIds ?? [])
    .flatMap((id) => {
      const thread = threads.find((value) => value.id === id);
      return thread ? [thread] : [];
    })
    .slice(0, 5);
  const visibleChats = allChats ? threads : recentChats;
  const visibleFiles = allFiles ? (files.data?.entries ?? []) : (data?.files ?? []);
  const upload = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(selectedFiles))
        await uploadLibraryFile(environmentId, projectId, file, AbortSignal.timeout(300_000));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
      refresh();
      files.refresh();
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const chatSection = (
    <section className={styles["project-home-section"]} key="chats" aria-label="Recent chats">
      <div className={styles["project-home-section-heading"]}>
        <h2>
          Recent chats <span>{threads.length}</span>
        </h2>
        <Button variant="ghost" size="xs" onClick={() => setAllChats(!allChats)}>
          {allChats ? "Show recent" : "View all"}
        </Button>
      </div>
      {visibleChats.length === 0 ? (
        <p className={styles["project-home-empty"]}>
          Your next conversation starts above. Chats you open will appear here.
        </p>
      ) : (
        visibleChats.map((thread) => (
          <button
            key={thread.id}
            className={styles["project-home-row"]}
            onClick={() => onOpenThread(thread.id)}
          >
            <span
              className={styles["project-home-status-dot"]}
              data-status={thread.source.status}
            />
            <span className={styles["project-home-row-text"]}>
              <strong>{thread.title}</strong>
              <small>
                {thread.source.latestVisibleMessage?.text.slice(0, 110) || "Start the conversation"}
              </small>
            </span>
            <span className={styles["project-home-status"]} data-status={thread.source.status}>
              {thread.source.status.replaceAll("_", " ")}
            </span>
          </button>
        ))
      )}
    </section>
  );
  const librarySection = (
    <section className={styles["project-home-section"]} key="library" aria-label="Local library">
      <div className={styles["project-home-section-heading"]}>
        <h2>
          <BookOpenIcon size={14} /> Local library <span>{data?.fileCount ?? 0}</span>
        </h2>
        <Button variant="ghost" size="xs" onClick={() => setAllFiles(!allFiles)}>
          {allFiles ? "Show recent" : "View all"}
        </Button>
      </div>
      {allFiles && (
        <div className={styles["project-home-search"]}>
          <input
            aria-label="Search Local library"
            placeholder="Search titles, filenames, labels…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
      )}
      {visibleFiles.length === 0 ? (
        <p className={styles["project-home-empty"]}>
          Keep useful documents and links close. Available in every chat with @.
        </p>
      ) : (
        visibleFiles.map((entry) => (
          <button
            className={styles["project-home-row"]}
            key={entry.id}
            onClick={() => {
              onOpenPreview();
              setSourcePreview(null);
              setSelected(entry.id);
            }}
          >
            {entry.kind === "link" ? <LinkIcon size={15} /> : <FileTextIcon size={15} />}
            <span className={styles["project-home-row-text"]}>
              <strong>{entry.title}</strong>
              <small>
                {entry.kind === "link"
                  ? "Saved link"
                  : `${entry.originalName.split(".").at(-1)?.toUpperCase()} · ${formatAttachmentSize(entry.sizeBytes)}`}
              </small>
            </span>
            {entry.status !== "ready" && (
              <span className={styles["project-home-status"]} data-status={entry.status}>
                {entry.status === "unsupported" ? "Original saved" : entry.status}
              </span>
            )}
          </button>
        ))
      )}
      {files.error && allFiles && <p role="alert">{files.error}</p>}
      {allFiles && (
        <div className={styles["project-home-actions"]}>
          <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>{page + 1}</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={(page + 1) * 25 >= (files.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
      <div className={styles["project-home-actions"]}>
        <Button
          variant="ghost"
          size="xs"
          disabled={!canOperate || busy}
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon size={13} />
          {busy ? "Saving…" : "Add files"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={!canOperate}
          onClick={() => setLink(link === null ? "" : null)}
        >
          Save link
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void upload(event.target.files)}
      />
      {link !== null && (
        <form
          className={styles["project-home-link"]}
          onSubmit={(event) => {
            event.preventDefault();
            void runAtomCommand(appAtomRegistry, home.saveLink, {
              environmentId,
              input: { projectId, url: link },
            }).then((result) => {
              if (result._tag === "Success") {
                setLink(null);
                refresh();
                files.refresh();
              } else setError("Could not save this link. Use an HTTP or HTTPS URL.");
            });
          }}
        >
          <input
            aria-label="Link URL"
            type="url"
            required
            placeholder="https://…"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <Button size="xs" type="submit">
            Save
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setLink(null)}>
            Cancel
          </Button>
        </form>
      )}
    </section>
  );
  return (
    <div
      className={styles["project-home"]}
      style={{ "--project-home-accent": preferences.accent ?? "#7c8cf8" } as CSSProperties}
      data-density={preferences.density}
    >
      <div className={styles["project-home-main"]}>
        <header className={styles["project-home-heading"]}>
          <div>
            <p>PROJECT HOME</p>
            <h1>{project?.title ?? "Project"}</h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCustomizing(!customizing)}
            aria-expanded={customizing}
          >
            <SlidersHorizontalIcon size={15} /> Customize
          </Button>
        </header>
        {customizing && (
          <form
            className={styles["project-home-customize"]}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void update({
                accent: String(form.get("accent")),
                density: form.get("density") === "compact" ? "compact" : "comfortable",
                showChats: form.has("showChats"),
                showLibrary: form.has("showLibrary"),
                libraryFirst: form.has("libraryFirst"),
                briefingInstructions: String(form.get("briefingInstructions") ?? ""),
              });
            }}
          >
            <label>
              Accent{" "}
              <input type="color" name="accent" defaultValue={preferences.accent ?? "#7c8cf8"} />
            </label>
            <label>
              Density{" "}
              <select aria-label="Density" name="density" defaultValue={preferences.density}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label>
              <input type="checkbox" name="showChats" defaultChecked={preferences.showChats} /> Show
              chats
            </label>
            <label>
              <input type="checkbox" name="showLibrary" defaultChecked={preferences.showLibrary} />{" "}
              Show Local library
            </label>
            <label>
              <input
                type="checkbox"
                name="libraryFirst"
                defaultChecked={preferences.libraryFirst}
              />{" "}
              Local library first
            </label>
            <label className={styles["project-home-focus"]}>
              Briefing focus
              <textarea
                aria-label="Briefing focus"
                name="briefingInstructions"
                maxLength={2000}
                defaultValue={preferences.briefingInstructions}
                placeholder="For example: focus on unresolved decisions and recent changes"
              />
            </label>
            <Button type="submit" size="sm" disabled={!canCustomize}>
              Save preferences
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustomizing(false)}>
              Close
            </Button>
          </form>
        )}
        <section className={styles["project-home-briefing"]} aria-label="Project briefing">
          <div className={styles["project-home-eyebrow"]}>
            <span
              className={styles["project-home-briefing-dot"]}
              data-refreshing={briefing?.status === "generating"}
            />{" "}
            YOUR BRIEFING{" "}
            <span>
              {briefing?.status === "generating" ? (
                "Updating…"
              ) : briefing?.generatedAt ? (
                <time
                  dateTime={briefing.generatedAt}
                  aria-label={`Generated ${new Date(briefing.generatedAt).toLocaleString()}`}
                >
                  Generated{" "}
                  {new Date(briefing.generatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              ) : (
                ""
              )}
            </span>
          </div>
          <div
            className={styles["project-home-briefing-copy"]}
            key={briefing?.generatedAt ?? "empty"}
          >
            <h2>{briefing?.title || "A little context before your next step."}</h2>
            <p>
              {briefing?.summary ||
                (briefing?.status === "failed"
                  ? "Your briefing is unavailable. Chat and your saved context are ready to use."
                  : "Preparing a briefing from recent activity and saved context. You can start working now.")}
            </p>
            {briefing?.nextStep && (
              <p className={styles["project-home-next"]}>
                <span>Next</span> {briefing.nextStep}
              </p>
            )}
          </div>
          <div className={styles["project-home-sources"]}>
            {briefing?.sources.map((source) => (
              <button
                key={`${source.kind}:${source.id}`}
                onClick={() => {
                  if (source.kind === "thread") {
                    onOpenThread(source.id as ThreadId);
                    return;
                  }
                  onOpenPreview();
                  setSelected(source.kind === "asset" ? source.id : null);
                  setSourcePreview(
                    source.kind !== "asset" && source.excerpt
                      ? { label: source.label, excerpt: source.excerpt }
                      : null,
                  );
                  if (source.kind !== "asset" && !source.excerpt) onOpenChanges();
                }}
              >
                {source.label}
              </button>
            ))}
          </div>
          {briefing?.status === "failed" && briefing.generatedAt && (
            <p className={styles["project-home-muted"]}>
              Refresh failed. Showing the last successful briefing.
            </p>
          )}
          {(query.error || !connected) && (
            <p className={styles["project-home-muted"]} role="status">
              Connection unavailable. Showing saved context where available.
            </p>
          )}
        </section>
        {children}
        {error && (
          <p className={styles["project-home-error"]} role="alert">
            {error}
          </p>
        )}
        <div className={styles["project-home-columns"]}>
          {preferences.libraryFirst ? (
            <>
              {preferences.showLibrary && librarySection}
              {preferences.showChats && chatSection}
            </>
          ) : (
            <>
              {preferences.showChats && chatSection}
              {preferences.showLibrary && librarySection}
            </>
          )}
        </div>
        <p className={styles["project-home-footnote"]}>
          Local library lives with this project’s environment and is available on your connected
          devices.
        </p>
      </div>
      {sourcePreview && (
        <aside className={styles["project-library-preview"]} aria-label="Briefing source">
          <Button variant="ghost" size="sm" onClick={() => setSourcePreview(null)}>
            Close source
          </Button>
          <h3>{sourcePreview.label}</h3>
          <pre>{sourcePreview.excerpt}</pre>
        </aside>
      )}
      {selected && (
        <LibraryPreview
          key={selected}
          environmentId={environmentId}
          projectId={projectId}
          id={selected}
          onClose={() => setSelected(null)}
          onRefresh={() => {
            refresh();
            refreshFiles();
          }}
          onAdd={(entry) => addLibraryToComposer(environmentId, projectId, entry, draftTarget)}
        />
      )}
    </div>
  );
}

function LibraryPreview({
  environmentId,
  projectId,
  id,
  onClose,
  onAdd,
  onRefresh,
}: ScopedProjectRef & {
  id: string;
  onClose: () => void;
  onAdd: (entry: ProjectLibraryEntry) => Promise<void>;
  onRefresh: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  const query = useEnvironmentQuery(home.read({ environmentId, input: { projectId, id } }));
  const entry = query.data?.entry;
  const canAttach = useAtomValue(home.attach.permissionAtom(environmentId));
  const canRetry = useAtomValue(home.retry.permissionAtom(environmentId));
  const asset = useEnvironmentQuery(
    entry?.attachmentId
      ? assetEnvironment.createUrl({
          environmentId,
          input: { resource: { _tag: "attachment", attachmentId: entry.attachmentId } },
        })
      : null,
  );
  const connection = readPreparedConnection(environmentId);
  const original =
    connection && asset.data
      ? resolveAssetUrl(connection.httpBaseUrl, asset.data.relativeUrl)
      : entry?.url;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (entry?.status !== "processing") return;
    const timer = window.setInterval(query.refresh, 2000);
    return () => window.clearInterval(timer);
  }, [entry?.status, query.refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={styles["project-library-preview"]}
      aria-label="Local library preview"
    >
      <div className={styles["project-home-section-heading"]}>
        <h2>Local library</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close preview">
          <XIcon size={16} />
        </Button>
      </div>
      {query.error && <p role="alert">{query.error}</p>}
      {!entry ? (
        <p>Loading preview…</p>
      ) : (
        <>
          <h3>{entry.title}</h3>
          <p className={styles["project-home-muted"]}>{entry.originalName}</p>
          <p>{entry.summary}</p>
          <div className={styles["project-home-labels"]}>
            {entry.labels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className={styles["project-home-actions"]}>
            <Button
              size="sm"
              disabled={busy || !canAttach}
              onClick={() => {
                setBusy(true);
                void onAdd(entry)
                  .catch(() => setError("Could not attach this item. Try again."))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Adding…" : "Add to chat"}
            </Button>
            {original && (
              <a href={original} target="_blank" rel="noreferrer">
                {entry.kind === "link" ? "Open link" : "Open original"}
              </a>
            )}
          </div>
          {entry.status === "processing" && <p role="status">Processing saved content…</p>}
          {(entry.status === "failed" || entry.status === "unsupported") && (
            <div>
              <p>
                {entry.status === "failed"
                  ? "Processing failed. The original is safely saved."
                  : "Text extraction is not supported for this format. The original is safely saved."}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canRetry}
                onClick={() =>
                  void runAtomCommand(appAtomRegistry, home.retry, {
                    environmentId,
                    input: { projectId, id },
                  }).then((result) => {
                    if (result._tag === "Success") {
                      query.refresh();
                      onRefresh();
                    } else setError("Could not retry processing. Try again.");
                  })
                }
              >
                Retry processing
              </Button>
            </div>
          )}
          {original && entry.mimeType.startsWith("image/") && (
            <img src={original} alt={entry.originalName} />
          )}
          {query.data?.content && <pre>{query.data.content}</pre>}
          {query.data?.truncated && (
            <p>Preview truncated. Open the original for the complete document.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </aside>
  );
}
