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
import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { AppSheet } from "../../components/AppSheet";
import { projectHomeEnvironment as home } from "../../state/projectHome";
import { useEnvironmentQuery } from "../../state/query";
import { useThreadShells } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import { addLibraryToComposer } from "../../lib/projectLibrary";
import { releaseUnusedComposerAttachmentFiles } from "../../state/use-composer-drafts";
import { pickComposerFiles } from "../../lib/composerImages";
import {
  prepareTurnAttachments,
  releasePendingAttachmentUploads,
} from "../../lib/attachmentUpload";
import { assetEnvironment } from "../../state/assets";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { environmentSession } from "../../state/session";
import * as Option from "effect/Option";

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 justify-center px-2 active:opacity-60"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

/** The native entry screen keeps its existing composer and opens previews in a dismissible sheet. */
export function ProjectHome({
  projectRef,
  draftKey,
  onOpenThread,
}: {
  projectRef: ScopedProjectRef;
  draftKey: string;
  onOpenThread: (id: ThreadId) => void;
}) {
  const { environmentId, projectId } = projectRef;
  const target = useMemo(
    () => ({ environmentId, input: { projectId } }),
    [environmentId, projectId],
  );
  const query = useEnvironmentQuery(home.snapshot(target));
  const connected =
    useEnvironmentQuery(environmentCatalog.stateAtom(environmentId)).data?.phase === "connected";
  const canOperate = useAtomValue(home.open.permissionAtom(environmentId));
  const threads = useThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId && thread.projectId === projectId && !thread.deletedAt,
  );
  const [sourcePreview, setSourcePreview] = useState<{ label: string; excerpt: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [allChats, setAllChats] = useState(false);
  const [allFiles, setAllFiles] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [customizing, setCustomizing] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data;
  const preferences = data?.preferences ?? DEFAULT_PROJECT_HOME_PREFERENCES;
  const briefing = data?.briefing;
  const library = useEnvironmentQuery(
    allFiles
      ? home.list({
          environmentId,
          input: { projectId, query: search, offset: page * 25, limit: 25 },
        })
      : null,
  );
  const refresh = query.refresh;
  useEffect(() => {
    if (canOperate && connected)
      void runAtomCommand(appAtomRegistry, home.open, target).then(refresh);
  }, [canOperate, connected, target, refresh]);
  const processing =
    briefing?.status === "generating" ||
    [...(data?.files ?? []), ...(library.data?.entries ?? [])].some(
      (entry) => entry.status === "processing",
    );
  const refreshLibrary = library.refresh;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      refresh();
      refreshLibrary();
    }, 2000);
    return () => clearInterval(timer);
  }, [processing, refresh, refreshLibrary]);
  const change = async (value: ProjectHomePreferences) => {
    const result = await runAtomCommand(appAtomRegistry, home.customize, {
      environmentId,
      input: { projectId, preferences: value },
    });
    if (result._tag === "Success") refresh();
    else Alert.alert("Could not save customization", "Try again when connected.");
  };
  const upload = async () => {
    setBusy(true);
    try {
      const picked = await pickComposerFiles({ existingCount: 0 });
      if (picked.error) Alert.alert("Some files could not be selected", picked.error);
      const uploaded = await prepareTurnAttachments({
        environmentId,
        projectId,
        attachments: picked.files,
        supportsImageUploads: true,
      });
      if (uploaded.status === "ready") {
        await releasePendingAttachmentUploads(environmentId, uploaded.pendingAttachmentIds);
        await releaseUnusedComposerAttachmentFiles(picked.files);
      }
      refresh();
      library.refresh();
    } catch (error) {
      Alert.alert("Could not save files", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };
  const chats = allChats
    ? threads
    : (data?.recentThreadIds ?? [])
        .flatMap((id) => threads.filter((thread) => thread.id === id))
        .slice(0, 5);
  const chatSection = (
    <View key="chats" className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="font-t3-medium text-foreground">Recent chats</Text>
        <Action
          label={allChats ? "Show recent" : "All chats"}
          onPress={() => setAllChats(!allChats)}
        />
      </View>
      {chats.length === 0 ? (
        <Text className="text-sm text-foreground-muted">Chats you open appear here.</Text>
      ) : (
        chats.map((thread) => (
          <Pressable
            accessibilityRole="button"
            key={thread.id}
            onPress={() => onOpenThread(thread.id)}
            className={
              preferences.density === "compact"
                ? "border-b border-border py-2"
                : "border-b border-border py-3"
            }
          >
            <Text numberOfLines={1} className="text-sm text-foreground">
              {thread.title}
            </Text>
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {thread.source.status} ·{" "}
              {thread.source.latestVisibleMessage?.text ?? "Start the conversation"}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
  const librarySection = (
    <View key="library" className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="font-t3-medium text-foreground">
          Local library · {data?.fileCount ?? 0}
        </Text>
        <Action
          label={allFiles ? "Show recent" : "All files"}
          onPress={() => setAllFiles(!allFiles)}
        />
      </View>
      {allFiles && (
        <TextInput
          accessibilityLabel="Search Local library"
          placeholder="Search Local library"
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setPage(0);
          }}
          className="rounded-lg border border-border p-3 text-foreground"
        />
      )}
      {(allFiles ? (library.data?.entries ?? []) : (data?.files ?? [])).map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          onPress={() => setSelected(entry.id)}
          className={
            preferences.density === "compact"
              ? "border-b border-border py-2"
              : "border-b border-border py-3"
          }
        >
          <Text numberOfLines={1} className="text-sm text-foreground">
            {entry.title}
          </Text>
          <Text numberOfLines={1} className="text-xs text-foreground-muted">
            {entry.kind === "link" ? "Saved link" : entry.originalName} · {entry.status}
          </Text>
        </Pressable>
      ))}
      {!data?.fileCount && (
        <Text className="text-sm text-foreground-muted">
          Save documents and links. Find them in any chat with @.
        </Text>
      )}
      {allFiles && (
        <View className="flex-row justify-between">
          <Action label="Previous" disabled={!page} onPress={() => setPage(page - 1)} />
          <Action
            label="Next"
            disabled={(page + 1) * 25 >= (library.data?.total ?? 0)}
            onPress={() => setPage(page + 1)}
          />
        </View>
      )}
      <View className="flex-row">
        <Action
          label={busy ? "Saving…" : "Add files"}
          disabled={!canOperate || busy}
          onPress={() => void upload()}
        />
        <Action label="Save link" disabled={!canOperate} onPress={() => setLink("")} />
      </View>
      {link !== null && (
        <View>
          <TextInput
            accessibilityLabel="Link URL"
            value={link}
            onChangeText={setLink}
            autoCapitalize="none"
            placeholder="https://…"
            className="rounded-lg border border-border p-3 text-foreground"
          />
          <View className="flex-row">
            <Action
              label="Save"
              onPress={() =>
                void runAtomCommand(appAtomRegistry, home.saveLink, {
                  environmentId,
                  input: { projectId, url: link },
                }).then((result) => {
                  if (result._tag === "Success") {
                    setLink(null);
                    refresh();
                  }
                })
              }
            />
            <Action label="Cancel" onPress={() => setLink(null)} />
          </View>
        </View>
      )}
    </View>
  );
  return (
    <View className="w-full gap-5 px-6 pt-6">
      <View
        className="border-y border-border py-5"
        style={{ borderTopColor: preferences.accent ?? "#7c8cf8" }}
      >
        <Text className="text-xs text-foreground-muted">
          YOUR BRIEFING {briefing?.status === "generating" ? "· Updating…" : ""}
        </Text>
        <Text className="mt-3 text-xl font-t3-medium text-foreground">
          {briefing?.title || "Context for your next step"}
        </Text>
        <Text className="mt-2 text-sm text-foreground-muted">
          {briefing?.summary ||
            (briefing?.status === "failed"
              ? "Briefing unavailable. Your chat and library are ready."
              : "Preparing recent activity and saved context…")}
        </Text>
        {briefing?.nextStep && (
          <Text className="mt-3 text-sm text-foreground">Next · {briefing.nextStep}</Text>
        )}
        {briefing?.generatedAt && (
          <Text className="mt-3 text-xs text-foreground-muted">
            Generated {new Date(briefing.generatedAt).toLocaleString()}
          </Text>
        )}
        {(query.error || !connected) && (
          <Text className="text-xs text-foreground-muted">Offline · showing saved context</Text>
        )}
        <View className="flex-row flex-wrap">
          {briefing?.sources
            .filter(
              (source) => source.kind === "thread" || source.kind === "asset" || source.excerpt,
            )
            .map((source) => (
              <Action
                key={source.id}
                label={source.label}
                onPress={() =>
                  source.kind === "thread"
                    ? onOpenThread(source.id as ThreadId)
                    : source.kind === "asset"
                      ? setSelected(source.id)
                      : setSourcePreview({ label: source.label, excerpt: source.excerpt ?? "" })
                }
              />
            ))}
        </View>
      </View>
      <Action label="Customize project home" onPress={() => setCustomizing(!customizing)} />
      {customizing && (
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground">Show chats</Text>
            <Switch
              disabled={!canOperate}
              value={preferences.showChats}
              onValueChange={(showChats) => void change({ ...preferences, showChats })}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground">Show Local library</Text>
            <Switch
              disabled={!canOperate}
              value={preferences.showLibrary}
              onValueChange={(showLibrary) => void change({ ...preferences, showLibrary })}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground">Local library first</Text>
            <Switch
              disabled={!canOperate}
              value={preferences.libraryFirst}
              onValueChange={(libraryFirst) => void change({ ...preferences, libraryFirst })}
            />
          </View>
          <View className="flex-row">
            {["#7c8cf8", "#78bf9b", "#e6a660"].map((accent) => (
              <Action
                key={accent}
                label={accent}
                disabled={!canOperate}
                onPress={() => void change({ ...preferences, accent })}
              />
            ))}
          </View>
          <Action
            label={`Density: ${preferences.density}`}
            disabled={!canOperate}
            onPress={() =>
              void change({
                ...preferences,
                density: preferences.density === "compact" ? "comfortable" : "compact",
              })
            }
          />
          <TextInput
            accessibilityLabel="Briefing focus"
            defaultValue={preferences.briefingInstructions}
            placeholder="Briefing focus"
            multiline
            maxLength={2000}
            onEndEditing={(event) =>
              void change({ ...preferences, briefingInstructions: event.nativeEvent.text })
            }
            className="rounded-lg border border-border p-3 text-foreground"
          />
        </View>
      )}
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
      {sourcePreview && (
        <AppSheet title={sourcePreview.label} onClose={() => setSourcePreview(null)}>
          <ScrollView contentContainerClassName="px-5 pb-12 pt-20">
            <Text selectable className="text-sm text-foreground">
              {sourcePreview.excerpt}
            </Text>
          </ScrollView>
        </AppSheet>
      )}
      {selected && (
        <LibraryPreview
          key={selected}
          projectRef={projectRef}
          id={selected}
          onClose={() => setSelected(null)}
          onAdd={(entry) => addLibraryToComposer(environmentId, projectId, entry, draftKey)}
        />
      )}
    </View>
  );
}

function LibraryPreview({
  projectRef: { environmentId, projectId },
  id,
  onClose,
  onAdd,
}: {
  projectRef: ScopedProjectRef;
  id: string;
  onClose: () => void;
  onAdd: (entry: ProjectLibraryEntry) => Promise<void>;
}) {
  const query = useEnvironmentQuery(home.read({ environmentId, input: { projectId, id } }));
  const entry = query.data?.entry;
  const canOperate = useAtomValue(home.attach.permissionAtom(environmentId));
  const asset = useEnvironmentQuery(
    entry?.attachmentId
      ? assetEnvironment.createUrl({
          environmentId,
          input: { resource: { _tag: "attachment", attachmentId: entry.attachmentId } },
        })
      : null,
  );
  const connection = appAtomRegistry.get(
    environmentSession.preparedConnectionValueAtom(environmentId),
  );
  const url =
    asset.data && Option.isSome(connection)
      ? resolveAssetUrl(connection.value.httpBaseUrl, asset.data.relativeUrl)
      : entry?.url;
  const refresh = query.refresh;
  useEffect(() => {
    if (entry?.status !== "processing") return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [entry?.status, refresh]);
  return (
    <AppSheet title="Local library" onClose={onClose}>
      <ScrollView contentContainerClassName="gap-3 px-5 pb-12 pt-20">
        <Text className="text-xl font-t3-medium text-foreground">{entry?.title ?? "Loading…"}</Text>
        {entry && (
          <>
            <Text className="text-xs text-foreground-muted">{entry.originalName}</Text>
            <Text className="text-sm text-foreground">{entry.summary}</Text>
            <Text className="text-xs text-foreground-muted">{entry.labels.join(" · ")}</Text>
            <Action
              disabled={!canOperate}
              label="Add to chat"
              onPress={() =>
                void onAdd(entry).catch((error) => Alert.alert("Could not attach", String(error)))
              }
            />
            {url && (
              <Action
                label={entry.kind === "link" ? "Open link" : "Open original"}
                onPress={() => void Linking.openURL(url)}
              />
            )}
            {entry.status !== "ready" && (
              <Text className="text-sm text-foreground-muted">
                {entry.status === "processing"
                  ? "Processing…"
                  : "Original saved. Text processing is unavailable."}
              </Text>
            )}
            {(entry.status === "failed" || entry.status === "unsupported") && (
              <Action
                label="Retry processing"
                disabled={!canOperate}
                onPress={() =>
                  void runAtomCommand(appAtomRegistry, home.retry, {
                    environmentId,
                    input: { projectId, id },
                  }).then(refresh)
                }
              />
            )}
            <Text selectable className="text-sm text-foreground">
              {query.data?.content}
            </Text>
            {query.data?.truncated && (
              <Text className="text-xs text-foreground-muted">
                Preview truncated. Open the original for the complete document.
              </Text>
            )}
          </>
        )}
        {query.error && <Text className="text-sm text-foreground-muted">{query.error}</Text>}
      </ScrollView>
    </AppSheet>
  );
}
