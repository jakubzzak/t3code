# Desktop terminal launcher

## Problem and outcome

Desktop users should be able to open their current directory in T3 Code from a terminal without separately installing the CLI. After enabling the command in the desktop app, `t3 .` opens the project with a fresh chat, whether the app is running or closed.

## Scope

Add desktop-managed terminal command setup and the `t3 <directory>` invocation. Preserve bare `t3`, `t3 app`, all existing subcommands, and their options and behavior. Do not change server startup defaults, provider behavior, or ordinary project and chat creation flows.

This is a local desktop capability. Web and mobile clients do not install a command on their hosts. Remote desktop activation, SSH forwarding, and new Windows/WSL path translation are outside scope.

## Required behavior

- Desktop Settings provides an action to install the `t3` command using the installed app, without a separate npm installation or separately downloaded CLI. Show whether setup succeeded and provide a removal action. Make setup discoverable through the desktop command palette as well.
- `t3 .` resolves the directory from the invoking terminal's working directory. Relative and absolute directory arguments are supported, including quoted paths with spaces. Existing subcommand names retain precedence; `t3 ./serve`, for example, identifies a directory rather than invoking `t3 serve`.
- Launch the desktop app if it is closed, or focus the existing app if it is running. Wait for its local environment to be ready before opening the requested project. A single invocation opens one fresh chat, including when app startup is required.
- Reuse the project for that directory in the desktop's local environment, or add it if absent. Open and select a fresh empty chat each time; do not resume a previous chat or submit a prompt. Preserve existing chat history and normal new-chat defaults.
- Target the local environment even if the desktop currently displays a remote environment. Preserve existing unsupported-environment and platform-mismatch boundaries rather than interpreting a local path on another machine.
- Invalid directories and app startup or activation failures produce an actionable terminal error and an unsuccessful exit status. Do not report success merely because the app launched. Installation failures must be visible in Settings, with any required PATH or terminal-restart step explained.
- Repeated installation is safe. Existing CLI installations must keep working: do not silently overwrite an independently installed executable or shadow it with a launcher that drops its commands. Detect a conflicting or incompatible command and explain how to resolve it. Removal deletes only the desktop-managed launcher and leaves independent installations, projects, and chats intact.

## Acceptance criteria

1. With the desktop installed and no separately installed CLI, enable the terminal command in Settings. After any indicated shell setup, `t3 .` works from a project directory.
2. With the app closed and the directory not yet registered, `t3 .` launches the app, adds one project, and selects one fresh chat. With the app running, invoking it again reuses that project and opens another fresh chat without changing existing conversations.
3. A relative path and a quoted absolute path containing spaces open the intended directory. A nonexistent path fails without creating a project or chat.
4. While a remote environment is displayed, a local invocation opens the project in the local environment. An unavailable or unsupported target reports a failure rather than creating the project remotely.
5. Bare `t3`, `t3 app`, and existing server and management commands retain their current behavior. Setup detects an existing command conflict without replacing it; repeated installation and removal preserve unrelated executables and user data.

## Constraints and decisions

- Keep the existing [CLI command surface](../../apps/server/src/bin.ts) compatible. Only directory invocation gains the new launch-and-open behavior; bare `t3` continues to start the server.
- Reuse the established [desktop activation flow](../../apps/web/src/desktopAppActivation.ts) for project selection and fresh-chat creation. App startup must not cause duplicate activation or a second desktop instance.
- The launcher should continue working after normal desktop updates. Platform-specific installation details may differ without changing the command's meaning.

## Assumptions

- Desktop support covers macOS, Windows, and Linux, following the repository's multi-surface guidance. Setup placement, launcher packaging, and platform-specific PATH handling are implementation choices, not additional product flows.
