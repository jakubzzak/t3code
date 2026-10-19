import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { ProjectId, ThreadId, DEFAULT_PROJECT_HOME_PREFERENCES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { resolveAttachmentPathById, sweepStalePendingAttachments } from "../attachmentStore.ts";
import * as Store from "./ProjectHomeStore.ts";

const layer = Store.layer.pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-home-store-" })),
  Layer.provideMerge(NodeServices.layer),
);
const projectId = ProjectId.make("library-project");
const attachmentId = "pending-00000000-0000-4000-8000-000000000001-md";
const upload = {
  projectId,
  attachmentId,
  name: "notes.md",
  mimeType: "text/markdown",
  sizeBytes: 11,
};

describe("ProjectHomeStore", () => {
  it.effect(
    "pages and searches the entire library, keeps stable identity through processing, and persists layout and opened order",
    () =>
      Effect.gen(function* () {
        const store = yield* Store.ProjectHomeStore;
        for (let index = 0; index < 8; index++) {
          yield* store.save(
            {
              id: `asset-${index}`,
              projectId,
              kind: "link",
              originalName: `source ${index}`,
              title: `Title ${index}`,
              summary: "",
              labels: ["specification"],
              attachmentId: null,
              mimeType: "text/html",
              sizeBytes: 0,
              url: `https://example.com/${index}`,
              status: "ready",
              createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
            },
            `content ${index}`,
            false,
          );
          yield* store.visit(projectId, ThreadId.make(`thread-${index}`));
          yield* TestClock.adjust("1 second");
        }
        expect(
          (yield* store.page({ projectId, limit: 5 })).entries.map((entry) => entry.id),
        ).toEqual(["asset-7", "asset-6", "asset-5", "asset-4", "asset-3"]);
        expect(yield* store.page({ projectId, query: "SPECIFICATION", offset: 5 })).toMatchObject({
          total: 8,
          entries: [{ id: "asset-2" }, { id: "asset-1" }, { id: "asset-0" }],
        });
        const selected = yield* store.get(projectId, "asset-0");
        expect(selected?.content).toBe("content 0");
        yield* store.save(
          { ...selected!.entry, title: "Updated title", labels: ["decision"] },
          "updated content",
          false,
        );
        expect((yield* store.get(projectId, "asset-0"))?.entry.title).toBe("Updated title");
        expect(yield* store.get(ProjectId.make("other-project"), "asset-0")).toBeNull();
        const preferences = {
          ...DEFAULT_PROJECT_HOME_PREFERENCES,
          showLibrary: false,
          libraryFirst: true,
          briefingInstructions: "Focus on decisions",
        };
        yield* store.updatePreferences(projectId, preferences);
        expect(yield* store.preferences(projectId)).toEqual(preferences);
        yield* store.visit(projectId, ThreadId.make("thread-0"));
        expect(yield* store.recentThreads(projectId)).toEqual([
          "thread-0",
          "thread-7",
          "thread-6",
          "thread-5",
          "thread-4",
        ]);
      }).pipe(Effect.provide(layer)),
  );
  it.effect(
    "shares one in-flight briefing across opens and throttles failed attempts without losing the cached result",
    () =>
      Effect.gen(function* () {
        const store = yield* Store.ProjectHomeStore;
        const claims = yield* Effect.all(
          [store.claimBriefing(projectId), store.claimBriefing(projectId)],
          { concurrency: "unbounded" },
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
        yield* TestClock.adjust("2 hours");
        expect(yield* store.claimBriefing(projectId)).toBe(false);
        const successful = {
          title: "Release",
          summary: "Ready for review",
          nextStep: "Review",
          sources: [],
          generatedAt: "2026-01-01T00:00:00.000Z",
          attemptedAt: null,
          status: "ready" as const,
        };
        yield* store.finishBriefing(projectId, successful);
        expect(yield* store.claimBriefing(projectId)).toBe(true);
        expect((yield* store.briefing(projectId)).summary).toBe(successful.summary);
        yield* store.finishBriefing(projectId, null);
        expect(yield* store.claimBriefing(projectId)).toBe(false);
        expect(yield* store.briefing(projectId)).toMatchObject({
          status: "failed",
          summary: successful.summary,
          generatedAt: successful.generatedAt,
        });
        yield* TestClock.adjust("1 hour");
        expect(yield* store.claimBriefing(projectId)).toBe(true);
      }).pipe(Effect.provide(layer)),
  );
  it.effect(
    "retains the original independently of pending cleanup and scopes discovery to its project",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const store = yield* Store.ProjectHomeStore;
        yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
        const pending = `${config.attachmentsDir}/${attachmentId}.md`;
        yield* fs.writeFileString(pending, "hello world");
        yield* store.retainUpload(upload);
        yield* store.retainUpload(upload);
        expect(
          sweepStalePendingAttachments({
            attachmentsDir: config.attachmentsDir,
            nowMs:
              Option.getOrThrow((yield* fs.stat(pending)).mtime).getTime() +
              7 * 24 * 60 * 60 * 1000,
          }).deleted,
        ).toBe(1);
        expect(yield* fs.exists(pending)).toBe(false);
        const entries = yield* store.list(projectId);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.originalName).toBe("notes.md");
        expect(entries[0]?.status).toBe("processing");
        const original = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: entries[0]!.attachmentId!,
        });
        expect(original).not.toBeNull();
        expect(yield* fs.readFileString(original!)).toBe("hello world");
        expect(yield* store.list(ProjectId.make("other-project"))).toEqual([]);
        expect(yield* store.list(projectId, "NOTES")).toHaveLength(1);
        expect(yield* store.list(projectId, "absent")).toEqual([]);
      }).pipe(Effect.provide(layer)),
  );
});
