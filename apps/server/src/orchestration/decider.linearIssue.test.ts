import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(input: {
  readonly autoSettleDisabledAt?: string | null;
  readonly settledOverride?: "settled" | "active" | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: input.settledOverride ?? null,
        settledAt: input.settledOverride === "settled" ? NOW : null,
        autoSettleDisabledAt: input.autoSettleDisabledAt ?? null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

const issue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix login",
  url: "https://linear.app/acme/issue/ENG-123",
  workspace: "acme",
  branchName: "eng-123-fix-login",
};
it.layer(NodeServices.layer)("Linear issue associations", (it) => {
  it.effect("persists an issue through metadata events and replay, then unlinks it", () =>
    Effect.gen(function* () {
      let model = makeReadModel({});
      const command = {
        type: "thread.meta.update" as const,
        commandId: CommandId.make("link"),
        threadId: ThreadId.make("thread-1"),
        linkedLinearIssue: issue,
      };
      const result = yield* decideOrchestrationCommand({ readModel: model, command });
      const events = Array.isArray(result) ? result : [result];
      for (const event of events) model = yield* projectEvent(model, event);
      expect(model.threads[0]).toMatchObject({ linkedLinearIssue: issue });
      const unlink = { ...command, commandId: CommandId.make("unlink"), linkedLinearIssue: null };
      const removed = yield* decideOrchestrationCommand({ readModel: model, command: unlink });
      for (const event of Array.isArray(removed) ? removed : [removed])
        model = yield* projectEvent(model, event);
      expect(model.threads[0]).toMatchObject({ linkedLinearIssue: null });
    }),
  );
  it.effect("rejects linking while a turn is starting instead of changing context", () =>
    Effect.gen(function* () {
      const model = makeReadModel({});
      const thread = model.threads[0]!;
      const running = {
        ...model,
        threads: [
          {
            ...thread,
            session: {
              threadId: thread.id,
              status: "starting" as const,
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "full-access" as const,
              activeTurnId: null,
              lastError: null,
              updatedAt: NOW,
            },
          },
        ],
      };
      const command = {
        type: "thread.meta.update" as const,
        commandId: CommandId.make("link"),
        threadId: thread.id,
        linkedLinearIssue: issue,
        branch: issue.branchName,
        worktreePath: "/worktrees/project/eng-123-fix-login",
      };
      const result = yield* Effect.exit(
        decideOrchestrationCommand({ readModel: running, command }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );
  it.effect("settles the previous chat and associates this chat in the same decision", () =>
    Effect.gen(function* () {
      let model = makeReadModel({});
      const thread = model.threads[0]!;
      model = {
        ...model,
        threads: [
          thread,
          {
            ...thread,
            id: ThreadId.make("previous"),
            branch: issue.branchName,
            worktreePath: "/worktrees/project/issue",
          },
        ],
      };
      const events = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.linear-issue.select",
          commandId: CommandId.make("takeover"),
          threadId: thread.id,
          issue,
          worktreePath: "/worktrees/project/issue",
          expectedWorktreePath: null,
          expectedIssueId: null,
          takeoverThreadIds: [ThreadId.make("previous")],
        },
      });
      for (const event of Array.isArray(events) ? events : [events])
        model = yield* projectEvent(model, event);
      expect(model.threads[0]).toMatchObject({
        linkedLinearIssue: issue,
        branch: issue.branchName,
        worktreePath: "/worktrees/project/issue",
      });
      expect(model.threads[1]).toMatchObject({
        settledOverride: "settled",
        worktreePath: "/worktrees/project/issue",
      });
    }),
  );
  it.effect("rejects a stale selection when another issue was linked in the meantime", () =>
    Effect.gen(function* () {
      const model = makeReadModel({});
      const thread = model.threads[0]!;
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: {
            ...model,
            threads: [{ ...thread, linkedLinearIssue: { ...issue, id: "another" } }],
          },
          command: {
            type: "thread.linear-issue.select",
            commandId: CommandId.make("stale"),
            threadId: thread.id,
            issue,
            worktreePath: "/worktrees/project/issue",
            expectedWorktreePath: null,
            expectedIssueId: null,
            takeoverThreadIds: [],
          },
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects takeover when the previous agent starts after the modal opened", () =>
    Effect.gen(function* () {
      const model = makeReadModel({});
      const thread = model.threads[0]!;
      const previousId = ThreadId.make("previous");
      const previous = {
        ...thread,
        id: previousId,
        branch: issue.branchName,
        worktreePath: "/worktrees/project/issue",
        session: {
          threadId: previousId,
          status: "running" as const,
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access" as const,
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      };
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: { ...model, threads: [thread, previous] },
          command: {
            type: "thread.linear-issue.select",
            commandId: CommandId.make("race"),
            threadId: thread.id,
            issue,
            worktreePath: previous.worktreePath,
            expectedWorktreePath: null,
            expectedIssueId: null,
            takeoverThreadIds: [previousId],
          },
        }),
      );
      expect(result._tag).toBe("Failure");
      expect(previous.settledAt).toBeNull();
      expect(thread.worktreePath).toBeNull();
    }),
  );
  it.effect("reuses a settled chat's worktree without requiring takeover", () =>
    Effect.gen(function* () {
      let model = makeReadModel({});
      const thread = model.threads[0]!;
      const previous = {
        ...thread,
        id: ThreadId.make("previous"),
        branch: issue.branchName,
        worktreePath: "/worktrees/project/issue",
        settledOverride: "settled" as const,
        settledAt: NOW,
      };
      model = { ...model, threads: [thread, previous] };
      const result = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.linear-issue.select",
          commandId: CommandId.make("reuse"),
          threadId: thread.id,
          issue,
          worktreePath: previous.worktreePath,
          expectedWorktreePath: null,
          expectedIssueId: null,
          takeoverThreadIds: [],
        },
      });
      for (const event of Array.isArray(result) ? result : [result])
        model = yield* projectEvent(model, event);
      expect(model.threads[0]?.linkedLinearIssue).toEqual(issue);
      expect(model.threads[1]).toEqual(previous);
    }),
  );
});
