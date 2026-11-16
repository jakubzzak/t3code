import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@t3tools/contracts";
import { FolderOpenIcon } from "lucide-react";
import { FileExplorerIcon, FinderIcon } from "~/components/Icons";

export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return "Reveal in Finder";
  if (normalized.includes("win")) return "Reveal in File Explorer";
  return "Reveal in Files";
}

/** File manager icon matching `revealInFileExplorerLabel`. */
export function revealInFileExplorerIcon(platform: string) {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return FinderIcon;
  if (normalized.includes("win")) return FileExplorerIcon;
  return FolderOpenIcon;
}

export function revealInFileExplorerLabelForOs(os: ExecutionEnvironmentPlatformOs): string {
  if (os === "darwin") return "Reveal in Finder";
  if (os === "windows") return "Reveal in File Explorer";
  return "Reveal in Files";
}

export function revealInFileExplorerLabelForKind(kind: FileManagerRevealKind): string {
  if (kind === "finder") return "Reveal in Finder";
  if (kind === "file-explorer") return "Reveal in File Explorer";
  return "Reveal in Files";
}
