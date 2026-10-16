import { describe, expect, it } from "vite-plus/test";
import { pullRequestPreviews } from "./pullRequestPreviews.logic";

const checkout = "https://prod-2570-one.checkout.staging.jurata.ch";
const otherCheckout = "https://prod-2570-two.checkout.staging.jurata.ch";
const backstage = "https://prod-2570-one.backstage.staging.jurata.ch";

describe("pullRequestPreviews", () => {
  it("finds deployment comments whose Markdown link text is the destination URL", () => {
    const cockpit = "https://prod-2570-one.cockpit.staging.jurata.ch";
    const urls = [checkout, backstage, cockpit, otherCheckout];
    const body = [
      "## Preview Deployment",
      "Here is a preview of this PR:",
      ...urls.map((url) => `**Preview URL:** [${url}](${url})`),
    ].join("\n\n");

    expect(pullRequestPreviews([{ body }])).toEqual([
      { url: checkout, label: "checkout.staging.jurata.ch", ambiguous: true },
      { url: backstage, label: "backstage.staging.jurata.ch", ambiguous: false },
      { url: cockpit, label: "cockpit.staging.jurata.ch", ambiguous: false },
      { url: otherCheckout, label: "checkout.staging.jurata.ch", ambiguous: true },
    ]);
  });

  it("finds plain, Markdown and autolink destinations across comments regardless of headings", () => {
    expect(
      pullRequestPreviews([
        { body: `Unrelated heading\nPreview URL: ${checkout}.` },
        { body: `[Backstage](${backstage}/review?mode=preview#details) and <${otherCheckout}>` },
      ]),
    ).toEqual([
      { url: checkout, label: "checkout.staging.jurata.ch", ambiguous: true },
      {
        url: `${backstage}/review?mode=preview#details`,
        label: "backstage.staging.jurata.ch",
        ambiguous: false,
      },
      { url: otherCheckout, label: "checkout.staging.jurata.ch", ambiguous: true },
    ]);
  });

  it("deduplicates full URLs, keeps collisions and recalculates them after comment edits", () => {
    const comments = [{ body: `${checkout} ${checkout}` }, { body: otherCheckout }];
    expect(pullRequestPreviews(comments).map(({ url, ambiguous }) => ({ url, ambiguous }))).toEqual(
      [
        { url: checkout, ambiguous: true },
        { url: otherCheckout, ambiguous: true },
      ],
    );
    expect(pullRequestPreviews(comments.slice(0, 1))).toEqual([
      { url: checkout, label: "checkout.staging.jurata.ch", ambiguous: false },
    ]);
    expect(pullRequestPreviews([])).toEqual([]);
  });

  it("ignores unrelated, malformed, insecure and lookalike hosts", () => {
    expect(
      pullRequestPreviews([
        {
          body: [
            "https://example.com",
            "http://prod.checkout.staging.jurata.ch",
            "https://checkout.staging.jurata.ch",
            "https://a.b.checkout.staging.jurata.ch",
            "https://prod.checkout.staging.jurata.ch.example.com",
            "https://-prod.checkout.staging.jurata.ch",
            "https://prod.check_out.staging.jurata.ch",
            "https://user:password@prod.checkout.staging.jurata.ch",
          ].join(" "),
        },
      ]),
    ).toEqual([]);
  });

  it("keeps balanced parentheses in paths and excludes surrounding prose punctuation", () => {
    expect(
      pullRequestPreviews([
        { body: `(${checkout}/view(item)). [Review](${backstage}/a(b)?x=1#part),` },
      ]).map((p) => p.url),
    ).toEqual([`${checkout}/view(item)`, `${backstage}/a(b)?x=1#part`]);
  });

  it("preserves URL paths, bracketed query parameters and fragments in URL-labelled links", () => {
    const url = `${checkout}/view(item)?filter[]=active#details`;
    expect(pullRequestPreviews([{ body: `**Preview URL:** [${url}](${url}).` }])).toEqual([
      { url, label: "checkout.staging.jurata.ch", ambiguous: false },
    ]);
  });
});
