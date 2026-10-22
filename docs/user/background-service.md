# Running T3 Code in the background

On Linux and macOS, T3 Code can run as a service for your user so you do not need
to keep a terminal open.

## Manage the service

Install the `t3` CLI first ([Install T3 Code](./install.md#command-line)), then
run these commands on the machine that will host T3 Code:

| Task                            | Command                |
| ------------------------------- | ---------------------- |
| Install and start               | `t3 service install`   |
| Inspect status and log location | `t3 service status`    |
| Move to a newer release         | `t3 update`            |
| Restart                         | `t3 service restart`   |
| Stop and remove from startup    | `t3 service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `t3 service install` again repairs a service that `t3 service status`
reports as broken.

`t3 update` downloads the newest release on your channel and switches `t3`
and the service to it. Restarting interrupts running agent turns, terminals,
and remote clients, so it asks first; answer no and the service keeps running
the old version until you run `t3 service restart`. Pass `--yes` from a
script. A server you started by hand is left running; stop and start it again
to pick up the new version. Wait for any remote update already in progress
before updating; to match a remote client's version, follow
[Updating T3 Code](./updating.md).

Pass an exact version (`t3 update 0.0.42`) to pin one, `--channel nightly` to
switch trains, or `--allow-downgrade` to move backwards. `preview` is a
maintainers' test train: its builds can be broken and are never offered as
updates, so the installer and `t3 update` ask for confirmation before
installing one.

`t3 uninstall` removes the background service, the `t3` launcher, and the
downloaded versions after showing you the list and asking once. Your projects,
threads, and settings under `~/.t3/userdata` are kept. Pass `--yes` from a
script.

## Platform support

Linux needs systemd user services. Setup enables lingering so T3 Code starts at
boot and keeps running after logout. If this needs administrator permission,
setup prints a recovery command before changing the service.

macOS starts the service when you log in and stops it when you log out. Keep the
Mac logged in and awake for unattended remote access. Installing over SSH while
nobody is logged in at the Mac's screen can fail at the final start step; the
service is still installed and will start at the next login.

Windows background services are not supported.

T3 Connect can offer service installation during setup, but the two are managed
separately. Signing out of T3 Connect does not stop or uninstall the service.

## Keep a Mac awake with the desktop app

In the macOS desktop app, enable **Keep awake** in **Settings → Features**, then
choose **Configure** to complete the one-time administrator setup and adjust
battery/heat safeguards. The feature applies to the whole desktop instance and
all its projects; there is no per-project override. The Keep awake settings page
uses the same switch. The Mac stays awake
while Blackbird runs, including with its lid closed or its window closed. The
display can still turn off and lock. This applies to the Mac running the desktop
app, regardless of which environment you are viewing; it does not keep a remote
computer awake or enable the feature for a standalone CLI service.

Setup grants limited power-control permission to your macOS account. Other apps
running as you can use that permission outside Blackbird's battery and heat
safeguards. Turning Keep awake off stops Blackbird's session; **Remove setup**
revokes the permission.

By default, Low Power Mode starts below 40% battery and normal sleep is allowed
below 10%. Heat safeguards also reduce power at serious thermal pressure and
allow sleep at critical pressure. These limits are configurable. Keep awake
resumes when conditions improve. Keeping a laptop awake uses more battery; keep
it ventilated while running with the lid closed.

Turn the setting off or quit Blackbird to restore normal power behavior. A
separate recovery service restores settings after an unexpected exit. Use
**Remove setup** in the same settings page to remove that service and its power
permissions. If restoration fails, the page reports the error and retains
recovery so it can try again. Only one Blackbird instance can own Keep awake on
a Mac at a time.

## Troubleshooting

Start with `t3 service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running T3 Code as root creates a separate installation and Connect
identity. Without administrator access, run `t3 serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status t3code.service`, then use the repair command printed by T3 Code.                     |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `t3 service restart`.                            |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `t3` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.t3tools.t3code.service.plist`.

For failures after signing in to T3 Connect, see
[connection troubleshooting](./remote-access.md#t3-connect-troubleshooting).
