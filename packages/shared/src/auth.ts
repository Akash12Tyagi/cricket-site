import { z } from "zod";

export const USER_ROLES = ["fan", "scorer", "editor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Login codes are 6 digits, valid for 10 minutes, max 5 attempts (plan §5.2). */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_DAYS = 30;
/** `__Host-` prefix: cookie is Secure, host-only, Path=/ — cannot be set by subdomains. */
export const SESSION_COOKIE = "__Host-sid";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export const requestCodeSchema = z.object({ email: emailSchema });
export type RequestCodeInput = z.infer<typeof requestCodeSchema>;

export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), "Code must be 6 digits"),
});
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;

/** The only user fields ever sent to the browser. No email is echoed in public responses. */
export const publicUserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(USER_ROLES),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
