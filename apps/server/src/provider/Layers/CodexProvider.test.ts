import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  mapCodexModelCapabilities,
  probeCodexSkillsForCwd,
} from "./CodexProvider.ts";

import { makeProbeSpawner } from "../testUtils/codexProbeSpawner.ts";

const probeSkill = {
  name: "test-skill",
  description: "Test skill",
  path: `${process.cwd()}/test-skill/SKILL.md`,
  scope: "user",
  enabled: true,
};
const skillsResponse = {
  data: [{ cwd: process.cwd(), skills: [probeSkill], errors: [] }],
};
const settings = Schema.decodeSync(CodexSettings)({});

it.layer(NodeServices.layer)("Codex skill probes", (it) => {
  it.effect("keeps account and models ready when skill discovery stalls", () =>
    Effect.gen(function* () {
      const mock = yield* makeProbeSpawner(Effect.never);
      const fiber = yield* checkCodexProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
        Effect.forkChild,
      );
      yield* Deferred.await(mock.requested);
      yield* TestClock.adjust("11 seconds");
      const status = yield* Fiber.join(fiber);
      assert.strictEqual(status.status, "ready");
      assert.strictEqual(status.auth.status, "authenticated");
      assert.strictEqual(status.models[0]?.slug, "gpt-test");
      assert.deepStrictEqual(status.skills, []);
      yield* Deferred.await(mock.closed);
    }),
  );

  it.effect("keeps account and models ready when skill discovery fails", () =>
    Effect.gen(function* () {
      const mock = yield* makeProbeSpawner(
        Effect.succeed({
          error: { code: -32603, message: "Cannot read skill directory" },
        }),
      );
      const status = yield* checkCodexProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
      );
      assert.strictEqual(status.status, "ready");
      assert.strictEqual(status.auth.status, "authenticated");
      assert.strictEqual(status.models[0]?.slug, "gpt-test");
      yield* Deferred.await(mock.closed);
    }),
  );

  it.effect("includes skills when discovery finishes within the health-check budget", () =>
    Effect.gen(function* () {
      const mock = yield* makeProbeSpawner(Effect.succeed({ result: skillsResponse }));
      const status = yield* checkCodexProviderStatus(settings).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
      );
      assert.strictEqual(status.status, "ready");
      assert.deepStrictEqual(status.skills, [probeSkill]);
      yield* Deferred.await(mock.closed);
    }),
  );

  it.effect("allows a workspace skill scan to finish after twenty seconds", () =>
    Effect.gen(function* () {
      const response = yield* Deferred.make<{ result: typeof skillsResponse }>();
      const mock = yield* makeProbeSpawner(Deferred.await(response));
      const fiber = yield* probeCodexSkillsForCwd({ binaryPath: "codex", cwd: process.cwd() }).pipe(
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
        Effect.forkChild,
      );
      yield* Deferred.await(mock.requested);
      yield* TestClock.adjust("25 seconds");
      yield* Deferred.succeed(response, { result: skillsResponse });
      assert.deepStrictEqual(yield* Fiber.join(fiber), [probeSkill]);
      yield* Deferred.await(mock.closed);
    }),
  );

  it.effect("fails and closes a workspace scan that never answers", () =>
    Effect.gen(function* () {
      const mock = yield* makeProbeSpawner(Effect.never);
      const fiber = yield* probeCodexSkillsForCwd({ binaryPath: "codex", cwd: process.cwd() }).pipe(
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
        Effect.flip,
        Effect.forkChild,
      );
      yield* Deferred.await(mock.requested);
      yield* TestClock.adjust("61 seconds");
      assert.strictEqual((yield* Fiber.join(fiber))._tag, "TimeoutError");
      yield* Deferred.await(mock.closed);
    }),
  );
});

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
