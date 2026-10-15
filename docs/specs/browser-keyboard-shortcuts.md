# Browser keyboard shortcuts

## Problem and outcome

Users of T3 Code's embedded desktop browser report that Copy, Paste, Select All, Find, Back, Forward, and Copy URL shortcuts do not work. Everyday browsing requires reliable keyboard behavior while the browser has focus.

Treat this as a behavior defect first. Diagnose each shortcut's existing support and failure path before adding functionality. Repair existing handlers and reuse existing actions; add support only where absent. Focus detection is a suspected cause of editing failures, not an established diagnosis.

## Scope

Restore editing shortcuts and provide page history navigation, Find, and Copy URL within the focused browser panel. Focus includes the embedded webpage, its editable fields, the address field, and browser toolbar controls. A visible browser without focus does not own these shortcuts.

The reported and agreed shortcuts use macOS Command keys. Preserve existing Windows/Linux editing behavior and shared web/mobile behavior. New platform-specific shortcut mappings, a shortcut customization system, and unrelated browser commands are outside this scope. Desktop behavior must remain consistent when connected to local or remote environments.

## Required behavior

| Shortcut                                    | Behavior while the browser owns focus                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, `Cmd+Z` | Perform normal Copy, Paste, Cut, Select All, and Undo in the focused page or field. Preserve existing Redo behavior.                                                      |
| `Cmd+[` / `Cmd+]`                           | Navigate backward/forward in the current browser tab's history. Do nothing when that direction has no history.                                                            |
| `Cmd+Shift+C`                               | Copy the current page URL to the clipboard. Show “URL copied” only after the write succeeds.                                                                              |
| `Cmd+F`                                     | Open or focus Find for the current page. Enter advances to the next match, Shift+Enter moves to the previous match, and Escape closes Find and returns focus to the page. |

- Browser commands target the current tab whether focus is on the page or its toolbar. Editing commands act on the focused field or page selection; they must not edit the chat composer, another tab, or another window.
- Moving focus to chat, a terminal, or another panel immediately restores that surface's existing shortcut behavior. Browser visibility or prior focus is insufficient to capture a shortcut.
- A single keypress performs one action. Browser history shortcuts must not navigate T3's own route history or fire an additional page action.
- Copy URL uses the current committed page URL, including redirects and in-page URL changes, rather than an unfinished address-field edit. A clipboard failure must not show a success notification; expose the failure using the existing notification convention. With no current page URL, do not copy stale text or report success.
- Find searches the current page and visibly identifies the active match and whether matches exist. Repeated `Cmd+F` focuses the existing Find control. Closing Find clears its search highlights. Search state and results must not be presented as belonging to a different tab or a newly navigated page.

## Acceptance criteria

1. In a page text field, select, copy, cut, paste, undo, and redo text with the existing editing shortcuts. Each action occurs once in that field. Copying a page selection and editing the browser address field also work without altering chat content.
2. Navigate a tab through pages A, B, and C. From both webpage and toolbar focus, `Cmd+[` returns to B and `Cmd+]` returns to C. Repeated navigation stops harmlessly at history boundaries; other tabs and T3's route remain unchanged.
3. After a redirect or in-page URL change, `Cmd+Shift+C` copies the current page URL and shows success. An unsubmitted address edit is not copied. A failed clipboard write reports failure without success.
4. Find a repeated phrase, move between matches in both directions, search for an absent phrase, and close Find with Escape. Reopening, switching tabs, or navigating does not expose stale results as current.
5. With the browser still visible, move focus to the composer, terminal, and another panel. Browser commands do not run there; return focus to the browser and they work again. Background agent input does not edit another focused surface.

## Constraints and decisions

- Inspect native menu handling, guest-page input, focus detection, and host shortcut routing together. The existing [editing shortcut filter](../../apps/desktop/src/preview/Manager.ts) already permits focused editing chords; its presence does not prove those shortcuts work in the running app.
- Reuse the existing [browser navigation methods](../../apps/desktop/src/ipc/methods/preview.ts) and [preview action routing](../../apps/web/src/components/preview/previewActionBus.ts) where applicable. Avoid parallel implementations of the same action or globally enabling unrelated application menu shortcuts.
- Preserve page text editing and the isolation of background automation from the user's focused renderer. Shortcut handling must not introduce focus polling, continuous repainting, or unnecessary network traffic.
- Validate observable behavior and focus transitions, not only shortcut classification. Any integrated browser verification follows the repository's explicit user-authorization requirement.

No blocking product questions remain. The exact cause of the existing failures must be established during implementation.
