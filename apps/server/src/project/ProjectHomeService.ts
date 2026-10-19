import {
  ProjectHomeError,
  type ProjectId,
  type ProjectHomeSnapshot,
  type ProjectHomePreferences,
  type ThreadId,
  type ProjectLibraryListInput,
  type ProjectLibraryEntry,
  type ProjectLibraryPreview,
  type ProjectLibraryAttachment,
  type ProjectBriefingSource,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerConfig from "../config.ts";
import * as Projects from "../orchestration-v2/ProjectStore.ts";
import * as Projections from "../orchestration-v2/ProjectionStore.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Settings from "../serverSettings.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as Store from "./ProjectHomeStore.ts";
import { createPendingAttachmentId, resolveAttachmentPathById } from "../attachmentStore.ts";

const isProjectHomeError = Schema.is(ProjectHomeError);
const PREVIEW_LIMIT = 128_000;
const textMime = (mime: string, name: string) =>
  mime.startsWith("text/") ||
  /(?:json|xml|javascript|yaml)/i.test(mime) ||
  /\.(?:md|txt|csv|json|jsonl|yaml|yml|xml|html|log|ts|js|py|rs|go)$/i.test(name);

export class ProjectHomeService extends Context.Service<
  ProjectHomeService,
  {
    readonly validateProject: (projectId: ProjectId) => Effect.Effect<void, ProjectHomeError>;
    readonly retainUpload: (
      input: Store.RetainProjectUpload,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly open: (projectId: ProjectId) => Effect.Effect<ProjectHomeSnapshot, ProjectHomeError>;
    readonly snapshot: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectHomeSnapshot, ProjectHomeError>;
    readonly customize: (
      projectId: ProjectId,
      preferences: ProjectHomePreferences,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly visit: (
      projectId: ProjectId,
      threadId: ThreadId,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly list: (
      input: ProjectLibraryListInput,
    ) => Effect.Effect<
      { entries: ReadonlyArray<ProjectLibraryEntry>; total: number },
      ProjectHomeError
    >;
    readonly read: (
      projectId: ProjectId,
      id: string,
    ) => Effect.Effect<ProjectLibraryPreview, ProjectHomeError>;
    readonly saveLink: (
      projectId: ProjectId,
      url: string,
    ) => Effect.Effect<ProjectLibraryEntry, ProjectHomeError>;
    readonly retry: (projectId: ProjectId, id: string) => Effect.Effect<void, ProjectHomeError>;
    readonly attach: (
      projectId: ProjectId,
      id: string,
    ) => Effect.Effect<ProjectLibraryAttachment, ProjectHomeError>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/project/ProjectHomeService") {}

const make = Effect.gen(function* () {
  const store = yield* Store.ProjectHomeStore;
  const projects = yield* Projects.ProjectStoreV2;
  const projections = yield* Projections.ProjectionStoreV2;
  const generation = yield* Generation.TextGeneration;
  const settings = yield* Settings.ServerSettingsService;
  const git = yield* Git.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const queuedAssets = new Set<string>();

  const project = (projectId: ProjectId) =>
    projects.get(projectId).pipe(
      Effect.mapError(
        (cause) => new ProjectHomeError({ projectId, operation: "find project", cause }),
      ),
      Effect.flatMap((value) =>
        Option.isSome(value)
          ? Effect.succeed(value.value)
          : Effect.fail(new ProjectHomeError({ projectId, operation: "find project" })),
      ),
    );
  const validateProject = (projectId: ProjectId) => project(projectId).pipe(Effect.asVoid);
  const read = (projectId: ProjectId, id: string) =>
    validateProject(projectId).pipe(
      Effect.andThen(store.get(projectId, id)),
      Effect.flatMap((value) =>
        value
          ? Effect.succeed(value)
          : Effect.fail(new ProjectHomeError({ projectId, operation: "find library item" })),
      ),
    );
  const generate = (kind: "asset" | "briefing", context: string, instructions = "") =>
    Effect.gen(function* () {
      const currentSettings = yield* settings.getSettings;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-context-" });
      return yield* generation.generateProjectContext({
        kind,
        context,
        instructions,
        cwd,
        modelSelection: currentSettings.textGenerationModelSelection,
      });
    }).pipe(Effect.timeout("2 minutes"), Effect.scoped);

  const extract = (entry: ProjectLibraryEntry) =>
    Effect.gen(function* () {
      if (entry.url !== null) {
        // Only explicitly saved HTTP links reach here. No environment credentials are forwarded.
        const response = yield* http
          .get(entry.url)
          .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
        const mime = response.headers["content-type"] ?? "text/plain";
        if (!textMime(mime, entry.originalName)) return null;
        let length = 0;
        const text = yield* response.stream.pipe(
          Stream.decodeText(),
          Stream.takeWhile(() => length < PREVIEW_LIMIT),
          Stream.map((chunk) => {
            const remaining = PREVIEW_LIMIT - length;
            length += chunk.length;
            return chunk.slice(0, remaining);
          }),
          Stream.runFold(
            () => "",
            (acc, chunk) => acc + chunk,
          ),
        );
        return {
          content: mime.includes("html")
            ? text
                .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : text,
          truncated: length >= PREVIEW_LIMIT,
        };
      }
      if (!textMime(entry.mimeType, entry.originalName)) return null;
      const original =
        entry.attachmentId &&
        resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: entry.attachmentId,
        });
      if (!original)
        return yield* Effect.fail(
          new ProjectHomeError({ projectId: entry.projectId, operation: "read original" }),
        );
      const content = yield* fs.stream(original, { bytesToRead: PREVIEW_LIMIT }).pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (acc, chunk) => acc + chunk,
        ),
      );
      return content.includes("\u0000")
        ? null
        : { content, truncated: entry.sizeBytes > PREVIEW_LIMIT };
    }).pipe(Effect.timeout("20 seconds"), Effect.scoped);

  const assets = yield* makeDrainableWorker((entry: ProjectLibraryEntry) =>
    Effect.gen(function* () {
      let content = "";
      let truncated = false;
      yield* Effect.gen(function* () {
        const extracted = yield* extract(entry);
        if (extracted === null) {
          yield* store.save({ ...entry, status: "unsupported" }, "", false);
          return;
        }
        content = extracted.content;
        truncated = extracted.truncated;
        const generated = yield* generate(
          "asset",
          `source:${entry.id}\nFilename: ${entry.originalName}\nURL: ${entry.url ?? ""}\n${content}`,
        );
        yield* store.save(
          {
            ...entry,
            title: generated.title || entry.originalName,
            summary: generated.summary,
            labels: generated.labels,
            status: "ready",
          },
          content,
          truncated,
        );
      }).pipe(
        Effect.catchCause(() => store.save({ ...entry, status: "failed" }, content, truncated)),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => queuedAssets.delete(entry.id)))),
  );

  const enqueueAsset = (entry: ProjectLibraryEntry) =>
    Effect.gen(function* () {
      if (queuedAssets.has(entry.id)) return;
      queuedAssets.add(entry.id);
      yield* assets.enqueue(entry);
    });

  const briefings = yield* makeDrainableWorker((projectId: ProjectId) =>
    Effect.gen(function* () {
      const currentProject = yield* project(projectId);
      const preferences = yield* store.preferences(projectId);
      const threadIds = yield* store.recentThreads(projectId);
      const threads = yield* Effect.forEach(threadIds, (id) => projections.getThreadShell(id));
      const library = yield* store.page({ projectId, limit: 8 });
      const sources: Array<typeof ProjectBriefingSource.Type> = [];
      const context = [`Project: ${currentProject.title}`];
      for (const thread of threads) {
        if (!thread || thread.projectId !== projectId || thread.deletedAt !== null) continue;
        sources.push({ kind: "thread", id: thread.id, label: thread.title });
        context.push(
          `source:${thread.id}\nChat: ${thread.title}\nStatus: ${thread.status}\n${(thread.latestVisibleMessage?.text ?? "").slice(0, 2000)}`,
        );
      }
      for (const entry of library.entries) {
        sources.push({ kind: "asset", id: entry.id, label: entry.title });
        context.push(`source:${entry.id}\nAsset: ${entry.title}\n${entry.summary.slice(0, 1600)}`);
      }
      const changes = yield* git
        .execute({
          operation: "ProjectHome.changes",
          cwd: currentProject.workspaceRoot,
          args: ["diff", "--stat", "HEAD"],
          maxOutputBytes: 4000,
          timeoutMs: 5000,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (changes?.stdout.trim()) {
        sources.push({
          kind: "change",
          id: "working-tree",
          label: "Working tree changes",
          excerpt: changes.stdout.slice(0, 4000),
        });
        context.push(`source:working-tree\nCurrent changes:\n${changes.stdout}`);
      }
      const commits = yield* git
        .execute({
          operation: "ProjectHome.commits",
          cwd: currentProject.workspaceRoot,
          args: ["log", "-5", "--format=%h %s", "--stat"],
          maxOutputBytes: 5000,
          timeoutMs: 5000,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (commits?.stdout.trim()) {
        sources.push({
          kind: "change",
          id: "recent-commits",
          label: "Recent commits and files",
          excerpt: commits.stdout.slice(0, 5000),
        });
        context.push(`source:recent-commits\n${commits.stdout}`);
      }
      const result = yield* generate(
        "briefing",
        context.join("\n\n"),
        preferences.briefingInstructions,
      );
      const sourceIds = new Set(result.sourceIds);
      yield* store.finishBriefing(projectId, {
        title: result.title,
        summary: result.summary,
        nextStep: result.nextStep,
        sources: sources.filter((source) => sourceIds.has(source.id)),
        generatedAt: DateTime.formatIso(yield* DateTime.now),
        attemptedAt: null,
        status: "ready",
      });
    }).pipe(Effect.catchCause(() => store.finishBriefing(projectId, null))),
  );

  const snapshot = (projectId: ProjectId) =>
    Effect.gen(function* () {
      yield* validateProject(projectId);
      const [preferences, briefing, library, recentThreadIds] = yield* Effect.all([
        store.preferences(projectId),
        store.briefing(projectId),
        store.page({ projectId, limit: 5 }),
        store.recentThreads(projectId),
      ]);
      return {
        preferences,
        briefing,
        files: library.entries,
        fileCount: library.total,
        recentThreadIds,
      };
    });

  return ProjectHomeService.of({
    validateProject,
    retainUpload: (input) =>
      validateProject(input.projectId).pipe(
        Effect.andThen(store.retainUpload(input)),
        Effect.flatMap((entry) =>
          entry.status === "processing" ? enqueueAsset(entry) : Effect.void,
        ),
      ),
    snapshot,
    open: (projectId) =>
      Effect.gen(function* () {
        yield* validateProject(projectId);
        if (yield* store.claimBriefing(projectId)) yield* briefings.enqueue(projectId);
        return yield* snapshot(projectId);
      }),
    customize: (projectId, preferences) =>
      validateProject(projectId).pipe(
        Effect.andThen(store.updatePreferences(projectId, preferences)),
      ),
    visit: (projectId, threadId) =>
      Effect.gen(function* () {
        yield* validateProject(projectId);
        const thread = yield* projections
          .getThreadShell(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new ProjectHomeError({ projectId, operation: "find chat", cause }),
            ),
          );
        if (!thread || thread.projectId !== projectId || thread.deletedAt !== null)
          return yield* new ProjectHomeError({ projectId, operation: "find chat" });
        yield* store.visit(projectId, threadId);
      }),
    list: (input) => validateProject(input.projectId).pipe(Effect.andThen(store.page(input))),
    read,
    saveLink: (projectId, url) =>
      Effect.gen(function* () {
        yield* validateProject(projectId);
        const parsed = yield* Effect.try({
          try: () => new URL(url),
          catch: (cause) => new ProjectHomeError({ projectId, operation: "parse link", cause }),
        });
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
          return yield* new ProjectHomeError({ projectId, operation: "save HTTP link" });
        const id = yield* crypto
          .randomUUIDv4()
          .pipe(
            Effect.mapError(
              (cause) => new ProjectHomeError({ projectId, operation: "create link", cause }),
            ),
          );
        const entry: ProjectLibraryEntry = {
          id,
          projectId,
          kind: "link",
          originalName: parsed.href,
          url: parsed.href,
          attachmentId: null,
          mimeType: "text/html",
          sizeBytes: 0,
          title: parsed.hostname,
          summary: "",
          labels: [],
          status: "processing",
          createdAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* store.save(entry, "", false);
        yield* enqueueAsset(entry);
        return entry;
      }),
    retry: (projectId, id) =>
      Effect.gen(function* () {
        const value = yield* read(projectId, id);
        if (queuedAssets.has(id)) return;
        const entry = { ...value.entry, status: "processing" as const };
        yield* store.save(entry, value.content, value.truncated);
        yield* enqueueAsset(entry);
      }),
    attach: (projectId, id) =>
      Effect.gen(function* () {
        const { entry, content } = yield* read(projectId, id);
        const source =
          entry.attachmentId &&
          resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: entry.attachmentId,
          });
        if (entry.kind === "file" && !source)
          return yield* new ProjectHomeError({ projectId, operation: "find original" });
        const extension = source ? path.extname(source) : ".txt";
        const attachmentId = createPendingAttachmentId(extension);
        const destination = path.join(config.attachmentsDir, `${attachmentId}${extension}`);
        const linkText = `${entry.url}\n\n${entry.summary}\n\n${content}`;
        yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
        if (source) yield* fs.copyFile(source, destination);
        else yield* fs.writeFileString(destination, linkText);
        return {
          attachmentId,
          name: source ? entry.originalName : `${entry.title}.txt`,
          mimeType: source ? entry.mimeType : "text/plain",
          sizeBytes: source ? entry.sizeBytes : new TextEncoder().encode(linkText).byteLength,
        };
      }).pipe(
        Effect.mapError((cause) =>
          isProjectHomeError(cause)
            ? cause
            : new ProjectHomeError({ projectId, operation: "attach library item", cause }),
        ),
      ),
    drain: Effect.all([assets.drain, briefings.drain]).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(ProjectHomeService, make);
