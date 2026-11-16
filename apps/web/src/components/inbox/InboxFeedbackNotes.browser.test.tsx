import { StrictMode } from "react";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";

const state = vi.hoisted(() => ({ command: vi.fn(), canWrite: true }));
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: (() => state.canWrite) as never,
}));
vi.mock("~/state/inbox", () => ({
  inboxEnvironment: { mutate: { permissionAtom: () => null } },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
import { InboxFeedbackNotes } from "./InboxFeedbackNotes";

const environmentId = EnvironmentId.make("notes-environment");
const notification = {
  id: "one",
  projectId: ProjectId.make("notes-project"),
  revision: 7,
  confirmedOutcome: "Existing note",
};
const container = document.createElement("div");
const onSaved = vi.fn();
function setup() {
  const timers = fakeTimers();
  state.canWrite = true;
  state.command
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ notification: { revision: 8 } }));
  onSaved.mockReset();
  return timers;
}
function view(note = notification) {
  return (
    <StrictMode>
      <InboxFeedbackNotes
        key={note.id}
        environmentId={environmentId}
        notification={note}
        onSaved={onSaved}
      />
    </StrictMode>
  );
}
async function type(text: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function advance(ms = 500) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

it("autosaves the latest edit after a typing pause and allows clearing a note", async () => {
  using _timers = setup();
  await using _screen = await render(view(), { container, router: false });
  await type("first");
  await advance(300);
  await type("latest feedback");
  await advance(499);
  expect(state.command).not.toHaveBeenCalled();
  await advance(1);
  expect(state.command).toHaveBeenCalledOnce();
  expect(state.command.mock.calls[0]![0].input).toMatchObject({
    id: "one",
    expectedRevision: 7,
    action: { type: "outcome", text: "latest feedback" },
  });
  expect(onSaved).toHaveBeenCalledOnce();
  expect(container.querySelector("button")).toBeNull();
  await type("");
  await advance();
  expect(state.command.mock.calls[1]![0].input).toMatchObject({
    expectedRevision: 8,
    action: { type: "outcome", text: "" },
  });
});

it("serializes changes made during a save using the acknowledged revision", async () => {
  using _timers = setup();
  let complete!: () => void;
  state.command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () => resolve(AsyncResult.success({ notification: { revision: 12 } }));
      }),
  );
  await using _screen = await render(view(), { container, router: false });
  await type("first");
  await advance();
  await type("second");
  await advance();
  expect(state.command).toHaveBeenCalledOnce();
  await act(async () => complete());
  await advance(0);
  expect(state.command).toHaveBeenCalledTimes(2);
  expect(state.command.mock.calls[1]![0].input).toMatchObject({
    expectedRevision: 12,
    action: { type: "outcome", text: "second" },
  });
});

it("flushes when switching notifications without leaking the old draft", async () => {
  using _timers = setup();
  await using screen = await render(view(), { container, router: false });
  await type("unfinished typing");
  await screen.rerender(view({ ...notification, id: "two", confirmedOutcome: "Different note" }));
  expect(state.command).toHaveBeenCalledOnce();
  expect(state.command.mock.calls[0]![0].input).toMatchObject({
    id: "one",
    action: { type: "outcome", text: "unfinished typing" },
  });
  expect(container.querySelector("textarea")!.value).toBe("Different note");
  await advance();
  expect(state.command).toHaveBeenCalledOnce();
});

it("keeps failed edits visible with retry and respects read-only permissions", async () => {
  using _timers = setup();
  state.command.mockResolvedValueOnce(AsyncResult.failure(Cause.fail("conflict")));
  await using screen = await render(view(), { container, router: false });
  await type("Retain my feedback");
  await advance();
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("Couldn’t save notes");
  expect(container.querySelector("textarea")!.value).toBe("Retain my feedback");
  expect(onSaved).not.toHaveBeenCalled();
  await screen.rerender(view({ ...notification, revision: 10 }));
  await act(async () => container.querySelector("button")!.click());
  await advance();
  expect(state.command.mock.calls[1]![0].input.expectedRevision).toBe(10);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  state.canWrite = false;
  await screen.rerender(view());
  expect(container.querySelector("textarea")!.readOnly).toBe(true);
});
