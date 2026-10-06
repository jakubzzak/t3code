import type { EnvironmentId, OrchestrationMessage, ThreadId } from "@t3tools/contracts";
import { markdownCodeBlocks, type MarkdownCodeLanguageChange } from "@t3tools/shared/markdownCode";
import { useCallback } from "react";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export type EditableMarkdownMessage = Pick<
  OrchestrationMessage,
  "id" | "text" | "updatedAt" | "streaming"
>;

export function useMessageCodeLanguage(
  message: EditableMarkdownMessage,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  markdown: string,
) {
  const save = useAtomCommand(threadEnvironment.setCodeLanguage, { reportFailure: false });
  return useCallback(
    async (change: MarkdownCodeLanguageChange) => {
      if (message.streaming) throw new Error("Message is still streaming.");
      const displayed = markdownCodeBlocks(markdown);
      const original = markdownCodeBlocks(message.text);
      const index = displayed.findIndex((block) => block.start === change.blockStart);
      const source = original[index];
      const target = displayed[index];
      if (
        displayed.length !== original.length ||
        !source ||
        !target ||
        source.code !== target.code ||
        source.language !== target.language
      ) {
        throw new Error("This code block changed. Refresh it and try again.");
      }
      const result = await save({
        environmentId,
        input: {
          ...change,
          blockStart: source.start,
          threadId,
          messageId: message.id,
          expectedUpdatedAt: message.updatedAt,
        },
      });
      if (result._tag !== "Success") throw new Error("Could not save code language.");
    },
    [message, environmentId, threadId, markdown, save],
  );
}
