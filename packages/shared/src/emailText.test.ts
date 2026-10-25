import { describe, expect, it } from "vite-plus/test";
import { emailText } from "./emailText.ts";

describe("email text", () => {
  it("extracts the request from Superhuman HTML, excluding tracking and hidden content", () => {
    const html = `<html><head><style>.x { color:red }</style><title>Tracking</title></head><body>
      <div>Hey there, can I have the security report about PHP from you by EOD?</div>
      <div><br></div><div>LG</div><div>Jakub</div>
      <div class="gmail_signature">Sent via <a href="https://superhuman.com">Superhuman</a></div>
      <div style="display: none"><img src="https://tracking.example/pixel.gif">Hidden tracking text</div>
      <script>alert('bad')</script><!-- internal -->
    </body></html>`;
    expect(emailText(html)).toBe(
      "Hey there, can I have the security report about PHP from you by EOD?\n\nLG\nJakub\nSent via Superhuman (https://superhuman.com)",
    );
  });
  it("preserves paragraphs, lists, table cells, links, entities and escaped code", () => {
    expect(
      emailText(
        '<p>Review R&amp;D&#39;s &lt;script&gt; example&nbsp;today.</p><ul><li>Build</li><li>Send <a href="https://example.test/report?a=1&amp;b=2">report</a></li></ul><table><tr><td>Status</td><td>Ready</td></tr></table>',
      ),
    ).toBe(
      "Review R&D's <script> example today.\n\n• Build\n• Send report (https://example.test/report?a=1&b=2)\n\nStatus\tReady",
    );
  });
  it("handles malformed email and removes active, hidden and image content", () => {
    expect(
      emailText(
        '<div>Request <b>today</div><iframe src="https://example.test">frame</iframe><div hidden>hidden</div><p aria-hidden="true">secret</p><p style="visibility: hidden !important">hidden too</p><img onerror="bad()" src="https://example.test/pixel"><a href="javascript:bad()">read this</a>',
      ),
    ).toBe("Request today\nread this");
  });
  it("keeps plain text and literal angle brackets intact, and is idempotent", () => {
    const plain = "Email <person@example.test>\nUse x < 5 and List<T>.\n\n  Keep indentation.";
    expect(emailText(plain)).toBe(plain);
    const decoded = emailText("<p>Use &lt;script&gt; as an example, not executable markup.</p>");
    expect(emailText(decoded)).toBe(decoded);
  });
});
