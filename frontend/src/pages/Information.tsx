import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import Brand from "@/components/marketing/Brand";
import "@/styles/marketing.css";
import "@/styles/account.css";

export default function Information({
  kind,
}: {
  kind: "privacy" | "terms" | "support" | "not-found";
}) {
  return (
    <div className="uw-site uw-info-page">
      <header className="uw-account-header uw-container">
        <Brand />
        <Link className="uw-text-link" to="/">
          <ArrowLeft size={15} /> Back to Uno Word
        </Link>
      </header>
      <main className="uw-info-content">
        {kind === "privacy" ? (
          <>
            <p className="uw-eyebrow">YOUR WRITING, WITH CONTEXT</p>
            <h1>Privacy &amp; data</h1>
            <p>
              This page describes the current Uno Word implementation. It does
              not promise that data never leaves your device: cloud
              personalization works with information you choose to share.
            </p>
            <h2>Local writing sessions</h2>
            <p>
              The Chrome extension stores session counts, recent history, goals,
              and preferences in Chrome’s local extension storage. While a
              session is active, content scripts observe input in supported
              editors and reconcile typed and pasted text separately. Temporary
              text buffers help calculate changes. The extension is not a
              browsing-history recorder.
            </p>
            <h2>Account and cloud features</h2>
            <p>
              Supabase manages authentication. The app uses secure, HTTP-only
              session cookies; it does not store passwords in extension local
              storage. Your account ID associates your profile, saved ideas,
              documents, website sources, and writing memory with your account.
              User-scoped API requests and database row-level security limit
              access to account data.
            </p>
            <h2>Your writing workspace</h2>
            <p>
              The web editor saves documents to your authenticated account and
              keeps account-specific offline copies in this browser’s IndexedDB.
              The static editor shell may be cached to let you reopen it
              offline; authentication and private API responses are not stored
              in that cache. Offline copies remain on this device until browser
              site data is cleared. Use a trusted browser profile for private
              writing. Trashed writing documents remain recoverable in Trash.
            </p>
            <p>
              Editor writing statistics synchronize as counts and timings,
              separate from document text. The Chrome extension reuses those
              records without counting editor typing twice. Sharing the current
              draft with AI requires a request-specific choice; using a document
              for future AI personalization is a separate opt-in setting.
            </p>
            <h2>AI personalization</h2>
            <p>
              When you request Pro AI suggestions, the app builds bounded
              context from your saved profile, themes, and relevant available
              knowledge. That context is sent to the configured AI service
              (currently OpenAI). Document and website processing can also use
              AI summaries and embeddings. AI providers and Supabase process the
              data needed for these services under their own policies.
            </p>
            <h2>Billing data</h2>
            <p>
              Stripe hosts checkout and subscription management and processes
              payment details. Uno Word stores Stripe customer and subscription
              identifiers, subscription status, trial eligibility, and billing
              period dates to manage access. Card details are entered on
              Stripe’s pages.
            </p>
            <h2>Your choices</h2>
            <p>
              You can edit your Writing Profile, choose whether to save writing
              to memory, and manage documents and website references in the
              Library. Disabled or deleted sources are excluded from automatic
              suggestion context; deleting a source removes its stored file and
              derived index through the application. Saved suggestions may still
              contain wording generated earlier. Local session data can be
              managed through the extension.
            </p>
            <h2>Current limits and support</h2>
            <p>
              No visitor tracking or paid AI generation is used for the
              landing-page examples. This notice does not specify a legal
              retention schedule or additional regulatory guarantees. Formal
              legal terms and privacy contact details still require publication
              by the product owner. For verified project help, use{" "}
              <Link to="/support">Support</Link>.
            </p>
          </>
        ) : kind === "terms" ? (
          <>
            <p className="uw-eyebrow">CLEAR EXPECTATIONS</p>
            <h1>Terms of service</h1>
            <p className="uw-info-note">
              Formal Terms of Service have not yet been published by the product
              owner. This page does not create payment, refund, service-level,
              or legal promises.
            </p>
            <h2>Current availability</h2>
            <p>
              Uno Word has Free features and account-controlled Pro
              capabilities. Pro costs $20 USD monthly after a 7-day free trial
              for eligible accounts. A payment method is required; cancel before
              your trial ends to avoid a charge. Checkout remains unavailable
              until configured. Creating a Free account or downloading the
              extension does not purchase a subscription.
            </p>
            <h2>Developer release</h2>
            <p>
              The available extension download is a developer release installed
              through Chrome’s “Load unpacked” workflow. Managed browsers may
              prevent installation, and updates require manually replacing the
              release. There is no verified Chrome Web Store listing configured
              at present.
            </p>
            <h2>AI and editor support</h2>
            <p>
              AI suggestions are generated ideas and can be inaccurate; review
              them before use. Upload material you are permitted to share.
              Tracking works in supported text inputs and editors; Google Docs’
              canvas-based main editor is not supported.
            </p>
            <p>
              <Link to="/privacy">Read the current data-handling notice</Link>{" "}
              or <Link to="/support">get project help</Link>.
            </p>
          </>
        ) : kind === "support" ? (
          <>
            <p className="uw-eyebrow">A LITTLE HELP TO KEEP YOU GOING</p>
            <h1>Let’s get you writing.</h1>
            <p>
              Installation help and a few things to know about the current
              release.
            </p>
            <h2>Install the Chrome extension</h2>
            <a
              href="/downloads/unoword-extension.zip"
              download
              className="uw-button"
            >
              <Download size={17} /> Download Uno Word
            </a>
            <ol>
              <li>Unzip the download.</li>
              <li>
                Open <code>chrome://extensions</code>, then turn on Developer
                mode.
              </li>
              <li>
                Choose <strong>Load unpacked</strong> and select the extracted{" "}
                <strong>unoword</strong> folder.
              </li>
              <li>
                Pin the extension. Open Uno Word, choose your language, and
                start a writing session.
              </li>
              <li>
                Use Settings → Account &amp; Security to sign in. Pro
                capabilities require an eligible server-managed account.
              </li>
            </ol>
            <p>
              If your organization blocks developer extensions, use a browser
              that permits this installation method or contact its
              administrator. Developer release updates must be installed
              manually.
            </p>
            <h2>Which editors work?</h2>
            <p>
              Uno Word tracks active sessions in supported text fields,
              textareas, and contenteditable editors. Pasted words are recorded
              separately from typed progress. Chrome internal pages and the
              Chrome Web Store do not allow the extension. Google Docs’
              canvas-based main document editor is not currently supported.
            </p>
            <h2>Plans and account recovery</h2>
            <p>
              Sign in to your account to start Pro through Stripe Checkout or
              manage a Stripe subscription. You can update payment details and
              schedule cancellation in the billing portal. Checkout is
              unavailable until billing is configured. Email changes and
              password recovery require the administrator’s completed Supabase
              email configuration; the app reports when this setup is missing.
              Existing password sign-in is available.
            </p>
            <Link
              className="uw-button uw-button-outline"
              to="/account?mode=signin"
            >
              Go to your account
              <ArrowRight size={16} />
            </Link>
            <h2>Report an issue</h2>
            <p>
              The existing project’s{" "}
              <a
                href="https://github.com/felipeoracio/unoword/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub issues page
              </a>{" "}
              is the verified support destination. Do not post passwords,
              session cookies, private documents, or API keys. A GitHub account
              may be required.
            </p>
          </>
        ) : (
          <>
            <p className="uw-eyebrow">A NEW DIRECTION</p>
            <h1>This page hasn’t been written yet.</h1>
            <p>Head back to Uno Word and find your next idea.</p>
            <Link className="uw-button" to="/">
              Back to Uno Word
              <ArrowRight size={17} />
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
