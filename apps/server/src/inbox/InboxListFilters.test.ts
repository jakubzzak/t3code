import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  InboxListInput,
  ProjectId,
  type InboxListFilters,
  type InboxNotification,
  type InboxSource,
} from "@t3tools/contracts";
import {
  matchesInboxListFilters,
  isInboxNotificationVisible,
} from "@t3tools/shared/inboxVisibility";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Repository from "./InboxRepository.ts";
import { ingestInboxItem } from "./inboxState.ts";

const projectId = ProjectId.make("facets");
const make = (id: string, source: InboxSource = "slack") =>
  ingestInboxItem(projectId, {
    id,
    source,
    connectionId: "fixture",
    groupId: id,
    title: id,
    author: "Alex",
    content: id,
    location: "fixture",
    url: "https://example.test",
    occurredAt: "2026-11-03T12:00:00Z",
  });
const irrelevant = {
  version: 0,
  threshold: 98,
  status: "complete" as const,
  confidence: 99,
  irrelevant: true,
};
const activity = (kind?: "reply" | "update") => ({
  id: "activity",
  occurredAt: "2026-11-03T12:00:00Z",
  isSelf: true,
  ...(kind ? { kind } : {}),
});
const seeds: InboxNotification[] = [
  make("normal"),
  {
    ...make("manual"),
    state: { ...make("manual").state, irrelevant: true },
    replyCursor: activity("reply"),
  },
  {
    ...make("kept", "linear"),
    state: { ...make("kept").state, irrelevant: false },
    relevance: irrelevant,
    replyCursor: activity("update"),
  },
  {
    ...make("automatic", "superhuman"),
    state: { ...make("automatic").state, read: true },
    relevance: irrelevant,
    replyCursor: activity(),
  },
  { ...make("own-update", "linear"), replyCursor: activity("update") },
  { ...make("pending"), relevance: { ...irrelevant, status: "pending" } },
];
const ids = (rows: readonly InboxNotification[]) => rows.map((row) => row.items[0]!.id).sort();
const cases: readonly [InboxListFilters, readonly string[]][] = [
  [{}, ["normal", "manual", "kept", "automatic", "own-update", "pending"]],
  [
    { sources: [], selfActivity: [], unreadOnly: false, irrelevantOnly: false },
    ["normal", "manual", "kept", "automatic", "own-update", "pending"],
  ],
  [{ sources: ["linear", "superhuman"] }, ["kept", "automatic", "own-update"]],
  [{ unreadOnly: true }, ["normal", "manual", "kept", "own-update", "pending"]],
  [{ irrelevantOnly: true }, ["manual", "automatic"]],
  [{ selfActivity: ["reply"] }, ["manual", "automatic"]],
  [{ selfActivity: ["update"] }, ["kept", "own-update"]],
  [{ selfActivity: ["reply", "update"] }, ["manual", "automatic", "kept", "own-update"]],
  [
    {
      sources: ["slack", "superhuman"],
      unreadOnly: true,
      irrelevantOnly: true,
      selfActivity: ["reply", "update"],
    },
    ["manual"],
  ],
  [{ sources: ["linear"], irrelevantOnly: true }, []],
];

