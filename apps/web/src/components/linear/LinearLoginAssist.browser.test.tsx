import type { LinearDesktopRequest, LinearDesktopResult } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { LinearLoginSteps } from "./LinearLoginAssist";

const io = vi.hoisted(() => ({
  automation: {
    evaluate: vi.fn<(tabId: string, input: { expression: string }) => Promise<unknown>>(),
    waitFor: vi.fn(async () => {}),
  },
  linearRequest: vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(),
}));
vi.mock("../preview/previewBridge", () => ({ previewBridge: { automation: io.automation } }));
vi.mock("./requestLinear", () => ({
  requestLinear: (input: LinearDesktopRequest) => io.linearRequest(input),
}));
vi.mock("~/state/entities", () => ({ useThreadShell: () => null }));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => ({}) }));
vi.mock("~/cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));

const connection = { workspace: "acme", connectionKey: '["env","project"]' };
const loginUrl = "https://linear.app/login";
const googleUrl = "https://accounts.google.com/v3/signin/identifier";

// Stands in for the guest page the automation bridge drives: a login form in its own panel,
// evaluated against the page's URL instead of the test runner's.
function setup(connectedEmail: string | null) {
  using stack = new DisposableStack();
  const panel = document.createElement("div");
  panel.innerHTML =
    '<button>Continue with Google</button><input type="email"><button>Next</button>';
  document.body.append(panel);
  stack.defer(() => panel.remove());
  let url = loginUrl;
  io.automation.waitFor.mockClear();
  // Runs the bridge's guest script with `location` bound to the fake page's URL.
  io.automation.evaluate
    .mockReset()
    .mockImplementation(async (_tab, input) =>
      new Function("location", `return ${input.expression};`)(new URL(url)),
    );
  io.linearRequest.mockReset().mockResolvedValue({
    configured: true,
    connection: connectedEmail
      ? { workspace: "acme", userId: "me", name: "Me", email: connectedEmail }
      : null,
  } as LinearDesktopResult);
  const disposables = stack.move();
  return {
    input: panel.querySelector("input")!,
    steps: (next: string) => {
      url = next;
      return (
        <LinearLoginSteps
          runtimeTabId="tab"
          url={next}
          loading={false}
          email="t3@example.com"
          connection={connection}
        />
      );
    },
    [Symbol.dispose]: () => disposables.dispose(),
  };
}

it("fills the panel's Google login with the connected Linear email instead of the T3 email", async () => {
  using page = setup("linear@example.com");
  await using screen = await render(page.steps(loginUrl));
  await screen.rerender(page.steps(googleUrl));
  await vi.waitFor(() => expect(page.input.value).toBe("linear@example.com"));
});

it("falls back to the T3 email when there is no Linear connection", async () => {
  using page = setup(null);
  await using screen = await render(page.steps(loginUrl));
  await screen.rerender(page.steps(googleUrl));
  await vi.waitFor(() => expect(page.input.value).toBe("t3@example.com"));
});
