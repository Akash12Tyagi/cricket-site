import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  WEB_ORIGIN: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  /**
   * Proxy hops whose X-Forwarded-For entries are trusted. Default 0: forwarded headers are ignored, because
   * the Next.js proxy passes a client-supplied X-Forwarded-For through unchanged (spoofable; found in the
   * security probe). Only raise this when every hop in front of the API overwrites/appends it.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  /**
   * Header set by the CDN with the real visitor IP (e.g. "cf-connecting-ip" on Cloudflare). Only safe when the
   * origin accepts traffic from the CDN alone (firewall allow-list), so clients can't send it directly.
   */
  CLIENT_IP_HEADER: z.string().regex(/^[a-z0-9-]+$/).optional(),
  /** Where the API can reach the Next.js server privately, for on-demand page refresh (optional). */
  WEB_INTERNAL_URL: z.url().optional(),
  REVALIDATE_SECRET: z.string().min(32).optional(),
  /**
   * Live video: hosts we may play from. A stream URL whose host isn't listed is refused at save time, and the website's
   * CSP only opens these hosts. HLS = licensed .m3u8 feeds played in our own player (include the CDN host that serves the
   * segments); EMBED = provider-approved iframe players. Empty = that kind is disabled. Comma-separated hostnames.
   */
  STREAM_HLS_HOSTS: z.string().default(""),
  STREAM_EMBED_HOSTS: z.string().default(""),
  /** Query parameter the provider expects its access token in (STREAM_TOKEN_* variables are appended under this name). */
  STREAM_TOKEN_PARAM: z.string().regex(/^[A-Za-z0-9_-]{1,30}$/).default("token"),
  /** Optional YouTube Data API key: lets the checker prove a YouTube stream is actually live (otherwise it can only prove embedding is allowed). */
  YOUTUBE_API_KEY: z.string().min(20).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast at boot with a readable list of missing/invalid variables (never echoes values). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  return parsed.data;
}
