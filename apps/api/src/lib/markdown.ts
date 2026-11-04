import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Markdown → HTML → strict allow-list sanitising (plan §5.3). Runs on the server at save time, so
 * browsers only ever receive vetted HTML: no scripts, event handlers, iframes, styles or javascript: URLs.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "h4", "p", "br", "hr", "strong", "em", "blockquote", "ul", "ol", "li", "a", "img", "code", "pre", "table", "thead", "tbody", "tr", "th", "td"],
  allowedAttributes: { a: ["href", "title", "rel", "target"], img: ["src", "alt", "title", "width", "height", "loading"] },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer nofollow", ...(attribs.href?.startsWith("/") ? {} : { target: "_blank" }) } }),
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    h1: "h2", // the page title is the only h1
  },
};

export function renderArticle(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return sanitizeHtml(html, OPTIONS);
}
