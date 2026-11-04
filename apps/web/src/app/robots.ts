import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/internal/", "/login", "/admin", "/account", "/search"] }],
    sitemap: `${process.env.SITE_URL ?? "http://localhost:3100"}/sitemap.xml`,
  };
}
