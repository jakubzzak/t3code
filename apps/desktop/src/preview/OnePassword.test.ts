// @effect-diagnostics nodeBuiltinImport:off - Isolated on-disk profile lifecycle fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import type { BrowserWindow, Session, WebContents } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { it } from "@effect/vitest";
import { afterEach, describe, expect, vi } from "vite-plus/test";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as OnePassword from "./OnePassword.ts";
import { ONE_PASSWORD_EXTENSION_ID, ONE_PASSWORD_ORIGIN } from "./OnePasswordFiles.ts";

const mocks = vi.hoisted(() => ({
  addTab: vi.fn(),
  removeTab: vi.fn(),
  selectTab: vi.fn(),
  instances: vi.fn(),
  windows: [] as Array<{ url?: string; close: ReturnType<typeof vi.fn> }>,
}));
vi.mock("electron-chrome-extensions", () => ({
  ElectronChromeExtensions: class {
    addTab = mocks.addTab;
    removeTab = mocks.removeTab;
    selectTab = mocks.selectTab;
    constructor() {
      mocks.instances();
    }
  },
}));
vi.mock("electron", () => ({
  BrowserWindow: class extends NodeEvents.EventEmitter {
    url?: string;
    webContents = Object.assign(new NodeEvents.EventEmitter(), { setWindowOpenHandler: vi.fn() });
    constructor(options: { webPreferences: { session: Session } }) {
      super();
      Object.assign(this.webContents, {
        session: options.webPreferences.session,
        isDestroyed: () => false,
        reload: vi.fn(),
      });
      mocks.windows.push(this);
    }
    isDestroyed = () => false;
    show = vi.fn();
    close = vi.fn(() => this.emit("closed"));
    loadURL = async (url: string) => {
      this.url = url;
    };
  },
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => NodeFSP.rm(path, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
  mocks.windows.length = 0;
});

const fixture = async (platform: NodeJS.Platform = "darwin", persisted = false) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-onepassword-profile-"));
  roots.push(root);
  const directory = NodePath.join(root, "t3-onepassword");
  await NodeFSP.mkdir(NodePath.join(directory, "extension"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(directory, "extension", "manifest.json"), "{}");
  if (persisted) await NodeFSP.writeFile(NodePath.join(directory, "enabled"), "1");
  const workers = Object.assign(new NodeEvents.EventEmitter(), {
    getWorkerFromVersionID: () => ({ scope: `${ONE_PASSWORD_ORIGIN}/` }),
  });
  const extensions = {
    loadExtension: vi.fn(async () => {
      queueMicrotask(() =>
        workers.emit("running-status-changed", { versionId: 1, runningStatus: "running" }),
      );
      return { id: ONE_PASSWORD_EXTENSION_ID };
    }),
    removeExtension: vi.fn(),
  };
  const session = { storagePath: root, extensions, serviceWorkers: workers } as unknown as Session;
  const owner = { isDestroyed: () => false } as BrowserWindow;
  const tab = Object.assign(new NodeEvents.EventEmitter(), {
    session,
    isDestroyed: () => false,
    reload: vi.fn(),
    getURL: () => "https://example.com/",
  }) as unknown as WebContents;
  const layer = OnePassword.layer.pipe(
    Layer.provide(
      Layer.mock(DesktopEnvironment.DesktopEnvironment)({
        platform,
        homeDirectory: root,
        path: { join: NodePath.join } as DesktopEnvironment.DesktopEnvironment["Service"]["path"],
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.provide(
      Layer.mock(ElectronDialog.ElectronDialog)({
        showMessageBox: () => Effect.succeed({ response: 0, checkboxChecked: false }),
      }),
    ),
  );
  return {
    root,
    directory,
    session,
    extensions,
    serviceEffect: OnePassword.OnePassword.pipe(Effect.provide(layer)),
    tab,
    owner,
  };
};

const setup = (platform: NodeJS.Platform = "darwin", persisted = false) =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture(platform, persisted));
    const service = yield* f.serviceEffect;
    return { ...f, service };
  });

describe("1Password profile lifecycle", () => {
  it.effect("does not initialize compatibility APIs in profiles which never opted in", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      yield* f.service.prepare(f.session);
      expect(mocks.instances).not.toHaveBeenCalled();
      expect(f.service.isEnabled(f.session)).toBe(false);
    }),
  );
  it.effect("restores a persisted opt-in once, even with concurrent page initialization", () =>
    Effect.gen(function* () {
      const f = yield* setup("darwin", true);
      yield* Effect.all([f.service.prepare(f.session), f.service.prepare(f.session)], {
        concurrency: "unbounded",
      });
      expect(f.extensions.loadExtension).toHaveBeenCalledTimes(1);
      expect(f.service.isEnabled(f.session)).toBe(true);
    }),
  );
  it.effect("enables and disables only the chosen profile, retaining its extension data", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const other = yield* setup();
      f.service.track(f.tab, f.owner);
      yield* f.service.enable(f.session, f.owner);
      expect(f.service.isEnabled(f.session)).toBe(true);
      expect(f.service.isEnabled(other.session)).toBe(false);
      expect(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(f.directory, "enabled"), "utf8"),
        ),
      ).toBe("1");
      expect(mocks.windows[0]?.url).toBe(`${ONE_PASSWORD_ORIGIN}/app/app.html#/page/welcome`);
      expect(mocks.addTab).toHaveBeenCalledWith(f.tab, f.owner);
      const popup = mocks.windows[0]!;
      yield* f.service.disable(f.session);
      expect(f.service.isEnabled(f.session)).toBe(false);
      expect(f.extensions.removeExtension).toHaveBeenCalledWith(ONE_PASSWORD_EXTENSION_ID);
      expect(popup.close).toHaveBeenCalled();
      expect(f.tab.reload).toHaveBeenCalledTimes(2);
      yield* Effect.promise(() =>
        expect(NodeFSP.access(NodePath.join(f.directory, "enabled"))).rejects.toThrow(),
      );
      yield* Effect.promise(() =>
        expect(
          NodeFSP.access(NodePath.join(f.directory, "extension", "manifest.json")),
        ).resolves.toBeUndefined(),
      );
    }),
  );
  it.effect("keeps normal browser startup working when restoring the extension fails", () =>
    Effect.gen(function* () {
      const f = yield* setup("darwin", true);
      f.extensions.loadExtension.mockRejectedValueOnce(new Error("corrupt extension"));
      yield* f.service.prepare(f.session);
      expect(f.service.isEnabled(f.session)).toBe(false);
      expect(JSON.stringify(f.service.menuItems(f.tab, f.owner))).toContain("Retry enabling");
    }),
  );
  it.effect("excludes incognito sessions and non-macOS clients", () =>
    Effect.gen(function* () {
      const f = yield* setup("linux", true);
      yield* f.service.prepare(f.session);
      expect(f.service.menuItems(f.tab, f.owner)).toEqual([]);
      expect(f.extensions.loadExtension).not.toHaveBeenCalled();
      const mac = yield* setup();
      const ephemeral = { ...mac.session, storagePath: null } as Session;
      yield* mac.service.prepare(ephemeral);
      expect(mac.extensions.loadExtension).not.toHaveBeenCalled();
      expect(
        JSON.stringify(
          mac.service.menuItems({ ...mac.tab, session: ephemeral } as WebContents, mac.owner),
        ),
      ).toContain("persistent profile");
    }),
  );
});
