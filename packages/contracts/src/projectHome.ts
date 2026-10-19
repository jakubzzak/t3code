import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProjectLibraryEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  kind: Schema.Literals(["file", "link"]),
  originalName: Schema.String,
  attachmentId: Schema.NullOr(Schema.String),
  mimeType: Schema.String,
  sizeBytes: NonNegativeInt,
  url: Schema.NullOr(Schema.String),
  title: Schema.String,
  summary: Schema.String,
  labels: Schema.Array(Schema.String),
  status: Schema.Literals(["processing", "ready", "failed", "unsupported"]),
  createdAt: Schema.String,
});
export type ProjectLibraryEntry = typeof ProjectLibraryEntry.Type;

export const ProjectHomePreferences = Schema.Struct({
  accent: Schema.NullOr(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  density: Schema.Literals(["comfortable", "compact"]),
  showChats: Schema.Boolean,
  showLibrary: Schema.Boolean,
  libraryFirst: Schema.Boolean,
  briefingInstructions: Schema.String.check(Schema.isMaxLength(2000)),
});
export type ProjectHomePreferences = typeof ProjectHomePreferences.Type;
export const DEFAULT_PROJECT_HOME_PREFERENCES: ProjectHomePreferences = {
  accent: null,
  density: "comfortable",
  showChats: true,
  showLibrary: true,
  libraryFirst: false,
  briefingInstructions: "",
};

export const ProjectBriefingSource = Schema.Struct({
  kind: Schema.Literals(["thread", "file", "asset", "change"]),
  id: Schema.String,
  label: Schema.String,
  excerpt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(5000))),
});
export const GeneratedProjectContext = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(160)),
  summary: Schema.String.check(Schema.isMaxLength(1600)),
  nextStep: Schema.String.check(Schema.isMaxLength(400)),
  labels: Schema.Array(Schema.String.check(Schema.isMaxLength(40))).check(Schema.isMaxLength(6)),
  sourceIds: Schema.Array(Schema.String).check(Schema.isMaxLength(12)),
});
export type GeneratedProjectContext = typeof GeneratedProjectContext.Type;

export const ProjectBriefing = Schema.Struct({
  title: Schema.String,
  summary: Schema.String,
  nextStep: Schema.String,
  sources: Schema.Array(ProjectBriefingSource),
  generatedAt: Schema.NullOr(Schema.String),
  attemptedAt: Schema.NullOr(Schema.String),
  status: Schema.Literals(["empty", "generating", "ready", "failed"]),
});
export type ProjectBriefing = typeof ProjectBriefing.Type;
export const EMPTY_PROJECT_BRIEFING: ProjectBriefing = {
  title: "",
  summary: "",
  nextStep: "",
  sources: [],
  generatedAt: null,
  attemptedAt: null,
  status: "empty",
};

export const ProjectHomeInput = Schema.Struct({ projectId: ProjectId });
export const ProjectHomeSnapshot = Schema.Struct({
  preferences: ProjectHomePreferences,
  briefing: ProjectBriefing,
  files: Schema.Array(ProjectLibraryEntry),
  fileCount: NonNegativeInt,
  recentThreadIds: Schema.Array(ThreadId),
});
export type ProjectHomeSnapshot = typeof ProjectHomeSnapshot.Type;
export const ProjectHomeUpdateInput = Schema.Struct({
  projectId: ProjectId,
  preferences: ProjectHomePreferences,
});
export const ProjectHomeVisitInput = Schema.Struct({ projectId: ProjectId, threadId: ThreadId });
export const ProjectLibraryListInput = Schema.Struct({
  projectId: ProjectId,
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(300))),
  offset: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(
    NonNegativeInt.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  ),
});
export type ProjectLibraryListInput = typeof ProjectLibraryListInput.Type;
export const ProjectLibraryListResult = Schema.Struct({
  entries: Schema.Array(ProjectLibraryEntry),
  total: NonNegativeInt,
});
export const ProjectLibraryItemInput = Schema.Struct({
  projectId: ProjectId,
  id: TrimmedNonEmptyString,
});
export const ProjectLibraryPreview = Schema.Struct({
  entry: ProjectLibraryEntry,
  content: Schema.String,
  truncated: Schema.Boolean,
});
export type ProjectLibraryPreview = typeof ProjectLibraryPreview.Type;
export const ProjectLibraryLinkInput = Schema.Struct({
  projectId: ProjectId,
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});
export const ProjectLibraryAttachment = Schema.Struct({
  attachmentId: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: NonNegativeInt,
});
export type ProjectLibraryAttachment = typeof ProjectLibraryAttachment.Type;

export class ProjectHomeError extends Schema.TaggedError<ProjectHomeError>()("ProjectHomeError", {
  projectId: ProjectId,
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Could not ${this.operation} for this project.`;
  }
}
