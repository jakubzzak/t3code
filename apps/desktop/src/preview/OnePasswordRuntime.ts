// @effect-diagnostics globalTimers:off - Bounded Electron event-listener lifetime, cleared in finally.
import type { Session, ServiceWorkersRunningStatusChangedEventParams } from "electron";
import { isOnePasswordPage, ONE_PASSWORD_EXTENSION_ID } from "./OnePasswordFiles.ts";

/** Package loading alone succeeds even when an extension's background script crashes. */
export async function loadOnePassword(session: Session, directory: string) {
  let stop = () => {};
  const running = new Promise<void>((resolve, reject) => {
    const changed = (details: ServiceWorkersRunningStatusChangedEventParams) => {
      if (details.runningStatus !== "running") return;
      const worker = session.serviceWorkers.getWorkerFromVersionID(details.versionId);
      if (worker && isOnePasswordPage(worker.scope)) resolve();
    };
    const timeout = setTimeout(
      () =>
        reject(
          new Error("1Password's background process did not start. Disable it and try again."),
        ),
      10_000,
    );
    session.serviceWorkers.on("running-status-changed", changed);
    stop = () => {
      clearTimeout(timeout);
      session.serviceWorkers.off("running-status-changed", changed);
    };
  });
  try {
    const loaded = session.extensions.loadExtension(directory).then((extension) => {
      if (extension.id !== ONE_PASSWORD_EXTENSION_ID) {
        session.extensions.removeExtension(extension.id);
        throw new Error("Unexpected 1Password extension identity.");
      }
    });
    await Promise.all([loaded, running]);
  } catch (error) {
    session.extensions.removeExtension(ONE_PASSWORD_EXTENSION_ID);
    throw error;
  } finally {
    stop();
  }
}
