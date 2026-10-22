import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProjectId, type InboxNotification } from "@t3tools/contracts";
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
      Settings.layerTest({ inboxSummaryPrompt: "Saved summary preferences" }),
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
      const first = yield* analysis.analyze(notification, [past]);
      assert.equal(inputs[0]?.instructions, undefined);
      assert.deepEqual(inputs[0]?.precedents, []);
      assert.deepEqual(first.precedentIds, []);
      assert.deepEqual(first.suggestions, []);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: {
            inboxMemoryEnabled: true,
            inboxSummaryPromptEnabled: true,
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
      assert.deepEqual(enabled.suggestions, ["Verify one reconnect retry."]);
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: {
            inboxMemoryEnabled: false,
            inboxSummaryPromptEnabled: false,
          },
        },
      });
      yield* analysis.analyze({ ...notification, analysis: enabled }, [past]);
      assert.equal(inputs[2]?.instructions, undefined);
      assert.deepEqual(inputs[2]?.precedents, []);
      assert.equal(JSON.parse(inputs[2]!.context).analysis, null);
    }).pipe(Effect.provide(Analysis.layer.pipe(Layer.provideMerge(dependencies))));
  },
);
