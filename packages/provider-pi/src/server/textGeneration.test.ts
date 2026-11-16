import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makePiTextGeneration } from "./textGeneration.ts";

const decodeJsonLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const makeFakePi = (
  reply: string,
  setModelError?: string,
  turnEvents: ReadonlyArray<Record<string, unknown>> = [],
  models?: ReadonlyArray<Record<string, unknown>>,
  version = "0.84.3",
  thinkingError?: string,
) =>
  Effect.gen(function* () {
    const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const received: Array<Record<string, unknown>> = [];
    const emit = (record: Record<string, unknown>) =>
      Queue.offer(stdout, new TextEncoder().encode(`${encodeJsonLine(record)}\n`));
    let buffered = "";
    const onStdin = (chunk: Uint8Array) =>
      Effect.gen(function* () {
        buffered += new TextDecoder().decode(chunk);
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines.filter((candidate) => candidate.length > 0)) {
          const record = decodeJsonLine(line) as Record<string, unknown>;
          received.push(record);
          const response = { type: "response", id: record["id"], command: record["type"] };
          if (record["type"] === "prompt") {
            yield* emit({ ...response, success: true });
            for (const event of turnEvents) yield* emit(event);
            yield* emit({ type: "agent_settled" });
          } else if (record["type"] === "get_last_assistant_text") {
            yield* emit({ ...response, success: true, data: { text: reply } });
          } else if (record["type"] === "get_available_models" && models !== undefined) {
            yield* emit({ ...response, success: true, data: { models } });
          } else if (record["type"] === "set_model" && setModelError !== undefined) {
            yield* emit({ ...response, success: false, error: setModelError });
          } else if (record["type"] === "set_thinking_level" && thinkingError !== undefined) {
            yield* emit({ ...response, success: false, error: thinkingError });
          } else {
            yield* emit({ ...response, success: true });
          }
        }
      });
    const launches: Array<{ cwd: string | undefined; args: ReadonlyArray<string> }> = [];
    const spawner = ChildProcessSpawner.make((command) => {
      const versionProbe =
        ChildProcess.isStandardCommand(command) && command.args.includes("--version");
      if (ChildProcess.isStandardCommand(command) && !versionProbe)
        launches.push({ cwd: command.options.cwd, args: command.args.map(String) });
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          // Outside the valid pid range, so PiRpc's process-group kill never lands.
          pid: ChildProcessSpawner.ProcessId(999_999_999),
          exitCode: versionProbe ? Effect.succeed(ChildProcessSpawner.ExitCode(0)) : Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach(onStdin),
          stdout: versionProbe
            ? Stream.make(new TextEncoder().encode(version))
            : Stream.fromQueue(stdout),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      );
    });
    return { spawner, received, launches };
  });

