// @effect-diagnostics nodeBuiltinImport:off - Real installed-extension filesystem fixtures.
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  copyOnePasswordExtension,
  findOnePasswordExtension,
  isOnePasswordPage,
  readOnePasswordManifest,
} from "./OnePasswordFiles.ts";

// Public Web Store extension identity, not a vault or signing secret.
const key =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnHpaUll4uWujpAdbIXOQY2WE6hk8PllsYsnoUaj5qHXwv4IB6A9pONqGaTL2KL20u6E6XVhncY6Ae6SQSBQqiIkgjPsiG0NDNsDlju/kzBnfimKFC/bpzOrqFqbhswQHifnet5uHlpG97whTzLO3ka0M5aqB9V9mD/0qVXvNgAVVnSTULH254YqpeCcAhmsKiFZSL6OrOZmCp8kZ/OeOUK9iYWYylL7VcOXVrZf10EPrlaCNXzVk7K35dPuQ7svhA0Pgju3kngB4RLa5Iojhw3IT+B5+m8pisjOSd1oKMrRmhGs7rDhF5IEtAiVxqVp7uOOMPQj3vrbMDAzf7vqLtQIDAQAB";
const manifest = (version = "8.12.42.36") => JSON.stringify({ key, version, manifest_version: 3 });
const temporary: string[] = [];
const directory = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-onepassword-files-"));
  temporary.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

describe("1Password installation", () => {
  it("rejects other extension identities and malformed manifests", () => {
    expect(readOnePasswordManifest(manifest())).toEqual({ version: "8.12.42.36" });
    for (const input of [
      "null",
      "{}",
      JSON.stringify({ key: "another-key", version: "1" }),
      JSON.stringify({ key, version: "../escape" }),
    ]) {
      expect(() => readOnePasswordManifest(input)).toThrow();
    }
  });
  it("chooses the newest complete installed extension without copying profile storage", async () => {
    const root = await directory();
    const extensionRoot = NodePath.join(
      root,
      "Default",
      "Extensions",
      "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
    );
    for (const version of ["8.9.0", "8.12.0", "8.99.0"]) {
      const folder = NodePath.join(extensionRoot, version);
      await NodeFSP.mkdir(folder, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(folder, "manifest.json"),
        version === "8.99.0" ? "{" : manifest(version),
      );
    }
    await NodeFSP.writeFile(NodePath.join(root, "Default", "vault-private"), "must not copy");
    const found = await findOnePasswordExtension([root, NodePath.join(root, "missing")]);
    expect(found?.version).toBe("8.12.0");
    const copy = NodePath.join(root, "copy");
    await copyOnePasswordExtension(found!.directory, copy);
    expect(await NodeFSP.readdir(copy)).toEqual(["manifest.json"]);
  });
  it("refuses symlinks into browser-private data", async () => {
    const root = await directory();
    const source = NodePath.join(root, "source");
    await NodeFSP.mkdir(source);
    await NodeFSP.writeFile(NodePath.join(source, "manifest.json"), manifest());
    await NodeFSP.writeFile(NodePath.join(root, "private"), "private");
    await NodeFSP.symlink(NodePath.join(root, "private"), NodePath.join(source, "escaped"));
    await expect(copyOnePasswordExtension(source, NodePath.join(root, "target"))).rejects.toThrow(
      "symbolic links",
    );
  });
  it("limits extension pages to the exact extension origin", () => {
    expect(
      isOnePasswordPage("chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/popup/index.html"),
    ).toBe(true);
    for (const url of [
      "https://aeblfdkhhhdcdjpifhhbdiojplfjncoa/popup/index.html",
      "chrome-extension://other/popup/index.html",
      "javascript:alert(1)",
      "chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa.evil/",
    ]) {
      expect(isOnePasswordPage(url)).toBe(false);
    }
  });
});
