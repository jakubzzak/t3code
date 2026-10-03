# Keyboard section navigation

## Problem and outcome

T3 Code users need to move between the left chat list, center conversation, and right surfaces without reaching for the mouse. Keyboard navigation must make the active section apparent and provide a direct path back to typing.

## Scope

Add section navigation and focus transitions to the three-section layout. Reuse existing chats, surfaces, and surface availability rules. This specification does not redesign those features.

## Required behavior

- Pressing Escape twice in succession while the chat input or a surface has focus releases that focus. This alone does not select a section or dim the layout.
- While content is unfocused, Command+Left and Command+Right select the neighboring section in visual order: chat list, conversation, surfaces. The initial move starts from the section that most recently held focus.
- Selecting a section leaves its appearance unchanged and dims the other two. Moving selection transfers this treatment to the new section.
- Navigating into a collapsed sidebar reveals and selects it.
- With the left section selected, Up and Down move a visible highlight between chats without opening them. Enter opens the highlighted chat, focuses its input, and clears section selection and dimming.
- With the center section selected, Enter focuses the chat input and clears section selection and dimming.
- With the right section selected, the existing Open a surface shortcuts are available: B for Browser, T for Terminal, F for Files, D for Diff, P for Pull request, L for Linked pull requests, A for Agents, and M for Device. Unavailable surfaces cannot be activated. Opening a surface focuses it and clears section selection and dimming; opening Terminal permits immediate typing.
- With any section selected, a single Escape clears section selection and dimming. It leaves content unfocused rather than returning to the chat input.
- Double Escape also releases focus after entering a surface, allowing Command+Left/Right to resume section navigation.

## Acceptance criteria

1. From a focused chat input with an unsent draft, double Escape preserves the draft and releases focus without dimming. Command+Left selects the chat list and dims the center and right sections. Up/Down changes the highlight without changing the open chat; Enter opens the highlighted chat with its input focused and all dimming cleared.
2. From an unfocused center section, Command+Right reveals a collapsed right sidebar and selects it. T opens an available terminal, clears dimming, and routes subsequent typing to that terminal. Double Escape followed by Command+Left selects the center; Enter returns to the chat input.
3. From any selected section, Escape restores normal appearance without focusing an input. Command+Left/Right can start section navigation again.
4. Navigating into either collapsed sidebar reveals it. A disabled surface shortcut does not open an unavailable surface or transfer focus to it.

## Constraints and decisions

- Section selection and content focus are distinct states. Navigation shortcuts must not replace normal Command+Arrow text navigation while an input or surface owns focus.
- Reuse the shortcuts and availability checks in [RightPanelTabs](../../apps/web/src/components/RightPanelTabs.tsx). Preserve ordinary letter input inside active content.
- Popup dismissal and nested surface Escape handling must be checked when implementing the double-Escape gesture; one key event must not accidentally cause both dismissal and an unrelated navigation transition.

## Open questions

These do not block publishing the spec, but must be settled before finalizing the affected behavior:

- Proposed default, not yet accepted: stop section navigation at the outer edges rather than wrap around.
- Proposed default, not yet accepted: enable surface letter shortcuts only while the right section is selected. The existing empty launcher enables them outside typing contexts whenever it is visible. Decide whether default-mode behavior should change too.
- Define the double-Escape timing window and precedence when a popup or embedded surface consumes Escape.
- Define the initial chat highlight and traversal of collapsed chat groups, plus the starting section when none has previously held focus.
- Platform scope is currently expressed with macOS Command keys. Confirm equivalent shortcuts for other desktop platforms and applicability beyond the three-section layout.
