import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { InboxSuggestionStatus, InboxSuggestionCallout } from "./InboxSuggestion";

const container = document.createElement("div");
const mount = (ui: ReactNode) => render(ui, { container, router: false });

it("shows compact terminal outcomes and retries without activating the notification", async () => {
  const retry = vi.fn(),
    activate = vi.fn();
  await using screen = await mount(
    <article onClick={activate}>
      <InboxSuggestionStatus status="unavailable" onRetry={retry} />
    </article>,
  );
  expect(container.textContent).toContain("Unavailable");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Retry suggestion research"]')!
      .click(),
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(activate).not.toHaveBeenCalled();
  await screen.rerender(<InboxSuggestionStatus status="empty" />);
  expect(container.textContent).toContain("No suggestion");
  expect(container.querySelector("button")).toBeNull();
  await screen.rerender(<InboxSuggestionStatus status="ready" />);
  expect(container.textContent).toBe("");
});

it("changes research wording every three seconds without repeats, while announcing a stable accessible status", async () => {
  using _timers = fakeTimers();
  await using _screen = await mount(<InboxSuggestionStatus status="researching" />);
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
  using _timers = fakeTimers();
  using visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await using _screen = await mount(<InboxSuggestionStatus status="researching" />);
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
  await using screen = await mount(
    <InboxSuggestionCallout visible suggestions={["Review the report"]}>
      {body}
    </InboxSuggestionCallout>,
  );
  expect(container.querySelector('section[aria-label="Suggestion"]')?.textContent).toContain(
    "Review the report",
  );
  await screen.rerender(
    <InboxSuggestionCallout visible={false} suggestions={[]}>
      {body}
    </InboxSuggestionCallout>,
  );
  const hidden = container.querySelector('[aria-hidden="true"]');
  expect(hidden?.textContent).toContain("Review the report");
  expect(hidden?.hasAttribute("inert")).toBe(true);
  await screen.rerender(
    <InboxSuggestionCallout visible suggestions={["Check the updated report"]}>
      {body}
    </InboxSuggestionCallout>,
  );
  expect(container.querySelector('[aria-hidden="false"]')?.textContent).toContain(
    "Check the updated report",
  );
});
