# Paste browser screenshots into chat

## Problem and outcome

Desktop users who capture an embedded-browser screenshot currently receive copy-path, reveal-file, and copy-image actions. Attaching that screenshot to the chat takes another manual step. Provide a direct action that places the captured image in the draft and lets the user describe it before sending.

## Scope

Extend the existing desktop screenshot confirmation with **Paste in chat**. Support its associated chat whether that chat uses a local or remote environment. Preserve the existing screenshot save, copy, and reveal actions.

Do not add capture controls to web, mobile, or streamed browser tabs that currently omit them. Recording attachments, browser zoom, automatic sending, and choosing a different destination chat are outside scope.

## Required behavior

- After a successful capture, **Paste in chat** attaches that saved screenshot as an ordinary image thumbnail in the associated chat's draft and focuses that composer. Preserve existing draft text and attachments. Do not submit, queue, or start an agent turn.
- Bind the action to the capture's thread and environment. A delayed action or a thread switch must not attach the image to another chat. If the original target is unavailable, report the failure without redirecting the attachment.
- Attach the captured image itself, not its file path or a newly captured frame. Use the normal image attachment lifecycle for preview, draft persistence, upload, manual sending, and removal. Removing the draft attachment must not delete the saved screenshot.
- Repeated activation for the same screenshot must not add duplicate attachments. Respect existing attachment limits and permissions; report a rejected attachment rather than claiming it was added.
- Local image bytes must reach the destination environment through the existing attachment flow. A remote agent must not depend on access to the desktop's filesystem. Preserve ordinary upload error and retry behavior, and do not report successful insertion when reading or adding the image fails.

## Acceptance criteria

1. Capture a screenshot with text and another attachment already in the draft. Choose **Paste in chat**. One screenshot thumbnail appears, previous content remains, and keyboard input goes to the composer. No message or agent turn starts until the user sends.
2. Change the page after capture, then attach the screenshot. The attachment shows the original capture. Activating the action again does not duplicate it. Removing its thumbnail leaves the saved image and other draft content intact.
3. Capture in a desktop browser associated with a remote-environment chat. Attach and manually send it through the normal upload flow; the destination receives usable image bytes without reading a desktop-local path.
4. Switch chats before using the saved-screenshot action. It remains bound to the original thread and environment and never modifies the newly selected chat's draft. An unavailable original target produces an error.
5. A full attachment list or an unreadable screenshot leaves the existing draft intact and reports the failure. Upload failure follows the existing retry flow. Copy path, reveal file, and copy image still work; excluded client surfaces gain no capture controls.

## Constraints and decisions

- The existing [capture confirmation and annotation attachment flow](../../apps/web/src/components/preview/PreviewView.tsx) provide the entry point and a precedent for adding browser images to a draft.
- Desktop capture currently returns artifact metadata and a local path. Supplying the image bytes requires a supported desktop-to-client transfer; clipboard round-tripping is unnecessary and must not be required for this action.
- Reuse the scoped [composer draft store](../../apps/web/src/composerDraftStore.ts) and [attachment upload flow](../../apps/web/src/lib/attachmentUploadQueue.ts). Keep normal attachment limits, persistence behavior, and destination-environment checks rather than introducing a separate screenshot attachment system.
- Attach without sending and then focus the composer were explicitly chosen. Extending screenshot capture to web and streamed tabs is deferred. No blocking product questions remain.
