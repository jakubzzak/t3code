import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as HttpClient from "effect/http/HttpClient";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Projects from "../orchestration-v2/ProjectStore.ts";
import * as Projections from "../orchestration-v2/ProjectionStore.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Settings from "../serverSettings.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as Store from "./ProjectHomeStore.ts";
import * as Home from "./ProjectHomeService.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";

const projectId = ProjectId.make("home-project");
const project: Projects.ProjectRow = {
  projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const makeLayer = (
  generateProjectContext: Generation.TextGeneration["Service"]["generateProjectContext"],
) =>
  Home.layer.pipe(
    Layer.provideMerge(Store.layer),
    Layer.provide(
      Layer.mock(Projects.ProjectStoreV2)({
        get: (id) => Effect.succeed(Option.some({ ...project, projectId: id })),
      }),
    ),
    Layer.provide(
      Layer.mock(Projections.ProjectionStoreV2)({ getThreadShell: () => Effect.succeed(null) }),
    ),
    Layer.provide(Layer.mock(Generation.TextGeneration)({ generateProjectContext })),
    Layer.provide(
      Layer.mock(Settings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
    ),
    Layer.provide(Layer.mock(Git.GitVcsDriver)({})),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("No network in this test")),
      ),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-home-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );

describe("ProjectHomeService", () => {
  it.effect(
    "keeps uploaded bytes after processing failure and retries in place without exposing another project's asset",
    () => {
      let attempts = 0;
      return Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const service = yield* Home.ProjectHomeService;
        yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
        const attachmentId = "pending-00000000-0000-4000-8000-000000000001-md";
        const path = `${config.attachmentsDir}/${attachmentId}.md`;
        yield* fs.writeFileString(path, "# Release\nShip after review.");
        yield* service.retainUpload({
          projectId,
          attachmentId,
          name: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 28,
        });
        yield* service.drain;
        const { entries } = yield* service.list({ projectId });
        expect(entries).toHaveLength(1);
        expect(entries[0]?.status).toBe("failed");
        yield* fs.remove(path);
        const id = entries[0]!.id;
        yield* service.retry(projectId, id);
        yield* service.drain;
        const preview = yield* service.read(projectId, id);
        expect(preview).toMatchObject({
          entry: {
            id,
            title: "Release checklist",
            labels: ["release"],
            status: "ready",
            originalName: "notes.md",
          },
          content: "# Release\nShip after review.",
        });
        const attached = yield* service.attach(projectId, id);
        const attachedPath = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: attached.attachmentId,
        });
        expect(yield* fs.readFileString(attachedPath!)).toBe("# Release\nShip after review.");
        expect(
          Result.isFailure(yield* Effect.result(service.read(ProjectId.make("other"), id))),
        ).toBe(true);
        expect(attempts).toBe(2);
      }).pipe(
        Effect.provide(
          makeLayer((input) => {
            expect(input.modelSelection).toEqual(
              DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
            );
            expect(input.context).toContain("Ship after review.");
            return ++attempts === 1
              ? Effect.fail(
                  new TextGenerationError({
                    operation: "generateProjectContext",
                    detail: "Unavailable",
                  }),
                )
              : Effect.succeed({
                  title: "Release checklist",
                  summary: "Review before shipping.",
                  labels: ["release"],
                  sourceIds: [],
                  nextStep: "",
                });
          }),
        ),
      );
    },
  );
  it.effect(
    "keeps failed links and unsupported originals available without inventing content",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const service = yield* Home.ProjectHomeService;
        const link = yield* service.saveLink(projectId, "https://unavailable.example/document");
        yield* service.drain;
        expect(yield* service.read(projectId, link.id)).toMatchObject({
          entry: { url: link.url, status: "failed" },
          content: "",
        });
        expect(
          Result.isFailure(yield* Effect.result(service.saveLink(projectId, "file:///etc/passwd"))),
        ).toBe(true);
        yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
        const attachmentId = "pending-00000000-0000-4000-8000-000000000002-pdf";
        const path = `${config.attachmentsDir}/${attachmentId}.pdf`;
        const bytes = new Uint8Array([0, 1, 2, 3]);
        yield* fs.writeFile(path, bytes);
        yield* service.retainUpload({
          projectId,
          attachmentId,
          name: "drawing.pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.length,
        });
        yield* service.drain;
        const { entries } = yield* service.list({ projectId });
        const unsupported = entries.find((entry) => entry.originalName === "drawing.pdf")!;
        expect(yield* service.read(projectId, unsupported.id)).toMatchObject({
          entry: { status: "unsupported", summary: "" },
          content: "",
        });
        yield* fs.remove(path);
        const attached = yield* service.attach(projectId, unsupported.id);
        expect(
          Array.from(
            yield* fs.readFile(
              resolveAttachmentPathById({
                attachmentsDir: config.attachmentsDir,
                attachmentId: attached.attachmentId,
              })!,
            ),
          ),
        ).toEqual(Array.from(bytes));
      }).pipe(
        Effect.provide(makeLayer(() => Effect.die("Unsupported files must not request a summary"))),
      ),
  );
});
