"use client";

import Link from "next/link";
import { useMe } from "@/lib/client-session";

export function AccountMenu() {
  const { user, loading } = useMe();
  const cls = "rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20";
  if (loading) return <span className={`${cls} opacity-60`} aria-hidden>…</span>;
  if (!user) return <Link href="/login" className={cls}>Log in</Link>;
  const staff = user.role !== "fan";
  return (
    <span className="flex items-center gap-2">
      {staff && <Link href="/admin" className="text-sm opacity-90 hover:opacity-100">Admin</Link>}
      <Link href="/account" className={cls}>{user.displayName ?? "Account"}</Link>
    </span>
  );
}
