import type { FilesSearchOptions } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

/** Last Files query for this environment/chat, retained while the client is running. */
export const filesSearchQueryAtom = Atom.family((_chatKey: string) =>
  Atom.make("").pipe(Atom.keepAlive),
);

/** Session-only view state: survives closing Files, never written to storage. */
export const filesSearchOptionsAtom = Atom.family((_chatKey: string) =>
  Atom.make<FilesSearchOptions>({ includeIgnored: true, includeTests: false }).pipe(Atom.keepAlive),
);
