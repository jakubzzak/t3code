import { useEffect, useRef, useState } from "react";
import type { DesktopPreviewBridge, DesktopPreviewFindResult } from "@t3tools/contracts";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/** Search belongs to this mounted page; unmounting cancels it and clears highlights. */
export function PreviewFindBar({
  tabId,
  bridge,
  focusNonce,
  onClose,
}: {
  tabId: string;
  bridge: Pick<DesktopPreviewBridge, "findInPage" | "stopFindInPage">;
  focusNonce: number;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DesktopPreviewFindResult | null>(null);
  const [error, setError] = useState(false);
  const search = (text: string, forward = true, findNext = false) => {
    const request = ++generation.current;
    setError(false);
    setResult(null);
    void bridge.findInPage(tabId, text, { forward, findNext }).then(
      (next) => {
        if (request === generation.current) setResult(next);
      },
      () => {
        if (request === generation.current) setError(true);
      },
    );
  };
  useEffect(() => {
    if (focusNonce === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);
  useEffect(
    () => () => {
      generation.current += 1;
      void bridge.stopFindInPage(tabId).catch(() => undefined);
    },
    [bridge, tabId],
  );
  const status = error
    ? "Unable to search page"
    : !query
      ? ""
      : result
        ? result.matches === 0
          ? "No matches"
          : `${result.activeMatchOrdinal} of ${result.matches}`
        : "Searching…";
  return (
    <div
      role="search"
      aria-label="Find in page"
      className="flex items-center gap-1 border-b border-border px-2 py-1.5"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          ref={inputRef}
          size="compact"
          aria-label="Find in page"
          placeholder="Find in page"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            search(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            if (query) search(query, !event.shiftKey, true);
          }}
        />
      </div>
      <span role="status" className="shrink-0 text-xs text-muted-foreground">
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={!query}
        onClick={() => search(query, false, true)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={!query}
        onClick={() => search(query, true, true)}
      >
        <ArrowDown />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close Find" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
