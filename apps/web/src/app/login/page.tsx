import type { Metadata } from "next";
import { Suspense } from "react";
import { Ball } from "@/components/Ball";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_30px_60px_-30px_rgba(61,7,16,0.45)]">
      <div className="floodlit px-7 pb-7 pt-9">
        <Ball kind="red" size={40} className="ball-spin mb-4" />
        <h1 className="wide text-3xl font-black text-white">Walk out to bat</h1>
        <p className="mt-2 text-sm text-white/75">No password needed. We&apos;ll email you a 6-digit code to follow your teams and players.</p>
      </div>
      <div className="p-7">
      <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
