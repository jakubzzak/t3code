import { lazy, Suspense } from "react";
import {
  SelectableMarkdownText as T3SelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";

const MermaidDiagram = lazy(() => import("../features/markdown/MermaidDiagram"));
const renderDiagram: NonNullable<SelectableMarkdownTextProps["renderDiagram"]> = (props) => (
  <Suspense fallback={props.children}>
    <MermaidDiagram {...props} />
  </Suspense>
);

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@t3tools/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  return (
    <T3SelectableMarkdownText
      {...props}
      renderDiagram={renderDiagram}
      highlightCode={highlightCodeSnippet}
    />
  );
}
