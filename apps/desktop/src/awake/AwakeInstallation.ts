export const AWAKE_LABEL = "com.blackbird.keep-awake-v1";
export const AWAKE_HELPER = `/Library/PrivilegedHelperTools/${AWAKE_LABEL}`;
export const AWAKE_PLIST = `/Library/LaunchDaemons/${AWAKE_LABEL}.plist`;
export const AWAKE_SUDOERS = "/etc/sudoers.d/blackbird-keep-awake-v1";
export const AWAKE_ROOT = `/var/db/${AWAKE_LABEL}`;

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Grants this user fixed power operations, not arbitrary commands or app-only authority. */
export function installAwakeCommand(source: string, uid: number) {
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error("Invalid desktop user ID.");
  const rule = `#${uid} ALL=(root) NOPASSWD: ${AWAKE_HELPER} apply *, ${AWAKE_HELPER} release *\n`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${AWAKE_LABEL}</string>
<key>ProgramArguments</key><array><string>${AWAKE_HELPER}</string><string>recover</string></array>
<key>StartInterval</key><integer>15</integer><key>RunAtLoad</key><true/>
</dict></plist>`;
  // Refuse to overwrite another installation, including a partially installed one.
  return `set -eu
umask 077
if [ -e ${AWAKE_HELPER} ] || [ -L ${AWAKE_HELPER} ]; then echo 'Keep awake setup already exists; remove it first.' >&2; exit 1; fi
if [ -e ${AWAKE_PLIST} ] || [ -L ${AWAKE_PLIST} ]; then echo 'Keep awake setup already exists; remove it first.' >&2; exit 1; fi
if [ -e ${AWAKE_SUDOERS} ] || [ -L ${AWAKE_SUDOERS} ]; then echo 'Keep awake setup already exists; remove it first.' >&2; exit 1; fi
test ! -e /etc/sudoers.d/blackbird-awake || { echo 'Remove the older Blackbird Keep awake setup first.' >&2; exit 1; }
if [ -e ${AWAKE_ROOT} ] || [ -L ${AWAKE_ROOT} ]; then echo 'Keep awake setup already exists; remove it first.' >&2; exit 1; fi
/bin/mkdir -p /Library/PrivilegedHelperTools
/bin/mkdir -m 700 ${AWAKE_ROOT}
trap '/bin/launchctl bootout system/${AWAKE_LABEL} 2>/dev/null || true; /bin/rm -f ${AWAKE_HELPER} ${AWAKE_PLIST} ${AWAKE_SUDOERS} ${AWAKE_ROOT}/sudoers ${AWAKE_ROOT}/lock ${AWAKE_ROOT}/disabled; /bin/rmdir ${AWAKE_ROOT} 2>/dev/null || true' EXIT
: > ${AWAKE_ROOT}/disabled
/usr/bin/printf '%s' ${shellQuote(source)} > ${AWAKE_HELPER}
/bin/chmod 755 ${AWAKE_HELPER}
/usr/bin/printf '%s' ${shellQuote(plist)} > ${AWAKE_PLIST}
/bin/chmod 644 ${AWAKE_PLIST}
/usr/bin/printf '%s' ${shellQuote(rule)} > ${AWAKE_ROOT}/sudoers
/usr/sbin/visudo -cf ${AWAKE_ROOT}/sudoers
/usr/bin/install -o root -g wheel -m 0440 ${AWAKE_ROOT}/sudoers ${AWAKE_SUDOERS}
/bin/rm ${AWAKE_ROOT}/sudoers
/bin/launchctl bootstrap system ${AWAKE_PLIST}
/bin/launchctl print system/${AWAKE_LABEL} >/dev/null
/bin/rm ${AWAKE_ROOT}/disabled
trap - EXIT`;
}

export const removeAwakeCommand = `set -eu
if [ -x ${AWAKE_HELPER} ]; then
  ${AWAKE_HELPER} uninstall
else
  test ! -e ${AWAKE_ROOT}/session || { echo 'Recovery journal exists; reinstall the helper before removing setup.' >&2; exit 1; }
fi
/bin/launchctl bootout system/${AWAKE_LABEL} 2>/dev/null || { if /bin/launchctl print system/${AWAKE_LABEL} >/dev/null 2>&1; then exit 1; fi; }
/bin/rm -f ${AWAKE_SUDOERS} ${AWAKE_PLIST} ${AWAKE_HELPER}
/bin/rm -f ${AWAKE_ROOT}/lock ${AWAKE_ROOT}/session.next ${AWAKE_ROOT}/disabled ${AWAKE_ROOT}/sudoers
if [ -d ${AWAKE_ROOT} ]; then /bin/rmdir ${AWAKE_ROOT}; fi`;
