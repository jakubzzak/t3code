// @effect-diagnostics nodeBuiltinImport:off - Dirent and realpath distinguish aliases without reading contents.
import * as NodeFSP from "node:fs/promises";
import type {
  ProjectEntry,
  ProjectListEntriesResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { isProjectFaviconPath } from "@t3tools/shared/projectFavicon";
import {
  scoreQueryMatch,
  insertRankedSearchResult,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

export class WorkspaceFilesReadError extends Schema.TaggedError<WorkspaceFilesReadError>()(
  "WorkspaceFilesReadError",
  {
    cwd: Schema.String,
    directoryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Unable to read folder: ${this.directoryPath || "."}`;
  }
}

export class WorkspaceFiles extends Context.Service<
  WorkspaceFiles,
  {
    readonly list: (
      cwd: string,
      directoryPath: string,
    ) => Effect.Effect<ProjectListEntriesResult, WorkspaceFilesReadError>;
    readonly search: (
      input: ProjectSearchEntriesInput,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceFilesReadError>;
    readonly refresh: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/WorkspaceFiles") {}

class SnapshotKey extends Data.Class<{ readonly cwd: string; readonly revision: string }> {}

const MAX_ENTRIES = 100_000;
const MAX_DIRECTORIES = 2_000;
const MAX_DEPTH = 128;

const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const paths = yield* WorkspacePaths.WorkspacePaths;
  const process = yield* VcsProcess.VcsProcess;
  const outside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  };
  const hasSegment = (target: string, name: string) => target.split(path.sep).includes(name);

  const ignoredNames = Effect.fn("WorkspaceFiles.ignoredNames")(function* (
    directory: string,
    names: readonly string[],
  ) {
    const ignored = new Set<string>();
    for (let offset = 0; offset < names.length; offset += 1000) {
      const result = yield* process
        .run({
          operation: "WorkspaceFiles.ignoredNames",
          command: "git",
          cwd: directory,
          args: ["-c", "core.fsmonitor=false", "check-ignore", "-z", "--stdin"],
          stdin: `${names.slice(offset, offset + 1000).join("\0")}\0`,
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: 1024 * 1024,
        })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (!result || (result.exitCode !== 0 && result.exitCode !== 1)) break;
      for (const name of result.stdout.split("\0")) ignored.add(name);
    }
    return ignored;
  });

  const children = Effect.fn("WorkspaceFiles.children")(function* (
    cwd: string,
    directoryPath: string,
    root: string,
    directory: string,
    ancestors: readonly string[],
    search: boolean,
    inheritedIgnored = false,
  ) {
    const toError = (cause: unknown) => new WorkspaceFilesReadError({ cwd, directoryPath, cause });
    const dirents = yield* Effect.tryPromise({
      try: () => NodeFSP.readdir(directory, { withFileTypes: true }),
      catch: toError,
    });
    const candidates = dirents.filter(
      (child) =>
        child.name !== ".git" &&
        (!search || child.name !== "node_modules") &&
        (child.isFile() || child.isDirectory() || child.isSymbolicLink()),
    );
    const ignored = yield* ignoredNames(
      directory,
      candidates.map((child) => child.name),
    );
    const entries = yield* Effect.forEach(
      candidates,
      (child) =>
        Effect.tryPromise({
          try: async () => {
            const alias = directoryPath ? `${directoryPath}/${child.name}` : child.name;
            let canonical = path.join(directory, child.name);
            let kind: ProjectEntry["kind"] = child.isDirectory() ? "directory" : "file";
            let link: ProjectEntry["link"];
            if (child.isSymbolicLink()) {
              let target = "";
              try {
                target = await NodeFSP.readlink(canonical);
                canonical = await NodeFSP.realpath(canonical);
                if (
                  hasSegment(canonical, ".git") ||
                  (search && hasSegment(canonical, "node_modules"))
                )
                  return null;
                const stat = await NodeFSP.stat(canonical);
                kind = stat.isDirectory() ? "directory" : "file";
                link = {
                  target,
                  ...((!stat.isFile() && !stat.isDirectory()) ||
                  (kind === "directory" && ancestors.includes(canonical))
                    ? { unavailable: true }
                    : {}),
                };
              } catch {
                link = { target, unavailable: true };
              }
            }
            const entry: ProjectEntry = {
              path: alias,
              kind,
              ...(inheritedIgnored || ignored.has(child.name) ? { ignored: true } : {}),
              ...(outside(root, canonical) ? { readOnly: true } : {}),
              ...(link ? { link } : {}),
            };
            return { entry, canonical };
          },
          catch: toError,
        }),
      { concurrency: 16 },
    );
    return entries.filter((entry) => entry !== null);
  });

  const list: WorkspaceFiles["Service"]["list"] = Effect.fn("WorkspaceFiles.list")(
    function* (cwd, directoryPath) {
      const toError = (cause: unknown) =>
        new WorkspaceFilesReadError({ cwd, directoryPath, cause });
      const relativePath =
        directoryPath === ""
          ? ""
          : (yield* paths
              .resolveRelativePathWithinRoot({ workspaceRoot: cwd, relativePath: directoryPath })
              .pipe(Effect.mapError(toError))).relativePath;
      const location = yield* Effect.tryPromise({
        try: async () => {
          const root = await NodeFSP.realpath(cwd);
          const ancestors = [root];
          let directory = root;
          const segments = relativePath.split("/").filter(Boolean);
          if (segments.length > MAX_DEPTH) throw new Error("Directory depth exceeded.");
          for (let i = 0; i < segments.length; i++) {
            if (segments[i] === ".git") throw new Error("Git internals are excluded.");
            directory = await NodeFSP.realpath(path.join(cwd, ...segments.slice(0, i + 1)));
            if (hasSegment(directory, ".git") || ancestors.includes(directory))
              throw new Error("Directory link is unavailable.");
            ancestors.push(directory);
          }
          return { root, directory, ancestors };
        },
        catch: toError,
      });
      const items = yield* children(
        cwd,
        relativePath,
        location.root,
        location.directory,
        location.ancestors,
        false,
      );
      return { entries: items.map((item) => item.entry), truncated: false };
    },
  );

  const scan = Effect.fn("WorkspaceFiles.scan")(function* (cwd: string, includeIgnored: boolean) {
    const root = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(cwd),
      catch: (cause) => new WorkspaceFilesReadError({ cwd, directoryPath: "", cause }),
    });
    if (hasSegment(root, "node_modules") || hasSegment(root, ".git"))
      return { entries: [], truncated: false };
    const queue = [{ directoryPath: "", directory: root, ancestors: [root], ignored: false }];
    const entries: ProjectEntry[] = [];
    const deadline = (yield* Clock.currentTimeMillis) + 5_000;
    let visited = 0;
    let truncated = false;
    while (queue.length > 0 && visited < MAX_DIRECTORIES && entries.length < MAX_ENTRIES) {
      if ((yield* Clock.currentTimeMillis) >= deadline) break;
      const batch = queue.splice(0, Math.min(8, MAX_DIRECTORIES - visited));
      visited += batch.length;
      const result = yield* Effect.forEach(
        batch,
        (item) =>
          children(
            cwd,
            item.directoryPath,
            root,
            item.directory,
            item.ancestors,
            true,
            item.ignored,
          ).pipe(
            Effect.map((items) => ({ item, items })),
            Effect.catchTags({
              WorkspaceFilesReadError: (error) =>
                item.directoryPath === ""
                  ? Effect.fail(error)
                  : Effect.sync(() => {
                      truncated = true;
                      return { item, items: [] };
                    }),
            }),
          ),
        { concurrency: 8 },
      ).pipe(Effect.timeoutOption(Math.max(1, deadline - (yield* Clock.currentTimeMillis))));
      if (Option.isNone(result)) {
        truncated = true;
        break;
      }
      for (const { item, items } of result.value) {
        for (const child of items) {
          if (!includeIgnored && child.entry.ignored) continue;
          if (entries.length >= MAX_ENTRIES) {
            truncated = true;
            break;
          }
          entries.push(child.entry);
          if (child.entry.kind === "directory" && !child.entry.link?.unavailable) {
            if (item.ancestors.length >= MAX_DEPTH) {
              truncated = true;
              continue;
            }
            queue.push({
              directoryPath: child.entry.path,
              directory: child.canonical,
              ancestors: [...item.ancestors, child.canonical],
              ignored: child.entry.ignored === true,
            });
          }
        }
      }
    }
    return { entries, truncated: truncated || queue.length > 0 };
  });
  // Separate bounded caches avoid scanning ignored trees until explicitly requested.
  const normal = yield* Cache.make({
    capacity: 4,
    timeToLive: "10 seconds",
    lookup: (key: { readonly cwd: string; readonly revision: string }) => scan(key.cwd, false),
  });
  const includingIgnored = yield* Cache.make({
    capacity: 4,
    timeToLive: "10 seconds",
    lookup: (key: { readonly cwd: string; readonly revision: string }) => scan(key.cwd, true),
  });
  const search: WorkspaceFiles["Service"]["search"] = Effect.fn("WorkspaceFiles.search")(
    function* (input) {
      const snapshot = yield* Cache.get(
        input.files?.includeIgnored ? includingIgnored : normal,
        new SnapshotKey({ cwd: input.cwd, revision: input.filesRevision ?? "" }),
      );
      const query = input.query.trim().toLowerCase();
      const matches: RankedSearchResult<ProjectEntry>[] = [];
      let total = 0;
      for (const entry of snapshot.entries) {
        const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
        if (
          (input.kind && entry.kind !== input.kind) ||
          (entry.kind === "file" && !input.files?.includeTests && /\.(test|spec)\./.test(name)) ||
          (input.imageOnly && !isProjectFaviconPath(entry.path))
        )
          continue;
        const score =
          query === ""
            ? 0
            : scoreQueryMatch({
                value: entry.path.toLowerCase(),
                query,
                exactBase: 0,
                prefixBase: 10,
                boundaryBase: 20,
                includesBase: 30,
                fuzzyBase: 100,
              });
        if (score === null) continue;
        total++;
        insertRankedSearchResult(
          matches,
          { item: entry, score, tieBreaker: entry.path },
          input.limit,
        );
      }
      const byPath = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
      const ancestors = new Map<string, ProjectEntry>();
      for (const { item } of matches) {
        const parts = item.path.split("/");
        for (let index = 1; index < parts.length; index++) {
          const entry = byPath.get(parts.slice(0, index).join("/"));
          if (entry && (entry.link || entry.ignored)) ancestors.set(entry.path, entry);
        }
      }
      return {
        entries: matches.map((match) => match.item),
        ancestors: [...ancestors.values()],
        truncated: snapshot.truncated || total > input.limit,
      };
    },
  );
  const refresh = (_cwd: string) =>
    Effect.all([Cache.invalidateAll(normal), Cache.invalidateAll(includingIgnored)], {
      discard: true,
    });
  return WorkspaceFiles.of({ list, search, refresh });
});

export const layer = Layer.effect(WorkspaceFiles, make).pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(VcsProcess.layer),
);
