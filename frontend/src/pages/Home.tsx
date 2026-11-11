import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Check,
  Chrome,
  Compass,
  Flag,
  FolderOpen,
  Lightbulb,
  Menu,
  PenLine,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import StudioShowcase, {
  ProductCapture,
} from "@/components/marketing/StudioShowcase";
import {
  StudioAccordion,
  StudioButton,
  StudioCard,
  StudioContainer,
  StudioImage,
  StudioLink,
  StudioSectionHeading,
} from "@/components/studio/StudioPrimitives";
import { FREE_START, PRO_START, useProduct, type Product } from "@/lib/product";
import { trackMarketingInteraction } from "@/lib/analytics";
import forest from "@/assets/studio/covers/forest-path.webp";
import mountain from "@/assets/studio/covers/mountain-sunrise.webp";
import notebook from "@/assets/studio/covers/open-notebook.webp";
import reading from "@/assets/studio/covers/reading-corner.webp";
import lake from "@/assets/studio/covers/lakeside-reflection.webp";
import tree from "@/assets/studio/covers/tree-and-horizon.webp";
import forestSmall from "@/assets/marketing/illustrations/forest-path-640.webp";
import notebookSmall from "@/assets/marketing/illustrations/open-notebook-640.webp";
import mountainSmall from "@/assets/marketing/illustrations/mountain-sunrise-640.webp";
import readingSmall from "@/assets/marketing/illustrations/reading-corner-640.webp";
import lakeSmall from "@/assets/marketing/illustrations/lakeside-reflection-640.webp";
import treeSmall from "@/assets/marketing/illustrations/tree-and-horizon-640.webp";
import "@/styles/marketing.css";
import "@/styles/landing.css";

