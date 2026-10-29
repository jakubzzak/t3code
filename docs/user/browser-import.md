# Import browser sessions

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Integrations → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag T3 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen T3 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

On Windows, import supports Firefox and Helium profiles that use standard profile encryption.
Other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies
are skipped on all platforms.

## 1Password in the desktop browser

On macOS, right-click a page in the built-in browser and choose **1Password → Enable in this
profile**. Install the official 1Password extension in Chrome, Arc, or another supported
Chromium browser first. T3 Code copies the extension code and opens its account setup; sign in
to 1Password separately. Desktop-app unlocking is not supported by this experimental integration.

The extension can read and fill pages in that profile, including pages opened by agents.
Incognito profiles and remote server browsers do not support this integration. Use
**1Password → Set up 1Password** to resume sign-in, **Open 1Password** to open the vault popup
after signing in, or **Disable in this profile** to stop it.
Disabling keeps the extension's saved sign-in data. The copied extension does not update automatically.
