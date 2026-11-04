import Link from "next/link";
import { Ball } from "@/components/Ball";

/** A lost ball: it sailed out of the ground. */
export default function NotFound() {
  return (
    <div className="floodlit relative isolate overflow-hidden rounded-[28px] px-6 py-20 text-center">
      <div aria-hidden className="mx-auto mb-8 h-24 w-64">
        <div className="pop-in" style={{ animationDelay: "100ms" }}>
          <Ball kind="red" size={56} className="mx-auto animate-[ball-fly_2.4s_var(--ease-out-expo)_infinite]" />
        </div>
      </div>
      <h1 className="wide text-4xl font-black text-white sm:text-6xl">Lost ball!</h1>
      <p className="mx-auto mt-3 max-w-md text-white/75">That one's gone into the stands. The page you're looking for doesn't exist (or has moved).</p>
      <Link href="/" className="mt-8 inline-flex rounded-full bg-leather-600 px-6 py-3 font-bold text-white transition-transform hover:-translate-y-0.5">Back to live scores</Link>
    </div>
  );
}
