import type { FilesSearchOptions } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

/** Session-only view state: survives closing Files, never written to storage. */
export const filesSearchOptionsAtom = Atom.family((_chatKey: string) =>
  Atom.make<FilesSearchOptions>({ includeIgnored: false, includeTests: false }).pipe(
    Atom.keepAlive,
  ),
);
