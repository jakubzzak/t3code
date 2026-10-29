# 02 - 1Password in the built-in browser

**Status:** Implemented, experimental macOS support.

Implementation: [PR #50](https://github.com/jakubzzak/t3code/pull/50).
User guide: [1Password in the desktop browser](../user/browser-import.md#1password-in-the-desktop-browser).

This spec records the agreed scope and behavior of the local integration.

## Problem and outcome

A person using the built-in browser should be able to use their 1Password logins and passkeys without leaving the browser. Local macOS builds do not currently provide this through direct extension loading or the existing native passkey path.

Integrate the official 1Password browser extension into a selected persistent browser profile. The person enables it explicitly, signs in separately, and uses the extension on supported websites. Personal local use is the initial scope.

## Supported surfaces

| Surface                                                    | Support                                |
| ---------------------------------------------------------- | -------------------------------------- |
| macOS desktop, persistent native browser profile           | Supported                              |
| Server-owned tab rendered natively by the local desktop    | Supported in its local browser profile |
| Incognito profile                                          | Unsupported                            |
| Remote streamed or headless browser                        | Unsupported                            |
| Web client, mobile client, other desktop operating systems | Unsupported in this version            |

Each persistent profile has its own opt-in and extension storage. Enabling one profile must not enable another.

## User experience

### Enable and sign in

1. Open a page in a supported profile.
2. Choose **1Password** from the browser’s three-dot menu, or **1Password → Enable in this profile…** from the page context menu.
3. On first installation, show a confirmation explaining that the extension can read and fill websites in this profile, including agent-opened pages; only extension code is copied; separate sign-in is required; desktop-app unlocking is unavailable.
4. Cancelling leaves the extension uninstalled and disabled. If the official extension is not installed in a supported Chromium browser, explain that prerequisite.
5. After confirmation, copy and validate the official extension code, start it, persist the opt-in, reload existing pages, and open 1Password’s official onboarding page.
6. The person completes sign-in in 1Password’s own UI. **Set up 1Password…** in the context menu can reopen onboarding if interrupted.

### Open and use the vault

- **⋯ → 1Password** opens the vault popup when the profile is enabled.
- **Right-click → 1Password → Open 1Password** provides the same action.
- The popup operates against the selected browser tab.
- The official extension handles unlocking, filling, and passkey approval on supported websites. Blackbird does not collect the account password or implement its own vault UI.
- No operating-system notification is required as the success signal. A passkey test succeeds when the extension offers the matching credential and the website completes authentication.

### Dismiss

- Pressing **Escape** closes the vault popup.
- Clicking outside it, or otherwise moving focus away, closes the vault popup.
- Dismissal does not disable the extension or erase its stored sign-in data.
- Onboarding and sign-in windows stay open when focus changes or Escape is pressed, so switching to another app during setup does not interrupt it.

### Disable and return

- **Right-click → 1Password → Disable in this profile** unloads the extension for that profile, closes its windows, and reloads its pages.
- Disabling retains the copied code and extension storage. It is not a sign-out or data-deletion action.
- Re-enabling uses the retained installation and account state. It opens onboarding so setup can be resumed if needed.
- Enabled profiles restore the extension when the app starts again. A restore failure must leave ordinary browsing available and expose a retry action.

## Constraints

- Load only the expected official extension identity. Validate the extension manifest and reject symlinks while copying code.
- Never copy the source browser’s vault, cookies, or account storage. The destination profile signs in separately.
- Use a pinned compatibility layer to supply missing Electron extension APIs. Bind its IPC to the actual extension sender origin, disable cross-session IPC and native messaging, and remove generic IPC argument/result logging.
- Opening the vault through the desktop bridge must resolve an existing registered browser tab. Unsupported profiles or unavailable tabs must fail without opening a vault in another profile.
- The extension may access pages opened by agents in an enabled profile. First-use consent must make this explicit.
- Isolated development testing must use a separate Electron profile as well as separate server state, preserving the installed app’s browser data.

## Non-goals and limitations

This version does not provide desktop-app unlocking or Touch ID through 1Password’s native messaging bridge, automatic extension updates, arbitrary browser-extension installation, shared vault sessions across profiles, or a workaround for Apple’s native browser passkey entitlement. It does not promise compatibility with every website or future extension version.

## Acceptance criteria

| Scenario                           | Required result                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| First use in a supported profile   | Confirmation appears; acceptance opens official onboarding; cancellation leaves the profile disabled.                                  |
| Missing or invalid extension code  | Clear failure; no unexpected extension is loaded.                                                                                      |
| Separate profile                   | Existing browser account data is not imported; another profile remains unaffected.                                                     |
| Successful setup                   | The person signs in and can open or unlock the vault from both menu entry points.                                                      |
| Passkey login                      | On a supported website with a matching passkey in the vault, 1Password offers the credential and the website completes authentication. |
| Popup dismissal                    | Escape and outside focus close the vault; setup stays open.                                                                            |
| Disable                            | Extension activity stops in that profile, windows close, pages reload, and saved extension storage remains.                            |
| Restart or re-enable               | Opt-in and retained account state remain usable; startup failure does not block browsing.                                              |
| Unsupported surface or invalid tab | No usable vault-opening action is exposed, or the operation fails explicitly without affecting another profile.                        |
| Development isolation              | Testing and restarting the dev app do not modify or restart the installed app.                                                         |

## Validation record

184 focused tests passed across profile lifecycle, PreviewManager, preview IPC, DesktopWindow, and PreviewView. Additional extension identity/copy, worker startup, and development-profile isolation tests passed during implementation. Desktop and web typechecks, targeted lint, and the desktop build passed.

The agent verified the official onboarding and sign-in screens in the isolated desktop. The owner manually tested the feature and reported success, including the three-dot menu and dismissal changes. Fresh before/after screenshots, a dismissal recording, and an independently recorded authenticated passkey ceremony remain absent because native UI automation timed out during final capture. These are evidence gaps, not additional scope.
