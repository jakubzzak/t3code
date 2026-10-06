import { useEffect, useState, type ReactNode } from "react";
import { renderMermaid } from "@t3tools/shared/mermaid";
import { Button } from "./ui/button";

export function MermaidDiagram(props: {
  code: string;
  theme: "light" | "dark";
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    code: string;
    theme: string;
    attempt: number;
    svg?: string;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void renderMermaid(props.code, props.theme, controller.signal).then(
      (svg) => {
        if (!controller.signal.aborted)
          setResult({ code: props.code, theme: props.theme, attempt, svg });
      },
      () => {
        if (!controller.signal.aborted)
          setResult({ code: props.code, theme: props.theme, attempt, failed: true });
      },
    );
    return () => controller.abort();
  }, [props.code, props.theme, attempt]);
  const current =
    result?.code === props.code && result.theme === props.theme && result.attempt === attempt
      ? result
      : null;
  if (current?.svg) {
    return (
      <div
        role="img"
        aria-label="Mermaid diagram"
        className="overflow-auto p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: current.svg }}
      />
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span role={current?.failed ? "alert" : "status"}>
          {current?.failed
            ? "Could not render this diagram. Its source is shown below."
            : "Rendering diagram…"}
        </span>
        {current?.failed ? (
          <Button
            size="xs"
            variant="ghost"
            aria-label="Retry diagram"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </Button>
        ) : null}
      </div>
      {props.children}
    </>
  );
}
