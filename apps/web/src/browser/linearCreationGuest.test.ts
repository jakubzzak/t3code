// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://linear.app/acme/my-issues"}
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { installLinearCreationGuest } from "./linearCreationGuest";

const id = "11111111-1111-4111-8111-111111111111";
const host = window as Window & {
  __t3LinearCreation?: { result: { status: string; issueId?: string }; cancel: () => void };
};
let requests: FakeXHR[];
class FakeXHR extends EventTarget {
  status = 200;
  responseType = "";
  responseText = JSON.stringify({ data: { o1: { lastSyncId: 123 } } });
  open() {}
  send() {
    requests.push(this);
  }
}
beforeEach(() => {
  requests = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  document.body.innerHTML = '<button aria-label="Create new issue"></button>';
});
afterEach(() => {
  host.__t3LinearCreation?.cancel();
  delete host.__t3LinearCreation;
  vi.unstubAllGlobals();
});
async function editor() {
  installLinearCreationGuest("token", "acme");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.innerHTML = '<form><div aria-label="Issue title">New work</div></form>';
  document.body.append(dialog);
  await Promise.resolve();
  return dialog;
}
function request(
  title = "New work",
  query = "mutation Create($input: IssueCreateInput!) { o1:issueCreate(input: $input) { lastSyncId } }",
) {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://client-api.linear.app/graphql");
  xhr.send(JSON.stringify({ query, variables: { input: { id, title } } }));
  return requests.at(-1)!;
}
it("only completes after the submitted editor's matching mutation succeeds", async () => {
  const dialog = await editor();
  request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  request("Other work").dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  const xhr = request();
  dialog.remove();
  await Promise.resolve();
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  xhr.dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});
it("disarms after cancellation and ignores later issue creation", async () => {
  const dialog = await editor();
  dialog.remove();
  await Promise.resolve();
  request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("cancelled");
});
it("does not accept a GraphQL failure or an unrelated mutation", async () => {
  const dialog = await editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  request(
    "New work",
    "mutation Update($input: IssueUpdateInput!) { issueUpdate(input: $input) { lastSyncId } }",
  ).dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  const xhr = request();
  xhr.responseText = JSON.stringify({ errors: [{ message: "failed" }] });
  xhr.dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("error");
});
it("refuses to capture an existing editor or a different workspace", async () => {
  await editor();
  expect(() => installLinearCreationGuest("other", "acme")).toThrow("Finish or cancel");
  expect(() => installLinearCreationGuest("other", "different")).toThrow("workspace");
});

it("accepts Linear's live Blob response format and keeps the exact UUID", async () => {
  const dialog = await editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  const xhr = request();
  xhr.responseType = "blob";
  const blob = class {
    async text() {
      return xhr.responseText;
    }
  };
  vi.stubGlobal("Blob", blob);
  Object.defineProperty(xhr, "response", { value: new blob(), configurable: true });
  xhr.dispatchEvent(new Event("load"));
  await Promise.resolve();
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});

it("cancels a dismissed editor even after a submission that never sent a mutation", async () => {
  const dialog = await editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  dialog.remove();
  await Promise.resolve();
  request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("cancelled");
});

it("correlates keyboard submission from the creation editor", async () => {
  const dialog = await editor();
  dialog
    .querySelector('[aria-label="Issue title"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
  request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});
