// @effect-diagnostics nodeBuiltinImport:off - Electron extension lifecycle and browser-owned files.
import {
  BrowserWindow,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import type { ElectronChromeExtensions } from "electron-chrome-extensions";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { loadOnePassword } from "./OnePasswordRuntime.ts";
import { BROWSER_IMPORT_SOURCES } from "./BrowserImport/Sources.ts";
import {
  copyOnePasswordExtension,
  findOnePasswordExtension,
  isOnePasswordPage,
  ONE_PASSWORD_EXTENSION_ID,
  ONE_PASSWORD_ORIGIN,
} from "./OnePasswordFiles.ts";

export class OnePasswordError extends Schema.TaggedError<OnePasswordError>()("OnePasswordError", {
  message: Schema.String,
}) {}

export class OnePassword extends Context.Service<
  OnePassword,
  {
    /** Restores opt-in before the first page loads; incognito sessions are excluded. */
    readonly prepare: (session: Session) => Effect.Effect<void>;
    readonly enable: (
      session: Session,
      owner: BrowserWindow,
    ) => Effect.Effect<void, OnePasswordError>;
    readonly disable: (session: Session) => Effect.Effect<void, OnePasswordError>;
    readonly isEnabled: (session: Session) => boolean;
    readonly track: (contents: WebContents, owner: BrowserWindow) => void;
    readonly menuItems: (
      contents: WebContents,
      owner: BrowserWindow,
    ) => ReadonlyArray<MenuItemConstructorOptions>;
  }
>()("@t3tools/desktop/preview/OnePassword") {}

type Profile = {
  compatibility?: ElectronChromeExtensions;
  loading?: Promise<void>;
  enabled: boolean;
  error?: string | undefined;
  busy: boolean;
  windows: Set<BrowserWindow>;
  tabs: Map<WebContents, BrowserWindow>;
};

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const dialogs = yield* ElectronDialog.ElectronDialog;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const profiles = new WeakMap<Session, Profile>();
  const profileFor = (session: Session) => {
    let profile = profiles.get(session);
    if (!profile) {
      profile = { enabled: false, busy: false, tabs: new Map(), windows: new Set() };
      profiles.set(session, profile);
    }
    return profile;
  };
  const directoryFor = (session: Session) => {
    if (!session.storagePath) throw new Error("1Password needs a persistent browser profile.");
    return NodePath.join(session.storagePath, "t3-onepassword");
  };
  const roots = BROWSER_IMPORT_SOURCES.filter((source) => source.engine === "chromium")
    .map((source) =>
      source.userDataDirectory({
        path: environment.path,
        platform: environment.platform,
        home: environment.homeDirectory,
        appData: undefined,
        localAppData: undefined,
      }),
    )
    .filter((root): root is string => root !== undefined);

  const track = (contents: WebContents, owner: BrowserWindow) => {
    const profile = profileFor(contents.session);
    if (profile.tabs.has(contents)) return;
    profile.tabs.set(contents, owner);
    profile.compatibility?.addTab(contents, owner);
    contents.on("focus", () => profile.compatibility?.selectTab(contents));
    contents.once("destroyed", () => {
      profile.tabs.delete(contents);
    });
  };

  const createWindow = (session: Session, url: string, parent?: BrowserWindow, asTab = true) => {
    const parsed = new URL(url);
    if (!isOnePasswordPage(url) && parsed.protocol !== "https:" && url !== "about:blank") {
      throw new Error("1Password requested an unsupported URL.");
    }
    const window = new BrowserWindow({
      width: 820,
      height: 720,
      title: "1Password",
      show: false,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const profile = profileFor(session);
    profile.windows.add(window);
    window.once("closed", () => profile.windows.delete(window));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, next) => {
      if (!isOnePasswordPage(next) && !next.startsWith("https://")) event.preventDefault();
    });
    if (asTab) track(window.webContents, window);
    void window.loadURL(url).then(
      () => window.show(),
      () => window.close(),
    );
    return window;
  };

  const compatibilityFor = async (session: Session) => {
    const profile = profileFor(session);
    if (!profile.compatibility) {
      const { ElectronChromeExtensions } = await import("electron-chrome-extensions");
      profile.compatibility = new ElectronChromeExtensions({
        session,
        createTab: async (details) => {
          const window = createWindow(session, details.url ?? "about:blank");
          return [window.webContents, window];
        },
        selectTab: (tab, window) => {
          window.focus();
          tab.focus();
        },
        removeTab: (tab) => {
          if (tab.isDestroyed()) return;
          const window = BrowserWindow.fromWebContents(tab);
          // Extensions cannot close the Blackbird host window or unrelated tabs.
          if (window && profile.windows.has(window)) window.close();
        },
        createWindow: async (details) =>
          createWindow(
            session,
            (Array.isArray(details.url) ? details.url[0] : details.url) ?? "about:blank",
          ),
        removeWindow: (window) => {
          for (const owned of profile.windows) if (owned === window) owned.close();
        },
        requestPermissions: async () => false,
      });
      for (const [tab, owner] of profile.tabs) {
        if (!tab.isDestroyed() && !owner.isDestroyed()) profile.compatibility.addTab(tab, owner);
      }
    }
    return profile.compatibility;
  };

  const load = async (session: Session) => {
    const profile = profileFor(session);
    if (profile.enabled) return;
    await compatibilityFor(session);
    await loadOnePassword(session, NodePath.join(directoryFor(session), "extension"));
    profile.enabled = true;
    profile.error = undefined;
  };

  const prepare = (session: Session) =>
    Effect.promise(async () => {
      if (environment.platform !== "darwin" || !session.storagePath) return;
      const profile = profileFor(session);
      profile.loading ??= (async () => {
        const enabled = await NodeFSP.access(NodePath.join(directoryFor(session), "enabled")).then(
          () => true,
          () => false,
        );
        if (enabled) await load(session);
      })().catch((error: unknown) => {
        profile.error = error instanceof Error ? error.message : "1Password could not start.";
      });
      await profile.loading;
    });

  const enable = async (session: Session, owner: BrowserWindow) => {
    const directory = directoryFor(session);
    const extensionDirectory = NodePath.join(directory, "extension");
    const installed = await NodeFSP.access(NodePath.join(extensionDirectory, "manifest.json")).then(
      () => true,
      () => false,
    );
    if (!installed) {
      const source = await findOnePasswordExtension(roots);
      if (!source)
        throw new Error(
          "Install the official 1Password extension in Chrome, Arc, or another supported Chromium browser, then try again.",
        );
      const { response } = await runPromise(
        dialogs.showMessageBox(
          {
            type: "question",
            message: "Enable 1Password in this browser profile?",
            detail:
              "1Password can read and fill websites in this profile, including pages opened by agents. Only the extension code is copied; sign in separately here. Desktop-app unlocking is not available in this integration.",
            buttons: ["Enable 1Password", "Cancel"],
            defaultId: 1,
            cancelId: 1,
          },
          owner,
        ),
      );
      if (response !== 0) return;
      await NodeFSP.mkdir(directory, { recursive: true });
      const staging = await NodeFSP.mkdtemp(NodePath.join(directory, "install-"));
      try {
        await copyOnePasswordExtension(source.directory, NodePath.join(staging, "extension"));
        await NodeFSP.rename(NodePath.join(staging, "extension"), extensionDirectory);
      } finally {
        await NodeFSP.rm(staging, { recursive: true, force: true });
      }
    }
    await load(session);
    try {
      await NodeFSP.writeFile(NodePath.join(directory, "enabled"), "1", { mode: 0o600 });
    } catch (error) {
      session.extensions.removeExtension(ONE_PASSWORD_EXTENSION_ID);
      profileFor(session).enabled = false;
      throw error;
    }
    for (const tab of profileFor(session).tabs.keys()) {
      if (!tab.isDestroyed() && !isOnePasswordPage(tab.getURL())) tab.reload();
    }
    // The popup alone has no sign-in controls in a fresh extension profile.
    createWindow(session, `${ONE_PASSWORD_ORIGIN}/app/app.html#/page/welcome`, owner);
  };

  const disable = async (session: Session) => {
    const profile = profileFor(session);
    await NodeFSP.rm(NodePath.join(directoryFor(session), "enabled"), { force: true });
    session.extensions.removeExtension(ONE_PASSWORD_EXTENSION_ID);
    profile.enabled = false;
    profile.error = undefined;
    for (const window of profile.windows) if (!window.isDestroyed()) window.close();
    for (const tab of profile.tabs.keys()) if (!tab.isDestroyed()) tab.reload();
  };

  const perform = (session: Session, work: () => Promise<void>) =>
    Effect.suspend(() => {
      const profile = profileFor(session);
      if (profile.busy) return Effect.void;
      profile.busy = true;
      return Effect.tryPromise({
        try: work,
        catch: (cause) =>
          new OnePasswordError({
            message:
              cause instanceof Error
                ? cause.message
                : "1Password could not complete the operation.",
          }),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            profile.busy = false;
          }),
        ),
      );
    });
  const action = (session: Session, owner: BrowserWindow, work: () => Promise<void>) => () => {
    void runPromise(
      perform(session, work).pipe(
        Effect.catch((error) =>
          dialogs.showMessageBox(
            {
              type: "error",
              message: "1Password",
              detail: error.message,
              buttons: ["OK"],
            },
            owner,
          ),
        ),
      ),
    );
  };

  return OnePassword.of({
    prepare,
    enable: (session, owner) => perform(session, () => enable(session, owner)),
    disable: (session) => perform(session, () => disable(session)),
    track,
    isEnabled: (session) => profileFor(session).enabled,
    menuItems: (contents, owner) => {
      if (environment.platform !== "darwin") return [];
      const session = contents.session;
      const profile = profileFor(session);
      return [
        {
          label: "1Password",
          submenu: !session.storagePath
            ? [{ label: "Use a persistent profile to enable 1Password", enabled: false }]
            : profile.enabled
              ? [
                  {
                    label: "Open 1Password",
                    enabled: !profile.busy,
                    click: action(session, owner, async () => {
                      profile.compatibility?.selectTab(contents);
                      createWindow(
                        session,
                        `${ONE_PASSWORD_ORIGIN}/popup/index.html`,
                        owner,
                        false,
                      );
                    }),
                  },
                  {
                    label: "Set up 1Password…",
                    enabled: !profile.busy,
                    click: action(session, owner, async () => {
                      createWindow(
                        session,
                        `${ONE_PASSWORD_ORIGIN}/app/app.html#/page/welcome`,
                        owner,
                      );
                    }),
                  },
                  {
                    label: "Disable in this profile",
                    enabled: !profile.busy,
                    click: action(session, owner, () => disable(session)),
                  },
                ]
              : [
                  {
                    label: profile.error ? "Retry enabling 1Password…" : "Enable in this profile…",
                    enabled: !profile.busy,
                    click: action(session, owner, () => enable(session, owner)),
                  },
                ],
        },
      ];
    },
  });
});

export const layer = Layer.effect(OnePassword, make);
