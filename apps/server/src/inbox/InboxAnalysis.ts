import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  DEFAULT_SERVER_SETTINGS,
  InboxError,
  type InboxNotification,
  type InboxIrrelevanceReference,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { findInboxPrecedents } from "./inboxMemory.ts";
import * as Attachments from "./InboxAttachments.ts";
import { inboxContext } from "./notificationContext.ts";
export class InboxAnalysis extends Context.Service<
  InboxAnalysis,
  {
    readonly analyze: (
      notification: InboxNotification,
      history: ReadonlyArray<InboxNotification>,
      references?: ReadonlyArray<InboxIrrelevanceReference>,
    ) => Effect.Effect<NonNullable<InboxNotification["analysis"]>, InboxError>;
  }
>()("t3/inbox/InboxAnalysis") {}
const referenceWords = (value: string) =>
  new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);

/** Rank a bounded project history by the latest message, then preserve feedback recency. */
const matchingReferences = (
  notification: InboxNotification,
  references: ReadonlyArray<InboxIrrelevanceReference>,
) => {
  const latest = notification.items.at(-1);
  const query = referenceWords(
    notification.slackThread?.messages.at(-1)?.content ?? latest?.content ?? "",
  );
  return references
    .filter((reference) => reference.projectId === notification.projectId)
    .slice(0, 100)
    .map((reference, index) => {
      const words = referenceWords(reference.content);
      const overlap = [...query].filter((word) => words.has(word)).length;
      return { reference, index, score: overlap / Math.sqrt(Math.max(1, words.size)) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12)
    .sort((a, b) => a.index - b.index)
    .map(({ reference: { content, irrelevant } }) => ({
      content: content.slice(0, 1500),
      irrelevant,
    }));
};
const make = Effect.gen(function* () {
  const attachments = yield* Attachments.InboxAttachments;
  const settings = yield* Settings.ServerSettingsService;
  const projects = yield* Projects.ProjectService;
  const generation = yield* TextGeneration.TextGeneration;
  return InboxAnalysis.of({
    analyze: (notification, history, references = []) =>
      Effect.gen(function* () {
        const config = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
        ).settings;
        if (!config.inboxSummaryEnabled)
          return yield* new InboxError({
            detail: "Enable Summary in this project’s Inbox settings.",
          });
        const project = yield* projects.getShell(notification.projectId);
        if (Option.isNone(project))
          return yield* new InboxError({ detail: "The notification's project is unavailable." });
        const modelSelection =
          config.inboxSummaryModelSelection ?? config.textGenerationModelSelection;
        const precedents = config.inboxMemoryEnabled
          ? findInboxPrecedents(notification, history)
          : [];
        if (!generation.generateInboxAnalysis)
          return yield* new InboxError({
            detail: "The selected model cannot summarize notifications.",
          });
        const classifyRelevance =
          notification.relevance?.status === "pending" &&
          notification.relevance.version === notification.analysisVersion;
        const media = yield* attachments.load(notification);
        const result = yield* generation.generateInboxAnalysis({
          images: media.images,
          classifyRelevance,
          relevanceReferences: classifyRelevance
            ? matchingReferences(notification, references)
            : [],
          cwd: project.value.workspaceRoot,
          modelSelection,
          context: inboxContext({ ...notification, analysis: null }, media.context).slice(0, 64000),
          precedents,
          suggest: false,
          instructions:
            config.inboxSummaryPrompt.trim() || DEFAULT_SERVER_SETTINGS.inboxSummaryPrompt,
        });
        const { irrelevanceConfidence, ...content } = result;
        return {
          ...content,
          ...(classifyRelevance && irrelevanceConfidence !== undefined
            ? { irrelevanceConfidence }
            : {}),
          suggestions: [],
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
