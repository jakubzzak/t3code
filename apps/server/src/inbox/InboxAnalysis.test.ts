import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type InboxNotification } from "@t3tools/contracts";
import type { InboxAnalysisInput } from "@t3tools/provider-core/server/textGeneration";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Analysis from "./InboxAnalysis.ts";
import { ingestInboxItem } from "./inboxState.ts";

const projectId = ProjectId.make("project-a");
const notification = ingestInboxItem(projectId, {
  id: "new",
  source: "slack",
  connectionId: "team",
  groupId: "new-thread",
  title: "Session refresh",
  content: "Please check session refresh.",
  author: "Alex",
  location: "#support",
  url: "https://slack.com",
  occurredAt: "2026-10-22T10:00:00Z",
});
const past = {
  ...notification,
  id: "past",
  confirmedOutcome: "The session refresh was fixed by retrying once.",
} satisfies InboxNotification;

it.effect(
  "uses custom summary instructions and confirmed project history only when enabled",
  () => {
    const inputs: InboxAnalysisInput[] = [];
    const dependencies = Layer.mergeAll(
      Settings.layerTest({}),
      Layer.mock(Projects.ProjectService)({
        getShell: (id) =>
          Effect.succeedSome({
            id,
            title: "Project",
            workspaceRoot: "/test-project",
            defaultModelSelection: null,
            scripts: [],
            createdAt: notification.updatedAt,
            updatedAt: notification.updatedAt,
          }),
      }),
      Layer.mock(Generation.TextGeneration)({
        generateInboxAnalysis: (input) =>
          Effect.sync(() => {
            inputs.push(input);
            return {
              description: "Check session refresh.",
              summary: "Review the reconnect behavior.",
              suggestions: ["Verify one reconnect retry."],
              precedentIds: [past.id, "unconfirmed"],
            };
          }),
      }),
    );
    return Effect.gen(function* () {
      const analysis = yield* Analysis.InboxAnalysis;
      const settings = yield* Settings.ServerSettingsService;
      const disabled = yield* analysis.analyze(notification, [past]).pipe(Effect.result);
      assert.equal(disabled._tag, "Failure");
      assert.equal(inputs.length, 0);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { inboxSummaryEnabled: true, inboxSummaryPrompt: "" },
        },
      });
      const first = yield* analysis.analyze(notification, [past]);
      assert.equal(inputs[0]?.instructions, DEFAULT_SERVER_SETTINGS.inboxSummaryPrompt);
      assert.deepEqual(inputs[0]?.precedents, []);
      assert.deepEqual(first.precedentIds, []);
      assert.deepEqual(first.suggestions, []);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: {
            inboxMemoryEnabled: true,
            inboxSummaryEnabled: true,
            inboxSummaryPrompt: "Focus on the requested verification.",
            inboxPreResolution: true,
          },
        },
      });
      const enabled = yield* analysis.analyze(notification, [
        past,
        {
          ...past,
          id: "another-project",
          projectId: ProjectId.make("project-b"),
        },
      ]);
      assert.equal(inputs[1]?.instructions, "Focus on the requested verification.");
      assert.deepEqual(
        inputs[1]?.precedents.map((item) => item.id),
        [past.id],
      );
      assert.deepEqual(enabled.precedentIds, [past.id]);
      assert.deepEqual(enabled.suggestions, []);
      assert.equal(inputs[1]?.suggest, false);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: {
            inboxMemoryEnabled: false,
            inboxSummaryEnabled: true,
            inboxSummaryPrompt: "",
          },
        },
      });
      yield* analysis.analyze({ ...notification, analysis: enabled }, [past]);
      assert.equal(inputs[2]?.instructions, DEFAULT_SERVER_SETTINGS.inboxSummaryPrompt);
      assert.deepEqual(inputs[2]?.precedents, []);
      assert.equal(JSON.parse(inputs[2]!.context).analysis, null);
      yield* settings.updateSettings({
        projectSettingsOverrides: { [projectId]: { inboxSummaryEnabled: false } },
      });
      assert.equal(
        (yield* analysis.analyze(notification, [past]).pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(inputs.length, 3);
    }).pipe(Effect.provide(Analysis.layer.pipe(Layer.provideMerge(dependencies))));
  },
);
