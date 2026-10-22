# Agentic search across chats and integrations

## Problem and outcome

Blackbird users need answers without remembering which conversation, project, or connected tool holds the information. Add two search actions that create a projectless chat, research the user's question, and return a very concise answer with citations and a short account of the sources searched. The resulting chat supports follow-up questions.

## Scope

- **Search in all chats** searches Blackbird conversations across projects, including projectless chats.
- **Search everywhere** searches those chats first, then connected integrations. An answer found in chats does not skip the integration phase.
- Launch only through the Command-K palette or the two dedicated keybindings. Do not add search buttons to chat views, sidebars, or existing find bars.
- Settings controls feature enablement and the default prompt for each action. There is no search-specific provider/model setting; use the existing projectless-chat selection behavior and ordinary chat controls.
- Preserve existing Command-F current-chat find and Command-Shift-F project-file search.

## Required behavior

### Entry and prompt handling

1. Register both named actions in the command palette. Bind **Shift-Option-F** to Search in all chats and **Control-Option-F** to Search everywhere on macOS; neither binding includes Command. Use the existing keybinding system and expose their assignments there.
2. Each activation opens a fresh chat with no user project selected and no existing conversation history. Do not reuse the current chat or inherit its project's scope.
3. A shortcut visibly prefills the corresponding configured default prompt in the new chat's editable composer, focuses it, and waits for the user to add their question and submit. Prefilling alone never starts an agent; an unchanged template or whitespace-only additional input must not start research.
4. In the palette, apply the configured prompt implicitly, keeping the user's query separate from the template. Merely typing, highlighting an action, or opening a chat does not submit the default prompt by itself.
5. When a nonempty palette query has no ordinary matches, always show **Search in all chats** and **Search everywhere**, while the feature is enabled. These fallback actions must not themselves be filtered out by that query. Selecting either and pressing Enter opens the projectless chat and immediately submits the typed query together with that action's implicit instructions, exactly once. Preserve the user's wording.
6. Selecting a normal named palette action without a research question opens a blank composer with its instructions implicitly prepared and waits for input. Text used to find the command itself is not automatically treated as the research question.
7. Abandoning an unsubmitted draft follows normal new-chat behavior and starts no work. Once submitted, use ordinary chat progress, Stop, error recovery, and follow-up behavior; retain the question if starting the turn fails.

### Research and answer

- All-chats research must be able to find and read relevant conversations outside the initiating project. It must not silently search only the new chat's backing project or only the currently visible sidebar list.
- Everywhere research starts with chats and then makes query-driven searches across connected integrations that expose search/read capabilities. It can follow relevant references and refine queries. Do not require a source picker or a second submission between phases. "Everything" defines the accessible search scope, not a promise to read every item or dump every history into the model.
- Use the current environment's authorized access and available connected sources. Searching does not authorize editing source records or sending messages. A projectless launch must not bypass project, environment, or connector access rules.
- The default prompts request a very concise answer, normally two to four short bullets or an equally short paragraph, with links/citations supporting the findings. Avoid a long research narrative.
- End with a compact **Sources:** line listing what was actually searched. Distinguish failures, unavailable sources, and incomplete coverage rather than counting them as successfully searched. For example: `Sources: Blackbird chats, Slack, Linear · Drive unavailable.` Do not invent sources or results.
- If no evidence is found, say so briefly and retain the Sources line. A failing integration must not discard findings from chats or other available integrations. Follow-up questions remain in the same projectless chat.

### Settings

- Add this feature under Settings → Features with an enable/disable control and independently editable default prompts for the two actions. The settings configure templates; saving or editing them never starts a search.
- Disabling removes both palette actions, including no-results fallbacks, and disables their shortcuts. Re-enabling restores them and the saved prompt customizations. Existing search chats remain ordinary accessible chats.
- Prompt edits affect subsequent launches; they must not overwrite an already edited draft or alter prior messages. Keep existing provider/model settings and selection behavior unchanged.

## Acceptance criteria

1. From a project chat, each shortcut creates a distinct projectless draft with the correct visible, editable template. No provider turn starts until the user supplies a question and submits; the template alone cannot start research.
2. A nonempty unmatched palette query shows both fallback actions. Choosing either launches exactly one projectless turn with that exact question and the selected implicit template, without requiring the user to enter it again.
3. Finding a search command by name opens a prepared chat without researching the command name. Empty palette input cannot auto-submit a template. Existing palette matches and ordinary Enter behavior remain intact.
4. A question whose evidence is in another project's conversation is answered with a working source link. Everywhere also searches integrations after chats, even when the chat phase found an answer.
5. With one integration unavailable, the answer preserves other findings and briefly identifies the missing coverage under Sources. An unsuccessful search states that no evidence was found rather than producing an unsupported answer.
6. Each customized prompt is used on its next launch through either entry path. Disabling and re-enabling behaves as specified, and ordinary find, project search, and existing chats continue to work.

## Constraints and assumptions

- The launch UI applies to web and desktop, which share the command palette. Use the same environment-backed path for local, remote, and tunnel connections. Native mobile continues to display and continue these ordinary chats; a new native mobile launch surface is outside the requested palette-and-shortcuts scope.
- Assumption: "all chats" includes retrievable retained conversations across the user's connected environments, including settled conversations; disconnected environments must be disclosed as unavailable. It does not mean restoring deleted history.
- The current [thread-search tool](../../apps/server/src/mcp/toolkits/thread/tools.ts) is bounded, searches active threads, and defaults to the caller's project. Prompt wording alone cannot guarantee the required coverage. Ensure the underlying search/read capability supports the scope and reports limits without claiming an exhaustive search.
- Available integration tools can vary by provider and environment. Preserve ordinary provider selection; missing capabilities must produce an honest limitation rather than an unannounced provider switch. Any added server capability belongs in a service with typed contracts and thin transport/MCP entry points.
- Search on submission, not on each palette keystroke. Keep retrieval bounded and progressive instead of loading every conversation into the client or model.
- Nonblocking defaults to resolve during implementation review: initial enablement and exact shipped prompt wording, using existing feature-setting conventions and the required behavior above.
