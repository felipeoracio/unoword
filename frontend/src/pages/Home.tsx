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
import { useLifetimeOffer } from "@/lib/lifetime";
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
  { icon: PencilLine, text: "Write in a beautiful editor — Pro" },
  { icon: Lightbulb, text: "Get personalized AI guidance — Pro" },
  { icon: BarChart3, text: "Track your progress and build habits" },
  { icon: FolderOpen, text: "Organize documents and folders — Pro" },
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
    text: "Get topics, guiding questions, and outlines from a writing coach that considers your interests. Every sentence stays yours.",
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
    title: "Set Your Goal",
    text: "Add the Chrome extension and choose your daily word target.",
  },
  {
    icon: FileText,
    title: "Build Consistency",
    text: "Track your progress. Activity continues being recorded after your Free streak display reaches seven days.",
  },
  {
    icon: Sparkles,
    title: "Unlock More With Pro",
    text: "Use the writing editor, organized documents, unlimited streaks, and personalized AI guidance.",
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
    "Yes. Free includes daily word tracking, daily goals, basic statistics, unlimited non-AI Quick Prompts, the Chrome extension, and visible writing streaks up to seven days. Your qualifying activity continues being recorded beyond Day 7. Pro unlocks the full qualifying streak and the built-in editor, formatting, document library, folders, and AI coaching.",
  ],
  [
    "Can I write directly in UnoWord?",
    "Yes. With Pro Monthly or Lifetime, sign in and open the writing editor to create, format, and organize documents. It saves drafts in your browser and synchronizes them to your account when cloud storage is available. Previously opened documents can be edited offline after an initial online visit.",
  ],
  [
    "How does UnoWord count words?",
    "The document word count includes all text currently in the document. Writing progress counts new words typed during a session, with deletions and undo reconciled. Pasted text and imports do not add to typed-word progress. The extension tracks supported editors separately and reuses editor activity without counting it twice. Google Docs’ canvas-based main editor is not currently supported.",
  ],
  [
    "How are AI suggestions personalized?",
    "Pro AI uses your latest My Writing Profile, selected themes, writing memory, relevant previous ideas, and enabled reference sources. Sharing the current draft for an AI request requires your consent. Using an editor document for future personalization is a separate opt-in choice. You can edit your profile and manage sources. AI requires an internet connection.",
  ],
  [
    "Can I use UnoWord without AI?",
    "Yes. All plans can track writing, set goals, and use unlimited prewritten non-AI Quick Prompts. The built-in editor, formatting, document library, and folders require Pro Monthly or Lifetime. Quick Prompt uses the existing prompt library and does not call an AI provider.",
  ],
  [
    "Can I change my subscription later?",
    "Sign in to your account to start an eligible trial through Stripe Checkout or manage an existing subscription in the Stripe Customer Portal. You can update payment details and schedule cancellation there. Access continues until the end of the trial or paid period for a scheduled cancellation. Checkout is available only when billing is configured.",
  ],
  [
    "Is my writing private?",
    "Documents belong to your signed-in account, with owner checks and database row-level security. Offline drafts remain in this browser’s local storage; use a trusted browser profile. Cloud features use Supabase, and AI requests send the context you authorize to the configured AI provider. Your draft is not sent to AI just because you open this page. See our Privacy Policy for details and current limitations.",
  ],
  [
    "Does UnoWord stop tracking after Day 7?",
    "No. Your qualifying writing activity continues being recorded. Only the Free streak display and premium milestones are capped. Sign in to sync activity metadata across devices; offline activity queues locally. Use Sync this device’s writing history to bring in available older local sessions.",
  ],
  [
    "What happens when I upgrade?",
    "After your paid entitlement is verified, UnoWord reveals your full current qualifying streak, including synced activity recorded on Free. Your streak is not restarted. Missing a required writing day still breaks the current streak under the normal rules. Historical activity stays saved.",
  ],
  [
    "Does Free include the editor?",
    "No. The built-in editor, rich-text formatting, document library, folders, and personalized Writing Profile require Pro Monthly or Lifetime. Existing documents are preserved if you downgrade.",
  ],
  [
    "Does UnoWord generate content for me?",
    "No. UnoWord suggests topics, reflective questions, outlines, and structural advice. It does not write or rewrite your sentences, stories, or articles. You do the writing. UnoWord helps you keep going.",
  ],
  [
    "What if I miss a writing day?",
    "Your current streak follows the normal consecutive-day rule: at least one typed word per calendar day in your configured timezone. If a required day is missed, the current streak resets; historical activity is preserved. Pasted words do not qualify.",
  ],
  [
    "What is included in Pro?",
    "The built-in writing editor, rich-text formatting, document library and folders, unlimited visible streaks and full available qualifying history, personalized Writing Profile, context-aware suggestions, AI Writing Guidance, and an AI usage dashboard. Lifetime includes exactly the same paid features.",
  ],
  ["What are the AI limits?", "__AI_ALLOWANCE__"],
  [
    "Does Lifetime include everything in Pro?",
    "Yes. Lifetime has exactly the same paid features and applicable AI allowances as Monthly Pro, without a recurring subscription payment. The $100 offer is limited to the first 25 qualifying purchasers, with the published 14-day refund policy. Existing protected allowance versions remain in force.",
  ],
];

