import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { OTP_LENGTH } from "@cricket/shared";

/** Keyed hash: stored instead of raw codes/tokens, so a database leak reveals nothing usable. */
export function hmac(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
