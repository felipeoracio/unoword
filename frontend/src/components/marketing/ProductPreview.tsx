import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Flame,
  Folder,
  Lightbulb,
  PencilLine,
  Settings,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";

export default function ProductPreview() {
  return (
    <figure
      className="uw-showcase"
      aria-label="Illustrative Uno Word dashboard with fictional session data"
    >
      <div className="uw-browser-art" aria-hidden="true">
        <div className="uw-browser-dots">
          <i />
          <i />
          <i />
          <span>One word at a time</span>
        </div>
        <div className="uw-paper">
          <div />
          <div />
          <div />
          <div />
          <div />
          <div />
          <span>Every idea starts somewhere.</span>
        </div>
      </div>
      <div className="uw-product">
        <div className="uw-product-header">
          <span className="uw-product-brand">
            <img src="/brand/unoword.svg" width="34" height="34" alt="" />
            Uno Word
          </span>
          <Settings size={19} aria-hidden="true" />
        </div>
        <div className="uw-product-tabs" aria-hidden="true">
          <span className="selected">Write</span>
          <span>Ideas</span>
          <span>Progress</span>
          <span>Library</span>
        </div>
        <div className="uw-product-goal">
          <div>
            <span className="uw-product-muted">Words today</span>
            <strong>
              748
              <span className="uw-cursor" />
            </strong>
            <span className="uw-product-muted">of 1,000 words</span>
          </div>
          <div className="uw-demo-ring">
            <div>
              <b>
                75<span>%</span>
              </b>
              <small>Daily goal</small>
            </div>
          </div>
        </div>
        <div className="uw-product-stats">
          <div>
            <Timer size={20} />
            <span>
              Session time<b>42:15</b>
            </span>
          </div>
          <div>
            <Target size={20} />
            <span>
              Goal<b>1,000</b>
            </span>
          </div>
          <div>
            <Flame size={20} />
            <span>
              Streak<b>5 days</b>
            </span>
          </div>
        </div>
        <div className="uw-product-idea">
          <div className="uw-product-idea-label">
            <Sparkles size={19} />
            <span>A little inspiration</span>
            <span className="uw-tiny-tag">Pro</span>
          </div>
          <h3>The stories hidden in everyday rituals</h3>
          <p>
            Explore how one small daily practice can tell a bigger story about
            who we are.
          </p>
          <span className="uw-product-source">
            <BookOpen size={12} /> Inspired by your writing interests
          </span>
          <div className="uw-product-example-button">
            Explore this idea <ArrowUpRight size={15} />
          </div>
        </div>
        <div className="uw-product-nav" aria-hidden="true">
          {[
            [PencilLine, "Write"],
            [Lightbulb, "Ideas"],
            [BarChart3, "Progress"],
            [Folder, "Library"],
          ].map(([Icon, label]) => {
            const Glyph = Icon as typeof PencilLine;
            return (
              <span key={String(label)}>
                <Glyph size={19} />
                {String(label)}
              </span>
            );
          })}
        </div>
      </div>
      <div className="uw-float-note">
        <span>
          <Sparkles size={16} />
        </span>
        <div>
          A little progress.
          <br />
          <strong>A lot of possibility.</strong>
        </div>
      </div>
      <figcaption>
        Illustrative product preview · Fictional example data
      </figcaption>
    </figure>
  );
}
