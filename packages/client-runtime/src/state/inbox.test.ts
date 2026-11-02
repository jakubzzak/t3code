import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
  CommandId,
  WS_METHODS,
  type InboxNotification,
  type InboxReplyInput,
  type InboxGetInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
  type PreparedConnection,
} from "../connection/model.ts";
import type { EnvironmentRpcInput } from "../rpc/client.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createInboxEnvironmentAtoms } from "./inbox.ts";

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => sessionState }),
}));
const sessionState = Atom.make(
  AsyncResult.success({
    authenticated: true,
    scopes: [AuthOrchestrationOperateScope],
    permissions: [AuthOrchestrationOperateScope],
  }),
);
const env = EnvironmentId.make("inbox-environment");
const projectId = ProjectId.make("inbox-project");

it.effect(
  "refreshes every read of the project's notification after acceptance, without refreshing other projects or environments",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let revision = 0;
        let status: "sent" | "failed" = "sent";
        const reads: string[] = [];
        const snapshot = (id: ProjectId): InboxNotification => ({
          id: "notification",
          projectId: id,
          revision,
          source: "linear",
          connectionId: "workspace",
          groupId: "issue",
          items: [],
          state: { read: true, placement: "active", snoozedUntil: null, threadId: null },
          analysis: null,
          processingError: null,
          analysisVersion: 0,
          analysisAttempts: 0,
          analysisRetryAt: null,
          agentStatus: "idle",
          agentError: null,
          agentAttempt: 0,
          agentIntent: null,
          linkedChatSettled: false,
          updatedAt: "2026-10-30T10:00:00Z",
          confirmedOutcome: null,
        });
        const client = {
          [WS_METHODS.inboxList]: ({
            projectId: id,
            ...input
          }: EnvironmentRpcInput<typeof WS_METHODS.inboxList>) =>
            Effect.sync(() => {
              reads.push(JSON.stringify({ projectId: id, ...input }));
              return [snapshot(id)];
            }),
          [WS_METHODS.inboxGet]: ({ projectId: id }: InboxGetInput) =>
            Effect.sync(() => snapshot(id)),
          [WS_METHODS.inboxReply]: (input: InboxReplyInput) =>
            Effect.sync(() => {
              if (status === "sent") revision++;
              return {
                ...input,
                status,
                ...(status === "failed" ? { error: "Rejected" } : {}),
              };
            }),
        };
        const state = yield* SubscriptionRef.make<SupervisorConnectionState>({
          ...AVAILABLE_CONNECTION_STATE,
          desired: true,
          network: "online" as const,
          phase: "connected" as const,
          attempt: 1,
        });
        const session = yield* SubscriptionRef.make(
          Option.some({ client } as unknown as RpcSession),
        );
        const supervisor = EnvironmentSupervisor.of({
          target: new PrimaryConnectionTarget({
            environmentId: env,
            label: "Inbox",
            httpBaseUrl: "https://inbox.example.test",
            wsBaseUrl: "wss://inbox.example.test",
          }),
          state,
          session,
          prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        });
        const run: EnvironmentRegistry["Service"]["run"] = (_id, effect) =>
          Effect.provideService(effect, EnvironmentSupervisor, supervisor);
        const followStream: EnvironmentRegistry["Service"]["followStream"] = (_id, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisor);
        const service = {
          run,
          followStream,
          stateChanges: () => SubscriptionRef.changes(state),
        } as unknown as EnvironmentRegistry["Service"];
        const runtime = Atom.runtime(Layer.succeed(EnvironmentRegistry, service));
        const visibility = Atom.family((_id: EnvironmentId) => Atom.make(0).pipe(Atom.keepAlive));
        const inbox = createInboxEnvironmentAtoms(runtime, { refreshTrigger: visibility });
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const list = (input: Parameters<typeof inbox.list>[0]["input"], environmentId = env) =>
          inbox.list({ environmentId, input });
        const variants = [
          list({ projectId, offset: 0, limit: 101 }),
          list({ projectId, search: "Tars", offset: 0, limit: 101 }),
          list({ projectId, threadId: ThreadId.make("linked-chat") }),
        ];
        const detail = inbox.get({ environmentId: env, input: { projectId, id: "notification" } });
        const unrelated = [
          list({ projectId: ProjectId.make("another-project") }),
          list({ projectId }, EnvironmentId.make("another-environment")),
        ];
        const readList = (atom: (typeof variants)[number]) =>
          AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
            Effect.tap(() => Effect.yieldNow),
          );
        for (const atom of [...variants, ...unrelated]) registry.mount(atom);
        registry.mount(detail);
        for (const atom of [...variants, ...unrelated])
          expect((yield* readList(atom))[0]?.revision).toBe(0);
        expect(
          (yield* AtomRegistry.getResult(registry, detail, { suspendOnWaiting: true }))?.revision,
        ).toBe(0);
        const input: InboxReplyInput = {
          projectId,
          id: "notification",
          itemId: "item",
          commandId: CommandId.make("accepted"),
          text: "Reply to Tars",
          target: { source: "linear", issueId: "issue", parentId: null },
        };
        const sent = yield* Effect.promise(() =>
          inbox.reply.run(registry, { environmentId: env, input }),
        );
        expect(sent._tag).toBe("Success");
        for (const atom of variants) expect((yield* readList(atom))[0]?.revision).toBe(1);
        expect(
          (yield* AtomRegistry.getResult(registry, detail, { suspendOnWaiting: true }))?.revision,
        ).toBe(1);
        for (const atom of unrelated) expect((yield* readList(atom))[0]?.revision).toBe(0);
        status = "failed";
        const beforeFailure = reads.length;
        yield* Effect.promise(() =>
          inbox.reply.run(registry, {
            environmentId: env,
            input: { ...input, commandId: CommandId.make("rejected") },
          }),
        );
        for (const atom of variants) expect((yield* readList(atom))[0]?.revision).toBe(1);
        expect(reads).toHaveLength(beforeFailure);
        // Visibility changes still refresh every project on the selected environment.
        revision++;
        registry.set(visibility(env), 1);
        for (const atom of [...variants, unrelated[0]!])
          expect((yield* readList(atom))[0]?.revision).toBe(2);
        expect((yield* readList(unrelated[1]!))[0]?.revision).toBe(0);
      }),
    ),
);