const imageVariants: Record<string, string> = {
  [forest]: forestSmall,
  [notebook]: notebookSmall,
  [mountain]: mountainSmall,
  [reading]: readingSmall,
  [lake]: lakeSmall,
  [tree]: treeSmall,
};
const navigation = [
  ["Features", "features"],
  ["How It Works", "how-it-works"],
  ["Who It’s For", "who-its-for"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
];
const features = [
  {
    icon: PenLine,
    name: "Write",
    headline: "A quieter place to write.",
    text: "An inviting writing environment with formatting, focus mode, and a visible save status. Keep your attention on your words.",
    access: "Pro",
    screen: "editor" as const,
  },
  {
    icon: Target,
    name: "Writing Goals",
    headline: "Small goals. Meaningful progress.",
    text: "Set personal goals and work toward them one word at a time. Typed words build your habit; pasted words stay distinct.",
    access: "Free + Pro",
    screen: "home" as const,
  },
  {
    icon: BarChart3,
    name: "Progress",
    headline: "See how far you’ve come.",
    text: "Review writing sessions, activity, and personal milestones. Pro adds extended trends and full qualifying streak history.",
    access: "Free + Pro",
    screen: "progress" as const,
  },
  {
    icon: Lightbulb,
    name: "Ideas",
    headline: "Discover where to begin.",
    text: "Explore unlimited, non-AI Quick Prompts. Pro adds personalized suggestions, guiding questions, and fresh perspectives.",
    access: "Free + Pro",
    screen: "ideas" as const,
  },
  {
    icon: Sparkles,
    name: "AI Guidance",
    headline: "Your voice stays yours.",
    text: "Explore angles, questions, and structure with thoughtful guidance. Choose context for a request and keep every authored sentence your own.",
    access: "Pro",
    screen: "guidance" as const,
  },
  {
    icon: FolderOpen,
    name: "Library",
    headline: "A home for your creative world.",
    text: "Organize projects, writing, reference sources, and saved ideas. Your Writing Profile and selected context stay within reach.",
    access: "Pro",
    screen: "library" as const,
  },
];
const freeFeatures = [
  ["session_tracking", "Writing sessions & basic statistics"],
  ["writing_goals", "Daily writing goals & visible streaks up to 7 days"],
  ["quick_prompt", "Unlimited non-AI Quick Prompts"],
  ["basic_history", "Chrome extension & recent history"],
];
const proFeatures = [
  ["session_tracking", "Everything in Free"],
  ["writing_editor", "Built-in writing editor & rich-text formatting"],
  ["document_library", "Private document library"],
  ["document_folders", "Document folders"],
  [
    "unlimited_writing_streaks",
    "Unlimited visible streaks & full qualifying history",
  ],
  ["personalized_ai_suggestions", "Personalized writing ideas"],
  ["ai_writing_guidance", "AI Writing Guidance"],
  [
    "personalized_writing_profile",
    "Writing Profile & selected reference context",
  ],
  ["goals_analytics", "Extended writing analytics"],
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
  const plan = product?.plans.find((p) => p.id === (paid ? "pro" : "free")),
    price = plan?.price;
  const trial = paid && product?.billing_available ? price?.trial_days || 0 : 0;
  const priceText = price
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: price.currency,
        maximumFractionDigits: 2,
      }).format(price.amount / 100)
    : null;
  return (
    <StudioCard className={"lp-price-card" + (paid ? " lp-price-pro" : "")}>
      <p className="lp-plan-label">
        {paid ? "MORE ROOM TO GROW" : "YOUR FIRST WORD"}
      </p>
      <h3>{paid ? "Pro" : "Free"}</h3>
      <p>
        {paid
          ? "More insight and personalization for your writing practice."
          : "A simple place to begin."}
      </p>
      <div className="lp-price">
        {paid ? (
          priceText ? (
            <>
              <strong>{priceText}</strong>
              <span>/{price!.interval}</span>
            </>
          ) : (
            <span>See the current offer in your account</span>
          )
        ) : (
          <strong>Free to start</strong>
        )}
      </div>
      {trial > 0 && (
        <p className="lp-trial">{trial}-day free trial for eligible accounts</p>
      )}
      {plan ? (
        <ul>
          {(paid ? proFeatures : freeFeatures)
            .filter(([key]) => plan.features[key])
            .map(([key, label]) => (
              <li key={key}>
                <Check size={17} aria-hidden="true" />
                {label}
              </li>
            ))}
        </ul>
      ) : (
        <p role="status">
          {failed
            ? "Plan details are temporarily unavailable. Check your account for current access."
            : "Loading current plan features…"}
        </p>
      )}
      {paid && product?.ai_allowance && (
        <p className="lp-allowance">
          {product.ai_allowance.suggestions_daily} suggestions/day ·{" "}
          {product.ai_allowance.suggestions_monthly}/calendar month ·{" "}
          {product.ai_allowance.guidance_monthly} Writing Guidance/month. No
          rollover. Existing subscribers retain their assigned terms.
        </p>
      )}
      <StudioLink
        to={paid ? PRO_START : FREE_START}
        variant={paid ? "default" : "outline"}
        onClick={() =>
          trackMarketingInteraction(
            paid ? "explore_pro" : "start_free",
            "pricing",
          )
        }
      >
        {paid ? "Explore Pro" : "Get Started Free"}
        <ArrowRight size={16} aria-hidden="true" />
      </StudioLink>
      {paid && (
        <small>
          {trial > 0
            ? `Then ${priceText}/${price!.interval}. Payment method required. Cancel before the trial ends to avoid a charge.`
            : product?.billing_available
              ? "Review your offer and confirm in your account."
              : "Checkout is currently unavailable. Your plan will not change."}
        </small>
      )}
    </StudioCard>
  );
}
export default function Home() {
  const product = useProduct(),
    [menuOpen, setMenuOpen] = useState(false),
    [theme, setTheme] = useState("light");
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("uno-writing-theme") === "dark")
        setTheme("dark");
    } catch {
      /* Public page works without storage. */
    }
  }, []);
  useEffect(() => {
    const media = matchMedia("(min-width:900px)"),
      close = () => {
        if (media.matches) setMenuOpen(false);
      };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }
  const faq = [
    {
      question: "What is UnoWord?",
      answer:
        "UnoWord is a personal writing companion for developing ideas, building writing habits, and tracking progress. Pro adds a focused editor, private library, and thoughtful AI guidance while keeping your writing voice at the center.",
    },
    {
      question: "Is UnoWord free?",
      answer:
        "Yes. Free includes Chrome extension session tracking, daily goals, recent history, visible streaks up to seven days, and unlimited non-AI Quick Prompts. Recording continues beyond Day 7. The built-in editor, private document library, extended analytics, and personalized AI require Pro. Current access and offers are shown above and in your account.",
    },
    {
      question: "How does the browser extension work?",
      answer:
        "Start a session and write in supported text fields or contenteditable editors. The floating counter shows your progress; Pause and End control the session. Google Docs canvas editing and Chrome-restricted pages are not supported. Existing unpacked installations require a local update and reload.",
    },
    {
      question: "Can UnoWord help me find writing ideas?",
      answer:
        "Quick Prompt offers unlimited prompts without AI or AI credits. Pro adds New Topic, Expand an Idea, and Connect the Dots, with explicit requests and your account’s existing AI allowances.",
    },
    {
      question: "Does UnoWord write content for me?",
      answer:
        "No. UnoWord offers questions, directions, and structure to help you explore your ideas. AI guidance stays separate from authored writing; it does not automatically insert finished articles or rewrite your prose.",
    },
    {
      question: "Can I track my writing goals?",
      answer:
        "Yes. Set a daily word goal and review typed words and session activity. Session time, today’s writing time, and lifetime time remain distinct. Qualifying typed words build streaks; pasted words do not.",
    },
    {
      question: "Can I use my documents for AI personalization?",
      answer:
        "Eligible Pro accounts can select reference materials and a Writing Profile. Source permissions, processing readiness, and request context determine what is available. Sharing the current draft for a request requires your choice; opening a page does not send your writing to AI.",
    },
    {
      question: "Where is my writing saved?",
      answer: (
        <>
          <p>
            Editor drafts save on this device and sync to your signed-in account
            when connected. Offline changes can be recovered and reconciled.
            Extension progress sync uses counts and timing, not your writing
            text; saving writing to AI Memory is a separate choice.
          </p>
          <p>
            Read the <Link to="/privacy">Privacy Policy</Link> for storage,
            providers, retention, and current limitations.
          </p>
        </>
      ),
    },
    {
      question: "Can I cancel my subscription?",
      answer:
        "For Stripe-managed subscriptions, open your account to manage or cancel through the existing billing portal. Substack-linked and existing Lifetime access have their own account controls and applicable terms. Your plan does not change just because you visit pricing.",
    },
    {
      question: "How can I contact support?",
      answer: (
        <>
          <Link to="/support">Visit Support</Link> for installation, account,
          billing, and writing recovery help.
        </>
      ),
    },
  ];
  return (
    <div className="uw-site lp-site" data-studio-theme={theme}>
      <a className="uw-studio-skip lp-skip" href="#main">
        Skip to content
      </a>
      <header className="lp-header">
        <StudioContainer className="lp-header-inner">
          <Brand />
          <nav className="lp-desktop-nav" aria-label="Main navigation">
            {navigation.map(([label, id]) => (
              <a key={id} href={"#" + id}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <Link className="lp-sign-in" to="/account?mode=signin">
              Sign In
            </Link>
            <StudioLink
              to={FREE_START}
              className="lp-header-cta"
              onClick={() => trackMarketingInteraction("start_free", "header")}
            >
              Start Writing Free
            </StudioLink>
            <StudioButton
              ref={menuButton}
              variant="ghost"
              className="lp-menu-button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="marketing-mobile-nav"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <X aria-hidden="true" />
              ) : (
                <Menu aria-hidden="true" />
              )}
            </StudioButton>
          </div>
        </StudioContainer>
        <nav
          id="marketing-mobile-nav"
          className="lp-mobile-nav"
          aria-label="Mobile navigation"
          hidden={!menuOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu();
            }
          }}
        >
          {navigation.map(([label, id]) => (
            <a key={id} href={"#" + id} onClick={closeMenu}>
              {label}
            </a>
          ))}
          <Link to="/account?mode=signin">Sign In</Link>
          <StudioLink
            to={FREE_START}
            onClick={() => trackMarketingInteraction("start_free", "header")}
          >
            Start Writing Free
          </StudioLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="hero-heading">
          <StudioContainer className="lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="uw-studio-eyebrow">A MORE PERSONAL WAY TO WRITE</p>
              <h1 id="hero-heading">
                Your ideas deserve
                <br className="lp-desktop-break" /> a place to grow.
              </h1>
              <p className="lp-hero-support">
                Write more. Find your flow. Discover what’s next.
              </p>
              <p className="lp-hero-description">
                Meet UnoWord, your personal writing companion. Build a writing
                habit, track your progress, and discover meaningful ideas with
                thoughtful AI guidance that keeps your voice at the center.
              </p>
              <div className="lp-hero-buttons">
                <StudioLink
                  to={FREE_START}
                  onClick={() =>
                    trackMarketingInteraction("start_free", "hero")
                  }
                >
                  Start Writing Free
                  <ArrowRight aria-hidden="true" />
                </StudioLink>
                <StudioLink
                  to="#showcase"
                  variant="outline"
                  onClick={() =>
                    trackMarketingInteraction("explore_product", "hero")
                  }
                >
                  Explore UnoWord
                </StudioLink>
              </div>
              <p className="lp-slogan">Every idea starts with Uno Word.</p>
              <p className="lp-plan-note">
                Free tracking & Quick Prompts. Editor and personalized AI with
                Pro.
              </p>
            </div>
            <div className="lp-hero-preview">
              <ProductCapture screen="home" priority />
            </div>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-journey"
          aria-labelledby="journey-heading"
        >
          <StudioContainer className="lp-journey-grid">
            <StudioImage
              src={forest}
              srcSet={`${imageVariants[forest]} 640w, ${forest} 960w`}
              sizes="(max-width:599px) calc(100vw - 32px), (max-width:899px) 45vw, 30vw"
              fetchPriority="low"
              width={960}
              height={640}
              alt="Morning light falls across a winding path through a blue and gold forest."
              loading="lazy"
            />
            <div>
              <p className="uw-studio-eyebrow">THE WRITING JOURNEY</p>
              <h2 id="journey-heading">
                Writing shouldn’t feel like starting over every day.
              </h2>
              <p>
                You have stories to tell, ideas to explore, and projects waiting
                to be finished. But finding the time, motivation, and direction
                to keep writing isn’t always easy.
              </p>
              <p>
                UnoWord helps you turn those moments of uncertainty into
                opportunities to begin.
              </p>
            </div>
          </StudioContainer>
          <StudioContainer className="lp-problem-cards">
            {[
              {
                icon: PenLine,
                title: "Finding the first words",
                text: "Explore prompts and guiding questions that help you discover where to begin.",
              },
              {
                icon: Target,
                title: "Staying consistent",
                text: "Create achievable writing goals and build a rhythm that works for you.",
              },
              {
                icon: BarChart3,
                title: "Seeing your progress",
                text: "Track writing sessions and recognize how your efforts add up.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <StudioCard key={title}>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </StudioCard>
            ))}
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-features"
          id="features"
          aria-labelledby="features-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="features-heading"
              eyebrow="THOUGHTFULLY MADE FOR WRITERS"
              title="Everything you need to keep moving forward."
              description="A thoughtful collection of tools designed to support your creativity, consistency, and authentic writing voice."
            />
            <div className="lp-feature-index">
              {features.map(({ icon: Icon, name, access }, i) => (
                <a key={name} href={"#feature-" + i}>
                  <Icon aria-hidden="true" />
                  <strong>{name}</strong>
                  <span>{access}</span>
                </a>
              ))}
            </div>
            <div className="lp-feature-stories">
              {features.map(({ name, headline, text, access, screen }, i) => (
                <article
                  className="lp-feature-story"
                  id={"feature-" + i}
                  key={name}
                >
                  <div className="lp-feature-copy">
                    <p className="uw-studio-eyebrow">
                      {name} · {access}
                    </p>
                    <h3>{headline}</h3>
                    <p>{text}</p>
                    <StudioLink
                      to={access === "Pro" ? PRO_START : FREE_START}
                      variant="outline"
                      onClick={() =>
                        trackMarketingInteraction(
                          access === "Pro" ? "explore_pro" : "start_free",
                          "features",
                        )
                      }
                    >
                      {access === "Pro" ? "Explore Pro" : "Start Writing Free"}
                      <ArrowRight size={16} aria-hidden="true" />
                    </StudioLink>
                  </div>
                  <ProductCapture screen={screen} />
                </article>
              ))}
            </div>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-showcase"
          id="showcase"
          aria-labelledby="showcase-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="showcase-heading"
              eyebrow="WELCOME TO YOUR STUDIO"
              title="A writing studio that feels like yours."
              description="Everything you need to begin, focus, and make progress—thoughtfully organized in one welcoming space."
            />
            <StudioShowcase />
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-how"
          id="how-it-works"
          aria-labelledby="how-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="how-heading"
              eyebrow="HOW IT WORKS"
              title="One idea. One session. One step forward."
            />
            <div className="lp-steps">
              {[
                {
                  icon: Compass,
                  title: "Find your starting point",
                  text: "Choose a writing project or explore a thoughtful prompt.",
                },
                {
                  icon: PenLine,
                  title: "Make time for your words",
                  text: "Begin writing, work toward your goal, and find your rhythm.",
                },
                {
                  icon: Flag,
                  title: "See your progress grow",
                  text: "Review your writing activity and return to your work with renewed direction.",
                },
              ].map(({ icon: Icon, title, text }, i) => (
                <article key={title}>
                  <span className="lp-step-number">0{i + 1}</span>
                  <Icon aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
            <p className="lp-sample-note">
              Projects and the built-in editor require Pro. Free works with
              Quick Prompt and the Chrome extension.
            </p>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-ai"
          id="ai-companion"
          aria-labelledby="ai-heading"
        >
          <StudioContainer className="lp-ai-grid">
            <div>
              <p className="uw-studio-eyebrow">THOUGHTFUL AI GUIDANCE · PRO</p>
              <h2 id="ai-heading">Your voice stays yours.</h2>
              <p>
                Your experiences, ideas, and perspective make your writing
                meaningful.
              </p>
              <p>
                UnoWord uses AI to help you explore possibilities, ask better
                questions, and develop your ideas—not to replace your words with
                someone else’s.
              </p>
              <p>
                Your Writing Profile and selected, permitted references can make
                suggestions more personally relevant.
              </p>
              <ul>
                {[
                  "Explore fresh writing angles.",
                  "Discover guiding questions.",
                  "Develop ideas and outlines.",
                  "Draw inspiration from chosen sources.",
                  "Maintain control over your own writing.",
                ].map((text) => (
                  <li key={text}>
                    <Check size={16} aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ul>
              <Link className="lp-text-link" to="/privacy">
                Read how AI context is handled
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <ProductCapture screen="guidance" />
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-audiences"
          id="who-its-for"
          aria-labelledby="audience-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="audience-heading"
              eyebrow="WHO IT’S FOR"
              title="For every kind of writer."
            />
            <div className="lp-audience-grid">
              {[
                {
                  image: notebook,
                  title: "Bloggers and newsletter writers",
                  text: "Find fresh perspectives and maintain a consistent writing rhythm.",
                },
                {
                  image: mountain,
                  title: "Authors and aspiring authors",
                  text: "Make steady progress on chapters, manuscripts, and stories.",
                },
                {
                  image: reading,
                  title: "Content creators and freelancers",
                  text: "Organize ideas and build momentum across writing projects.",
                },
                {
                  image: lake,
                  title: "Everyday writers",
                  text: "Journal, reflect, explore your thoughts, and develop meaningful ideas.",
                },
              ].map(({ image, title, text }) => (
                <StudioCard key={title}>
                  <StudioImage
                    src={image}
                    srcSet={`${imageVariants[image]} 640w, ${image} 960w`}
                    sizes="(max-width:599px) calc(100vw - 32px), (max-width:899px) 45vw, 30vw"
                    fetchPriority="low"
                    alt=""
                    width={960}
                    height={640}
                    loading="lazy"
                  />
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </StudioCard>
              ))}
            </div>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-pricing"
          id="pricing"
          aria-labelledby="pricing-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="pricing-heading"
              eyebrow="A LITTLE ROOM TO BEGIN. MORE ROOM TO GROW."
              title="Start free. Grow at your pace."
              description="Choose the support that fits your writing practice. Your words and your progress stay yours."
            />
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
              Current features and offers come from UnoWord’s product
              configuration. Sign in to review your account’s terms. Visiting
              this page never starts a subscription or changes your plan.
            </p>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-trust"
          aria-labelledby="trust-heading"
        >
          <StudioContainer>
            <ShieldCheck size={30} aria-hidden="true" />
            <h2 id="trust-heading">Your writing is personal. We understand.</h2>
            <p>
              Your ideas, unfinished drafts, and creative projects deserve
              thoughtful handling. UnoWord provides clear information about
              storage, synchronization, permissions, and the providers used by
              its tools.
            </p>
            <nav aria-label="Privacy and support">
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/support">Support</Link>
            </nav>
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-faq"
          id="faq"
          aria-labelledby="faq-heading"
        >
          <StudioContainer>
            <StudioSectionHeading
              id="faq-heading"
              eyebrow="A FEW GOOD QUESTIONS"
              title="Before you find your first word."
            />
            <StudioAccordion items={faq} />
          </StudioContainer>
        </section>
        <section
          className="lp-section lp-final-cta"
          aria-labelledby="final-heading"
        >
          <StudioContainer>
            <StudioImage
              src={tree}
              srcSet={`${imageVariants[tree]} 640w, ${tree} 960w`}
              sizes="(max-width:599px) calc(100vw - 32px), (max-width:899px) 45vw, 30vw"
              fetchPriority="low"
              alt=""
              width={960}
              height={640}
              loading="lazy"
            />
            <div>
              <p className="uw-studio-eyebrow">YOUR NEXT CHAPTER</p>
              <h2 id="final-heading">
                Your next great idea starts with one word.
              </h2>
              <p>
                Start small. Find your rhythm. Discover where your words can
                take you.
              </p>
              <StudioLink
                to={FREE_START}
                onClick={() => trackMarketingInteraction("start_free", "final")}
              >
                Start Writing Free
                <ArrowRight aria-hidden="true" />
              </StudioLink>
              <p className="lp-slogan">Every idea starts with Uno Word.</p>
            </div>
          </StudioContainer>
        </section>
      </main>
      <footer className="lp-footer">
        <StudioContainer>
          <div>
            <Brand />
            <p>
              A thoughtful place for your creativity,
              <br />
              consistency, and authentic writing voice.
            </p>
            <small>© {new Date().getFullYear()} UnoWord</small>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <Link to="/account?mode=signin">Sign In</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/support">Contact & Support</Link>
          </nav>
          {product.data?.chrome_store_url && (
            <a
              className="lp-text-link"
              href={product.data.chrome_store_url}
              onClick={() =>
                trackMarketingInteraction("install_extension", "footer")
              }
            >
              <Chrome size={18} aria-hidden="true" />
              Chrome Web Store
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          )}
        </StudioContainer>
      </footer>
    </div>
  );
}
