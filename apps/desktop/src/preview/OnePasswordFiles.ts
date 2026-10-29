// @effect-diagnostics nodeBuiltinImport:off - Installed browser extension files are a local desktop boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export const ONE_PASSWORD_EXTENSION_ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
export const ONE_PASSWORD_ORIGIN = `chrome-extension://${ONE_PASSWORD_EXTENSION_ID}`;

/** Checks the installed extension's identity before executing any of its code. */
export function readOnePasswordManifest(raw: string) {
  const manifest: unknown = JSON.parse(raw);
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("key" in manifest) ||
    typeof manifest.key !== "string" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    !/^\d+(\.\d+){0,3}$/.test(manifest.version)
  ) {
    throw new Error("This folder does not contain the installed 1Password extension.");
  }
  const id = NodeCrypto.createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + Number.parseInt(value, 16)));
  if (id !== ONE_PASSWORD_EXTENSION_ID) throw new Error("This is not the 1Password extension.");
  return { version: manifest.version };
}

/** Browser code only: never reads or copies cookies, extension storage, or vault data. */
export async function findOnePasswordExtension(roots: ReadonlyArray<string>) {
  const candidates: Array<{ directory: string; version: string }> = [];
  for (const root of roots) {
    const profiles = await NodeFSP.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue;
      const extensionRoot = NodePath.join(
        root,
        profile.name,
        "Extensions",
        ONE_PASSWORD_EXTENSION_ID,
      );
      const versions = await NodeFSP.readdir(extensionRoot, { withFileTypes: true }).catch(
        () => [],
      );
      for (const version of versions) {
        if (!version.isDirectory()) continue;
        const directory = NodePath.join(extensionRoot, version.name);
        try {
          candidates.push({
            directory,
            ...readOnePasswordManifest(
              await NodeFSP.readFile(NodePath.join(directory, "manifest.json"), "utf8"),
            ),
          });
        } catch {
          /* Incomplete browser updates are not installable. */
        }
      }
    }
  }
  candidates.sort((left, right) => {
    const a = left.version.split(".").map(Number);
    const b = right.version.split(".").map(Number);
    for (let index = 0; index < 4; index++) {
      const difference = (b[index] ?? 0) - (a[index] ?? 0);
      if (difference) return difference;
    }
    return left.directory.localeCompare(right.directory);
  });
  return candidates[0];
}

/** A separate copy survives source-browser upgrades; symlinks must not escape into profile data. */
export async function copyOnePasswordExtension(source: string, destination: string) {
  await NodeFSP.cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (file) => {
      const stat = await NodeFSP.lstat(file);
      if (stat.isSymbolicLink())
        throw new Error("Extension folders must not contain symbolic links.");
      return true;
    },
  });
  return readOnePasswordManifest(
    await NodeFSP.readFile(NodePath.join(destination, "manifest.json"), "utf8"),
  );
}

export function isOnePasswordPage(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "chrome-extension:" && url.hostname === ONE_PASSWORD_EXTENSION_ID;
  } catch {
    return false;
  }
}
