import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as GitHubAppAccess from "./GitHubAppAccess.ts";
import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubRest from "./GitHubRest.ts";

const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      query: Schema.String,
      variables: Schema.Struct({
        owner: Schema.optional(Schema.String),
        input: Schema.optional(Schema.Struct({ pullRequestId: Schema.String })),
      }),
    }),
  ),
);

const jsonHeaders = { "content-type": "application/json" };

it.effect("merges in personal and work checkouts using their own CLI credentials", () => {
  const merged: string[] = [];
  const cliDirectories: string[] = [];
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON request body");
        const document = decodeDocument(new TextDecoder().decode(request.body.body));
        const owner = document.variables.owner ?? document.variables.input?.pullRequestId;
        if (request.headers.authorization !== `Bearer ${owner}-token`) {
          return HttpClientResponse.fromWeb(
            request,
            new Response('{"errors":[{"message":"Resource not accessible by integration"}]}', {
              headers: jsonHeaders,
            }),
          );
        }
        if (document.query.includes("mergePullRequest(")) merged.push(owner!);
        const body = document.query.includes("mergePullRequest(")
          ? { data: { mergePullRequest: { clientMutationId: null } } }
          : {
              data: {
                repository: {
                  pullRequest: {
                    id: owner,
                    headRefOid: "head-sha",
                    isMergeQueueEnabled: false,
                    mergeStateStatus: "CLEAN",
                    baseRef: null,
                  },
                },
              },
            };
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { headers: jsonHeaders }),
        );
      }),
    ),
  );
  const host = TestSourceControlHost.layer({
    process: {
      run: (input) =>
        Effect.sync(() => {
          cliDirectories.push(input.cwd);
          return {
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdout: `${input.cwd.slice(1)}-token`,
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }),
    },
  });
  const layer = GitHubPullRequestApi.layer.pipe(
    Layer.provide(GitHubAppAccess.layer),
    Layer.provideMerge(GitHubRest.layerWithDependencies),
    Layer.provideMerge(SourceControlRateLimit.layer),
    Layer.provide(Layer.mergeAll(host, http, NodeCrypto.layer, NodeServices.layer)),
    Layer.provide(Layer.succeed(HostProcess.Environment, {})),
    Layer.provide(Layer.succeed(HostProcess.WorkingDirectory, "/server")),
  );
  return Effect.gen(function* () {
    const api = yield* GitHubPullRequestApi.GitHubPullRequestApi;
    yield* Effect.forEach(
      ["personal", "work"],
      (owner) =>
        api.runPullRequestAction({
          cwd: `/${owner}`,
          host: "github.com",
          repository: `${owner}/repo`,
          number: 74,
          action: "merge",
          mergeMethod: "squash",
        }),
      { concurrency: 2 },
    );
    expect(merged.toSorted()).toEqual(["personal", "work"]);
    expect(cliDirectories.toSorted()).toEqual(["/personal", "/work"]);
  }).pipe(Effect.provide(layer));
});
