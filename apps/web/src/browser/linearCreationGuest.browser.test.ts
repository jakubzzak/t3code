import { expect, it } from "vite-plus/test";

import { stubGlobal } from "../../test/render";
import { installLinearCreationGuest } from "./linearCreationGuest";

const id = "11111111-1111-4111-8111-111111111111";
const host = window as Window & {
  __t3LinearCreation?: { result: { status: string; issueId?: string }; cancel: () => void };
};
const linearLocation = new URL("https://linear.app/acme/my-issues");

/**
 * Production injects the guest's source into Linear's page. The test page cannot take Linear's
 * origin, so the same source runs here with only `location` replaced.
 */
function install(token: string, workspace: string) {
  const guest = new Function(
    "location",
    `return (${installLinearCreationGuest.toString()})(${JSON.stringify(token)}, ${JSON.stringify(workspace)});`,
  );
  return guest(linearLocation) as unknown;
}

/** Mounts Linear's create button and a fake XHR; dispose cancels the guest and removes both. */
function setup() {
  using stack = new DisposableStack();
  const requests: FakeXHR[] = [];
  class FakeXHR extends EventTarget {
    status = 200;
    responseType = "";
    responseText = JSON.stringify({ data: { o1: { lastSyncId: 123 } } });
    open() {}
    send() {
      requests.push(this);
    }
  }
  // The guest patches the prototype of whichever XMLHttpRequest is global, so it only touches FakeXHR.
  stack.use(stubGlobal("XMLHttpRequest", FakeXHR));
  const root = stack.adopt(document.createElement("div"), (node) => node.remove());
  root.innerHTML = '<button aria-label="Create new issue"></button>';
  document.body.append(root);
  stack.defer(() => {
    host.__t3LinearCreation?.cancel();
    delete host.__t3LinearCreation;
  });
  async function editor() {
    install("token", "acme");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = '<form><div aria-label="Issue title">New work</div></form>';
    root.append(dialog);
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
  const resources = stack.move();
  return { editor, request, [Symbol.dispose]: () => resources.dispose() };
}

it("only completes after the submitted editor's matching mutation succeeds", async () => {
  using t = setup();
  const dialog = await t.editor();
  t.request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  t.request("Other work").dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  const xhr = t.request();
  dialog.remove();
  await Promise.resolve();
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  xhr.dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});
it("disarms after cancellation and ignores later issue creation", async () => {
  using t = setup();
  const dialog = await t.editor();
  dialog.remove();
  await Promise.resolve();
  t.request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("cancelled");
});
it("does not accept a GraphQL failure or an unrelated mutation", async () => {
  using t = setup();
  const dialog = await t.editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  t.request(
    "New work",
    "mutation Update($input: IssueUpdateInput!) { issueUpdate(input: $input) { lastSyncId } }",
  ).dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("pending");
  const xhr = t.request();
  xhr.responseText = JSON.stringify({ errors: [{ message: "failed" }] });
  xhr.dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("error");
});
it("refuses to capture an existing editor or a different workspace", async () => {
  using t = setup();
  await t.editor();
  expect(() => install("other", "acme")).toThrow("Finish or cancel");
  expect(() => install("other", "different")).toThrow("workspace");
});

it("accepts Linear's live Blob response format and keeps the exact UUID", async () => {
  using t = setup();
  const dialog = await t.editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  const xhr = t.request();
  xhr.responseType = "blob";
  const blob = class {
    async text() {
      return xhr.responseText;
    }
  };
  using _blob = stubGlobal("Blob", blob);
  Object.defineProperty(xhr, "response", { value: new blob(), configurable: true });
  xhr.dispatchEvent(new Event("load"));
  await Promise.resolve();
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});

it("cancels a dismissed editor even after a submission that never sent a mutation", async () => {
  using t = setup();
  const dialog = await t.editor();
  dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  dialog.remove();
  await Promise.resolve();
  t.request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result.status).toBe("cancelled");
});

it("correlates keyboard submission from the creation editor", async () => {
  using t = setup();
  const dialog = await t.editor();
  dialog
    .querySelector('[aria-label="Issue title"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
  t.request().dispatchEvent(new Event("load"));
  expect(host.__t3LinearCreation?.result).toEqual({ status: "created", issueId: id });
});
