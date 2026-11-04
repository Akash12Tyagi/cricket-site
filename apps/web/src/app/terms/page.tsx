import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of use", alternates: { canonical: "/terms" } };

// DRAFT, placeholder terms. Must be written/reviewed by a lawyer before launch.
export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="27 October 2026">
      <p>CricketLive provides live scores, statistics and news for personal, non-commercial use.</p>
      <h2>Content</h2>
      <p>Scores are entered by our scorers and may occasionally contain errors that we correct as quickly as possible. Automated bulk copying of the site or its data is not permitted.</p>
      <h2>Videos</h2>
      <p>
        Videos on this site are official uploads shown through YouTube&apos;s embedded player and YouTube API Services. By watching them you agree to be
        bound by the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
      </p>
      <h2>Accounts</h2>
      <p>Keep access to your email account secure; anyone who can read your email can sign in. You can delete your account at any time.</p>
    </LegalPage>
  );
}
