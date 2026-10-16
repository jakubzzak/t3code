import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

const decodeProbeRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
      method: Schema.String,
    }),
  ),
);

// Exercise the real protocol client and probe with controllable skill responses.
export const makeProbeSpawner = Effect.fnUntraced(function* (
  skills: Effect.Effect<{ result: unknown } | { error: { code: number; message: string } }>,
) {
  const requested = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<void>();
  const spawner = ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const output = yield* Queue.unbounded<Uint8Array>();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let pending = "";
      const stdin = Sink.forEach((chunk: Uint8Array) =>
        Effect.gen(function* () {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const request = yield* decodeProbeRequest(line).pipe(Effect.orDie);
            if (request.id === undefined) continue;
            const result = (() => {
              switch (request.method) {
                case "initialize":
                  return Effect.succeed({
                    result: {
                      userAgent: "codex/0.162.1",
                      codexHome: process.cwd(),
                      platformFamily: "unix",
                      platformOs: "macos",
                    },
                  });
                case "account/read":
                  return Effect.succeed({
                    result: {
                      account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
                      requiresOpenaiAuth: true,
                    },
                  });
                case "model/list":
                  return Effect.succeed({
                    result: {
                      data: [
                        {
                          id: "gpt-test",
                          model: "gpt-test",
                          displayName: "GPT Test",
                          description: "Test model",
                          hidden: false,
                          isDefault: true,
                          defaultReasoningEffort: "medium",
                          supportedReasoningEfforts: [],
                        },
                      ],
                      nextCursor: null,
                    },
                  });
                case "account/rateLimits/read":
                  return Effect.succeed({ result: { rateLimits: { planType: "pro" } } });
                case "skills/list":
                  return Deferred.succeed(requested, undefined).pipe(Effect.andThen(skills));
                default:
                  return Effect.die(`Unexpected probe request: ${request.method}`);
              }
            })();
            yield* result.pipe(
              Effect.flatMap((payload) =>
                Queue.offer(
                  output,
                  encoder.encode(`${JSON.stringify({ id: request.id, ...payload })}\n`),
                ),
              ),
              Effect.forkIn(scope),
            );
          }
        }),
      );
      yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin,
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { spawner, requested, closed };
});
