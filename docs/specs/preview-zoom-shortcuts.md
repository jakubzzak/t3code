# Preview zoom shortcuts

## Problem and outcome

Users cannot reliably zoom an embedded webpage with familiar keyboard shortcuts after focusing it. Preview zoom actions and keybindings already exist, but the desktop guest input path does not route zoom keys to those actions. Users should be able to resize page content without resizing the surrounding Blackbird interface.

## Scope

Restore page zoom shortcuts throughout the focused preview panel in desktop and web clients. Focus includes the webpage, page text fields, address bar, and preview toolbar controls. Cover native desktop pages and streamed server-hosted pages, including desktop clients connected to remote environments.

Reuse existing zoom controls, levels, limits, and state ownership. Changes to zoom persistence, application-menu click behavior, unrelated shortcuts, mobile gestures, and the wider shortcut system are outside this scope.

## Required behavior

- On macOS, `Cmd+=` and `Cmd++` zoom the current preview page in; `Cmd+-` zooms it out; `Cmd+0` resets it to 100%. On Windows and Linux, use the equivalent Ctrl chords. Recognize both the unshifted equals chord and the shifted plus chord.
- These shortcuts belong to the preview only while keyboard focus is somewhere in its panel. A visible or previously focused preview does not capture them. Moving focus back to chat or another surface restores that surface's existing shortcut behavior, including app zoom where supported.
- Page zoom leaves the surrounding app interface at its existing scale. A single shortcut activation changes zoom once and does not also invoke app zoom or deliver a second zoom action to the page.
- Keyboard actions use the same zoom steps and bounds as the preview controls. At a limit, further input is harmless. Reset always means 100%, even when the configured default preview zoom differs. Existing zoom readouts reflect the resulting state.
- Native and streamed previews provide the same user-facing behavior. A server-owned tab continues to use its existing server-authoritative zoom state, including when rendered natively by the desktop app, so connected clients remain consistent. Preserve existing permissions, control restrictions, and error reporting; a failed adjustment must not be presented as a successful zoom.
- Other tabs, retained hidden guests, and inactive windows must not take keyboard ownership or receive an unrelated zoom change. Preserve text editing, navigation, find, and other shortcut behavior; do not broadly enable application-menu shortcuts for embedded pages.

## Acceptance criteria

1. With a native desktop page focused, use equals, shifted plus, and minus zoom chords. Repeat from a page text field, address bar, and toolbar control. Each activation changes only the current preview page by the existing step; the app scale stays unchanged and the zoom readout agrees with the page.
2. Zoom away from 100%, then reset with `Cmd+0` or `Ctrl+0`. The page returns to 100%, including when its configured default is different. Zooming at either bound causes no overflow or duplicate action.
3. Keep the preview visible and move focus to chat or another panel. Existing shortcuts there behave as before. Refocus the preview and page zoom resumes. Switch between retained browser tabs and verify that the receiving focused tab owns the shortcut.
4. Repeat the relevant shortcuts on macOS and Windows/Linux. Plain `+`, `=`, `-`, and `0` still type normally in page and address fields; unrelated modified shortcuts retain their behavior.
5. Repeat the zoom and reset flow with a streamed server tab in web and desktop clients, and with a server-owned tab rendered natively. The existing server zoom state and connected views remain consistent. An unavailable or rejected adjustment uses existing failure behavior without changing app zoom or claiming success.

## Constraints and decisions

- Reuse the existing [preview zoom actions](../../apps/web/src/components/preview/PreviewView.tsx) and [keybinding conventions](../../packages/shared/src/keybindings.ts). This is a focused routing repair, not a new zoom subsystem.
- The [desktop guest input handler](../../apps/desktop/src/preview/Manager.ts) suppresses most application-menu shortcuts, while [application menu zoom](../../apps/desktop/src/window/DesktopApplicationMenu.ts) deliberately targets the main window. Simply enabling that menu path would resize the app rather than satisfy page zoom.
- Native guests have a separate input path from the [streamed browser surface](../../apps/web/src/browser/ServerBrowserSurface.tsx). Verify both paths and actual focus transitions; the presence of declared keybindings alone does not prove working behavior. Preserve the existing focused-frame check for retained desktop guests and isolation from background automation.

No blocking product questions remain.
