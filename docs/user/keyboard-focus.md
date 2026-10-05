# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal with the pointer still focuses it.

## Move between panels

In a wide web or desktop window, press Escape twice within half a second to leave the
composer or a surface without losing your draft. Then use Command+Left/Right on macOS,
or Ctrl+Left/Right on Windows and Linux, to select the chat list, conversation, or surfaces.
Collapsed sidebars open when selected; navigation stops at either end.

In the chat list, Up/Down highlights visible chats and drafts without opening them. Enter
opens the highlighted chat and focuses its composer. In the conversation, Enter returns
to the composer. With the right panel selected, use B for Browser, T for Terminal, F for Files,
D for Diff, P for Pull request, L for Linear, A for Agents, or M for Device.
Only available surfaces open. These letters remain ordinary typing inside focused content.

The right panel keeps its active view when you return. With no input focused, Option+Left/Right
(Alt on Windows/Linux) switches views without wrapping. Command+T (Ctrl on Windows/Linux)
opens the view menu; adding Shift creates another browser or terminal of the current kind.
Browsers that reserve these shortcuts keep their normal behavior; use the `+` menu or letters
instead. Opening a view this way keeps panel focus. Tab enters its first useful control:
the browser URL, files search, or terminal shell. Inside an input, normal editing shortcuts apply.

Double Escape from a right-panel input returns to panel navigation without changing views.
A third Escape within half a second releases panel focus. After a pause, or when already
navigating the panel, use a fresh pair to release it. In the left and center panels, one Escape
clears panel selection. Closing the view menu returns to panel navigation; dismissing input
suggestions can be the first Escape of a pair. Panel navigation is unavailable in narrow
layouts and the mobile app.
