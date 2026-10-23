import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  Chrome,
  FileText,
  FolderOpen,
  Heart,
  Lightbulb,
  Mail,
  Menu,
  NotebookPen,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import ProductPreview, {
  FeaturePreview,
} from "@/components/marketing/ProductPreview";
import { FREE_START, PRO_START, useProduct, type Product } from "@/lib/product";
import "@/styles/marketing.css";
import "@/styles/landing.css";

const navigation = [
  ["Features", "features"],
  ["How It Works", "how-it-works"],
  ["AI Companion", "ai-companion"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
];
const benefits = [
  { icon: PencilLine, text: "Write in a beautiful text editor" },
  { icon: Lightbulb, text: "Get personalized AI suggestions" },
  { icon: BarChart3, text: "Track your progress and build habits" },
  { icon: FolderOpen, text: "Organize all your writing in one place" },
];
const features = [
  {
    kind: "editor" as const,
    title: "Beautiful Writing Editor",
    text: "Write in a clean, distraction-free environment with powerful formatting tools.",
  },
  {
    kind: "ai" as const,
    title: "Personalized AI Suggestions",
    text: "Get ideas, continue writing, brainstorm, and improve your text with AI that considers your interests.",
  },
  {
    kind: "progress" as const,
    title: "Track Your Progress",
    text: "See your word count, daily goals, streaks, and writing statistics as you write.",
  },
  {
    kind: "library" as const,
    title: "Stay Organized",
    text: "Create documents, organize them into folders, search your writing, and access your work.",
  },
];
const steps = [
  {
    icon: Chrome,
    title: "Install UnoWord",
    text: "Add the Chrome extension and create your free account.",
  },
  {
    icon: FileText,
    title: "Make it yours",
    text: "Write in the editor, set goals, choose themes, and build your Writing Profile.",
  },
  {
    icon: Sparkles,
    title: "Keep growing",
    text: "Track your progress and get personalized AI suggestions whenever you need inspiration.",
  },
];
const audiences = [
  {
    icon: NotebookPen,
    title: "Bloggers",
    text: "Write better content, more consistently.",
  },
  {
    icon: BookOpen,
    title: "Authors",
    text: "Develop your ideas and bring stories to life.",
  },
  {
    icon: Mail,
    title: "Newsletter writers",
    text: "Find fresh topics and stay inspired.",
  },
  {
    icon: Heart,
    title: "Journal writers",
    text: "Capture your thoughts and personal growth.",
  },
  {
    icon: PencilLine,
    title: "Content creators",
    text: "Turn ideas into engaging writing.",
  },
  {
    icon: Sparkles,
    title: "Anyone who loves to write",
    text: "Build a habit and make meaningful progress.",
  },
];
const faqs = [
  [
    "What is UnoWord?",
    "UnoWord is a writing companion that combines a text editor, writing progress tracking, document organization, and personalized AI suggestions, alongside an integrated Chrome extension.",
  ],
  [
    "Is UnoWord free?",
    "Yes. Free includes the writing editor, private document library, session tracking, recent writing history, and Quick Prompt. Pro adds personalized AI tools, knowledge sources, writing goals, and extended history. See the current offer in Pricing.",
  ],
  [
    "Can I write directly in UnoWord?",
    "Yes. Open the writing editor to create, format, and organize documents. It saves drafts in your browser and synchronizes them to your account when cloud storage is available. Previously opened documents can be edited offline after an initial online visit.",
  ],
  [
    "How does UnoWord count words?",
    "The document word count includes all text currently in the document. Writing progress counts new words typed during a session, with deletions and undo reconciled. Pasted text, imports, and inserted AI text do not add to typed-word progress. The extension tracks supported editors separately and reuses editor activity without counting it twice. Google Docs’ canvas-based main editor is not currently supported.",
  ],
  [
    "How are AI suggestions personalized?",
    "Pro AI uses your latest My Writing Profile, selected themes, writing memory, relevant previous ideas, and enabled reference sources. Sharing the current draft for an AI request requires your consent. Using an editor document for future personalization is a separate opt-in choice. You can edit your profile and manage sources. AI requires an internet connection.",
  ],
  [
    "Can I use UnoWord without AI?",
    "Yes. Write, format, organize documents, and track your sessions without Pro AI. Quick Prompt uses the existing prompt library and does not call an AI provider.",
  ],
  [
    "Can I change my subscription later?",
    "Sign in to your account to start an eligible trial through Stripe Checkout or manage an existing subscription in the Stripe Customer Portal. You can update payment details and schedule cancellation there. Access continues until the end of the trial or paid period for a scheduled cancellation. Checkout is available only when billing is configured.",
  ],
  [
    "Is my writing private?",
    "Documents belong to your signed-in account, with owner checks and database row-level security. Offline drafts remain in this browser’s local storage; use a trusted browser profile. Cloud features use Supabase, and AI requests send the context you authorize to the configured AI provider. Your draft is not sent to AI just because you open this page. See our Privacy Policy for details and current limitations.",
  ],
];

const freeFeatures = [
  ["writing_editor", "Writing editor & document library"],
  ["quick_prompt", "Quick Prompt — no AI request needed"],
  ["session_tracking", "Writing session statistics"],
  ["basic_history", "Recent writing history"],
];
const proFeatures = [
  ["writing_editor", "Everything in Free"],
  ["editor_ai", "Personalized AI writing assistance"],
  ["new_topic", "New Topic"],
  ["expand_idea", "Expand an Idea"],
  ["connect_dots", "Connect the Dots"],
  ["editor_ai", "AI text improvement & continuation"],
  ["knowledge_sources", "Opt-in writing knowledge"],
  ["goals_analytics", "Goals & extended history"],
];

function PricingCard({
  paid,
  product,
  failed,
}: {
  paid: boolean;
  product?: Product;
  failed: boolean;
}) {
  const plan = product?.plans.find((p) => p.id === (paid ? "pro" : "free"));
  const price = plan?.price;
  const trial =
    paid && product?.billing_available && price && price.trial_days > 0
      ? price.trial_days
      : 0;
  return (
    <article className={`lp-price-card${paid ? " lp-price-pro" : ""}`}>
      {paid && <span className="lp-plan-badge">More possibilities</span>}
      <h3>{paid ? "Pro" : "Free"}</h3>
      <p>
        {paid
          ? "More personalized inspiration and deeper writing insights."
          : "Everything you need to begin writing and tracking progress."}
      </p>
      <div className="lp-price">
        {paid ? (
          price ? (
            <>
              <strong>
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: price.currency,
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                }).format(price.amount / 100)}
              </strong>
              <span>/{price.interval}</span>
            </>
          ) : (
            <span className="lp-price-pending">
              See current offer in your account
            </span>
          )
        ) : (
          <strong>$0</strong>
        )}
      </div>
      {trial > 0 && (
        <p className="lp-trial">{trial}-day free trial for eligible accounts</p>
      )}
      {product && (
        <ul>
          {(paid ? proFeatures : freeFeatures)
            .filter(([id]) => plan?.features[id])
            .map(([id, label]) => (
              <li key={id + label}>
                <Check size={14} />
                {label}
              </li>
            ))}
        </ul>
      )}
      {!product && (
        <p className="lp-plan-status" role="status">
          {failed
            ? "Plan details are temporarily unavailable. Check your account for current access."
            : "Loading current plan features…"}
        </p>
      )}
      <Link
        className={`lp-button${paid ? "" : " lp-button-outline"}`}
        to={paid ? PRO_START : FREE_START}
      >
        {paid
          ? trial > 0
            ? `Start ${trial}-Day Free Trial`
            : "View Pro in Your Account"
          : "Get Started Free"}
      </Link>
      {paid && (
        <small>
          {trial > 0
            ? `Then ${new Intl.NumberFormat("en-US", { style: "currency", currency: price!.currency }).format(price!.amount / 100)}/${price!.interval}. Payment method required. Cancel before the trial ends to avoid a charge.`
            : product?.billing_available
              ? "Manage your subscription in your account."
              : "Checkout is currently unavailable."}
        </small>
      )}
    </article>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const product = useProduct();
  const freeHref = product.data?.chrome_store_url || FREE_START;
  return (
    <div className="uw-site lp-site">
      <a className="uw-skip" href="#main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Brand joined />
          <nav className="lp-desktop-nav" aria-label="Main navigation">
            {navigation.map(([label, id]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <Link className="lp-sign-in" to="/account?mode=signin">
              Sign In
            </Link>
            <a className="lp-button lp-header-cta" href={freeHref}>
              Get UnoWord Free <ArrowRight size={15} />
            </a>
            <button
              className="lp-menu-button"
              type="button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            className="lp-mobile-nav lp-container"
            id="mobile-navigation"
            aria-label="Mobile navigation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenuOpen(false);
                document
                  .querySelector<HTMLButtonElement>(".lp-menu-button")
                  ?.focus();
              }
            }}
          >
            {navigation.map(([label, id]) => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                {label}
                <ArrowRight size={15} />
              </a>
            ))}
            <Link to="/account?mode=signin">Sign In</Link>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">YOUR COMPLETE WRITING COMPANION</p>
              <h1>
                Write. Track. Get Inspired.
                <br />
                <span>All in One Place.</span>
              </h1>
              <p className="lp-hero-description">
                UnoWord combines a beautiful writing editor, personalized AI
                suggestions, and powerful progress tracking to help you write
                consistently and bring your ideas to life.
              </p>
              <div className="lp-hero-buttons">
                <a className="lp-button" href={freeHref}>
                  Get UnoWord Free <ArrowRight size={18} />
                </a>
                <Link className="lp-button lp-button-outline" to="/editor">
                  Explore the Editor <ArrowRight size={17} />
                </Link>
              </div>
              <p className="lp-hero-footnote">
                <span className="lp-chrome-mark" aria-hidden="true" />
                Chrome extension · Start for free · Upgrade when you’re ready
              </p>
            </div>
            <ProductPreview />
            <div className="lp-benefits">
              {benefits.map(({ icon: Icon, text }) => (
                <div key={text}>
                  <span className="lp-icon-circle">
                    <Icon size={26} />
                  </span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-feature-band" id="features">
          <div className="lp-container lp-feature-layout">
            <div className="lp-section-intro">
              <p className="lp-eyebrow">A MORE COMPLETE WRITING EXPERIENCE</p>
              <h2>Everything you need to keep writing.</h2>
              <p>
                UnoWord gives you a distraction-free writing editor,
                personalized AI support, and the tools to stay organized and
                make real progress.
              </p>
              <Link className="lp-button" to="/editor">
                Explore All Features <ArrowRight size={16} />
              </Link>
            </div>
            <div className="lp-feature-grid">
              {features.map((feature) => (
                <article className="lp-feature-card" key={feature.kind}>
                  <FeaturePreview kind={feature.kind} />
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <p className="lp-visual-note">
            Interface illustrations use fictional example content and progress.
          </p>
        </section>
        <section className="lp-how" id="how-it-works">
          <div className="lp-container lp-how-layout">
            <div className="lp-section-intro">
              <h2>From your first word to your next big idea.</h2>
              <p>Start writing in three simple steps.</p>
            </div>
            <div className="lp-steps">
              {steps.map(({ icon: Icon, title, text }, i) => (
                <article key={title}>
                  <div className="lp-step-icon">
                    <span className="lp-step-number">{i + 1}</span>
                    <span
                      className={
                        i === 0
                          ? "lp-icon-circle lp-step-chrome"
                          : "lp-icon-circle"
                      }
                    >
                      {i === 0 ? (
                        <span className="lp-chrome-mark" aria-hidden="true" />
                      ) : (
                        <Icon size={28} />
                      )}
                    </span>
                  </div>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                  {i < 2 && (
                    <ArrowRight
                      className="lp-step-arrow"
                      size={24}
                      aria-hidden="true"
                    />
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-personalization" id="ai-companion">
          <div className="lp-container lp-personal-layout">
            <div className="lp-section-intro">
              <h2>An AI writing companion that understands you.</h2>
              <p>
                The more you choose to share about your interests, goals, and
                writing materials, the more personalized UnoWord’s suggestions
                can become.
              </p>
              <a className="lp-button" href="#faq">
                How Personalization Works <ArrowRight size={16} />
              </a>
            </div>
            <div className="lp-flow">
              {[
                {
                  icon: UserRound,
                  title: "Your Writing Profile",
                  items: [
                    "Your interests",
                    "Writing goals",
                    "Preferred themes",
                    "Writing style",
                  ],
                },
                {
                  icon: FileText,
                  title: "Your Writing Knowledge",
                  items: [
                    "Your documents",
                    "Saved websites",
                    "Previous writing",
                    "Writing memory",
                  ],
                },
                {
                  icon: Sparkles,
                  title: "Personalized Ideas",
                  items: [
                    "New topics",
                    "Expand an idea",
                    "Connect the Dots",
                    "Continue writing",
                  ],
                },
              ].map(({ icon: Icon, title, items }, i) => (
                <div className="lp-flow-group" key={title}>
                  <article
                    className={
                      i === 2 ? "lp-flow-card lp-flow-result" : "lp-flow-card"
                    }
                  >
                    <span className="lp-icon-circle">
                      <Icon size={26} />
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <ul>
                        {items.map((item) => (
                          <li key={item}>
                            <Check size={13} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                  {i < 2 && (
                    <span className="lp-flow-connector" aria-hidden="true">
                      {i === 0 ? <Plus /> : <ArrowRight />}
                    </span>
                  )}
                </div>
              ))}
              <p className="lp-handwritten">
                The more you share,
                <br />
                the better the suggestions.
                <ArrowRight aria-hidden="true" size={36} />
              </p>
            </div>
          </div>
          <p className="lp-consent-note">
            <ShieldCheck size={14} /> You choose what to share. Private editor
            documents are used for AI only with your permission.
          </p>
        </section>
        <div className="lp-container lp-bottom-grid">
          <section id="pricing" className="lp-pricing">
            <h2>Start free. Grow at your own pace.</h2>
            <div className="lp-pricing-grid">
              <PricingCard
                paid={false}
                product={product.data}
                failed={product.isError}
              />
              <PricingCard
                paid
                product={product.data}
                failed={product.isError}
              />
            </div>
            <p className="lp-billing-note">
              Sign in before starting a subscription. AI usage limits apply; see
              your account for current allowances.{" "}
              {product.data?.billing_available
                ? "Checkout and subscription management are hosted by Stripe."
                : "Paid plan changes are unavailable until billing is configured."}
            </p>
          </section>
          <section className="lp-audiences">
            <h2>Who is UnoWord for?</h2>
            <div>
              {audiences.map(({ icon: Icon, title, text }) => (
                <article key={title}>
                  <span className="lp-icon-circle">
                    <Icon size={21} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="lp-faq" id="faq">
            <h2>Frequently asked questions</h2>
            {faqs.map(([question, answer], i) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div>
                  <p>{answer}</p>
                  {i === 7 && (
                    <Link to="/privacy">
                      Read our Privacy Policy <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              </details>
            ))}
            <Link className="lp-support-link" to="/support">
              Need a hand? Visit Support <ArrowRight size={14} />
            </Link>
          </section>
        </div>
        <section className="lp-final-cta">
          <div className="lp-container lp-final-inner">
            <div>
              <h2>Your next great idea starts with one word.</h2>
              <p>
                Whether you’re writing your first blog post or your next book,
                UnoWord helps you stay consistent, explore ideas, and make
                progress.
              </p>
            </div>
            <a className="lp-button lp-button-white" href={freeHref}>
              Get UnoWord Free <ArrowRight size={17} />
            </a>
            <Brand joined light />
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div>
          <Brand joined />
          <p>
            Your complete writing companion.
            <br />
            Every idea starts with UnoWord.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/support">Support</Link>
        </nav>
        <small>© {new Date().getFullYear()} UnoWord</small>
      </footer>
    </div>
  );
}
