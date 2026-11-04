import type { Metadata } from "next";
import { AccountPanel } from "./AccountPanel";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

/** Static shell (cacheable, no personal data in HTML); the panel loads the user's data client-side. */
export default function AccountPage() {
  return <AccountPanel />;
}
