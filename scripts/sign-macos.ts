import * as NodePath from "node:path";
import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

const hotspotEntitlements = NodePath.resolve(
  import.meta.dirname,
  "../native/hotspot/entitlements.plist",
);

/** Sign files with matching options together instead of spawning codesign for each file. */
export default async function sign(options: SignOptions): Promise<void> {
  const hotspotApp = NodePath.resolve(
    options.app,
    "Contents/Resources/hotspot/Blackbird Hotspot.app",
  );
  await signApplication({
    ...options,
    batchCodesignCalls: true,
    optionsForFile: (filePath) => {
      const original = options.optionsForFile?.(filePath) ?? {};
      const resolved = NodePath.resolve(filePath);
      if (resolved !== hotspotApp && !resolved.startsWith(`${hotspotApp}${NodePath.sep}`)) {
        return original;
      }
      // electron-builder otherwise applies Electron's inherited entitlements to
      // this native app, which omit the hardened-runtime Location permission.
      return { ...original, entitlements: hotspotEntitlements, hardenedRuntime: true };
    },
  });
}
