// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { InboxSuggestionStatus, InboxSuggestionCallout } from "./InboxSuggestion";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows compact terminal outcomes and retries without activating the notification", async () => {
  const retry = vi.fn(),
    activate = vi.fn();
  await act(async () =>
    root.render(
      <article onClick={activate}>
        <InboxSuggestionStatus status="unavailable" onRetry={retry} />
      </article>,
    ),
  );
  expect(container.textContent).toContain("Unavailable");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Retry suggestion research"]')!
      .click(),
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(activate).not.toHaveBeenCalled();
  await act(async () => root.render(<InboxSuggestionStatus status="empty" />));
  expect(container.textContent).toContain("No suggestion");
  expect(container.querySelector("button")).toBeNull();
  await act(async () => root.render(<InboxSuggestionStatus status="ready" />));
  expect(container.textContent).toBe("");
});

it("changes research wording every three seconds without repeats, while announcing a stable accessible status", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<InboxSuggestionStatus status="researching" />));
  // The active phrase is the last leaf in the label; sizing copies are aria-hidden with the label.
  const phrase = () => container.querySelector("svg + span")?.lastElementChild?.textContent;
  const values = [phrase()];
  await act(async () => vi.advanceTimersByTime(2999));
  expect(phrase()).toBe(values[0]);
  await act(async () => vi.advanceTimersByTime(1));
  values.push(phrase());
  for (let index = 0; index < 8; index++) {
    await act(async () => vi.advanceTimersByTime(3000));
    values.push(phrase());
  }
  expect(new Set(values).size).toBe(10);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Researching suggestion");
});

it("pauses wording changes when the app is hidden and resumes when visible", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => root.render(<InboxSuggestionStatus status="researching" />));
  const phrase = () => container.querySelector("svg + span")?.lastElementChild?.textContent;
  const before = phrase();
  visibility.mockReturnValue("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTime(9000));
  expect(phrase()).toBe(before);
  visibility.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(phrase()).not.toBe(before);
});

it("retains disappearing suggestion text so a collapse can reverse before the next suggestion arrives", async () => {
  const body = (items: ReadonlyArray<string>) => <p>{items.join("\n")}</p>;
  await act(async () =>
    root.render(
      <InboxSuggestionCallout visible suggestions={["Review the report"]}>
        {body}
      </InboxSuggestionCallout>,
    ),
  );
  expect(container.querySelector('section[aria-label="Suggestion"]')?.textContent).toContain(
    "Review the report",
  );
  await act(async () =>
    root.render(
      <InboxSuggestionCallout visible={false} suggestions={[]}>
        {body}
      </InboxSuggestionCallout>,
    ),
  );
  const hidden = container.querySelector('[aria-hidden="true"]');
  expect(hidden?.textContent).toContain("Review the report");
  expect(hidden?.hasAttribute("inert")).toBe(true);
  await act(async () =>
    root.render(
      <InboxSuggestionCallout visible suggestions={["Check the updated report"]}>
        {body}
      </InboxSuggestionCallout>,
    ),
  );
  expect(container.querySelector('[aria-hidden="false"]')?.textContent).toContain(
    "Check the updated report",
  );
});
