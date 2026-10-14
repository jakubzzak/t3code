import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { prepareLinearWorktree } from "./LinearWorktree.ts";
const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-linear-worktree-" })),
  Layer.provideMerge(NodeServices.layer),
);
it.layer(TestLayer)("Linear worktrees", (it) => {
  it.effect(
    "creates the exact Linear branch, then reuses its worktree with dirty files intact",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const git = yield* GitVcsDriver.GitVcsDriver;
        const config = yield* ServerConfig;
        const cwd = yield* fs.makeTempDirectoryScoped();
        const run = (args: string[]) =>
          git.execute({ cwd, args, operation: "test", timeoutMs: 10000 });
        yield* run(["init", "-b", "main"]);
        yield* run([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ]);
        const input = {
          cwd,
          projectId: "project-1",
          branchName: "eng-123-fix-login",
          baseRef: "main",
        };
        const first = yield* prepareLinearWorktree(input);
        expect(first.created).toBe(true);
        expect(first.path.startsWith((yield* fs.realPath(config.worktreesDir)) + path.sep)).toBe(
          true,
        );
        const branch = yield* git.execute({
          cwd: first.path,
          args: ["branch", "--show-current"],
          operation: "test",
        });
        expect(branch.stdout.trim()).toBe(input.branchName);
        yield* fs.writeFileString(path.join(first.path, "unfinished.txt"), "keep me");
        const again = yield* prepareLinearWorktree(input);
        expect(again).toEqual({ path: first.path, created: false });
        expect(yield* fs.readFileString(path.join(first.path, "unfinished.txt"))).toBe("keep me");
      }),
  );
  it.effect("fetches an existing GitHub branch and sets tracking without changing its name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const remote = yield* fs.makeTempDirectoryScoped();
      const run = (args: string[]) => git.execute({ cwd, args, operation: "test" });
      yield* run(["init", "-b", "main"]);
      yield* run([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      yield* git.execute({ cwd: remote, args: ["init", "--bare"], operation: "test" });
      yield* run(["remote", "add", "origin", "https://github.com/linear-fixture/repo.git"]);
      yield* run([
        "config",
        `url.${remote}.insteadOf`,
        "https://github.com/linear-fixture/repo.git",
      ]);
      yield* run(["push", "origin", "HEAD:refs/heads/team/eng-456-existing"]);
      // The selected base does not exist: only the actual GitHub branch can satisfy this request.
      const result = yield* prepareLinearWorktree({
        cwd,
        projectId: "remote-test",
        branchName: "team/eng-456-existing",
        baseRef: "missing-base",
      });
      const branch = yield* git.execute({
        cwd: result.path,
        args: ["branch", "--show-current"],
        operation: "test",
      });
      const upstream = yield* git.execute({
        cwd: result.path,
        args: ["rev-parse", "--abbrev-ref", "@{upstream}"],
        operation: "test",
      });
      expect(branch.stdout.trim()).toBe("team/eng-456-existing");
      expect(upstream.stdout.trim()).toBe("origin/team/eng-456-existing");
    }),
  );
  it.effect("uses the local branch even when the selected base is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const run = (args: string[]) => git.execute({ cwd, args, operation: "test" });
      yield* run(["init", "-b", "main"]);
      yield* run([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      yield* run(["branch", "eng-789-local"]);
      const result = yield* prepareLinearWorktree({
        cwd,
        projectId: "local-test",
        branchName: "eng-789-local",
        baseRef: "missing-base",
      });
      const head = yield* git.execute({
        cwd: result.path,
        args: ["branch", "--show-current"],
        operation: "test",
      });
      expect(head.stdout.trim()).toBe("eng-789-local");
    }),
  );
  it.effect(
    "rejects invalid branch names and preserves a directory collision without creating a branch",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig;
        const git = yield* GitVcsDriver.GitVcsDriver;
        const cwd = yield* fs.makeTempDirectoryScoped();
        const run = (args: string[], allowNonZeroExit = false) =>
          git.execute({ cwd, args, operation: "test", allowNonZeroExit });
        yield* run(["init", "-b", "main"]);
        yield* run([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ]);
        const input = {
          cwd,
          projectId: "collision-test",
          branchName: "bad branch",
          baseRef: "main",
        };
        const invalid = yield* prepareLinearWorktree(input).pipe(Effect.flip);
        expect(invalid.message).toContain("suggested branch name");
        const collision = path.join(
          config.worktreesDir,
          `${path.basename(cwd)}-collision-test`,
          "eng-789-collision",
        );
        yield* fs.makeDirectory(collision, { recursive: true });
        yield* fs.writeFileString(path.join(collision, "unfinished.txt"), "keep me");
        const failure = yield* prepareLinearWorktree({
          ...input,
          branchName: "eng-789-collision",
        }).pipe(Effect.flip);
        expect(failure.message).toContain("directory already exists");
        expect(yield* fs.readFileString(path.join(collision, "unfinished.txt"))).toBe("keep me");
        expect(
          (yield* run(["show-ref", "--verify", "--quiet", "refs/heads/eng-789-collision"], true))
            .exitCode,
        ).toBe(1);
      }),
  );
});
