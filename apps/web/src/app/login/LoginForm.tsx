"use client";

import { useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/client-session";
import { useState, type FormEvent } from "react";

/**
 * Passwordless login (plan §2.2 / §5.1). Nothing is written to localStorage/sessionStorage:
 * the email lives only in component state, and the session is an HttpOnly cookie set by the API
 * that this code can never read.
 */
export function LoginForm() {
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: unknown) {
    const res = await fetch(`/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "email") {
        const r = await call("code", { email });
        if (r.status === 429) setError("Too many attempts. Please wait a minute.");
        else if (!r.ok) setError("Please enter a valid email address.");
        else setStep("code");
      } else {
        const r = await call("verify", { email, code });
        if (r.ok) { setCode(""); window.location.assign(next); } // full load so every cached page picks up the new sign-in state
        else setError(r.status === 429 ? "Too many attempts. Please wait a minute." : "That code is wrong or has expired.");
      }
    } catch {
      setError("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {step === "email" ? (
        <label className="block text-sm font-medium">
          Email
          <input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
        </label>
      ) : (
        <label className="block text-sm font-medium">
          6-digit code sent to {email}
          <input inputMode="numeric" pattern="\d{6}" maxLength={6} name="code" autoComplete="one-time-code" required value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 tracking-[0.4em]" />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-live">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-brand-700 py-2 font-medium text-white hover:bg-brand-900 disabled:opacity-60">
        {busy ? "Please wait…" : step === "email" ? "Send code" : "Log in"}
      </button>
      {step === "code" && (
        <button type="button" onClick={() => { setStep("email"); setCode(""); }} className="w-full text-sm text-muted underline">Use a different email</button>
      )}
    </form>
  );
}
