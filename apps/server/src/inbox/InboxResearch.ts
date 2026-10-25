import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { InboxError, type InboxNotification, type InboxResearchStep } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Entries from "../workspace/WorkspaceEntries.ts";
import * as Files from "../workspace/WorkspaceFileSystem.ts";
import * as Chats from "../orchestration-v2/ThreadSearch.ts";
import * as SourceControl from "../sourceControl/SourceControlProviderRegistry.ts";
import { resolveThreadTitleLinks } from "../textGeneration/ThreadTitleLinks.ts";
import * as Repository from "./InboxRepository.ts";
import { findInboxPrecedents } from "./inboxMemory.ts";
import { inboxContext } from "./notificationContext.ts";

export class InboxResearch extends Context.Service<
  InboxResearch,
  {
    readonly research: (
      notification: InboxNotification,
    ) => Effect.Effect<ReadonlyArray<string>, InboxError>;
  }
>()("t3/inbox/InboxResearch") {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const projects = yield* Projects.ProjectService;
  const generation = yield* Generation.TextGeneration;
  const entries = yield* Entries.WorkspaceEntries;
  const files = yield* Files.WorkspaceFileSystem;
  const chats = yield* Chats.ThreadSearch;
  const repository = yield* Repository.InboxRepository;
  const sourceControl = yield* SourceControl.SourceControlProviderRegistry;
  const path = yield* Path.Path;
  const research = Effect.fn("InboxResearch.research")(
    function* (notification: InboxNotification) {
      const config = resolveProjectSettings(
        yield* settings.getSettings,
        notification.projectId,
      ).settings;
      if (!config.inboxEnabled || !config.inboxSummaryEnabled || !config.inboxPreResolution)
        return yield* new InboxError({
          detail: "Enable Summary and Suggested resolutions for this project.",
        });
      const project = yield* projects.getShell(notification.projectId);
      if (Option.isNone(project) || !generation.generateInboxResearch)
        return yield* new InboxError({
          detail: "The selected model cannot research this notification.",
        });
      const cwd = project.value.workspaceRoot;
      const context = inboxContext({ ...notification, analysis: null }).slice(0, 32000);
      const precedents = config.inboxMemoryEnabled
        ? findInboxPrecedents(notification, yield* repository.history(notification.projectId))
        : [];
      const observations: Array<{
        request: NonNullable<InboxResearchStep["request"]>;
        result: string;
      }> = [];
      const readablePaths = new Set<string>();
      const requests = new Set<string>();
      let successfulTools = 0;
      // Never expose a shell, arbitrary URLs, other projects, or undiscovered host paths to external text.
      const safePath = (value: string) =>
        !path.isAbsolute(value) &&
        !value
          .split(/[\\/]/)
          .some(
            (part) =>
              part === ".." ||
              part.startsWith(".") ||
              /^(?:secrets?|credentials?)(?:\.|$)/i.test(part),
          ) &&
        !/\.(?:pem|key|p12|pfx)$/i.test(value);
      const execute = Effect.fn("InboxResearch.readTool")(function* (
        request: NonNullable<InboxResearchStep["request"]>,
      ) {
        const current = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
        ).settings;
        if (!current.inboxEnabled || !current.inboxSummaryEnabled || !current.inboxPreResolution)
          return yield* new InboxError({ detail: "Suggestion research was disabled." });
        const query = request.query.trim();
        switch (request.tool) {
          case "search_project": {
            if (query.length < 2)
              return yield* new InboxError({
                detail: "A research search needs at least two characters.",
              });
            const result = yield* entries.searchContents({
              cwd,
              query,
              limit: 12,
              useRegex: false,
              caseSensitive: false,
              wholeWord: false,
            });
            const matches = result.matches.filter((match) => safePath(match.path));
            matches.forEach((match) => readablePaths.add(match.path));
            return encodeJson({ matches, truncated: result.truncated });
          }
          case "read_project_file":
            if (!safePath(query) || !readablePaths.has(query))
              return yield* new InboxError({
                detail: "Research can only read project files found by its search.",
              });
            return (yield* files.readFile({ cwd, relativePath: query })).contents.slice(0, 8000);
          case "search_chats":
            if (query.length < 2)
              return yield* new InboxError({
                detail: "A research search needs at least two characters.",
              });
            return encodeJson(
              yield* chats.search({ projectId: notification.projectId, query, limit: 5 }),
            );
          case "search_notifications": {
            if (query.length < 2)
              return yield* new InboxError({
                detail: "A research search needs at least two characters.",
              });
            const matches = yield* repository.list(notification.projectId, {
              search: query,
              limit: 5,
            });
            return encodeJson(
              matches.map((item) => ({
                id: item.id,
                content: inboxContext({ ...item, analysis: null }).slice(0, 1500),
              })),
            );
          }
          case "inspect_links":
            return (
              (yield* resolveThreadTitleLinks({ cwd, message: context }).pipe(
                Effect.provideService(SourceControl.SourceControlProviderRegistry, sourceControl),
              )) ?? "No supported source-control links in this notification."
            );
        }
      });
      for (let step = 0; step <= 6; step++) {
        const current = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
        ).settings;
        if (!current.inboxEnabled || !current.inboxSummaryEnabled || !current.inboxPreResolution)
          return yield* new InboxError({ detail: "Suggestion research was disabled." });
        const result = yield* generation.generateInboxResearch({
          cwd,
          modelSelection: config.inboxSummaryModelSelection ?? config.textGenerationModelSelection,
          context: encodeJson({
            notification: context,
            summary: notification.analysis?.summary,
            observations,
            remainingToolCalls: 6 - step,
          }),
          precedents,
          suggest: true,
        });
        if (!result.request) {
          const suggestions = result.suggestions.map((text) => text.trim()).filter(Boolean);
          if (observations.length && successfulTools === 0)
            return yield* new InboxError({ detail: "Research could not read its sources." });
          if (suggestions.length && successfulTools === 0)
            return yield* new InboxError({
              detail: "Research returned a suggestion without checking its sources.",
            });
          return suggestions;
        }
        const key = encodeJson(result.request);
        if (step === 6 || requests.has(key))
          return yield* new InboxError({
            detail: "Research did not finish within its tool budget.",
          });
        requests.add(key);
        const observation = yield* execute(result.request).pipe(
          Effect.timeout("20 seconds"),
          Effect.result,
        );
        if (observation._tag === "Success") successfulTools++;
        observations.push({
          request: result.request,
          result:
            observation._tag === "Success"
              ? observation.success.slice(0, 8000)
              : "This read tool was unavailable. Try another relevant source; do not infer success or no action.",
        });
      }
      return yield* new InboxError({ detail: "Research did not finish." });
    },
    Effect.mapError(
      (cause) => new InboxError({ detail: "Suggestion research is unavailable.", cause }),
    ),
  );
  return InboxResearch.of({ research });
});
export const layer = Layer.effect(InboxResearch, make);
