import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Pause, Sparkles, X } from "lucide-react";
import { useTourProgress } from "@/lib/onboarding";
import "@/styles/onboarding.css";

const steps = [
  "welcome",
  "sentence",
  "celebrate",
  "counter",
  "session",
  "goal",
  "progress",
  "suggestion",
  "profile",
  "extension",
  "summary",
];
const copy: Record<string, [string, string]> = {
  welcome: [
    "Every Great Story Starts Somewhere",
    "Welcome to UnoWord. You don’t need a perfect idea, a detailed plan, or even a lot of time. All you need is one sentence.",
  ],
  sentence: [
    "It Starts with One Sentence",
    "Write about anything on your mind. A thought, a memory, or something you’re looking forward to. There’s no right or wrong answer.",
  ],
  celebrate: [
    "You Did It. You Started.",
    "That’s how every great piece of writing begins—with a single sentence. And now you’ve written yours.",
  ],
  counter: [
    "Look What You’ve Started",
    "Every word adds up. Add a few more words and watch your real word count grow.",
  ],
  session: [
    "Make Time for Your Ideas",
    "In this editor, typing starts the existing writing-session tracker automatically. There is no separate Start button here. In Chrome, use the extension’s Start Session control.",
  ],
  goal: [
    "A Small Goal. A Big Difference.",
    "Keep your current daily goal or choose a gentle starting point. This updates the editor’s existing goal setting.",
  ],
  progress: [
    "Your Words Tell a Story",
    "These are your actual session and daily statistics. Locally saved activity contributes here; cloud synchronization is shown in the save status.",
  ],
  suggestion: [
    "Your Next Sentence Is Waiting",
    "Reveal a Quick Prompt from the existing prompt library. It doesn’t call AI or use your AI allowance.",
  ],
  profile: [
    "Inspiration That Gets to Know You",
    "Your existing Writing Profile guides personalized suggestions. You choose what to share; this tour never adds your draft to AI memory.",
  ],
  extension: [
    "Take UnoWord Wherever You Write",
    "Use the Chrome extension to track active writing sessions on supported websites. Installation instructions are in your account; we haven’t assumed it is installed.",
  ],
  summary: [
    "One Sentence Down. Endless Possibilities Ahead.",
    "You don’t need to be a great writer to begin. You just need to begin. Your writing stays in your document.",
  ],
};
const labels: Record<string, string> = {
  first_sentence_written: "First sentence written",
  word_counter_explored: "Word counter explored",
  writing_session_started: "Writing session tracked",
  writing_goal_set: "Daily writing goal established",
  suggestion_explored: "Writing suggestion explored",
  ai_profile_started: "Writing Profile opened",
  extension_explored: "Extension instructions explored",
};
const targets: Record<string, string> = {
  sentence: "canvas",
  counter: "words",
  session: "session",
  goal: "goal",
  progress: "stats",
  suggestion: "prompt",
  profile: "profile",
};
export default function WritingTour({
  owner,
  enabled,
  documentId,
  documentIds,
  select,
  create,
  observation,
  words,
  sessionActive,
  goal,
  saveGoal,
  openAssistant,
}: {
  owner: string;
  enabled: boolean;
  documentId: string | null;
  documentIds: string[];
  select: (id: string) => void;
  create: () => Promise<{ id: string } | undefined>;
  observation: {
    sequence: number;
    text: string;
    documentId: string;
    words: number;
  };
  words: number;
  sessionActive: boolean;
  goal: number;
  saveGoal: (value: number) => void;
  openAssistant: () => void;
}) {
  const { progress, update, notice } = useTourProgress(owner);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [promptVisible, setPromptVisible] = useState(true);
  const ready = useRef(false),
    baseline = useRef(0),
    typedBaseline = useRef(0),
    stepRef = useRef("");
  const step = progress?.current_step || "welcome";
  const context = useRef({
    progress,
    words,
    sequence: observation.sequence,
    openAssistant,
  });
  context.current = {
    progress,
    words,
    sequence: observation.sequence,
    openAssistant,
  };
  useEffect(() => {
    if (!progress || ready.current) return;
    ready.current = true;
    setOpen(
      progress.status === "not_started" ||
        progress.status === "in_progress" ||
        new URLSearchParams(location.search).get("tour") === "1",
    );
  }, [progress]);
  useEffect(() => {
    if (!open || !context.current.progress) return;
    if (step !== stepRef.current) {
      baseline.current = context.current.words;
      typedBaseline.current = context.current.sequence;
      stepRef.current = step;
    }
    if (["goal", "suggestion", "profile"].includes(step))
      context.current.openAssistant();
    const target = targets[step];
    if (!target) return;
    let marked: Element | null = null;
    const find = () => {
      const element = document.querySelector(`[data-tour="${target}"]`);
      if (!element || !element.getClientRects().length) return;
      if (marked === element) return;
      marked?.classList.remove("uw-tour-target");
      marked = element;
      element.classList.add("uw-tour-target");
      element.scrollIntoView({ behavior: "instant", block: "nearest" });
    };
    find();
    const timer = setInterval(find, 600);
    return () => {
      clearInterval(timer);
      marked?.classList.remove("uw-tour-target");
    };
  }, [open, step]); // Callbacks intentionally do not drive tour navigation or steal typing focus.
  useEffect(() => {
    if (
      !open ||
      !progress ||
      !enabled ||
      !progress.draft_id ||
      observation.documentId !== progress.draft_id
    )
      return;
    if (step === "sentence" && observation.sequence > typedBaseline.current) {
      const text = observation.text.trim();
      if (
        (observation.words - baseline.current >= 1 &&
          /[.!?。！？]$/.test(text) &&
          /\p{L}/u.test(text)) ||
        observation.words - baseline.current >= 5
      ) {
        update({
          current_step: "celebrate",
          completed_actions: { first_sentence_written: true },
          words: observation.words,
        });
      }
    }
    if (
      step === "counter" &&
      observation.sequence > typedBaseline.current &&
      words > baseline.current &&
      !progress.completed_actions.word_counter_explored
    )
      update({ completed_actions: { word_counter_explored: true }, words });
  }, [observation, words, open, step, enabled, progress, update]);
  useEffect(() => {
    if (
      open &&
      step === "session" &&
      sessionActive &&
      !progress?.completed_actions.writing_session_started
    )
      update({ completed_actions: { writing_session_started: true } });
  }, [open, step, sessionActive, progress, update]);
  useEffect(() => {
    const action = (event: Event) => {
      if (!open || !progress) return;
      const value = (event as CustomEvent<string>).detail;
      const expected: Record<string, string> = {
        goal: "writing_goal_set",
        suggestion: "suggestion_explored",
        profile: "ai_profile_started",
      };
      if (value === expected[step])
        update({ completed_actions: { [value]: true } });
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        open &&
        !document.querySelector("dialog[open]")
      ) {
        setOpen(false);
        update({ status: "paused" });
      }
    };
    window.addEventListener("unoword-tour-action", action);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("unoword-tour-action", action);
      window.removeEventListener("keydown", escape);
    };
  }, [open, step, progress, update]);
  if (!progress) return null;
  const next = (skip = false) => {
    let index = steps.indexOf(step) + 1;
    while (
      !enabled &&
      [
        "sentence",
        "celebrate",
        "counter",
        "session",
        "goal",
        "progress",
        "suggestion",
        "profile",
      ].includes(steps[index])
    )
      index++;
    if (skip && step === "sentence") index = 3;
    update({
      status: "in_progress",
      current_step: steps[index] || "summary",
      ...(skip ? { skipped_steps: [step] } : {}),
    });
  };
  async function begin(existing = false) {
    setBusy(true);
    try {
      if (!enabled) {
        update({ status: "in_progress", current_step: "extension" });
        return;
      }
      let id = existing
        ? documentId
        : progress?.draft_id && documentIds.includes(progress.draft_id)
          ? progress.draft_id
          : null;
      if (!id) id = (await create())?.id || null;
      if (!id) return;
      select(id);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-tour="canvas"]')?.focus(),
      );
      update({
        status: "in_progress",
        current_step: progress?.completed_actions.first_sentence_written
          ? "celebrate"
          : "sentence",
        draft_id: id,
      });
    } finally {
      setBusy(false);
    }
  }
  function pause() {
    setOpen(false);
    update({ status: "paused" });
  }
  return (
    <>
      <button
        className="uw-tour-launch"
        type="button"
        onClick={() => {
          setOpen(true);
          update({
            status: "in_progress",
            ...(progress.status === "completed"
              ? { current_step: "welcome" }
              : {}),
          });
        }}
      >
        {progress.status === "paused"
          ? "Resume UnoWord Tour"
          : "Take the UnoWord Tour"}
      </button>
      {open && (
        <aside
          className="uw-tour-card"
          aria-label="UnoWord guided writing tour"
          data-testid="writing-tour"
        >
          <div className="uw-tour-top">
            <span>
              <Sparkles size={16} /> YOUR FIRST WORDS
            </span>
            <button type="button" onClick={pause} aria-label="Pause tour">
              <Pause size={16} />
            </button>
          </div>
          <progress
            max={steps.length}
            value={steps.indexOf(step) + 1}
            aria-label="Tour step"
          />
          <p className="uw-tour-step">
            Step {steps.indexOf(step) + 1} of {steps.length} · About 3–5 minutes
          </p>
          <h2>{copy[step]?.[0]}</h2>
          <p>{copy[step]?.[1]}</p>
          {notice && (
            <p className="uw-tour-notice" role="status">
              {notice}
            </p>
          )}
          {step === "welcome" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void begin()}
              >
                Write My First Sentence <ArrowRight size={15} />
              </button>
              {enabled && documentId && (
                <button
                  type="button"
                  className="uw-tour-secondary"
                  onClick={() => void begin(true)}
                >
                  Use my current document
                </button>
              )}
              <button
                className="uw-tour-secondary"
                type="button"
                onClick={pause}
              >
                Explore on My Own
              </button>
            </>
          )}
          {step === "sentence" && promptVisible && (
            <p className="uw-tour-prompt">
              What is something you’ve been thinking about lately?{" "}
              <button
                type="button"
                aria-label="Dismiss inspiration prompt"
                onClick={() => setPromptVisible(false)}
              >
                <X size={13} />
              </button>
            </p>
          )}
          {step === "sentence" && progress.draft_id !== documentId && (
            <button
              type="button"
              onClick={() => progress.draft_id && select(progress.draft_id)}
            >
              Return to my first-sentence draft
            </button>
          )}
          {step === "celebrate" && (
            <p className="uw-tour-achievement" role="status">
              <Check size={18} />
              {documentId === progress.draft_id ? words : progress.words} words
              in your draft. Your journey has begun.
            </p>
          )}
          {step === "counter" && (
            <p aria-live="polite">
              {words} words in this document.{" "}
              {progress.completed_actions.word_counter_explored &&
                "You’re building momentum!"}
            </p>
          )}
          {step === "session" && (
            <p>
              {sessionActive
                ? "Your writing session is already active—no duplicate session is needed."
                : "Type in your draft to begin a tracked session, or skip this step."}
            </p>
          )}
          {step === "goal" && (
            <>
              <p>Current goal: {goal.toLocaleString()} words</p>
              <div className="uw-tour-goals">
                {[100, 250, 500, 1000].map((n) => (
                  <button type="button" key={n} onClick={() => saveGoal(n)}>
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="uw-tour-secondary"
                onClick={() => saveGoal(goal)}
              >
                Keep my current goal
              </button>
              <p>For a custom goal, use the highlighted Daily goal field.</p>
              {progress.completed_actions.writing_goal_set && (
                <p role="status">
                  Your goal is set. Every word brings you closer.
                </p>
              )}
            </>
          )}
          {step === "suggestion" && (
            <button
              type="button"
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>(
                    '[data-tour="prompt-action"]',
                  )
                  ?.click()
              }
            >
              Reveal a writing suggestion
            </button>
          )}
          {step === "profile" && (
            <button
              type="button"
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>('[data-tour="profile"]')
                  ?.click()
              }
            >
              Open My Writing Profile
            </button>
          )}
          {step === "extension" && (
            <Link
              to="/account#install"
              onClick={() =>
                update({
                  completed_actions: { extension_explored: true },
                  status: "paused",
                })
              }
            >
              View extension installation instructions <ArrowRight size={15} />
            </Link>
          )}
          {step === "summary" ? (
            <>
              <ul>
                {Object.entries(progress.completed_actions)
                  .filter(([, done]) => done)
                  .map(([id]) => (
                    <li key={id}>
                      <Check size={14} />
                      {labels[id]}
                    </li>
                  ))}
              </ul>
              {progress.completed_actions.first_sentence_written && (
                <p>
                  {documentId === progress.draft_id ? words : progress.words}{" "}
                  words in your draft.
                </p>
              )}
              {!Object.values(progress.completed_actions).some(Boolean) && (
                <p>
                  You explored at your own pace. Your first sentence is waiting
                  whenever you’re ready.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  if (
                    progress.draft_id &&
                    documentIds.includes(progress.draft_id)
                  )
                    select(progress.draft_id);
                  update({ status: "completed" });
                  setOpen(false);
                }}
              >
                Continue Writing
              </button>
              <button
                className="uw-tour-secondary"
                type="button"
                onClick={() => {
                  update({ status: "completed" });
                  setOpen(false);
                  document
                    .querySelector('[data-tour="stats"]')
                    ?.scrollIntoView({ block: "nearest" });
                }}
              >
                View My Progress
              </button>
            </>
          ) : (
            step !== "welcome" && (
              <div className="uw-tour-actions">
                <button
                  type="button"
                  onClick={() => next(true)}
                  className="uw-tour-secondary"
                >
                  Skip this step
                </button>
                {step !== "sentence" && (
                  <button type="button" onClick={() => next()}>
                    {step === "celebrate" ? "Keep Going" : "Next"}
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )
          )}
        </aside>
      )}
    </>
  );
}
