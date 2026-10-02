import { RegistryContext } from "@effect/atom-react";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, FilterIcon, SquareIcon } from "lucide-react";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { useFileFilterState, useFileFilterStore } from "~/fileFilterStore";
import { reviewEnvironment } from "~/state/review";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function FileFilterControl({
  scopeKey,
  environmentId,
  visibleCount,
  totalCount,
  hasMore = false,
}: {
  scopeKey: string;
  environmentId: EnvironmentId;
  visibleCount: number;
  totalCount: number;
  hasMore?: boolean;
}) {
  const state = useFileFilterState(scopeKey);
  const registry = useContext(RegistryContext);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const ownRequest = useRef<AbortController | null>(null);
  const regexId = useId();
  const messageId = useId();
  const active = state.appliedSource !== "";
  const busy = state.pending !== null;
  const count = `${visibleCount} of ${totalCount}${hasMore ? "+" : ""} files`;

  useEffect(
    () => () => {
      if (ownRequest.current) useFileFilterStore.getState().cancel(scopeKey, ownRequest.current);
    },
    [scopeKey],
  );

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    const store = useFileFilterStore.getState();
    const request = store.begin(scopeKey);
    ownRequest.current = request;
    const result = await executeAtomQuery(
      registry,
      reviewEnvironment.generateFileFilter({
        environmentId,
        input: { prompt: prompt.trim(), currentRegex: state.appliedSource },
      }),
      { signal: request.signal, reportFailure: false, reportDefect: false },
    );
    if (result._tag === "Success") {
      store.finish(scopeKey, request, result.value);
    } else if (!request.signal.aborted) {
      store.finish(scopeKey, request, { error: String(squashAtomCommandFailure(result)) });
    }
    if (ownRequest.current === request) ownRequest.current = null;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant={active ? "secondary" : "ghost"}
                  aria-label={active ? `Filter files (${count})` : "Filter files"}
                />
              }
            />
          }
        >
          <FilterIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {active ? `Filter files · ${count}` : "Filter files"}
        </TooltipPopup>
      </Tooltip>
      <DialogPopup bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Filter files</DialogTitle>
          <DialogDescription>Show filenames matching the regex.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-4">
          <label className="sr-only" htmlFor={regexId}>
            Filename regex
          </label>
          <Input
            id={regexId}
            font="mono"
            value={state.source}
            disabled={busy}
            maxLength={2000}
            aria-invalid={state.invalid}
            aria-describedby={state.message ? messageId : undefined}
            onChange={(event) => useFileFilterStore.getState().edit(scopeKey, event.target.value)}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{count}</span>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy || state.source === ""}
              onClick={() => useFileFilterStore.getState().edit(scopeKey, "")}
            >
              Clear filter
            </Button>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {busy || state.message ? (
              <p id={messageId} className="text-xs text-muted-foreground">
                {busy ? "Updating regex…" : state.message}
              </p>
            ) : null}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                aria-label="Describe which files to show"
                placeholder="Describe which files to show…"
                maxLength={4000}
                value={prompt}
                disabled={busy}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            {busy ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Stop generation"
                onClick={(event) => {
                  // Canceling turns this same button into a submit button before the click ends.
                  event.preventDefault();
                  if (state.pending) useFileFilterStore.getState().cancel(scopeKey, state.pending);
                }}
              >
                <SquareIcon className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                aria-label="Update regex"
                disabled={!prompt.trim()}
              >
                <ArrowUpIcon className="size-3.5" />
              </Button>
            )}
          </form>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
