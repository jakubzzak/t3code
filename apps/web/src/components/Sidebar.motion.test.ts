import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createSidebarListMotion } from "./Sidebar.motion";

class TestAnimation {
  progress: number | null = 0;
  playState: AnimationPlayState = "running";
  effect = { getComputedTiming: () => ({ progress: this.progress }) };
  cancel = vi.fn(() => {
    this.playState = "idle";
  });
  private onFinish: (() => void) | undefined;
  addEventListener(_type: string, listener: () => void) {
    this.onFinish = listener;
  }
  finish() {
    this.playState = "finished";
    this.onFinish?.();
  }
}

class TestRow {
  offsetTop = 0;
  offsetLeft = 4;
  offsetWidth = 260;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  dragTranslate = 0;
  style: Record<string, string> = {};
  inert = false;
  attributes: { name: string; value: string }[] = [];
  children: TestRow[] = [];
  clones: TestRow[] = [];
  remove = vi.fn();
  animations: TestAnimation[] = [];
  constructor(
    readonly name: string,
    public offsetHeight = 82,
  ) {}
  getBoundingClientRect() {
    return { top: this.offsetTop + this.dragTranslate, height: this.offsetHeight };
  }
  setAttribute(name: string, value: string) {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }
  querySelectorAll(_selector: string): TestRow[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  }
  cloneNode(_deep: boolean): TestRow {
    const clone = new TestRow(`${this.name} clone`, this.offsetHeight);
    clone.namespaceURI = this.namespaceURI;
    clone.style = { ...this.style };
    clone.attributes = this.attributes.map((attribute) => ({ ...attribute }));
    clone.children = this.children.map((child) => child.cloneNode(true));
    this.clones.push(clone);
    return clone;
  }
  animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = new TestAnimation();
    this.animations.push(animation);
    return animation;
  });
}

function fixture(rows: TestRow[]) {
  const media = { matches: false };
  const parent = {
    offsetTop: 0,
    children: rows,
    ownerDocument: { defaultView: { matchMedia: () => media } },
    getBoundingClientRect: () => ({ top: 0 }),
    getClientRects: () => [{}],
    append(node: TestRow) {
      parent.children.push(node);
      node.remove.mockImplementation(() => {
        parent.children = parent.children.filter((child) => child !== node);
      });
    },
  };
  function layout(next: TestRow[]) {
    let top = 8;
    for (const row of next) {
      row.offsetTop = top;
      top += row.offsetHeight + 1;
    }
    parent.children = [
      ...next,
      ...parent.children.filter((row) => row.style.position === "absolute"),
    ];
  }
  layout(rows);
  const motion = createSidebarListMotion(parent as unknown as HTMLElement);
  return { motion, layout, media, parent };
}

beforeEach(() => vi.stubGlobal("HTMLElement", TestRow));
afterEach(() => vi.unstubAllGlobals());

// Upstream pruned this suite; these cover only the Blackbird inbox shelf behavior.
describe("sidebar list motion", () => {
  it("keeps bottom-anchored rows still when their container moves into the removed row's space", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(true);
    parent.offsetTop = 83;
    layout([b]);
    motion.update(true);
    expect(b.animate).not.toHaveBeenCalled();
    expect(a.clones[0]?.style.top).toBe("-75px");
  });

  it("strips inbox row identity from a fading clone", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    a.setAttribute("data-thread-item", "a");
    a.setAttribute("data-inbox-row", "env:a");
    const { motion, layout } = fixture([a, b]);
    motion.update(true);
    layout([b]);
    motion.update(true);
    expect(a.clones[0]!.attributes).toEqual([{ name: "aria-hidden", value: "true" }]);
  });
});
