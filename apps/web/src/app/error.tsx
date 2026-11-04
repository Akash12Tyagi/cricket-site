"use client";

import { Ball } from "@/components/Ball";

/** Friendly error page: no stack traces or internals are ever shown (plan §5.5). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="floodlit relative isolate overflow-hidden rounded-[28px] px-6 py-20 text-center">
      <Ball kind="white" size={48} className="mx-auto mb-6" />
      <h1 className="wide text-3xl font-black text-white sm:text-5xl">Rain stopped play</h1>
      <p className="mt-3 text-white/75">Something went wrong on our side. Please try again.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
      <button onClick={reset} className="mt-8 rounded-full bg-leather-600 px-6 py-3 font-bold text-white transition-transform hover:-translate-y-0.5">Try again</button>
    </div>
  );
}
