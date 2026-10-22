import { expect, it } from "vite-plus/test";
import { slackText } from "./slackText.ts";
it("decodes Slack links, labels, names, groups, broadcasts and dates without executing markup", () => {
  const input =
    "<@U123> <!subteam^S123> <https://example.com/report?a=1&amp;b=2|the report> <!here> <!date^123^{date_short}|22 Oct> &lt;literal&gt;";
  const result = slackText(input, { users: { U123: "Alex" }, groups: { S123: "support" } });
  expect(result).toContain("@Alex @support");
  expect(result).toContain("[the report](<https://example.com/report?a=1&b=2>)");
  expect(result).toContain("@here 22 Oct");
  expect(slackText("<https://example.com|report>", {}, "preview")).toBe("report");
});
it("retains formatting and literal code while blocking images, arbitrary HTML and executable links", () => {
  const text =
    '*Review <@U123|Alex>* _today_ ~old~ `<@U123>`\n```U123: literal```\n<img src="https://tracker.example/pixel"> [bad](javascript:alert(1)) ![image](https://tracker.example) <javascript:alert(1)|bad>';
  const value = slackText(text, { users: { U123: "Alex" } });
  expect(value).toContain("**Review @Alex** _today_ ~~old~~");
  expect(value).toContain("`<@U123>`");
  expect(value).toContain("```U123: literal```");
  expect(value).not.toContain("[bad](javascript:");
  expect(value).toContain("\\<img");
  expect(value).toContain("\\!\\[image\\]");
});
it("preserves unresolved identities and unknown angle-bracket text instead of dropping them", () => {
  expect(slackText("<@U123> <!subteam^S123|@team> <#C123|support>", {}, "preview")).toBe(
    "@U123 @team #support",
  );
  expect(slackText("<div>literal</div>", {}, "preview")).toBe("<div>literal</div>");
});
