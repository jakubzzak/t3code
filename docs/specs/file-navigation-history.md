# File navigation history

## Problem and outcome

Selecting a file from Files or file search opens its preview immediately, but returning to the explorer takes extra clicks. Users need familiar Back and Forward shortcuts that remember their path through the explorer and files, including while editing a file.

## Scope

Add file navigation history to the shared web and desktop file viewer in draft and saved threads. Reuse the existing configurable navigation commands: `Cmd+[` and `Cmd+]` on macOS, and their existing Ctrl equivalents on Windows/Linux. Native mobile navigation, browser-page history, and changes to file editing or saving are outside this feature's scope.

## Required behavior

- From Files, open file A. Back returns to Files, Forward returns to A, and Back returns to Files again. File selection continues to open the file directly.
- Record visits between files, including files opened through the file picker, workspace search, links, breadcrumbs, and existing file tabs. For Files → A → B, Back shows A, Back shows Files, and Forward shows A then B.
- The shortcuts work with focus inside the file editor, including its text selection. They navigate once and do not indent, change, or save file content as a side effect.
- Returning to Files retains its search query, expanded folders, selection and scroll position. The selected file can be opened again by clicking it.
- Files and the side explorer share the last entered query within each environment/chat for the running client session. Changing files (including explicit opens), refreshing results, closing/reopening the panel, or switching away from and back to the chat must not clear it. Only editing or clearing the search field changes the query; other chats keep independent queries.
- Opening another file after going back starts a new history branch. Repeated activation of the same file does not add a duplicate visit.
- Keep histories separate for each environment and thread. Navigating within file history leaves the current thread and its app route unchanged.
- At either end of file history, the shortcut does nothing. It must not unexpectedly leave the thread. A restored file tab can return to Files before another file has been opened.
- Preserve existing shortcut ownership outside the active file viewer, including browser-page navigation, terminal input, keybinding capture and app-route navigation.

## Acceptance criteria

1. Execute Files → A → Back → Files → Forward → A → Back → Files, both with the side explorer hidden and visible. The explorer's query, folder expansion, selection and scroll position are retained.
2. Open A from Files, then B from file search or an existing tab. Move backward and forward through both files. With the cursor and a selection inside the source editor, navigation changes the viewed location without changing either file.
3. Go back from B to A and open C. Forward stays at C; Back returns to A. Reopening A repeatedly adds no redundant history stops.
4. Reach both history boundaries without leaving the thread. Reload with a file tab selected and confirm Back reaches Files. Another thread or environment keeps its own history and active file.
5. Return to Files and click its already-selected file. The file opens again. Close an unrelated file and verify navigation does not reopen it unexpectedly.
6. Check browser, terminal, composer and keybinding-capture focus: each retains its existing shortcut behavior. A custom Back/Forward binding also navigates file history while the editor has focus.
7. Enter a query in the side explorer, explicitly open another file, close/reopen the panel, switch to another chat and return. The original query remains. A second chat starts empty and retains its own query; manually clearing either query remains effective after reopening.

## Constraints and decisions

- History is client-side session state and is bounded. Persisting every visit across restarts is not required; existing open tabs still restore normally.
- Use existing right-panel surfaces and navigation commands. No server contract, database migration, new dependency, continuous animation, polling or extra network request is needed for a history step.
- File read failures remain visible through the existing viewer error behavior; Back and Forward remain available for recovery.
- Working assumptions: explicitly closed file tabs are skipped by history, and thread attachments keep their existing navigation behavior. These do not change workspace-file navigation.

No blocking product questions remain. Jakub explicitly chose to proceed without a Linear issue on 2026-10-31; this spec and its PR track the work.
