# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat,
or to the previous control on other pages. Choosing a workspace focus command moves to that
area instead. Opening Pull Requests moves focus into that page.
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

## Move between workspace areas

On web and desktop, press `F6` or `Shift+F6` to move between the Threads sidebar,
conversation, message input, and visible panels. Navigation wraps around and restores
the last focused control in each area. Pull Requests has a page content area. In Settings,
`F6` moves between the section list and the open section. Hidden areas are skipped. Other
dialogs and form popups retain focus; a thread context menu closes when an area command
moves focus away.

In a browser, plain `F6` may move to the browser's own toolbar. Use `mod+F6` and
`mod+Shift+F6` instead (`mod` is Command on macOS and Ctrl elsewhere). **Focus Next
Workspace Area** and **Focus Previous Workspace Area** are also in the command palette and
can be remapped in Settings > Keybindings.

## Browse threads

Tab moves through each thread and its buttons. Up and Down also move between threads
without opening them; Enter opens the focused thread or toggles a group. Right and Left
expand and collapse groups. `F2` renames the focused thread.

Press `Shift+F10` or the Context Menu key to open the focused thread's menu. Use the arrow
keys to move through it, Enter to choose, and Escape to close it.

The Settings section list works the same way: Up and Down move between sections, and Enter
opens one.

## Browser shortcuts

In the desktop browser on macOS, Command+[ and Command+] move backward and forward
through the current tab's history. Command+Shift+C copies the current page URL and
confirms when it has been copied. These shortcuts apply only while the browser page
or toolbar has focus.

Command+F opens Find in the current page. Enter moves to the next match,
Shift+Enter to the previous match, and Escape closes Find. Find and Copy URL are
also available from the browser menu.
