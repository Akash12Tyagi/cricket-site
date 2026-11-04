import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Cookie policy", alternates: { canonical: "/cookies" } };

// DRAFT, lists exactly the cookies the code sets. Keep in sync when adding any cookie.
export default function Cookies() {
  return (
    <LegalPage title="Cookie policy" updated="27 October 2026">
      <p>We use as few cookies as possible. There is no advertising or tracking cookie.</p>
      <table>
        <thead><tr><th>Name</th><th>Purpose</th><th>Readable by page scripts</th><th>Lifetime</th></tr></thead>
        <tbody>
          <tr><td><code>__Host-sid</code></td><td>Keeps you signed in (essential)</td><td>No (HttpOnly)</td><td>30 days, renewed while active</td></tr>
          <tr><td><code>signed_in</code></td><td>Says only &ldquo;someone is signed in&rdquo; so pages know to show your account menu. Contains no identity (essential)</td><td>Yes</td><td>Same as above</td></tr>
          <tr><td><code>consent</code></td><td>Remembers your cookie choice (essential)</td><td>Yes</td><td>180 days</td></tr>
        </tbody>
      </table>
      <p>To change your choice, clear this site&apos;s cookies in your browser; the banner will appear again.</p>
      <h2>Videos (YouTube)</h2>
      <p>
        Official highlights are played in YouTube&apos;s privacy-enhanced player (youtube-nocookie.com). Before you press play, the only thing loaded
        from YouTube is the thumbnail image (from i.ytimg.com, which sets no cookies); no YouTube player or script runs. Once you press play, YouTube may set its own cookies or similar storage under
        {" "}<a href="https://policies.google.com/privacy">Google&apos;s privacy policy</a>. If you don&apos;t want that, use the &ldquo;Watch on YouTube&rdquo; link instead.
      </p>
    </LegalPage>
  );
}