it.effect("runs Pi offline, since the process is stopped as soon as it answers", () =>
  Effect.gen(function* () {
    const pi = yield* makeFakePi(JSON.stringify({ subject: "Update README", body: "" }));
    const launches: Array<ReadonlyArray<string>> = [];
    const spawner = ChildProcessSpawner.make((command) => {
      if (ChildProcess.isStandardCommand(command)) launches.push(command.args.map(String));
      return pi.spawner.spawn(command);
    });
    const textGeneration = yield* makePiTextGeneration(
      { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
      {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

    const result = yield* textGeneration.generateCommitMessage({
      cwd: process.cwd(),
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md",
      modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "default"),
    });

    assert.equal(result.subject, "Update README");
    assert.deepEqual(
      launches.map((args) => args.filter((arg) => arg === "--offline")),
      [["--offline"]],
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("names the model and the disabled extensions when Pi cannot load it", () =>
  Effect.gen(function* () {
    const pi = yield* makeFakePi("", "Model not found: demo/demo-model");
    const textGeneration = yield* makePiTextGeneration(
      { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
      {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));

    const error = yield* textGeneration
      .generateCommitMessage({
        cwd: process.cwd(),
        branch: "main",
        stagedSummary: "M README.md",
        stagedPatch: "diff --git a/README.md b/README.md",
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "demo/demo-model"),
      })
      .pipe(Effect.flip);

    assert.equal(error._tag, "TextGenerationError");
    assert.include(error.detail, "Pi rejected model 'demo/demo-model'");
    assert.include(error.detail, "Model not found: demo/demo-model");
    assert.include(error.detail, "--no-extensions");
    assert.isUndefined(pi.received.find((record) => record["type"] === "prompt"));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("selects the provider and id Pi reported when the provider contains a slash", () =>
  Effect.gen(function* () {
    const provider = "llama-server=http://127.0.0.1:8080";
    const pi = yield* makeFakePi(
      JSON.stringify({ subject: "Update README", body: "" }),
      undefined,
      [],
      [{ provider, id: "qwen3" }],
    );
    const textGeneration = yield* makePiTextGeneration(
      { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
      {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));

    yield* textGeneration.generateCommitMessage({
      cwd: process.cwd(),
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md",
      modelSelection: createModelSelection(ProviderInstanceId.make("pi"), `${provider}/qwen3`),
    });

    const setModel = pi.received.find((record) => record["type"] === "set_model");
    assert.deepEqual(
      { provider: setModel?.["provider"], modelId: setModel?.["modelId"] },
      { provider, modelId: "qwen3" },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

const failedTurnWith = (errorMessage: string) => ({
  type: "message_end",
  message: { role: "assistant", stopReason: "error", errorMessage },
});

const failedTurn = failedTurnWith(
  '401: {"error":{"message":"Incorrect API key provided: sk-test-SECRET123"}}',
);

const generateCommitMessage = (turnEvents: ReadonlyArray<Record<string, unknown>>, reply = "") =>
  Effect.gen(function* () {
    const pi = yield* makeFakePi(reply, undefined, turnEvents);
    const textGeneration = yield* makePiTextGeneration(
      { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
      {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));
    return yield* textGeneration.generateCommitMessage({
      cwd: process.cwd(),
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md",
      modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "default"),
    });
  });

it.effect("reports Pi's turn error when the reply is empty", () =>
  Effect.gen(function* () {
    const error = yield* generateCommitMessage([failedTurn]).pipe(Effect.flip);

    assert.equal(error._tag, "TextGenerationError");
    assert.equal(error.detail, "Pi could not generate text: the model provider returned HTTP 401.");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps Pi's raw error text out of the error", () =>
  Effect.gen(function* () {
    const error = yield* generateCommitMessage([
      failedTurnWith("Invalid API key sk-test-SECRET123"),
    ]).pipe(Effect.flip);

    assert.equal(error.detail, "Pi could not generate text: the model provider reported an error.");
    assert.notInclude(error.message, "SECRET123");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps the reply when Pi answers after a failed attempt", () =>
  Effect.gen(function* () {
    const result = yield* generateCommitMessage(
      [failedTurn, { type: "message_end", message: { role: "assistant", stopReason: "stop" } }],
      JSON.stringify({ subject: "Update README", body: "" }),
    );

    assert.equal(result.subject, "Update README");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("drops an earlier error once a later attempt succeeds", () =>
  Effect.gen(function* () {
    const error = yield* generateCommitMessage([
      failedTurn,
      { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
    ]).pipe(Effect.flip);

    assert.equal(error.detail, "Pi returned empty output.");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "summarizes only supplied notification data with no tools or extensions outside the checkout",
  () =>
    Effect.gen(function* () {
      const pi = yield* makeFakePi(
        encodeJsonLine({
          summary: "Review by Friday.",
          description: "Review by Friday.",
          suggestions: [],
          precedentIds: [],
          irrelevanceConfidence: null,
        }),
      );
      const generation = yield* makePiTextGeneration(
        { enabled: true, binaryPath: "pi", launchArgs: "--tools read", customModels: [] },
        {},
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));
      const result = yield* generation.generateInboxAnalysis!({
        cwd: process.cwd(),
        context: "Review by Friday.",
        instructions: "One sentence.",
        suggest: false,
        precedents: [],
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "default"),
      });
      assert.equal(result.summary, "Review by Friday.");
      assert.notEqual(pi.launches[0]?.cwd, process.cwd());
      assert.include(pi.launches[0]!.args, "--no-tools");
      assert.include(pi.launches[0]!.args, "--no-extensions");
      assert.notInclude(pi.launches[0]!.args, "read");
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["summary", "research"] as const)(
  "supplies notification images to Pi %s without enabling tools or extensions",
  (operation) =>
    Effect.gen(function* () {
      const pi = yield* makeFakePi(
        encodeJsonLine(
          operation === "summary"
            ? {
                summary: "Review the attached list.",
                description: "Review the list.",
                suggestions: [],
                precedentIds: [],
                irrelevanceConfidence: null,
              }
            : { request: null, suggestions: ["Review the attached list."], replyDraft: null },
        ),
      );
      const generation = yield* makePiTextGeneration(
        { enabled: true, binaryPath: "pi", launchArgs: "--tools read", customModels: [] },
        {},
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));
      const images = [{ data: "iVBORw0KGgo=", mimeType: "image/png" }];
      const input = {
        cwd: process.cwd(),
        context: "Can we mark those as done?",
        images,
        suggest: operation === "research",
        precedents: [],
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "default"),
      };
      if (operation === "summary") yield* generation.generateInboxAnalysis!(input);
      else yield* generation.generateInboxResearch!(input);

      const prompt = pi.received.find((record) => record["type"] === "prompt");
      assert.deepEqual(prompt?.["images"], [{ type: "image", ...images[0] }]);
      assert.include(prompt?.["message"], input.context);
      assert.notEqual(pi.launches[0]?.cwd, process.cwd());
      assert.include(pi.launches[0]!.args, "--no-tools");
      assert.include(pi.launches[0]!.args, "--no-extensions");
      assert.notInclude(pi.launches[0]!.args, "read");
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each([
  { model: "demo/demo-model", thinking: "off", expected: "off", version: "0.84.3" },
  { model: "demo/demo-model", thinking: "max", expected: "max", version: "1.4.0" },
  { model: "demo/demo-model", thinking: "invalid", expected: undefined, version: "0.84.3" },
  { model: "demo/demo-model", thinking: undefined, expected: undefined, version: "0.84.3" },
  { model: "default", thinking: "off", expected: "off", version: "0.84.3" },
  { model: "demo/demo-model", thinking: "low", expected: undefined, version: "0.84.2" },
])(
  "handles thinking=$thinking for $model on Pi $version",
  ({ model, thinking, expected, version }) =>
    Effect.gen(function* () {
      const pi = yield* makeFakePi(
        JSON.stringify({ subject: "Update README", body: "" }),
        undefined,
        [],
        undefined,
        version,
      );
      const textGeneration = yield* makePiTextGeneration(
        { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
        {},
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));

      const generation = textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "main",
        stagedSummary: "M README.md",
        stagedPatch: "diff --git a/README.md b/README.md",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("pi"),
          model,
          thinking === undefined ? [] : [{ id: "thinking", value: thinking }],
        ),
      });
      if (version === "0.84.2") {
        const error = yield* generation.pipe(Effect.flip);
        assert.include(error.detail, "Pi 0.84.3 or newer");
        assert.deepEqual(pi.received, []);
        return;
      }
      const result = yield* generation;

      assert.equal(result.subject, "Update README");
      assert.deepEqual(
        pi.received.map((record) => record["type"]),
        [
          ...(model === "default" ? [] : ["get_available_models", "set_model"]),
          ...(expected === undefined ? [] : ["set_thinking_level"]),
          "prompt",
          "get_last_assistant_text",
        ],
      );
      assert.equal(
        pi.received.find((record) => record["type"] === "set_thinking_level")?.["level"],
        expected,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("generates at Pi's default level when Pi rejects the saved thinking level", () =>
  Effect.gen(function* () {
    const pi = yield* makeFakePi(
      JSON.stringify({ subject: "Update README", body: "" }),
      undefined,
      [],
      undefined,
      "1.4.0",
      'Thinking level "max" is not supported by demo/demo-model',
    );
    const textGeneration = yield* makePiTextGeneration(
      { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
      {},
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, pi.spawner));

    const result = yield* textGeneration.generateCommitMessage({
      cwd: process.cwd(),
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md",
      modelSelection: createModelSelection(ProviderInstanceId.make("pi"), "demo/demo-model", [
        { id: "thinking", value: "max" },
      ]),
    });

    assert.equal(result.subject, "Update README");
    assert.deepEqual(
      pi.received.map((record) => record["type"]),
      [
        "get_available_models",
        "set_model",
        "set_thinking_level",
        "prompt",
        "get_last_assistant_text",
      ],
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
