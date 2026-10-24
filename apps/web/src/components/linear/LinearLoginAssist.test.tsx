// @vitest-environment jsdom
import * as NodeVM from "node:vm";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { LinearLoginSteps } from "./LinearLoginAssist";

const automation = vi.hoisted(() => ({ evaluate: vi.fn(), waitFor: vi.fn(async () => {}) }));
vi.mock("../preview/previewBridge", () => ({ previewBridge: { automation } }));
vi.mock("~/state/entities", () => ({ useThreadShell: () => null }));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => ({}) }));
vi.mock("~/cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
const panel = document.createElement("div");
document.body.append(container, panel);
let root = createRoot(container);
let url = "https://linear.app/login";
const connection = { workspace: "acme", connectionKey: '["env","project"]' };
const render = async (email = "t3@example.com") => {
  await act(async () =>
    root.render(
      <LinearLoginSteps
        runtimeTabId="tab"
        url={url}
        loading={false}
        email={email}
        connection={connection}
      />,
    ),
  );
};
function setup(connectedEmail: string | null) {
  panel.innerHTML =
    '<button>Continue with Google</button><input type="email"><button>Next</button>';
  automation.evaluate.mockImplementation(async (_tab: string, input: { expression: string }) =>
    NodeVM.runInNewContext(input.expression, {
      location: new URL(url),
      document,
      HTMLInputElement,
      Event,
    }),
  );
  Object.assign(window, {
    desktopBridge: {
      linearRequest: vi.fn(async () => ({
        configured: true,
        connection: connectedEmail
          ? { workspace: "acme", userId: "me", name: "Me", email: connectedEmail }
          : null,
      })),
    },
  });
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  panel.replaceChildren();
  url = "https://linear.app/login";
  vi.clearAllMocks();
  Object.assign(window, { desktopBridge: undefined });
});
it("fills the panel's Google login with the connected Linear email instead of the T3 email", async () => {
  setup("linear@example.com");
  await render();
  url = "https://accounts.google.com/v3/signin/identifier";
  await render();
  expect(panel.querySelector("input")?.value).toBe("linear@example.com");
});
it("falls back to the T3 email when there is no Linear connection", async () => {
  setup(null);
  await render();
  url = "https://accounts.google.com/v3/signin/identifier";
  await render();
  expect(panel.querySelector("input")?.value).toBe("t3@example.com");
});

vi.mock("./requestLinear", () => ({
  requestLinear: (input: unknown) => window.desktopBridge!.linearRequest!(input as never),
}));
