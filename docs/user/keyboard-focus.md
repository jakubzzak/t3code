# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between sections

In a wide web or desktop window, press Escape twice within half a second to leave the
composer or a surface without losing your draft. Then use Command+Left/Right on macOS,
or Ctrl+Left/Right on Windows and Linux, to select the chat list, conversation, or surfaces.
Collapsed sidebars open when selected; navigation stops at either end.

In the chat list, Up/Down highlights visible chats and drafts without opening them. Enter
opens the highlighted chat and focuses its composer. In the conversation, Enter returns
to the composer. With surfaces selected, use B for Browser, T for Terminal, F for Files,
D for Diff, P for Pull request, L for Linked pull requests, A for Agents, or M for Device.
Only available surfaces open. These letters remain ordinary typing inside focused content.

Press Escape once to clear section selection without focusing an input. Escape used to
close a popup does not count toward double Escape. Section navigation is unavailable in
narrow layouts and the mobile app.
