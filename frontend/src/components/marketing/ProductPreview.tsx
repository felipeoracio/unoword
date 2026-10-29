import { useState, type KeyboardEvent } from "react";
import {
  AlignLeft,
  ArrowRight,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Underline,
} from "lucide-react";

const examples = [
  {
    name: "Ideas",
    title: "What should I write next?",
    text: "Explore a direction shaped by your interests.",
    items: [
      "Lessons from life’s unexpected turns",
      "The quiet power of showing up",
      "What a fresh start can teach us",
    ],
  },
  {
    name: "Questions",
    title: "Your words. Your next direction.",
    text: "Reflective questions to help you develop your own ideas.",
    items: [
      "Which detail could make your opening more specific?",
      "What changed your perspective?",
      "How could your ending connect to your beginning?",
    ],
  },
  {
    name: "Guidance",
    title: "Where could this thought lead?",
    text: "Short questions and structural advice. No generated prose.",
    items: [
      "Begin with a moment you remember",
      "Explore what changed your perspective",
      "Ask a question worth sitting with",
    ],
  },
];

/** Public, fictional illustration of the implemented editor. Never loads private data or calls AI. */
export default function ProductPreview() {
  const [active, setActive] = useState(0);
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 2
          : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
    setActive(next);
    document.getElementById(`editor-demo-tab-${next}`)?.focus();
  }
  return (
    <figure
      className="lp-showcase"
      aria-label="Illustrative UnoWord Pro writing editor with fictional content"
    >
      <div className="lp-window-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="lp-editor-preview">
        <div className="lp-preview-header">
          <span className="lp-preview-brand">
            <img src="/brand/unoword.svg" width="25" height="25" alt="" />
            UnoWord
          </span>
          <span className="lp-preview-title">
            Finding clarity in the journey
          </span>
          <span className="lp-saved">
            <Check size={13} /> All changes saved
          </span>
        </div>
        <div className="lp-preview-layout">
          <div className="lp-preview-library" aria-hidden="true">
            <div className="lp-library-heading">
              <b>Documents</b>
              <span>
                <Plus size={12} /> New
              </span>
            </div>
            <div className="lp-preview-search">
              <Search size={12} /> Search documents…
            </div>
            <b className="lp-library-label">My writing</b>
            <span className="lp-document-selected">
              <FileText /> My first article
            </span>
            <span>
              <Folder /> Book ideas
            </span>
            <span>
              <Folder /> Personal growth
            </span>
            <span>
              <Folder /> Newsletter
            </span>
            <span>
              <Folder /> Journal
            </span>
            <span>
              <FileText /> Drafts
            </span>
            <span>
              <Star /> Favorites
            </span>
            <span>
              <Trash2 /> Trash
            </span>
          </div>
          <div className="lp-preview-canvas">
            <div className="lp-preview-toolbar" aria-hidden="true">
              <span>
                Paragraph <ChevronDown />
              </span>
              <Bold />
              <Italic />
              <Underline />
              <List />
              <ListOrdered />
              <AlignLeft />
              <MoreHorizontal />
            </div>
            <div className="lp-preview-page">
              <h2>Finding clarity in the journey</h2>
              <p>
                Life often feels like a series of unexpected turns, but each
                step shapes who we become. When we pause, reflect, and write, we
                can see the bigger picture more clearly.
              </p>
              <p>Sometimes, all it takes is a little space to begin.</p>
              <span className="lp-preview-caret" aria-hidden="true" />
            </div>
            <div className="lp-preview-status">
              <span>58 words · Saved</span>
              <span>
                <Maximize2 size={11} /> Focus mode
              </span>
            </div>
          </div>
          <div className="lp-preview-assistant">
            <div className="lp-assistant-heading">
              <b>AI Assistant</b>
              <Sparkles size={14} />
            </div>
            <div
              className="lp-demo-tabs"
              role="tablist"
              aria-label="Editor assistant examples"
            >
              {examples.map((example, index) => (
                <button
                  key={example.name}
                  type="button"
                  role="tab"
                  id={`editor-demo-tab-${index}`}
                  aria-selected={active === index}
                  aria-controls="editor-demo-panel"
                  tabIndex={active === index ? 0 : -1}
                  onClick={() => setActive(index)}
                  onKeyDown={(event) => tabKeys(event, index)}
                >
                  {example.name}
                </button>
              ))}
            </div>
            <div
              id="editor-demo-panel"
              role="tabpanel"
              aria-labelledby={`editor-demo-tab-${active}`}
              tabIndex={0}
            >
              <div className="lp-demo-prompt">
                <Sparkles size={21} />
                <div>
                  <b>{examples[active].title}</b>
                  <p>{examples[active].text}</p>
                </div>
              </div>
              {examples[active].items.map((item) => (
                <div key={item} className="lp-demo-idea">
                  {item}
                  <ChevronRight size={13} />
                </div>
              ))}
              <a className="lp-demo-open" href="/editor">
                Try it in the editor <ArrowRight size={13} />
              </a>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        Pro writing workspace · Illustrative preview · Fictional writing and coaching examples
      </figcaption>
    </figure>
  );
}

export function FeaturePreview({
  kind,
}: {
  kind: "editor" | "ai" | "progress" | "library";
}) {
  return (
    <div className={`lp-mini-preview lp-mini-${kind}`} aria-hidden="true">
      {kind === "editor" && (
        <>
          <div className="lp-mini-toolbar">
            <span className="lp-mini-dots">● ● ●</span>
            <span>Paragraph⌄</span>
            <Bold />
            <Italic />
            <Underline />
          </div>
          <div className="lp-mini-paper">
            <b>A little space to begin</b>
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      )}
      {kind === "ai" && (
        <>
          <div className="lp-mini-label">
            <Sparkles />
            <b>What should I write next?</b>
          </div>
          <span>A personal story about growth</span>
          <span>The art of paying attention</span>
          <span>A new perspective on change</span>
        </>
      )}
      {kind === "progress" && (
        <>
          <b>Today’s progress</b>
          <div className="lp-mini-goal">
            <span>
              <strong>748</strong>
              <small>of 1,000 words</small>
            </span>
            <span className="lp-mini-ring" />
          </div>
          <div className="lp-mini-metrics">
            <span>
              5 days<small>streak</small>
            </span>
            <span>
              42:15<small>writing time</small>
            </span>
            <span>
              1,200<small>total words</small>
            </span>
          </div>
        </>
      )}
      {kind === "library" && (
        <>
          <div className="lp-mini-label">
            <b>My writing</b>
            <MoreHorizontal />
          </div>
          {["Personal growth", "Book ideas", "Newsletter", "Journal"].map(
            (name) => (
              <div className="lp-mini-folder" key={name}>
                <Folder />
                <span>{name}</span>
                <MoreHorizontal />
              </div>
            ),
          )}
        </>
      )}
    </div>
  );
}
