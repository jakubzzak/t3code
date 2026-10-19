import * as Home from "../../../project/ProjectHomeService.ts";
import { ProjectLibraryListResult, ProjectLibraryPreview } from "@t3tools/contracts";
import { McpAttachmentInput } from "./input.ts";
import {
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  MessageId,
  RunId,
  ThreadId,
  OrchestrationV2RunStatus,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerConfig.ServerConfig,
    ServerSecretStore.ServerSecretStore,
    FileSystem.FileSystem,
    Crypto.Crypto,
    Home.ProjectHomeService,
  ],
};
const AttachmentUploadTool = Tool.make("t3_attachment_prepare_upload", {
  ...shared,
  description:
    "Create the app's signed upload URL. POST the exact bytes to relativeUrl on this MCP server's HTTP origin, then pass the attachment metadata and returned ID to t3_thread_send_attachments. Upload is separate from sending; provider attachment support is decided by its adapter.",
  parameters: Schema.Struct({ upload: AttachmentCreateUploadUrlInput }),
  success: AttachmentCreateUploadUrlResult,
}).annotate(Tool.Destructive, true);
const AttachmentDiscardTool = Tool.make("t3_attachment_discard", {
  ...shared,
  description:
    "Discard a pending upload. Already-delivered thread attachments are never deleted by this operation.",
  parameters: AttachmentDeleteInput,
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
const AttachmentSendTool = Tool.make("t3_thread_send_attachments", {
  ...shared,
  description:
    "Send uploaded attachments to this thread or any other thread in this environment. Each call is a new message, without a retry key. Acceptance does not mean the provider can consume the attachment or has finished the turn. The target cannot have broader permission modes than the caller; failures retain claimed files when dispatch outcome is uncertain.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(120000))),
    attachments: Schema.Array(McpAttachmentInput).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    messageId: MessageId,
    runId: RunId,
    status: OrchestrationV2RunStatus,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const LibraryListTool = Tool.make("t3_library_list", {
  ...shared,
  description:
    "Search the calling thread's project Local library across all saved uploads and links. Retrieve relevant content on demand with t3_library_read; library files are outside the checkout.",
  parameters: Schema.Struct({
    query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(300))),
    offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
  success: ProjectLibraryListResult,
}).annotate(Tool.Readonly, true);
const LibraryReadTool = Tool.make("t3_library_read", {
  ...shared,
  description:
    "Read a saved Local library item by its stable id, scoped to the calling thread's project. Returns extracted content, summary, original identity and whether the content was truncated; originalPath points to the retained bytes on this environment for tools that can read files.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({
    ...ProjectLibraryPreview.fields,
    originalPath: Schema.NullOr(Schema.String),
  }),
}).annotate(Tool.Readonly, true);
export const AttachmentToolkit = Toolkit.make(
  LibraryListTool,
  LibraryReadTool,
  AttachmentUploadTool,
  AttachmentDiscardTool,
  AttachmentSendTool,
);
