import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { MermaidDiagram } from "./MermaidDiagram";

const renderMermaid = vi.hoisted(() => vi.fn());
vi.mock(import("@t3tools/shared/mermaid"), () => ({ renderMermaid }) as never);

describe("Mermaid diagram preview", () => {
  it("shows the completed diagram and ignores a superseded render", async () => {
    renderMermaid.mockReset();
    let finishOld!: (svg: string) => void;
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    );
    renderMermaid.mockResolvedValueOnce("<svg>Current</svg>");
    await using screen = await render(
      <MermaidDiagram code="old" theme="light">
        <pre>Source</pre>
      </MermaidDiagram>,
    );
    await screen.rerender(
      <MermaidDiagram code="new" theme="light">
        <pre>Source</pre>
      </MermaidDiagram>,
    );
    await act(() => finishOld("<svg>Old</svg>"));
    await expect
      .element(screen.getByRole("img", { name: "Mermaid diagram" }))
      .toHaveTextContent("Current");
    expect(screen.container.textContent).not.toContain("Old");
  });

  it("keeps source readable on failure and lets the user retry", async () => {
    renderMermaid.mockReset();
    renderMermaid.mockRejectedValueOnce(new Error("Invalid diagram"));
    renderMermaid.mockResolvedValueOnce("<svg>Recovered</svg>");
    await using screen = await render(
      <MermaidDiagram code="graph LR; A-->B" theme="dark">
        <pre>Source</pre>
      </MermaidDiagram>,
    );
    await expect
      .poll(() => screen.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Could not render");
    await expect.element(screen.getByText("Source")).toBeVisible();
    await screen.getByRole("button", { name: "Retry diagram" }).click();
    await expect
      .element(screen.getByRole("img", { name: "Mermaid diagram" }))
      .toHaveTextContent("Recovered");
  });
});
