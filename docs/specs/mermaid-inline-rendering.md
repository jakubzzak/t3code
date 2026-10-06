# Inline Mermaid diagrams and persistent block languages

## Problem and outcome

Users receive Mermaid diagrams as code in chat and must render them elsewhere to understand them. Show diagrams inline by default and let users inspect their source. Let users correct a block's language without asking the agent to resend it, with that correction preserved across devices.

## Scope

Cover code blocks in chat and rendered Markdown (`.md`) file previews on web (hosted and locally served), desktop, iOS, and Android. Include read-only Markdown previews for rendering and source inspection. Target all clients; mobile rendering feasibility must be verified before claiming parity or proposing a narrower release.

The picker selects how existing text is interpreted; it does not translate text into Mermaid or another language. Diagram authoring, export, and new diagram formats are outside this change.

## Required behavior

- Turn the language label in an editable block's header into a language picker. Include Mermaid and allow switching back to another supported code language. Changing the language preserves the block's body and does not affect neighboring blocks.
- A block labeled `mermaid` displays its diagram by default, including existing messages and files. Selecting Mermaid in the picker immediately selects diagram view. Selecting another language returns the block to code view.
- Provide a source/diagram toggle at the top right of Mermaid blocks. This is a temporary viewing choice, independent of the saved language: switching to source does not change another device's view, and reopening the content defaults to the diagram. Ordinary updates while viewing the content must not undo a deliberate switch to source.
- Chat language selections are saved by the owning environment and shared with every device connected to it. They survive reopening the thread, reconnecting, and restarting the server. A client-only language override does not satisfy this requirement.
- In an editable Markdown file preview, selecting a language updates that block's actual Markdown fence through the file save flow. Reopening the same environment's file on another device uses the saved language. Read-only previews render Mermaid and expose its source, but do not offer language editing.
- A failed language save must be visible and must not appear as a successfully persisted change. Preserve the last saved language and the source text so the user can retry. Changing back to a previous language uses the same durable save behavior.

## Acceptance criteria

1. Open a chat and an `.md` preview containing valid Mermaid fences on each supported client. Both show diagrams without a manual preview action. Source can be inspected and the diagram restored from the block's top-right control.
2. Change an unlabeled block containing valid Mermaid source to Mermaid on one device. The diagram appears, and a second device connected to that environment receives the selected language. Reopen after a server restart: the language remains Mermaid. Change it back to a code language and verify that change also persists.
3. Switch a Mermaid block to source on one device. Its saved language and another device's viewing mode remain unchanged. Further message updates do not force diagram view; reopening the content restores the default diagram view.
4. Change one fence's language in an editable Markdown preview. The saved file contains that language, with the block body and other fences preserved. Another device opening the file reflects it. A read-only Markdown preview permits source inspection without modifying the file.
5. Reject or interrupt a language save. The client reports the failure, retains the last saved state, and permits a retry without losing source text or changing a different block.

## Constraints and decisions

- Reuse the existing block headers and file save flows. Web file previews share [ChatMarkdown](../../apps/web/src/components/ChatMarkdown.tsx); mobile has a separate [code block renderer](../../apps/mobile/modules/t3-markdown-text/src/NativeMarkdownBlock.tsx) and [file preview](../../apps/mobile/src/features/files/FileMarkdownPreview.tsx). Cover each path explicitly.
- Persistence belongs in server services and typed contracts. A saved language must remain associated with the correct message and block as streaming or later updates arrive. The representation is an implementation choice, not a requirement to rewrite provider conversation history.
- Behavior is independent of provider and must work through local, remote/relay, and tunnel connections. Sharing a selection concerns devices using the same environment and content, not unrelated copies of a file or thread.
- Rendering must preserve responsive chat scrolling and mobile text selection. Avoid repeated diagram layout on every streamed token and continuously repainting animations. Mobile includes WebView and SVG dependencies, but this alone does not establish acceptable rendering performance.

## Assumptions to validate during implementation review

- While a Mermaid fence is incomplete during streaming, show source; attempt rendering once the fence closes. Invalid or unsupported diagrams retain readable source and a compact error, with a way to retry rendering after correction.
- Copy continues to copy the block's source in either view. Line wrapping is relevant only in source view.
- Mobile diagram sizing, scrolling, and the rendering approach need validation with representative diagrams. These are implementation-review items; no product decision currently blocks the spec.
