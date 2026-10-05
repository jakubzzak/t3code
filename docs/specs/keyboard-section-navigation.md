# Panel level shortcut navigation

## Problem and outcome

T3 Code users need to move between the left chat list, center conversation, and right views without reaching for the mouse. Right-panel navigation currently works for the empty launcher but does not provide a complete path through existing views. Users must be able to switch or create views, enter their controls, and recover panel focus predictably.

## Scope

Define panel navigation and focus transitions in the web and desktop three-panel layout, including locally hosted and remote connections. Preserve left and center navigation while completing the right-panel flow and the general double-Escape input escape. Mobile and narrow layouts are excluded. Reuse existing views, creation defaults, and availability and multiple-instance rules; do not redesign tabs or add new view kinds.

## Required behavior

### Moving between panels

- While content is unfocused, Command+Left/Right selects the neighboring panel in visual order: chat list, conversation, right views. Start from the panel that most recently held focus, or the center if none has. Stop at the outer edges without wrapping.
- Selecting a panel leaves its appearance unchanged and dims the other two. Moving selection transfers this treatment. Navigating into a collapsed sidebar reveals it.
- With the left panel selected, Up/Down moves a visible highlight through visible chats in display order, skipping collapsed groups. Initially highlight the active chat if visible, otherwise the first visible chat. Enter opens that chat, focuses its input, and clears panel selection and dimming.
- With the center panel selected, Enter focuses the chat input and clears panel selection and dimming.
- A single Escape clears left or center panel selection and dimming without focusing an input. The right panel uses the Escape rules below.

### Right-panel navigation

- Entering the right panel preserves and immediately displays its currently active view, falling back to the first view if none is active. No Enter confirmation is required. Focus belongs to the panel, not a tab or an input; retain existing tab appearance without adding a tab-focus highlight or navigation state.
- If no tabs exist, show the existing empty selection screen. Preserve its selection controls and the existing view shortcuts: B for Browser, T for Terminal, F for Files, D for Diff, P for Pull request, L for Linked pull requests, A for Agents, and M for Device. Preserve these letter shortcuts while the right panel owns navigation, including with existing views. Unavailable views cannot be opened.
- With the right panel focused and no input focused, Option+Left/Right immediately activates the previous/next view in displayed tab order, stopping at either end. Keep panel focus. Plain Left/Right does not switch views.
- In that same state, Command+T opens the existing `+` menu. Choosing an available kind creates or opens it using existing rules; dismissing the menu returns to the same active view and panel focus.
- Command+Shift+T creates a fresh view of the active kind without showing a chooser, only when that kind permits another instance. With no active view, an unavailable kind, or a kind that does not allow another instance, it does not create a view or open the chooser.
- Any view opened or created through panel navigation becomes active while the panel retains focus and no input is focused. This includes the empty launcher, letter shortcuts, the `+` menu, and same-kind creation. Creating a terminal does not immediately send typing to its shell.
- These panel commands are inactive outside right-panel navigation or while an input owns focus. Open menus retain their own keyboard navigation rather than switching background views.

### Entering and navigating a view

- Tab from the focused right panel with no input focused enters the active view at its first useful input or list item. It does not stop on the tab strip or require Enter.
- Browser: enter at the URL input. On the start screen, Tab/Shift+Tab and Down/Up traverse its URL and available recent URLs, local servers, and other launcher entries in forward/reverse order. Do not impose this launcher navigation on controls inside a loaded webpage.
- Files: Tab focuses the search input.
- Terminal: Tab focuses the shell. Once focused, the shell owns ordinary typing and its normal Tab behavior.
- Other views use their first useful input or list item and their existing internal navigation. Within inputs, preserve editing shortcuts, including Option+arrows; view-specific controls own their ordinary keys.

### Releasing focus with Escape

- Two quick Escape presses release focus from any input in the supported layout, including the composer, search fields, editors, terminal shell, and embedded browser inputs. Preserve drafts and input values.
- In the right panel, that pair returns to panel navigation with the same view active and no input focused. Panel shortcuts and Tab are immediately available. Outside the right panel, preserve the existing behavior: release input focus without selecting or dimming a panel.
- One additional Escape immediately after the pair releases right-panel focus and clears dimming. Thus three quick presses move from a right-panel input to no panel focus.
- When the right panel is already focused outside that continuing sequence, two quick Escapes release panel focus. A single Escape does not. After pausing following input release, a fresh pair is required.
- Use the existing 500 ms interval between successive Escape presses. A third press within 500 ms of the second continues the sequence; a longer gap or another key starts a new sequence. Held-key repeats do not count as additional presses.
- Input-associated popup dismissal must not make the input escape unavailable: for example, the first Escape may dismiss URL suggestions and the second releases input focus to the right panel. The second press must not also release panel focus. Independent dialogs and menus retain their own dismissal behavior; closing the `+` menu returns to panel navigation rather than counting as leaving the panel.

## Acceptance criteria

1. From a composer containing an unsent draft, double Escape preserves the draft and releases focus without dimming. Command+Left selects the chat list; Up/Down changes only its highlight; Enter opens that chat with its input focused. Command+arrows stop at the outer panels and reveal collapsed sidebars.
2. With several right-panel tabs and a non-first tab active, leave and re-enter the panel. The same view is immediately visible, with no input or tab focused and no new tab styling. Option+arrows switch immediately in tab order without wrapping; plain arrows do not switch views. Neither shortcut switches views while editing an input or typing in a shell.
3. With no tabs, the existing launcher remains usable. T opens an available terminal while retaining panel focus; Tab enters its shell. An unavailable view remains unavailable. Returning through double Escape permits Command+Left to select the center and Enter to focus the composer.
4. From panel focus, Command+T opens the `+` menu. Canceling preserves the active view and panel focus; choosing a kind opens it with panel focus. Command+Shift+T creates another supported instance without a chooser and does nothing for a single-instance kind. Tab then enters the new view's first useful control.
5. Tab from panel focus enters the browser URL, files search, or terminal shell as appropriate. Browser start-screen navigation reaches available recent URLs and local servers in both directions. Focused inputs preserve ordinary editing shortcuts; a focused shell retains its Tab behavior.
6. From a right-panel input, two Escapes within 500 ms preserve its contents and return to panel navigation. A third within 500 ms drops panel focus. If the third arrives after that interval, it is only the first press of a new pair. From ordinary panel focus, one Escape leaves focus in place and two release it. Verify the same recovery for editor, terminal, embedded browser, and URL-suggestion input states.

## Constraints and decisions

- Panel navigation and input focus are distinct states. Retaining the current view on panel entry avoids changing the user's working view merely by moving between panels.
- Reuse [RightPanelTabs](../../apps/web/src/components/RightPanelTabs.tsx) creation and availability rules and the existing [panel navigation](../../apps/web/src/sectionNavigation.ts) focus handling. Focus is local to the client and must not change another connected client's navigation state.
- Use Command on macOS and Ctrl on Windows/Linux for panel movement and creation shortcuts; Option maps to Alt. Do not replace native editing shortcuts while inputs own focus.
- Existing menu and browser-profile choices remain available. Same-kind creation uses the existing creation defaults; it does not duplicate the current URL, shell session, or other view contents.
- Embedded browser and terminal keyboard boundaries must preserve the same input-release and continuing third-Escape behavior. Validate interception limitations of browser-host shortcuts in web clients rather than assuming Electron behavior applies everywhere.
- Preserve existing panel dimming and tab appearance without continuously repainting animations or introducing server round trips for focus changes.

## Tracking

Proceed intentionally without a Linear issue, as approved by the maintainer.
