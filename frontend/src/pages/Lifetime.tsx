import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Feather,
  FolderOpen,
  Infinity as InfinityIcon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import ProductPreview from "@/components/marketing/ProductPreview";
import { useLifetimeOffer } from "@/lib/lifetime";
import { useProduct } from "@/lib/product";
import "@/styles/marketing.css";
import "@/styles/landing.css";
import "@/styles/lifetime.css";

const inclusions = [
  [
    "writing_editor",
    "Your own writing space",
    "A focused editor and private document library, with folders, formatting, and local autosave.",
    Feather,
  ],
  [
    "editor_ai",
    "A little inspiration, made personal",
    "Brainstorm, continue writing, and improve selected text with your Pro AI assistant.",
    Sparkles,
  ],
  [
    "knowledge_sources",
    "Your ideas, connected",
    "Bring your Writing Profile, enabled references, documents, and websites into your AI context.",
    FolderOpen,
  ],
  [
    "goals_analytics",
    "A writing habit that stays with you",
    "Follow your goals, sessions, streaks, and longer writing history as your practice grows.",
    Clock3,
  ],
] as const;
export default function Lifetime() {
  const product = useProduct();
  const offer = useLifetimeOffer();
  const soldOut = offer.data?.purchased != null && offer.data.purchased >= 25;
  const pro = product.data?.plans.find((plan) => plan.id === "pro");
  return (
    <div className="uw-site lp-site lt-site">
      <a className="uw-skip" href="#main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Brand joined />
          <nav className="lt-nav" aria-label="Promotion navigation">
            <a href="#included">What’s included</a>
            <a href="#offer-faq">Questions?</a>
            <Link to="/account?mode=signin">Sign In</Link>
          </nav>
          <a className="lp-button" href="#lifetime-offer">
            Explore the Deal <ArrowRight size={16} />
          </a>
        </div>
      </header>
      <main id="main">
        <div className="lt-preview-note" role="status">
          Stripe sandbox offer · $100 once · Limited to the first 25 lifetime
          purchasers.
        </div>
        <section className="lt-hero">
          <div className="lp-container lt-hero-grid">
            <div className="lt-hero-copy">
              <p className="lt-eyebrow">
                <span /> FIRST 25 PURCHASERS · LIFETIME OFFER
              </p>
              <h1>
                Make room for
                <br />a lifetime of <em>ideas.</em>
              </h1>
              <p className="lt-description">
                Your words deserve a place to grow. Get UnoWord Pro for a single
                $100 payment—and bring your writing, inspiration, and progress
                together.
              </p>
              <a href="#lifetime-offer" className="lp-button lt-main-button">
                Explore Lifetime Pro <ArrowRight size={18} />
              </a>
              <p className="lt-hero-note">
                <Check size={15} /> One payment. Lifetime Pro access. Current AI
                limits apply.
              </p>
            </div>
            <article
              id="lifetime-offer"
              className="lt-offer"
              aria-labelledby="offer-heading"
            >
              <div className="lt-offer-top">
                <span>
                  <InfinityIcon size={18} /> THE LIFETIME EDITION
                </span>
                <span className="lt-limited">25 places total</span>
              </div>
              <h2 id="offer-heading">
                UnoWord Pro.
                <br />
                Yours for the long run.
              </h2>
              <div className="lt-price">
                <span className="lt-currency">$</span>
                <strong>100</strong>
                <span>
                  USD
                  <br />
                  one time
                </span>
              </div>
              <p className="lt-price-note">
                A one-time purchase for lifetime Pro access. First 25 purchasers
                only.
              </p>
              <p className="lt-stock" role="status">
                {offer.data?.remaining != null
                  ? `${offer.data.remaining} of ${offer.data.capacity} lifetime deals left · ${offer.data.purchased} verified ${offer.data.purchased === 1 ? "purchase" : "purchases"}. ${offer.data.available} places available now; ${offer.data.reserved} held in checkout.`
                  : "Limited to 25 lifetime purchases. Availability will appear when the offer opens."}
              </p>
              {soldOut && (
                <p className="lt-sold-out" role="status">
                  All 25 lifetime deals are sold. Lifetime checkout is closed.
                  You can still explore our regular Free and Pro plans.
                </p>
              )}
              <ul>
                {[
                  "Writing editor & document library",
                  "Personalized AI writing assistance",
                  "Goals, streaks & extended history",
                  "Chrome extension included",
                ].map((text) => (
                  <li key={text}>
                    <Check size={17} />
                    {text}
                  </li>
                ))}
              </ul>
              <Link
                to={soldOut ? "/#pricing" : "/account?offer=lifetime"}
                className="lp-button"
              >
                {soldOut
                  ? "Lifetime Deal Sold Out"
                  : offer.data?.checkout_available
                    ? "Get the $100 Lifetime Deal"
                    : "View Lifetime Offer Status"}{" "}
                <ArrowRight size={17} />
              </Link>
              <p className="lt-offer-footnote">
                <ShieldCheck size={15} /> Sandbox/test checkout only. No live
                billing.
              </p>
            </article>
          </div>
          <div className="lp-container lt-value-strip">
            <span>
              <InfinityIcon size={21} />
              <b>One-time purchase</b>
            </span>
            <span>
              <Feather size={21} />
              <b>A place for every draft</b>
            </span>
            <span>
              <Sparkles size={21} />
              <b>Personalized inspiration</b>
            </span>
            <span>
              <ShieldCheck size={21} />
              <b>Your writing. Your choices.</b>
            </span>
          </div>
        </section>
        <section className="lp-container lt-product">
          <div className="lt-product-intro">
            <p className="lt-eyebrow">YOUR COMPLETE WRITING COMPANION</p>
            <h2>
              Your next chapter
              <br />
              starts right here.
            </h2>
            <p>
              Open a draft. Follow a thought. Find a new direction when you need
              one. UnoWord gives your writing a little structure and a lot of
              possibility.
            </p>
            <Link to="/">
              Get to know UnoWord <ArrowRight size={16} />
            </Link>
          </div>
          <ProductPreview />
        </section>
        <section className="lt-included" id="included">
          <div className="lp-container">
            <div className="lt-section-heading">
              <p className="lt-eyebrow">ALL THE REASONS TO KEEP WRITING</p>
              <h2>Pro tools. A lasting place for your ideas.</h2>
              <p>
                The current Pro feature set, brought together in one lifetime
                offer.
              </p>
            </div>
            <div className="lt-feature-grid">
              {inclusions
                .filter(([id]) => !pro || pro.features[id])
                .map(([id, title, text, Icon]) => (
                  <article key={id}>
                    <span className="lp-icon-circle">
                      <Icon size={25} />
                    </span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
            </div>
            <p className="lt-limits">
              AI usage, supported formats, and storage limits follow the current
              Pro allowance. Lifetime access does not mean unlimited AI
              requests.
            </p>
          </div>
        </section>
        <section
          className="lp-container lt-terms"
          id="offer-terms"
          aria-labelledby="offer-terms-title"
        >
          <div className="lt-section-heading">
            <p className="lt-eyebrow">KNOW EXACTLY WHAT YOU’RE GETTING</p>
            <h2 id="offer-terms-title">One payment. Clear terms.</h2>
          </div>
          <div className="lt-terms-grid">
            <article>
              <h3>Lifetime Pro includes</h3>
              <ul>
                <li>
                  Full writing editor, formatting, folders, and document
                  library.
                </li>
                <li>
                  Offline drafting with local autosave and cloud
                  synchronization.
                </li>
                <li>
                  Personalized AI: New Topic, Expand an Idea, Connect the Dots,
                  continuation, brainstorming, and selected-text improvement.
                </li>
                <li>
                  Your Writing Profile and enabled document/website knowledge
                  sources.
                </li>
                <li>
                  Goals, streaks, extended history, and the Chrome extension.
                </li>
              </ul>
            </article>
            <article>
              <h3>AI allowance & fair use</h3>
              <p>
                {offer.data
                  ? `New lifetime accounts receive an effective allowance of ${offer.data.daily_ai_limit} AI requests per day under the current Pro allowance.`
                  : "The current Pro daily AI allowance will be shown here when the offer configuration loads."}{" "}
                Your account shows your exact remaining allowance. A request can
                return several ideas; it does not become several requests just
                because it returns multiple suggestions.
              </p>
              <p>
                Use your account for your own writing. Daily caps and rate
                limits apply; do not bypass them through automated bulk
                requests, shared credentials, or reselling access. Lifetime
                access is not unlimited AI or storage.
              </p>
            </article>
            <article>
              <h3>$100 once · 14-day refunds</h3>
              <p>
                Pay $100 USD once for this account’s lifetime Pro access. There
                is no recurring lifetime-plan charge or free trial. This offer
                is separate from monthly Pro.
              </p>
              <p>
                Request a full refund within 14 days of the verified payment
                date from your account’s lifetime-offer page. Refunds are
                processed through Stripe. Pro access from this purchase ends
                after a verified full refund. Refunds do not reopen a sold
                lifetime place.
              </p>
              <Link to="/account?offer=lifetime">
                View your lifetime purchase or refund options{" "}
                <ArrowRight size={14} />
              </Link>
            </article>
          </div>
          <p className="lt-limits">
            Limited to the first 25 verified lifetime purchases. Paid purchases
            count toward the limit; open checkouts are shown separately as
            temporary holds. Once all 25 are sold, lifetime checkout closes and
            regular plans remain available. This page and checkout currently
            operate in Stripe test mode.
          </p>
        </section>
        <section className="lp-container lt-faq" id="offer-faq">
          <div>
            <p className="lt-eyebrow">A FEW THINGS TO KNOW</p>
            <h2>
              A simple offer.
              <br />
              Clear expectations.
            </h2>
            <p>Keep the focus on your writing.</p>
          </div>
          <div>
            {[
              [
                "What is the lifetime deal?",
                "The offer is $100 USD as a one-time payment for lifetime UnoWord Pro access. It is separate from the regular monthly subscription.",
              ],
              [
                "How does the refund policy work?",
                "Request a full refund within 14 days of payment from the lifetime-offer section of your signed-in account. Stripe verifies and processes the refund. Refunded lifetime purchases lose the access granted by that purchase and do not reopen a sold place.",
              ],
              [
                "What happens after all 25 places are sold?",
                "Lifetime checkout closes after 25 verified lifetime purchases. The sold-out page points you to the regular Free and monthly Pro plans. Refunds do not restart this lifetime offer.",
              ],
              [
                "Which features are included?",
                "The offer covers the current Pro feature set: the writing editor and document library, personalized AI tools, writing knowledge sources, writing goals, and extended history. Your account shows the current feature and usage limits.",
              ],
              [
                "Does lifetime mean unlimited AI?",
                "No. The existing Pro AI allowances and other feature limits still apply. The offer does not promise unlimited AI or storage.",
              ],
              [
                "How long is the deal available?",
                "The offer is limited to the first 25 lifetime purchases. An open checkout temporarily reserves a place. A place is released only after Stripe verifies that checkout expired.",
              ],
              [
                "What if I already subscribe to Pro?",
                "Sign in to review the lifetime offer. An active monthly subscription or open monthly checkout must be resolved before buying the lifetime offer. Signing in lets you review your account. Lifetime checkout never cancels your subscription automatically.",
              ],
              [
                "Can I write offline?",
                "Yes. After opening the editor online in your browser, you can edit available documents and create drafts offline. Changes save locally and synchronize when connectivity and account access are restored. AI assistance requires connectivity.",
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={17} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lt-final">
          <div className="lp-container">
            <InfinityIcon size={34} />
            <h2>
              A little space for your words.
              <br />A lifetime of possibilities.
            </h2>
            <p>Give your next idea somewhere to begin.</p>
            <a href="#lifetime-offer" className="lp-button lp-button-white">
              Explore the $100 Lifetime Deal <ArrowRight size={17} />
            </a>
            <small>Every idea starts with UnoWord.</small>
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div>
          <Brand joined />
          <p>Your complete writing companion.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link to="/">Home</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/support">Support</Link>
        </nav>
        <small>© {new Date().getFullYear()} UnoWord</small>
      </footer>
    </div>
  );
}
