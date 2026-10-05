import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { patchLinearProjectEmails, resolveLinearProjectEmail } from "./linearProjectEmail";

const first = { environmentId: EnvironmentId.make("env-a"), projectId: ProjectId.make("one") };
const second = { ...first, projectId: ProjectId.make("two") };
const remote = { ...first, environmentId: EnvironmentId.make("env-b") };

describe("project login email", () => {
  it("isolates projects and environments and hides values without selection", () => {
    const emails = patchLinearProjectEmails(
      patchLinearProjectEmails({}, [first], "first@example.com"),
      [second],
      "second@example.com",
    );
    expect(resolveLinearProjectEmail(emails, [first]).value).toBe("first@example.com");
    expect(resolveLinearProjectEmail(emails, [second]).value).toBe("second@example.com");
    expect(resolveLinearProjectEmail(emails, [remote]).value).toBe("");
    expect(resolveLinearProjectEmail(emails, []).value).toBe("");
    expect(patchLinearProjectEmails(emails, [], "leak@example.com")).toEqual(emails);
  });
  it("can replace or clear the selected project without changing another", () => {
    const emails = patchLinearProjectEmails({}, [first, second], "work@example.com");
    const cleared = patchLinearProjectEmails(emails, [first], "");
    expect(resolveLinearProjectEmail(cleared, [first]).value).toBe("");
    expect(resolveLinearProjectEmail(cleared, [second]).value).toBe("work@example.com");
    expect(resolveLinearProjectEmail(cleared, [first, second])).toEqual({ value: "", mixed: true });
  });
});
