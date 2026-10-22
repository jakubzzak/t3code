# Settings and project overrides

On web and desktop, the "Applying settings for …" sentence at the top of Settings pages picks
the project and environment a change applies to. Pages that only hold device preferences, such as
Appearance, don't show it. They start at **All projects** and **All environments**
and stay selected as you move between categories or search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

With a project selected, a provider's switch in **Settings → Providers** turns it on or off for
that project only, in either direction: a provider off on the machine can be used in one project,
and one on everywhere can be kept out of another. That project's model pickers follow the switch,
and no new turn there can start on a provider it turned off, including queued messages and
follow-ups from delegated tasks. A turn already running when the switch flips finishes. A delegated
task's result still lands in its parent thread, which sees it on its next turn. Reset returns the project to the
machine's setting. Every other provider setting stays per machine.

On mobile, open **Settings** and use the filter in its header to choose connected environments
and a project. The filter stays available in server-setting pages. With **All projects** selected,
the **Server settings** categories and auto-settle controls in **Thread behavior** edit the
selected environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Projects & threads → Overview** to rename the project across its selected
connected checkouts and see where those checkouts live.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

## Worktree branch names

In **Settings → Source Control → Worktree branch naming**, choose a static prefix,
a model-selected semantic prefix such as `feat/` or `fix/`, or custom instructions
for the complete name. The static prefix defaults to `t3/`; a trailing slash is
optional, and an empty prefix adds nothing. Invalid characters in a static prefix
are replaced with hyphens. Custom instructions are appended to
the naming prompt and can specify issue IDs, namespaces, and casing.

These settings apply to automatically named new worktree branches. Select a project
to override its environment defaults. Worktree directories keep their original names.
If generation fails, or a custom name is invalid or already taken, the temporary
branch name remains.

## Scheduled tasks

Open **Settings → Scheduled tasks** to create recurring tasks or manage existing
ones across your connected environments. Use the settings filter to narrow the
list by environment or project. Each task runs on the environment you choose,
using its project, model, and workspace settings. Fixed-time schedules use that
environment's time zone, which may differ from your phone's.

You can edit, pause, resume, run immediately, or delete a task from the list.
Webhook tasks only run when their URL is called, so they can't be run
immediately.
On mobile, leaving an edited form asks before discarding unsaved changes.

Choose **Use an existing chat** under Workspace to continue the same conversation
and checkout on every run. The chat picker includes resolved chats in the selected
project; archived chats cannot be selected. Resolving a chat keeps its automation
running. Archiving asks for confirmation and pauses attached automations. Unarchiving
does not resume them: return here to resume, choose another chat, or switch to a
checkout option to create a new chat on each run.

## Webhook automations

In **Settings → Scheduled tasks**, choose **On webhook**
as a task's schedule to run it whenever another service calls its URL, such as
GitHub on a new pull request or a CI job that failed. A public URL needs a
[T3 Connect](remote-access.md) managed tunnel; after you save the task, copy
its URL from the editor. Without one, the editor shows only the URL's path.
**Rotate** replaces the URL and the old one stops working.

The prompt decides what the agent sees. Placeholders pull values out of the
request: `{{body.path}}` for a JSON or form field, `{{headers.name}}`,
`{{query.name}}`, `{{body}}` for the raw body, and `{{request}}` for everything.
For example, `Review this PR: {{body.pull_request.html_url}}` sends only the
pull request link. A placeholder with no value is left empty.

For GitHub, turn on **Require signature**, keep the header
`x-hub-signature-256`, hex encoding and the `sha256=` prefix, and enter the
same secret in the repository's webhook settings with content type
`application/json`. Requests without a valid signature are rejected. Set this
up on desktop or web; mobile keeps an existing signature check but can't turn
one on.

On desktop and web, pick **Deliveries** from a task's menu to see recent
requests and the prompt each one produced.

If the environment is offline, the sender gets an error and nothing runs;
redeliver from the sender, such as GitHub's **Recent Deliveries**, once it is
back. To have T3 Connect keep requests instead, turn on **Hold webhooks while
offline** in **Settings → Connections**. T3 Connect then stores requests to a
T3 Connect URL for up to 24 hours and delivers them when the environment
returns. Leave it off if you don't want request bodies stored outside your
machine. To skip requests that waited too long, set **Skip requests older
than** on the task.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Project category, shown while a project is selected, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

