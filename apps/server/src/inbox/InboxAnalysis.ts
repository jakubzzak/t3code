import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { InboxError, type InboxNotification } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { findInboxPrecedents } from "./inboxMemory.ts";
import { inboxContext } from "./notificationContext.ts";
export class InboxAnalysis extends Context.Service<
  InboxAnalysis,
  {
    readonly analyze: (
      notification: InboxNotification,
      history: ReadonlyArray<InboxNotification>,
    ) => Effect.Effect<NonNullable<InboxNotification["analysis"]>, InboxError>;
  }
>()("t3/inbox/InboxAnalysis") {}
const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const projects = yield* Projects.ProjectService;
  const generation = yield* TextGeneration.TextGeneration;
  return InboxAnalysis.of({
    analyze: (notification, history) =>
      Effect.gen(function* () {
        const config = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
        ).settings;
        const project = yield* projects.getShell(notification.projectId);
        if (Option.isNone(project))
          return yield* new InboxError({ detail: "The notification's project is unavailable." });
        const modelSelection =
          config.inboxSummaryModelSelection ?? config.textGenerationModelSelection;
        const precedents = findInboxPrecedents(notification, history);
        if (!generation.generateInboxAnalysis)
          return yield* new InboxError({
            detail: "The selected model cannot summarize notifications.",
          });
        const result = yield* generation.generateInboxAnalysis({
          cwd: project.value.workspaceRoot,
          modelSelection,
          context: inboxContext(notification).slice(0, 64000),
          precedents,
          suggest: config.inboxPreResolution,
        });
        return {
          ...result,
          suggestions: config.inboxPreResolution ? result.suggestions : [],
          precedentIds: result.precedentIds.filter((id) =>
            precedents.some((item) => item.id === id),
          ),
          modelSelection,
          generatedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
        };
      }).pipe(
        Effect.mapError(
          (cause) =>
            new InboxError({
              detail:
                "Summary unavailable. Raw source content is still available; check the summary model in Features.",
              cause,
            }),
        ),
      ),
  });
});
export const layer = Layer.effect(InboxAnalysis, make);
