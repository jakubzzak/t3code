import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { filesSearchOptionsAtom } from "./filesSearchOptions.ts";

it("keeps temporary choices in one chat and resets in a new client session", () => {
  const session = AtomRegistry.make();
  const chat = filesSearchOptionsAtom("environment:chat-a");
  expect(session.get(chat)).toEqual({ includeIgnored: true, includeTests: false });
  const unmount = session.mount(chat);
  session.set(chat, { includeIgnored: false, includeTests: true });
  unmount();
  expect(session.get(chat)).toEqual({ includeIgnored: false, includeTests: true });
  expect(session.get(filesSearchOptionsAtom("environment:chat-b"))).toEqual({
    includeIgnored: true,
    includeTests: false,
  });
  const reloaded = AtomRegistry.make();
  expect(reloaded.get(chat)).toEqual({ includeIgnored: true, includeTests: false });
  session.dispose();
  reloaded.dispose();
});