it.effect(
  "matches server and cached facets with AND across groups, OR within groups and legacy cursor semantics",
  () =>
    Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      for (const row of seeds) yield* repository.put(row);
      for (const [filters, expected] of cases) {
        assert.deepEqual(
          ids(seeds.filter((row) => matchesInboxListFilters(row, filters))),
          [...expected].sort(),
        );
        const rows = yield* repository.list(projectId, {
          ...filters,
          visibility: "all",
          filterIrrelevant: false,
        });
        assert.deepEqual(ids(rows), [...expected].sort());
      }
      // Explicit facets never silently widen the caller's separately chosen visibility.
      assert.deepEqual(ids(yield* repository.list(projectId, { irrelevantOnly: true })), []);
      assert.deepEqual(
        ids(yield* repository.list(projectId, { irrelevantOnly: true, visibility: "filtered" })),
        ["automatic", "manual"],
      );
      assert.equal(matchesInboxListFilters(seeds[0]!, undefined), true);
      const legacySettings = {
        inboxFilterIrrelevant: false,
        inboxShowSelfUpdates: false,
        inboxShowSelfReplies: false,
      };
      const inboxRows = yield* repository.list(projectId, {
        visibility: "inbox",
        filterIrrelevant: false,
        showSelfUpdates: false,
        showSelfReplies: false,
      });
      assert.deepEqual(ids(inboxRows), ["kept", "normal", "own-update", "pending"]);
      assert.deepEqual(
        ids(seeds.filter((row) => isInboxNotificationVisible(row, legacySettings, "inbox"))),
        ids(inboxRows),
      );
      assert.deepEqual(
        ids(
          yield* repository.list(projectId, {
            visibility: "visible",
            filterIrrelevant: false,
            showSelfUpdates: false,
            showSelfReplies: false,
          }),
        ),
        ["normal", "pending"],
      );
    }).pipe(Effect.provide(Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);

it.effect(
  "applies selective facets before LIMIT and OFFSET even when matches lie beyond the first hundred rows",
  () =>
    Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      for (let index = 0; index < 105; index++) yield* repository.put(make(`newer-${index}`));
      for (const id of ["target-a", "target-b"]) {
        const base = make(id, "superhuman");
        yield* repository.put({
          ...base,
          updatedAt: id === "target-a" ? "2026-11-02T12:00:00Z" : "2026-11-02T11:00:00Z",
          state: { ...base.state, irrelevant: true },
          replyCursor: activity("update"),
        });
      }
      const filters = {
        visibility: "all" as const,
        sources: ["superhuman" as const],
        unreadOnly: true,
        irrelevantOnly: true,
        selfActivity: ["update" as const],
        limit: 1,
      };
      assert.deepEqual(ids(yield* repository.list(projectId, filters)), ["target-a"]);
      assert.deepEqual(ids(yield* repository.list(projectId, { ...filters, offset: 1 })), [
        "target-b",
      ]);
      assert.equal(
        (yield* repository.list(projectId, { visibility: "all", limit: 100 })).length,
        100,
      );
    }).pipe(Effect.provide(Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);

const decodeList = Schema.decodeUnknownSync(InboxListInput);
it("bounds source and activity facets and preserves omitted legacy request fields", () => {
  assert.deepEqual(decodeList({ projectId }), { projectId });
  assert.deepEqual(decodeList({ projectId, sources: [], selfActivity: [] }), {
    projectId,
    sources: [],
    selfActivity: [],
  });
  assert.throws(() =>
    decodeList({ projectId, sources: ["slack", "linear", "superhuman", "slack"] }),
  );
  assert.throws(() => decodeList({ projectId, selfActivity: ["reply", "update", "reply"] }));
  assert.throws(() => decodeList({ projectId, selfActivity: ["unknown"] }));
});

const allSources = ["slack", "linear", "superhuman"] as const;
const defaultInclude = { unread: true, irrelevant: false, selfReplies: false, selfUpdates: false };
const includeKeys = ["unread", "irrelevant", "selfReplies", "selfUpdates"] as const;

it.effect(
  "Include controls add categories without removing the ordinary read baseline and require every overlapping gate",
  () =>
    Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const readBase = { ...make("base-read"), state: { ...make("base-read").state, read: true } };
      const rows = [
        ...seeds,
        readBase,
        { ...make("self-reply-read"), state: { ...readBase.state }, replyCursor: activity() },
        { ...make("irrelevant-read"), state: { ...readBase.state }, relevance: irrelevant },
        {
          ...make("irrelevant-unread"),
          state: { ...make("irrelevant-unread").state, irrelevant: true },
        },
      ];
      for (const row of rows) yield* repository.put(row);
      yield* repository.put({
        ...readBase,
        id: `${readBase.id}-foreign`,
        projectId: ProjectId.make("foreign"),
      });
      const results = new Map<number, string[]>();
      for (let mask = 0; mask < 16; mask++) {
        const include = {
          unread: !!(mask & 1),
          irrelevant: !!(mask & 2),
          selfReplies: !!(mask & 4),
          selfUpdates: !!(mask & 8),
        };
        const filters = { sources: allSources, include, visibility: "all" as const };
        const actual = ids(yield* repository.list(projectId, filters));
        assert.deepEqual(actual, ids(rows.filter((row) => matchesInboxListFilters(row, filters))));
        results.set(mask, actual);
        assert.include(actual, "base-read");
        assert.equal(
          actual.includes("manual"),
          include.unread && include.irrelevant && include.selfReplies,
        );
        assert.equal(actual.includes("automatic"), include.irrelevant && include.selfReplies);
        assert.equal(actual.includes("kept"), include.unread && include.selfUpdates);
      }
      assert.deepEqual(results.get(0), ["base-read"]);
      assert.deepEqual(results.get(1), ["base-read", "normal", "pending"]);
      for (const [mask, before] of results)
        for (let bit = 0; bit < includeKeys.length; bit++) {
          if (mask & (1 << bit)) continue;
          const after = results.get(mask | (1 << bit))!;
          assert.equal(
            before.every((id) => after.includes(id)),
            true,
          );
        }
      assert.deepEqual(
        yield* repository.list(projectId, {
          visibility: "all",
          sources: [],
          include: defaultInclude,
        }),
        [],
      );
      assert.equal(
        matchesInboxListFilters(readBase, { sources: [], include: defaultInclude }),
        false,
      );
      assert.deepEqual(
        ids(yield* repository.list(projectId, { visibility: "all", include: defaultInclude })),
        results.get(1),
      );
      assert.deepEqual(
        ids(
          yield* repository.list(projectId, {
            visibility: "all",
            sources: allSources,
            include: defaultInclude,
            unreadOnly: true,
            irrelevantOnly: true,
            selfActivity: ["reply"],
          }),
        ),
        results.get(1),
      );
    }).pipe(Effect.provide(Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);

it.effect(
  "Include exclusions run before pagination so older ordinary read messages remain reachable",
  () =>
    Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      for (let index = 0; index < 105; index++)
        yield* repository.put({ ...make(`own-${index}`), replyCursor: activity("update") });
      for (const id of ["target-a", "target-b"]) {
        const row = make(id, "superhuman");
        yield* repository.put({
          ...row,
          state: { ...row.state, read: true },
          updatedAt: id === "target-a" ? "2026-11-02T12:00:00Z" : "2026-11-02T11:00:00Z",
        });
      }
      const input = {
        visibility: "all" as const,
        sources: allSources,
        include: defaultInclude,
        limit: 1,
      };
      assert.deepEqual(ids(yield* repository.list(projectId, input)), ["target-a"]);
      assert.deepEqual(ids(yield* repository.list(projectId, { ...input, offset: 1 })), [
        "target-b",
      ]);
    }).pipe(Effect.provide(Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);

it("requires an explicit boolean for each Include category without changing legacy input decoding", () => {
  assert.deepEqual(decodeList({ projectId, include: defaultInclude, sources: [] }), {
    projectId,
    include: defaultInclude,
    sources: [],
  });
  assert.throws(() => decodeList({ projectId, include: { unread: true } }));
  assert.throws(() =>
    decodeList({ projectId, include: { ...defaultInclude, irrelevant: "false" } }),
  );
});