const freeFeatures = [
  ["session_tracking", "Daily word tracking & basic statistics"],
  ["writing_goals", "Daily goals & visible streaks up to 7 days"],
  ["quick_prompt", "Unlimited basic, non-AI Quick Prompts"],
  ["basic_history", "Chrome extension & recent history"],
];
const proFeatures = [
  ["session_tracking", "Everything in Free"],
  ["writing_editor", "Built-in writing editor & rich-text formatting"],
  ["document_library", "Document library & folders"],
  [
    "unlimited_writing_streaks",
    "Full qualifying streak history & unlimited streaks",
  ],
  ["editor_ai", "Personalized suggestions & AI Writing Guidance"],
  ["writing_profile", "Personalized Writing Profile & context"],
  ["goals_analytics", "AI usage dashboard & extended analytics"],
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
      {paid && <span className="lp-plan-badge">Recommended monthly plan</span>}
      <h3>{paid ? "Pro Monthly" : "Free"}</h3>
      <p>
        {paid
          ? "Everything you need to build a lasting writing habit."
          : "Start building your writing habit."}
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
          <>
            <strong>$0</strong>
            <span>forever</span>
          </>
        )}
      </div>
      {trial > 0 && (
        <p className="lp-trial">{trial}-day free trial for eligible accounts</p>
      )}
      {paid && product?.ai_allowance && (
        <p className="lp-trial">
          {product.ai_allowance.suggestions_daily} suggestions/day ·{" "}
          {product.ai_allowance.suggestions_monthly}/calendar month ·{" "}
          {product.ai_allowance.guidance_monthly} Writing Guidance/month. No
          rollover. Existing subscribers retain their assigned terms.
        </p>
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
            ? "Get UnoWord Pro"
            : "Get UnoWord Pro"
          : "Start Writing Free"}
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
          <Brand />
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
                Your Words. Your Voice.
                <br />
                <span>Your Story.</span>
              </h1>
              <h2 className="lp-hero-support">
                Build Better Writing Habits. Break Through Writer's Block.
              </h2>
              <p className="lp-hero-description">
                UnoWord helps you stay consistent, track your progress, and
                discover what to write next—with personalized AI guidance that
                inspires your creativity instead of replacing it.
              </p>
              <div className="lp-hero-buttons">
                <a className="lp-button" href={freeHref}>
                  Start Writing for Free <ArrowRight size={18} />
                </a>
                <a className="lp-button lp-button-outline" href="#features">
                  Explore Features <ArrowRight size={17} />
                </a>
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
        <section
          className="lp-container lp-habit-grid"
          aria-label="Writing habit features for all plans"
        >
          <article>
            <span className="lp-eyebrow">ALL PLANS</span>
            <h2>Every Word Counts.</h2>
            <p>
              Set a daily word target and follow typed-word progress with basic
              statistics. Goal adjustments and prewritten prompts are unlimited.
            </p>
          </article>
          <article>
            <span className="lp-eyebrow">ALL PLANS · PRO BENEFITS</span>
            <h2>Consistency Creates Progress.</h2>
            <p>
              Build your first seven-day streak for free. Recording continues
              beyond Day 7. Pro unlocks your full qualifying streak, history,
              and long-term milestones.
            </p>
          </article>
          <article>
            <span className="lp-eyebrow">CHROME EXTENSION · ALL PLANS</span>
            <h2>Keep Track of Your Writing Wherever You Work.</h2>
            <p>
              Track writing in supported Chrome editors. Your dedicated UnoWord
              editor, rich-text formatting, document library, and folders
              require Pro.
            </p>
          </article>
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
                    {feature.kind !== "progress" && (
                      <span className="lp-feature-plan">Pro feature</span>
                    )}
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
        <section
          className="lp-container lp-philosophy"
          aria-labelledby="coach-philosophy"
        >
          <p className="lp-eyebrow">YOUR CREATIVITY STAYS YOURS</p>
          <h2 id="coach-philosophy">
            AI That Helps You Write. Not AI That Writes for You.
          </h2>
          <p>
            Your ideas deserve your own words. UnoWord helps you find
            inspiration, overcome writer’s block, and build a consistent writing
            habit. Our AI provides suggestions and guidance—but never writes
            your stories or articles.
          </p>
          <div className="lp-philosophy-grid">
            {[
              [
                "Find Your Inspiration",
                "Discover meaningful topics and creative writing directions.",
              ],
              [
                "Overcome Writer’s Block",
                "Receive thoughtful questions to help you decide what to explore next.",
              ],
              [
                "Keep Your Voice",
                "Your creativity stays yours. UnoWord never generates or rewrites your content.",
              ],
            ].map(([title, text]) => (
              <article key={title}>
                <Sparkles size={22} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <strong>You do the writing. UnoWord helps you keep going.</strong>
        </section>
        <section className="lp-how" id="how-it-works">
          <div className="lp-container lp-how-layout">
            <div className="lp-section-intro">
              <h2>A Better Writing Habit Starts With One Word.</h2>
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
                    "AI Writing Guidance",
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
              <LifetimePricing />
            </div>
            <PlanComparison product={product.data} />
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
                  <p>
                    {answer === "__AI_ALLOWANCE__"
                      ? product.data?.ai_allowance
                        ? `New Monthly Pro and Lifetime accounts receive ${product.data.ai_allowance.suggestions_daily} suggestions per day, ${product.data.ai_allowance.suggestions_monthly} per calendar month, and ${product.data.ai_allowance.guidance_monthly} Writing Guidance requests per calendar month. Each generation or regeneration uses one request; viewing saved ideas is free. Failed requests release their reserved credit. Existing protected terms remain in force. No rollover.`
                        : "See the current published limits in your account when configuration is available."
                      : answer}
                  </p>
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
            <Brand light />
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div>
          <Brand />
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

function LifetimePricing() {
  const offer = useLifetimeOffer();
  const value = offer.data;
  return (
    <article className="lp-price-card lp-lifetime-price">
      <span className="lp-plan-badge">Limited one-time offer</span>
      <h3>Lifetime</h3>
      <p>Your writing companion for life.</p>
      <div className="lp-price">
        {value ? (
          <>
            <strong>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: value.currency,
                maximumFractionDigits: 0,
              }).format(value.amount / 100)}
            </strong>
            <span>one-time</span>
          </>
        ) : (
          <span>See published offer terms</span>
        )}
      </div>
      <ul>
        <li>
          <Check size={14} />
          Every Pro Monthly feature
        </li>
        <li>
          <Check size={14} />
          Editor, formatting, documents & folders
        </li>
        <li>
          <Check size={14} />
          Unlimited streaks & qualifying history
        </li>
        <li>
          <Check size={14} />
          Identical AI features and allowances
        </li>
        <li>
          <Check size={14} />
          No recurring lifetime payment
        </li>
      </ul>
      {value?.ai_allowance && (
        <p className="lp-trial">
          {value.ai_allowance.suggestions_daily} suggestions/day ·{" "}
          {value.ai_allowance.suggestions_monthly}/month ·{" "}
          {value.ai_allowance.guidance_monthly} guidance/month. No rollover.
        </p>
      )}
      <p className="lp-trial">
        First 25 qualifying purchasers.{" "}
        {value?.remaining != null
          ? `${value.remaining} places remain, based on verified paid orders.`
          : "Live availability is shown on the lifetime offer page."}{" "}
        14-day refund window.
      </p>
      <Link className="lp-button lp-button-outline" to="/lifetime">
        {value?.remaining === 0
          ? "Offer sold out — view plans"
          : "Get Lifetime Access"}
        <ArrowRight size={16} />
      </Link>
    </article>
  );
}
function PlanComparison({ product }: { product: Product | undefined }) {
  const free = product?.plans.find((p) => p.id === "free")?.features,
    pro = product?.plans.find((p) => p.id === "pro")?.features;
  const rows: [string, string][] = [
    ["session_tracking", "Daily word tracking"],
    ["writing_goals", "Daily writing goals"],
    ["session_tracking", "Basic writing statistics"],
    ["quick_prompt", "Basic non-AI writing prompts"],
    ["session_tracking", "Chrome extension"],
    ["unlimited_writing_streaks", "Visible writing streak"],
    ["session_tracking", "Activity recorded beyond Day 7"],
    ["full_streak_history", "Full qualifying streak history"],
    ["writing_editor", "Built-in writing editor"],
    ["rich_text_formatting", "Rich-text formatting"],
    ["document_library", "Document library"],
    ["document_folders", "Document folders"],
    ["personalized_ai_suggestions", "Personalized AI suggestions"],
    ["ai_writing_guidance", "AI Writing Guidance"],
    ["personalized_writing_profile", "Personalized Writing Profile"],
    ["editor_ai", "AI usage dashboard"],
  ];
  function cell(key: string, paid: boolean) {
    const flags = paid ? pro : free;
    if (!flags) return "Loading…";
    if (key === "quick_prompt") return "Unlimited";
    if (key === "unlimited_writing_streaks")
      return flags[key] ? "Unlimited" : "Up to 7 days";
    if (key === "full_streak_history") return flags[key] ? "Yes" : "Locked";
    return flags[key] ? "Yes" : "No";
  }
  return (
    <div className="lp-plan-comparison">
      <h3>Choose the writing habit that grows with you.</h3>
      <p>
        Build your first seven-day streak for free. Your activity keeps being
        recorded after Day 7. Pro reveals your full qualifying current streak
        and future milestones—without resetting your history.
      </p>
      <table>
        <caption>UnoWord plan features</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Free</th>
            <th scope="col">Pro Monthly</th>
            <th scope="col">Lifetime</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{cell(key, false)}</td>
              <td>{cell(key, true)}</td>
              <td>{cell(key, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Writing days qualify with at least one typed word. Missed required days
        break a current streak; past activity remains saved. Sign in to
        synchronize progress metadata. AI allowances reset in your configured
        timezone and do not roll over. Existing subscribers retain their
        applicable protected terms.
      </p>
    </div>
  );
}
