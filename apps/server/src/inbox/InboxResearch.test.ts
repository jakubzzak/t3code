import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProjectId, ProviderInstanceId, type InboxResearchStep } from "@t3tools/contracts";
import type { InboxAnalysisInput } from "@t3tools/provider-core/server/textGeneration";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Entries from "../workspace/WorkspaceEntries.ts";
import * as Files from "../workspace/WorkspaceFileSystem.ts";
import * as Chats from "../orchestration-v2/ThreadSearch.ts";
import * as SourceControl from "../sourceControl/SourceControlProviderRegistry.ts";
import * as Repository from "./InboxRepository.ts";
import * as Research from "./InboxResearch.ts";
import { ingestInboxItem } from "./inboxState.ts";

const projectId = ProjectId.make("project-a");
const notification = {
  ...ingestInboxItem(projectId, {
    id: "n",
    source: "slack",
    connectionId: "team",
    groupId: "thread",
    title: "Session",
    content: "Check session refresh.",
    author: "Alex",
    location: "#support",
    url: "https://example.com",
    occurredAt: "2026-10-22T10:00:00Z",
  }),
  analysis: {
    summary: "Check session refresh.",
    description: "Session",
    suggestions: [],
    precedentIds: [],
    generatedAt: "2026-10-22T10:00:00Z",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  },
};
const fixture = (steps: ReadonlyArray<InboxResearchStep>) => {
  const inputs: InboxAnalysisInput[] = [],
    reads: string[] = [],
    scopes: string[] = [];
  const layer = Research.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Settings.layerTest({
          projectSettingsOverrides: {
            [projectId]: {
              inboxEnabled: true,
              inboxSummaryEnabled: true,
              inboxPreResolution: true,
            },
          },
        }),
        Layer.mock(Projects.ProjectService)({
          getShell: () =>
            Effect.succeedSome({
              id: projectId,
              title: "Project",
              workspaceRoot: "/project",
              defaultModelSelection: null,
              scripts: [],
              createdAt: notification.updatedAt,
              updatedAt: notification.updatedAt,
            }),
        }),
        Layer.mock(Generation.TextGeneration)({
          generateInboxResearch: (input) =>
            Effect.sync(() => {
              inputs.push(input);
              return (
                steps[inputs.length - 1] ?? { replyDraft: null, request: null, suggestions: [] }
              );
            }),
        }),
        Layer.mock(Entries.WorkspaceEntries)({
          searchContents: (input) =>
            Effect.sync(() => {
              scopes.push(input.cwd);
              return {
                matches: [
                  {
                    path: "src/session.ts",
                    lineNumber: 4,
                    lineContent: "retryRefresh()",
                    matchRanges: [],
                  },
                  { path: ".env", lineNumber: 1, lineContent: "PRIVATE_DATA", matchRanges: [] },
                ],
                truncated: false,
              };
            }),
        }),
        Layer.mock(Files.WorkspaceFileSystem)({
          readFile: (input) =>
            Effect.sync(() => {
              reads.push(input.relativePath);
              return {
                relativePath: input.relativePath,
                contents: "function retryRefresh() {}",
                byteLength: 26,
                truncated: false,
              };
            }),
        }),
        Layer.mock(Chats.ThreadSearch)({
          search: (input) =>
            Effect.sync(() => {
              scopes.push(input.projectId!);
              return { matches: [], hasMore: false };
            }),
        }),
        Layer.mock(Repository.InboxRepository)({
          history: () => Effect.succeed([]),
          list: (id) =>
            Effect.sync(() => {
              scopes.push(id);
              return [];
            }),
        }),
        Layer.mock(SourceControl.SourceControlProviderRegistry)({ resolveLink: () => undefined }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  return { layer, inputs, reads, scopes };
};

it.effect(
  "executes model-selected read tools, scopes searches, filters private paths, and uses observed evidence",
  () =>
    Effect.gen(function* () {
      const f = fixture([
        {
          replyDraft: null,
          request: { tool: "search_project", query: "refresh" },
          suggestions: [],
        },
        {
          replyDraft: null,
          request: { tool: "read_project_file", query: "src/session.ts" },
          suggestions: [],
        },
        { replyDraft: null, request: { tool: "search_chats", query: "refresh" }, suggestions: [] },
        {
          replyDraft: null,
          request: { tool: "search_notifications", query: "refresh" },
          suggestions: [],
        },
        {
          replyDraft: null,
          request: null,
          suggestions: [" Verify retryRefresh handles expired sessions. "],
        },
      ]);
      yield* Effect.gen(function* () {
        const research = yield* Research.InboxResearch;
        assert.deepEqual(yield* research.research(notification), {
          suggestions: ["Verify retryRefresh handles expired sessions."],
          replyDraft: null,
        });
        assert.deepEqual(f.reads, ["src/session.ts"]);
        assert.deepEqual(f.scopes, ["/project", projectId, projectId]);
        const context = f.inputs.at(-1)!.context;
        assert.ok(context.includes("retryRefresh"));
        assert.ok(!context.includes("PRIVATE_DATA"));
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect.each(["/private/secret", "../secret", ".env", "not-searched.ts"])(
  "refuses undiscovered or out-of-project file %s",
  (path) =>
    Effect.gen(function* () {
      const f = fixture([
        { replyDraft: null, request: { tool: "read_project_file", query: path }, suggestions: [] },
        { replyDraft: null, request: null, suggestions: [] },
      ]);
      yield* Effect.gen(function* () {
        const result = yield* (yield* Research.InboxResearch)
          .research(notification)
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.deepEqual(f.reads, []);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect("distinguishes no useful work from a suggestion generated without any research", () =>
  Effect.gen(function* () {
    for (const suggestions of [[], ["Guess at a fix"]]) {
      const f = fixture([{ replyDraft: null, request: null, suggestions }]);
      const result = yield* Effect.gen(function* () {
        return yield* (yield* Research.InboxResearch).research(notification).pipe(Effect.result);
      }).pipe(Effect.provide(f.layer));
      assert.equal(result._tag, suggestions.length ? "Failure" : "Success");
    }
  }),
);

it.effect("rejects repeated tool requests instead of looping indefinitely", () =>
  Effect.gen(function* () {
    const request = { tool: "search_chats" as const, query: "refresh" };
    const f = fixture([
      { replyDraft: null, request, suggestions: [] },
      { replyDraft: null, request, suggestions: [] },
    ]);
    yield* Effect.gen(function* () {
      const result = yield* (yield* Research.InboxResearch)
        .research(notification)
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.equal(f.inputs.length, 2);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("refuses research after its project setting is disabled", () =>
  Effect.gen(function* () {
    const f = fixture([{ replyDraft: null, request: null, suggestions: [] }]);
    yield* Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true, inboxPreResolution: false },
        },
      });
      assert.equal(
        (yield* (yield* Research.InboxResearch).research(notification).pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(f.inputs.length, 0);
    }).pipe(Effect.provide(f.layer));
  }),
);