Settings a repository can also declare in `t3.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `t3.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → General** (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `t3.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

## Notification inbox

Select a project in **Settings → Features** and enable **Inbox**, then choose its sources in
**Settings → Integrations**. Connections and relevance filters are configured explicitly for
each project. Inbox and Linear view are independent. The inbox is available on web and desktop;
mobile keeps the same project data but does not yet have a native inbox screen.

For Linear, enter your OAuth application's public client ID, or leave it blank to use the
environment's configured application, then connect your account. For Slack, enter the app's
public client ID, enable PKCE in Slack's OAuth settings, register the environment's callback URL,
then choose **Connect Slack**. Both use browser authorization without a client secret. Existing
Slack user tokens can still be entered manually. Slack supports DMs and personal/group mentions;
choose how much recent history to import. Saved and To-dos remain unavailable. Linear
uses the same environment connection as the issue picker. On desktop, **Move existing connection
to environment** preserves your account and workspace without enabling Inbox or Linear view.
Superhuman uses its official Mail MCP and registers its OAuth client automatically; no client ID
or secret is required. Sign in, select accounts, then select Important or other
splits and labels. Sign-in requires access to Superhuman Mail MCP and its Chrome extension.

Use the sidebar's **Inbox** tab to triage without leaving your current chat. Arrow keys focus and
expand an item. **Agent** starts the project's configured agent; **Agent chat** opens a linked chat
and waits for your message. Either action opens an existing linked chat. Its notification context
is also available in the chat's Details.

Read state, snoozing and settlement belong to Blackbird; they do not change the source. Undo restores
notification state. Undoing a running delegation requests a stop and keeps the chat and completed
work. A stop can remain pending or fail, so check its status before assuming the agent has stopped.

Enable Inbox in project Features settings to expand its processing controls within the feature.
**Summary** and **Agent Delegation** are separate subgroups, both off by default. Enable one to
choose its model and edit its prefilled default prompt. There are no separate prompt switches.
Turning a subgroup off hides its controls and keeps your model and prompt choices. Summary off
stops AI processing; Agent Delegation off prevents direct runs while Agent chat remains available.
Raw notification content stays usable without AI. An empty prompt uses the default instructions.

**Inbox memory** is also off by default. Enable it to use confirmed outcomes from similar cases
in the same project. With memory enabled, record an outcome in the linked chat's Details to make
it available to future processing. Turning memory off retains outcomes but stops history lookup.
Suggested resolutions remain proposals; they are not sent or executed automatically.

On macOS, some web browsers reserve ⌘⇧H before the page can receive it. Use Ctrl⇧H or the
Snooze action there; the desktop shortcut remains ⌘⇧H.

## Linear view

In the desktop app, select a project in **Settings → Features** and enable **Linear view**.
In **Settings → Integrations → Linear**, enter its workspace slug from `linear.app/<workspace>`.
If Linear view was enabled on this device before project settings were introduced, choose the
projects that should keep it enabled; other projects remain off.
Open **Linear** from the thread's surface picker, or press **L** while that picker is active.
The first open uses the issue identifier in the branch, or My Issues when there is none. An open
view keeps its current page unless you explicitly select an issue for the chat. Close and reopen
it to use another changed branch or workspace.

Linear uses its own interface and login. T3 uses the email from your connected Linear account
to assist panel sign-in. Without a Linear connection, it falls back to your T3 account email
when available; there is no separate email setting.
Finish passwords and two-factor authentication yourself. If assistance fails, sign in manually.
Turning the feature off closes its views while retaining workspace settings and browser logins.
The view is unavailable on web and mobile, including when they connect to a desktop server.

To link a chat to an issue, choose **Connect Linear** in the project's integration settings,
then select **Linear issue** in the bottom bar before your first message, or in the top-right
thread details panel once the conversation starts. A linked issue's identifier replaces the label.
The list starts with issues assigned to you. Use **Triage** for the workspace’s intake queue,
or **All issues** to find issues assigned to anyone. Choose a team before the search field to narrow all views; T3 remembers it for this
project and workspace on this device. **All teams** clears the filter. Search filters the selected
view and team. Issues appear by latest update, and scrolling loads more automatically. Linking is optional before or after a conversation
starts. It keeps your current chat and history, opens the issue in the right panel, and uses the
issue’s existing worktree or checks out its local or remote branch on the connected computer.
If the branch does not exist, it creates Linear’s suggested branch from `main` in a new worktree.

Choose **Create new issue** at the bottom of the picker to use Linear's editor in the right panel.
After creation, an unlinked chat uses the new issue automatically. A linked chat asks before
switching. If an agent starts while the editor is open, finish the turn and choose **Use this
issue**; T3 does not queue a switch. Leaving the chat keeps creation tied to its originating chat.
Canceling the editor leaves the chat unchanged.

If another active chat uses that worktree, choose to open it or use the current chat and settle
the previous one. Switching is unavailable while either agent is running. **Unlink issue**
removes the association while keeping the conversation and files. Linked chats remain usable
on web and mobile. Disconnecting Linear or turning off the feature preserves existing links.

## Worktree location

New worktrees go in the `worktrees` folder of the T3 home directory. To put them somewhere else,
such as another drive, set **Settings → Storage → Worktree location** to an absolute path like
`D:\worktrees` or `~/worktrees`. The setting is per machine. Existing worktrees stay where they
are, and cleanup covers both the default folder and the custom one. Linear issue worktrees
use this location too. To keep all projects' worktrees inside one checkout, choose a path such
as `~/Developer/t3code/.worktrees` and ignore `/.worktrees/` in that checkout's `.gitignore`.

## Storage cleanup

Open **Settings → Storage** to enable automatic cleanup on one machine or all connected
environments. Policies are off by default and run on the server at startup, when changed, and
hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after a thread settles, after
merging, or when they have no commits beyond the default branch. Set settled retention to 0 days
to remove a worktree at the next cleanup after settlement. Only T3-managed worktrees are eligible.
Active sessions and shared worktrees prevent removal. **Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

Enable **Delete worktrees with deleted threads** to remove safe worktrees after their last
thread is deleted, including archived threads and worktrees left by earlier deletions. The
server waits for sessions and terminals to stop and retries skipped worktrees after restart.
Existing prompts for deleting a worktree manually remain available when this policy is off.

Choose **Delete now** to run the enabled rules immediately. The latest results show which
worktrees were removed or kept and why, plus any failures.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`.

## Keep the default branch current

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

## Projects without Git

In **Settings → Source Control**, select a project and turn off **Git integration**.
This hides its Git and pull request controls and stops automatic Git activity,
including file checkpoints and restore. Chat, file access, and explicit Git commands
in a terminal remain available. New threads start in the project directory; existing
threads keep their working directories.

The choice applies to clients connected to that environment. Turn it back on in the
same place to resume Git features with your saved preferences. Files, repositories,
worktrees, and existing checkpoints are kept, but turns made while Git was off have
no file checkpoints.
