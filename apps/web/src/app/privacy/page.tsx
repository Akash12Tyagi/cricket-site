import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

// DRAFT, describes the system as built. Must be reviewed by a lawyer before launch.
export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="27 October 2026">
      <p>You can read every score, scorecard and story without an account. We only process personal data when you sign in.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Email address</strong>, to send one-time login codes. We never ask for or store a password.</li>
        <li><strong>Display name</strong> (optional) and the <strong>teams and players you follow</strong>.</li>
        <li><strong>Session records</strong>: when you signed in, when you were last active, and your browser type, so you can sign out of other devices.</li>
      </ul>
      <h2>What we don&apos;t do</h2>
      <ul>
        <li>We don&apos;t store passwords, tokens or personal data in your browser&apos;s storage. Your sign-in lives in a secure, HttpOnly cookie that page scripts cannot read.</li>
        <li>We don&apos;t load advertising or tracking scripts. If we add analytics, they will only run after you choose &ldquo;Accept all&rdquo;.</li>
        <li>We don&apos;t sell your data.</li>
        <li>We don&apos;t work out where you are. The &ldquo;Where to watch&rdquo; list puts your country first using your device&apos;s time zone; this is done in your browser and never sent to us.</li>
        <li>Videos use YouTube&apos;s player, which loads only after you press play; before that your browser fetches just the thumbnail image from YouTube (see the <Link href="/cookies">cookie policy</Link>).
          We use YouTube API Services to list official videos and their view counts; we don&apos;t send any of your data to YouTube through it.
          When you play a video, Google processes data under the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</li>
      </ul>
      <h2>Your rights</h2>
      <p>From <Link href="/account">your account</Link> you can download all data we hold about you, sign out on all devices, or permanently delete your account and follows.</p>
      <h2>Contact</h2>
      <p>Questions: privacy@example.com (replace before launch).</p>
    </LegalPage>
  );
}
