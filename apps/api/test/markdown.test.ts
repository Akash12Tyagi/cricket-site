import { describe, expect, it } from "vitest";
import { renderArticle } from "../src/lib/markdown.js";

describe("article rendering is XSS-safe", () => {
  it("renders normal markdown", () => {
    expect(renderArticle("## Report\n\nA **great** knock, [scorecard](https://example.com).")).toBe(
      '<h2>Report</h2>\n<p>A <strong>great</strong> knock, <a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">scorecard</a>.</p>\n');
  });
  it.each([
    ["<script>alert(1)</script>", "alert(1)"],
    ['<img src="https://x.test/a.png" onerror="alert(1)">', "onerror"],
    ["[click](javascript:alert(1))", "javascript:"],
    ['<iframe src="https://evil.test"></iframe>', "iframe"],
    ['<a href="https://ok.test" style="position:fixed">x</a>', "style"],
    ["![x](http://insecure.test/a.png)", "http://insecure"],
    ["# Title", "<h1"],
  ])("strips %s", (input, forbidden) => {
    expect(renderArticle(input)).not.toContain(forbidden);
  });
});
