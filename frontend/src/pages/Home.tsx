import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  Chrome,
  CircleCheck,
  Feather,
  FileText,
  Flame,
  FolderOpen,
  Layers3,
  Lightbulb,
  LockKeyhole,
  Menu,
  MessageCircle,
  Minus,
  NotebookPen,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Users,
  X,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import ProductPreview from "@/components/marketing/ProductPreview";
import { FREE_START, PRO_START, useProduct } from "@/lib/product";
import "@/styles/marketing.css";

const navigation = [
  ["Features", "features"],
  ["How it works", "how-it-works"],
  ["AI companion", "ai-companion"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
];
const features = [
  {
    icon: PencilLine,
    title: "Every word counts.",
    category: "LIVE WORD TRACKING",
    text: "Start a session and find your flow. Track the words you type in supported editors, with pasted words counted separately.",
    extra: "A clearer picture of your own writing.",
  },
  {
    icon: Target,
    title: "Small steps. Real progress.",
    category: "GOALS & CONSISTENCY",
    text: "Set a session word goal with Pro. Follow your streak and make a little space for writing, one day at a time.",
    extra: "Build a habit that feels like yours.",
  },
  {
    icon: Sparkles,
    title: "A spark when you need it.",
    category: "WRITING INSPIRATION",
    text: "Reach for a quick prompt, discover a fresh topic, or find a new direction for an idea you already love.",
    extra: "Less blank-page staring. More beginnings.",
  },
  {
    icon: Users,
    title: "Your interests come first.",
    category: "MY WRITING PROFILE",
    text: "Share your writing goals, favorite subjects, audience, and style. Your saved preferences help guide Pro AI suggestions.",
    extra: "Make it personal. Keep it editable.",
  },
  {
    icon: FolderOpen,
    title: "Give your ideas a home.",
    category: "YOUR WRITING KNOWLEDGE",
    text: "With Pro, add supported documents, public website references, and writing you choose to save to memory.",
    extra: "Your material. More meaningful possibilities.",
  },
  {
    icon: BarChart3,
    title: "See how far you’ve come.",
    category: "HISTORY & INSIGHTS",
    text: "Look back at recent sessions on Free. Explore your longer writing history and progress views with Pro.",
    extra: "The little wins deserve a little recognition.",
  },
];
const modes = [
  {
    id: "original",
    icon: PencilLine,
    title: "Quick Prompt",
    tag: "Free & Pro",
    text: "A simple spark to get you started.",
    titleExample: "Start with a small moment.",
    direction:
      "Write about an ordinary moment that turned out to matter more than you expected.",
    questions: [
      "What detail do you remember most?",
      "What changed in the way you saw it?",
      "Where could that moment lead?",
    ],
    sources: ["A simple writing prompt"],
  },
  {
    id: "new_topic",
    icon: Lightbulb,
    title: "New Topic",
    tag: "Pro",
    text: "Something fresh, shaped by your interests.",
    titleExample: "What a windowsill garden can teach us about starting.",
    direction:
      "Explore the parallels between growing a tiny herb garden and beginning a creative practice. Both can start small, thrive on attention, and leave room for a little uncertainty.",
    questions: [
      "What did you learn by starting small?",
      "Which daily practice made a difference?",
      "What would you tell someone beginning today?",
    ],
    sources: ["Writing Profile: personal essays", "Selected theme: nature"],
  },
  {
    id: "expand_idea",
    icon: BookOpen,
    title: "Expand an Idea",
    tag: "Pro",
    text: "Take a beginning a little further.",
    titleExample: "Give your morning ritual a bigger story.",
    direction:
      "Take your idea about a quiet morning coffee and explore what that ritual makes space for. Begin with a sensory detail, then move into the thought or memory that arrives with it.",
    questions: [
      "What makes this morning feel different?",
      "What does the quiet let you notice?",
      "How could one small ritual reveal a bigger change?",
    ],
    sources: ["Example draft: a quiet morning coffee"],
  },
  {
    id: "connect_dots",
    icon: Layers3,
    title: "Connect the Dots",
    tag: "Pro",
    text: "Find the thread between different ideas.",
    titleExample: "The quiet connection between gardens and creative routines.",
    direction:
      "Bring together your garden observations and notes on creative routines. Explore how paying attention, rather than chasing immediate results, can change what you grow and what you write.",
    questions: [
      "What do both practices ask you to notice?",
      "When does patience become useful?",
      "Where does the comparison stop working?",
    ],
    sources: [
      "Example source: garden observations",
      "Example source: creative routines",
    ],
  },
];
const audiences = [
  [NotebookPen, "Bloggers", "Find your next angle. Keep your voice."],
  [BookOpen, "Authors", "Build worlds, ideas, and a steady practice."],
  [
    MessageCircle,
    "Newsletter writers",
    "Turn your interests into your next edition.",
  ],
  [Feather, "Journal writers", "Make a little room to reflect."],
  [
    Lightbulb,
    "Content creators",
    "Connect scattered thoughts into something new.",
  ],
  [Sprout, "Aspiring writers", "Start with one word. See where it goes."],
];
const faqs = [
  [
    "What is UnoWord?",
    "UnoWord is a Chrome extension and personal writing companion. It helps you track active writing sessions, follow your progress, and find your next idea with quick prompts or personalized Pro AI suggestions.",
  ],
  [
    "Is UnoWord free?",
    "Yes. Free includes session tracking, Quick Prompt, recent writing history, and an editable Writing Profile. Pro adds the three AI suggestion modes, knowledge sources, writing goals, and extended history. Pro is $20 USD monthly, with a 7-day free trial for eligible accounts when checkout is available.",
  ],
  [
    "How does UnoWord count words?",
    "Start a session in the extension and write in a supported text field or editor. UnoWord tracks typed and pasted words separately; pasted text does not count toward your typed-word progress. Deletions and undo are reconciled with the editor. Google Docs’ canvas-based main editor is not currently supported.",
  ],
  [
    "How are AI suggestions personalized?",
    "Pro suggestions use your latest saved Writing Profile and selected themes, alongside available documents, website content, writing memory, and relevant previous ideas. You choose what to share. Editing your profile changes the preferences used on your next AI request. AI suggestions need an internet connection.",
  ],
  [
    "Can I use UnoWord without AI?",
    "Absolutely. Word tracking, local writing sessions, and Quick Prompt work without the three Pro AI modes. The original prompt library does not need an AI request.",
  ],
  [
    "Can I change my subscription later?",
    "Sign in to your account to open Stripe Checkout or manage an existing Stripe subscription. Pro is $20 USD monthly after a 7-day trial, available once per account; a payment method is required. You can cancel through the billing portal. Scheduled cancellation retains access until the trial or paid period ends. Checkout remains unavailable until billing setup is complete.",
  ],
  [
    "Is my writing private?",
    "Session counts and preferences are stored locally in the extension. The extension observes input in supported editors while a session is active. When you choose to use cloud features, profile information, saved writing, documents, website references, and relevant context can be processed by Supabase and the configured AI provider. Account data uses user-scoped access controls. See Privacy & data for the details and current limitations.",
  ],
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMode, setActiveMode] = useState(1);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const product = useProduct();
  const mode = modes[activeMode];
  const freeHref = product.data?.chrome_store_url || FREE_START;
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = [
      "ArrowRight",
      "ArrowLeft",
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
    ];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 3
          : (index +
              (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : 3)) %
            4;
    setActiveMode(next);
    document.getElementById(`mode-tab-${next}`)?.focus();
  }
  return (
    <div className="uw-site">
      <a className="uw-skip" href="#main">
        Skip to content
      </a>
      <header className="uw-header">
        <div className="uw-container uw-header-inner">
          <Brand />
          <nav className="uw-desktop-nav" aria-label="Main navigation">
            {navigation.map(([name, id]) => (
              <a key={id} href={`#${id}`}>
                {name}
              </a>
            ))}
          </nav>
          <div className="uw-header-actions">
            <Link className="uw-sign-in" to="/account?mode=signin">
              Sign in
            </Link>
            <a className="uw-button uw-button-small" href={freeHref}>
              Get UnoWord Free <ArrowUpRight size={15} />
            </a>
            <button
              className="uw-menu-button"
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
            id="mobile-navigation"
            className="uw-mobile-nav"
            aria-label="Mobile navigation"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenuOpen(false);
                document
                  .querySelector<HTMLButtonElement>(".uw-menu-button")
                  ?.focus();
              }
            }}
          >
            {navigation.map(([name, id]) => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                {name}
                <ArrowUpRight size={16} />
              </a>
            ))}
            <Link to="/account?mode=signin">
              Sign in <ArrowRight size={16} />
            </Link>
          </nav>
        )}
      </header>
      <main id="main">
        <section className="uw-hero">
          <div className="uw-container uw-hero-grid">
            <div className="uw-hero-copy">
              <p className="uw-eyebrow">
                <span className="uw-live-dot" /> YOUR PERSONAL WRITING COMPANION
              </p>
              <h1>
                Write more.
                <br />
                Stay inspired.
                <br />
                <span>Find your next idea.</span>
              </h1>
              <p className="uw-hero-description">
                Build your writing habit, track every word, and discover
                personalized writing ideas with an AI companion that understands
                your interests and goals.
              </p>
              <div className="uw-hero-buttons">
                <a href={freeHref} className="uw-button">
                  Get UnoWord Free <ArrowRight size={19} />
                </a>
                <a href="#features" className="uw-button uw-button-outline">
                  Explore features <ArrowDown size={17} />
                </a>
              </div>
              <p className="uw-hero-footnote">
                <Chrome size={16} /> Made for Chrome <span>·</span> Start for
                free
              </p>
              <div className="uw-hero-tags">
                <span>
                  <CircleCheck size={15} /> Track words
                </span>
                <span>
                  <CircleCheck size={15} /> Discover ideas
                </span>
                <span>
                  <CircleCheck size={15} /> Build habits
                </span>
              </div>
            </div>
            <ProductPreview />
          </div>
          <div className="uw-container uw-benefit-strip">
            <p>
              A little structure.
              <br />
              <strong>A lot more possibility.</strong>
            </p>
            <div>
              <PencilLine />
              <span>
                Make room
                <br />
                <b>for your words.</b>
              </span>
            </div>
            <div>
              <Lightbulb />
              <span>
                Find a spark
                <br />
                <b>when you need one.</b>
              </span>
            </div>
            <div>
              <Flame />
              <span>
                Keep showing up.
                <br />
                <b>See yourself grow.</b>
              </span>
            </div>
          </div>
        </section>

        <section className="uw-section uw-container uw-problem">
          <div>
            <p className="uw-eyebrow">FOR THE WORDS STILL WAITING</p>
            <h2>
              Writing isn’t always
              <br />
              the hard part.
            </h2>
          </div>
          <div>
            <h3>Knowing what to write—and showing up consistently—is.</h3>
            <p>
              Some days the words flow. Other days you stare at a blank page,
              unsure where to begin.
            </p>
            <p>
              UnoWord helps you turn scattered ideas into a sustainable writing
              practice. Track your progress, celebrate consistency, and discover
              your next writing direction.
            </p>
          </div>
        </section>

        <section id="features" className="uw-section uw-feature-section">
          <div className="uw-container">
            <div className="uw-section-heading">
              <div>
                <p className="uw-eyebrow">
                  A LITTLE HELP, FROM START TO FINISH
                </p>
                <h2>
                  Everything you need
                  <br />
                  to keep writing.
                </h2>
              </div>
              <p>
                For the first sentence, the next chapter,
                <br className="uw-desktop-break" /> and every little win in
                between.
              </p>
            </div>
            <div className="uw-feature-grid">
              {features.map(
                ({ icon: Icon, title, category, text, extra }, index) => (
                  <article
                    className={`uw-feature-card uw-feature-${index}`}
                    key={title}
                  >
                    <span className="uw-icon-tile">
                      <Icon size={23} />
                    </span>
                    <p className="uw-card-eyebrow">{category}</p>
                    <h3>{title}</h3>
                    <p>{text}</p>
                    <span className="uw-feature-extra">{extra}</span>
                    {index === 0 && (
                      <div className="uw-mini-bars" aria-hidden="true">
                        {[28, 46, 37, 64, 53, 81, 96].map((height, i) => (
                          <i key={i} style={{ height: height + "%" }} />
                        ))}
                        <span>One session at a time ↗</span>
                      </div>
                    )}
                  </article>
                ),
              )}
            </div>
          </div>
        </section>

        <section
          id="ai-companion"
          className="uw-section uw-container uw-ai-section"
        >
          <div className="uw-centered-heading">
            <p className="uw-eyebrow">
              <Sparkles size={14} /> MEET YOUR AI WRITING COMPANION
            </p>
            <h2>
              Your ideas deserve more
              <br />
              than a generic prompt.
            </h2>
            <p>
              Discover something new. Take an idea further. Find a connection
              you hadn’t seen.
              <br className="uw-desktop-break" /> Four ways to move from “what
              if” to your next words.
            </p>
          </div>
          <div className="uw-ai-showcase">
            <div
              className="uw-mode-list"
              role="tablist"
              aria-label="Writing suggestion modes"
            >
              {modes.map(({ icon: Icon, title, text, tag }, index) => (
                <button
                  type="button"
                  role="tab"
                  key={title}
                  id={`mode-tab-${index}`}
                  aria-controls="mode-example"
                  aria-selected={activeMode === index}
                  tabIndex={activeMode === index ? 0 : -1}
                  onClick={() => setActiveMode(index)}
                  onKeyDown={(event) => tabKeys(event, index)}
                  className={`uw-mode-card${activeMode === index ? " is-active" : ""}`}
                >
                  <span className="uw-mode-icon">
                    <Icon size={21} />
                  </span>
                  <span className="uw-mode-copy">
                    <span>
                      <strong>{title}</strong>
                      <small>{tag}</small>
                    </span>
                    <span>{text}</span>
                  </span>
                  <ArrowUpRight className="uw-mode-arrow" size={17} />
                </button>
              ))}
              <p className="uw-mode-note">
                <Check size={15} /> Quick Prompt is on Free and Pro.
                <br />
                The three personalized AI modes are Pro features.
              </p>
            </div>
            <div
              id="mode-example"
              role="tabpanel"
              aria-labelledby={`mode-tab-${activeMode}`}
              tabIndex={0}
              className="uw-example-panel"
            >
              <div className="uw-example-top">
                <span>
                  <Sparkles size={16} /> A LITTLE INSPIRATION
                </span>
                <span className="uw-example-badge">Fictional example</span>
              </div>
              <div key={mode.id} className="uw-example-content">
                <span className="uw-example-mode">{mode.title}</span>
                <h3>{mode.titleExample}</h3>
                <p>{mode.direction}</p>
                <div className="uw-example-questions">
                  <span>A few ways in</span>
                  {mode.questions.map((question) => (
                    <p key={question}>
                      <span>↳</span>
                      {question}
                    </p>
                  ))}
                </div>
                <div className="uw-example-sources">
                  {mode.sources.map((source) => (
                    <span key={source}>
                      <FileText size={12} />
                      {source}
                    </span>
                  ))}
                </div>
              </div>
              <p className="uw-demo-disclosure">
                An illustrative suggestion, not a live AI response.
              </p>
            </div>
          </div>
        </section>

        <section className="uw-personalization">
          <div className="uw-container uw-personalization-grid">
            <div>
              <p className="uw-eyebrow">INSPIRED BY WHAT MATTERS TO YOU</p>
              <h2>
                A companion that gets
                <br />
                to know your interests.
              </h2>
              <p>
                The more relevant information you choose to share, the more
                context UnoWord can use to personalize your next suggestion.
              </p>
              <p className="uw-control-note">
                <ShieldCheck size={20} />
                <span>
                  You choose what to share.
                  <br />
                  <strong>
                    You can edit your profile and manage your sources.
                  </strong>
                </span>
              </p>
              <Link className="uw-text-link" to={FREE_START}>
                Make UnoWord yours <ArrowRight size={17} />
              </Link>
            </div>
            <div className="uw-personalization-visual">
              <div className="uw-flow-step">
                <span className="uw-flow-icon">
                  <Users />
                </span>
                <div>
                  <small>01 · YOUR INTERESTS</small>
                  <h3>A little about you</h3>
                  <p>Writing Profile · Goals · Selected themes</p>
                  <div className="uw-interest-chips">
                    <span>Personal essays</span>
                    <span>Nature</span>
                    <span>Curiosity</span>
                  </div>
                </div>
              </div>
              <span className="uw-flow-connector" aria-hidden="true">
                ↓
              </span>
              <div className="uw-flow-step">
                <span className="uw-flow-icon">
                  <FolderOpen />
                </span>
                <div>
                  <small>02 · YOUR WRITING KNOWLEDGE</small>
                  <h3>The things you choose to share</h3>
                  <p>Documents · Websites · Writing memory · Ideas</p>
                </div>
              </div>
              <span className="uw-flow-connector" aria-hidden="true">
                ↓
              </span>
              <div className="uw-flow-step uw-flow-result">
                <span className="uw-flow-icon">
                  <Sparkles />
                </span>
                <div>
                  <small>03 · PERSONALIZED POSSIBILITIES</small>
                  <h3>A new direction, with your interests in mind.</h3>
                  <p>Discover, expand, and connect with Pro.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="uw-section uw-container">
          <div className="uw-section-heading">
            <div>
              <p className="uw-eyebrow">A SIMPLE START</p>
              <h2>
                From your first word
                <br />
                to your next big idea.
              </h2>
            </div>
            <a href={freeHref} className="uw-text-link">
              Let’s get you writing <ArrowRight size={18} />
            </a>
          </div>
          <div className="uw-how-grid">
            {[
              {
                icon: Chrome,
                title: "Install UnoWord",
                text: "Add the Chrome extension and start a writing session in a supported editor. One click, and you’re on your way.",
              },
              {
                icon: Users,
                title: "Make it yours",
                text: "Build your Writing Profile. With Pro, choose themes, set a word goal, and add the sources that inspire you.",
              },
              {
                icon: BarChart3,
                title: "Keep growing",
                text: "Follow your progress, return to the ideas you love, and find personalized inspiration whenever you need a nudge.",
              },
            ].map(({ icon: Icon, title, text }, i) => (
              <article className="uw-how-card" key={title}>
                <div className="uw-how-top">
                  <span>0{i + 1}</span>
                  <Icon size={28} />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                {i < 2 && (
                  <ArrowRight className="uw-how-arrow" aria-hidden="true" />
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="uw-section uw-audience-section">
          <div className="uw-container">
            <div className="uw-centered-heading">
              <p className="uw-eyebrow">
                THERE’S ROOM FOR YOUR KIND OF WRITING
              </p>
              <h2>
                Whatever you write,
                <br />
                UnoWord helps you keep going.
              </h2>
              <p>
                For writers of all kinds. Especially the one you’re becoming.
              </p>
            </div>
            <div className="uw-audience-grid">
              {audiences.map(([Icon, title, text]) => {
                const Glyph = Icon as typeof Feather;
                return (
                  <article key={String(title)}>
                    <Glyph size={24} />
                    <h3>{String(title)}</h3>
                    <p>{String(text)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="uw-section uw-container uw-pricing">
          <div className="uw-centered-heading">
            <p className="uw-eyebrow">YOUR PACE. YOUR POSSIBILITIES.</p>
            <h2>
              Start free.
              <br />
              Grow at your own pace.
            </h2>
            <p>A simple place to begin. More inspiration when you’re ready.</p>
          </div>
          <div className="uw-pricing-grid">
            {["free", "pro"].map((planId) => {
              const plan = product.data?.plans.find((p) => p.id === planId);
              const paid = planId === "pro";
              return (
                <article
                  className={`uw-price-card${paid ? " uw-price-pro" : ""}`}
                  key={planId}
                >
                  {paid && (
                    <span className="uw-pro-ribbon">
                      <Sparkles size={13} /> MORE PERSONALIZED POSSIBILITIES
                    </span>
                  )}
                  <div className="uw-price-heading">
                    <span className="uw-icon-tile">
                      {paid ? <Sparkles /> : <PencilLine />}
                    </span>
                    <h3>{paid ? "Pro" : "Free"}</h3>
                  </div>
                  <p>
                    {paid
                      ? "More personalized inspiration and deeper writing insights."
                      : "Everything you need to begin building your writing habit."}
                  </p>
                  <div className="uw-price-status">
                    {paid
                      ? plan?.price
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: plan.price.currency,
                          }).format(plan.price.amount / 100) +
                          " / " +
                          plan.price.interval
                        : "More room to grow."
                      : "Your first word is free."}
                    <span>
                      {paid
                        ? product.data?.billing_available
                          ? `${plan?.price?.trial_days ?? 7}-day free trial for eligible accounts. Then billed monthly.`
                          : "Paid plan changes are currently unavailable."
                        : "No payment required to get started."}
                    </span>
                  </div>
                  <ul>
                    {product.data?.features
                      .filter((feature) => plan?.features[feature.id])
                      .map((feature) => (
                        <li key={feature.id}>
                          <Check size={16} />
                          {feature.label}
                        </li>
                      ))}
                  </ul>
                  {!product.data && (
                    <p className="uw-plan-loading" role="status">
                      {product.isError
                        ? "Plan details are temporarily unavailable. Check your account for current access."
                        : "Loading current plan features…"}
                    </p>
                  )}
                  <Link
                    className={`uw-button${paid ? "" : " uw-button-outline"}`}
                    to={paid ? PRO_START : FREE_START}
                  >
                    {paid
                      ? product.data?.billing_available
                        ? "Try Pro free for 7 days"
                        : "View Pro in your account"
                      : "Get started free"}
                    <ArrowRight size={17} />
                  </Link>
                  <small>
                    {paid
                      ? "Payment method required. Cancel before your trial ends to avoid a charge."
                      : "Quick Prompt included. No AI subscription needed."}
                  </small>
                </article>
              );
            })}
          </div>
          <p className="uw-pricing-note">
            <LockKeyhole size={14} />{" "}
            {product.data?.billing_available
              ? "Secure checkout and subscription management through Stripe."
              : "No paid plan changes are processed until billing is configured."}{" "}
            AI allowances are account-specific; check your account for current
            access and limits.
          </p>
        </section>

        <section id="faq" className="uw-section uw-container uw-faq-section">
          <div>
            <p className="uw-eyebrow">A FEW THINGS YOU MIGHT BE WONDERING</p>
            <h2>
              Good questions.
              <br />
              Simple answers.
            </h2>
            <p>
              Getting to know your new
              <br className="uw-desktop-break" /> writing companion.
            </p>
            <Link to="/support" className="uw-text-link">
              Need a little help? <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="uw-faq-list">
            {faqs.map(([question, answer], index) => (
              <article className="uw-faq-item" key={question}>
                <h3>
                  <button
                    aria-expanded={openFaq === index}
                    aria-controls={`faq-answer-${index}`}
                    id={`faq-question-${index}`}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    {question}
                    <span>
                      {openFaq === index ? (
                        <Minus size={18} />
                      ) : (
                        <Plus size={18} />
                      )}
                    </span>
                  </button>
                </h3>
                <div
                  id={`faq-answer-${index}`}
                  role="region"
                  aria-labelledby={`faq-question-${index}`}
                  hidden={openFaq !== index}
                >
                  <p>
                    {answer}
                    {index === 6 && (
                      <>
                        {" "}
                        <Link to="/privacy">Read Privacy &amp; data →</Link>
                      </>
                    )}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="uw-final-cta">
          <div className="uw-container">
            <span className="uw-cta-sparkle" aria-hidden="true">
              <Sparkles size={30} />
            </span>
            <p className="uw-eyebrow">ONE WORD CAN TAKE YOU SOMEWHERE</p>
            <h2>
              Your next great idea
              <br />
              starts with one word.
            </h2>
            <p>
              Whether you’re writing your first blog post or your next book,
              <br className="uw-desktop-break" /> find a little structure, a
              little inspiration, and a reason to keep going.
            </p>
            <a className="uw-button uw-button-white" href={freeHref}>
              Get UnoWord Free <ArrowRight size={18} />
            </a>
            <small>Every idea starts with Uno Word.</small>
          </div>
        </section>
      </main>
      <footer className="uw-footer">
        <div className="uw-container">
          <div className="uw-footer-top">
            <div>
              <Brand />
              <p>
                A personal writing companion.
                <br />
                For more inspired, consistent writing.
              </p>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
              <Link to="/account?mode=signin">Sign in</Link>
              <Link to="/privacy">Privacy &amp; data</Link>
              <Link to="/terms">Terms of service</Link>
              <Link to="/support">Support</Link>
              {product.data?.chrome_store_url && (
                <a href={product.data.chrome_store_url}>
                  Chrome Web Store <ArrowUpRight size={13} />
                </a>
              )}
            </nav>
          </div>
          <div className="uw-footer-bottom">
            <span>© {new Date().getFullYear()} UnoWord</span>
            <span>Every idea starts with Uno Word.</span>
            <a href="#main">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
