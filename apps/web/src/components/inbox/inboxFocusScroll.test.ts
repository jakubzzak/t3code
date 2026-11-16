import { expect, it } from "vite-plus/test";
import { inboxFocusScrollDelta } from "./inboxFocusScroll";

it("scrolls to a short notification below the viewport after the preceding tall card collapses", () => {
  expect(inboxFocusScrollDelta(450, 530, 0, 300)).toBe(442);
});
it("keeps the header of a tall notification visible rather than scrolling to its bottom", () => {
  expect(inboxFocusScrollDelta(400, 1000, 0, 300)).toBe(392);
  expect(inboxFocusScrollDelta(-180, 500, 0, 300)).toBe(-188);
});
it("does not move an already visible notification", () => {
  expect(inboxFocusScrollDelta(12, 240, 0, 300)).toBe(0);
});
