import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createSectionEscapeHandler } from "./SectionEscape.ts";

const escape = {
  key: "Escape",
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};
afterEach(() => vi.useRealTimers());
describe("embedded browser focus release", () => {
  it("releases a focused input even when its page consumes Escape for suggestions", () => {
    const release = vi.fn();
    const key = createSectionEscapeHandler(release);
    const inputEscape = { ...escape, defaultPrevented: true, inputFocused: true };
    key(inputEscape);
    expect(release).not.toHaveBeenCalled();
    key(inputEscape);
    expect(release).toHaveBeenCalledOnce();
  });
  it("releases only on two unconsumed Escapes within 500ms", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const key = createSectionEscapeHandler(release);
    key(escape);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    key(escape);
    expect(release).toHaveBeenCalledOnce();
    key(escape);
    vi.advanceTimersByTime(501);
    key(escape);
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not count popup dismissal, modified Escape, intervening typing, or key repeat", () => {
    const release = vi.fn();
    const key = createSectionEscapeHandler(release);
    for (const interruption of [
      { defaultPrevented: true },
      { metaKey: true },
      { isComposing: true },
      { key: "a" },
    ]) {
      key(escape);
      key({ ...escape, ...interruption });
    }
    key(escape);
    key({ ...escape, repeat: true });
    expect(release).not.toHaveBeenCalled();
    key(escape);
    expect(release).toHaveBeenCalledOnce();
  });
});
