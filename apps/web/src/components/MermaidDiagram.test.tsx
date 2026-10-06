import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MermaidDiagram } from "./MermaidDiagram";

const render = vi.hoisted(() => vi.fn());
vi.mock("@t3tools/shared/mermaid", () => ({ renderMermaid: render }));

describe("Mermaid diagram preview", () => {
  beforeEach(() => {
    render.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  it("shows the completed diagram and ignores a superseded render", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let finishOld!: (svg: string) => void;
    render.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    );
    render.mockResolvedValueOnce("<svg>Current</svg>");
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <MermaidDiagram code="old" theme="light">
          <pre>Source</pre>
        </MermaidDiagram>,
      );
    });
    await act(async () => {
      view.update(
        <MermaidDiagram code="new" theme="light">
          <pre>Source</pre>
        </MermaidDiagram>,
      );
    });
    await act(async () => {
      finishOld("<svg>Old</svg>");
    });
    expect(view.root.findByProps({ role: "img" }).props.dangerouslySetInnerHTML.__html).toBe(
      "<svg>Current</svg>",
    );
    await act(async () => {
      view.unmount();
    });
  });

  it("keeps source readable on failure and lets the user retry", async () => {
    render.mockRejectedValueOnce(new Error("Invalid diagram"));
    render.mockResolvedValueOnce("<svg>Recovered</svg>");
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <MermaidDiagram code="graph LR; A-->B" theme="dark">
          <pre>Source</pre>
        </MermaidDiagram>,
      );
    });
    expect(view.root.findByType("pre").children).toEqual(["Source"]);
    expect(view.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "Could not render",
    );
    await act(async () => {
      view.root.findByProps({ "aria-label": "Retry diagram" }).props.onClick();
    });
    expect(view.root.findByProps({ role: "img" }).props.dangerouslySetInnerHTML.__html).toBe(
      "<svg>Recovered</svg>",
    );
    await act(async () => {
      view.unmount();
    });
  });
});
