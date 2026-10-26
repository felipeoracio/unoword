import { useState } from "react";
import { Link } from "react-router-dom";
import { useTourProgress } from "@/lib/onboarding";
import "@/styles/onboarding.css";
export default function AccountTour({
  owner,
  pro,
}: {
  owner: string;
  pro: boolean;
}) {
  const { progress, update, notice } = useTourProgress(owner);
  const [replay, setReplay] = useState(false);
  if (!progress) return null;
  const offer = progress.status === "not_started" || replay;
  return (
    <section className="uw-account-tour" aria-label="UnoWord onboarding">
      <h2>
        {offer
          ? "Every Great Story Starts Somewhere"
          : progress.status === "completed"
            ? "Keep your writing momentum"
            : "Your first sentence is waiting"}
      </h2>
      {offer && (
        <p>
          Welcome to UnoWord. You don’t need a perfect idea, a detailed plan, or
          even a lot of time. All you need is one sentence.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pro ? (
        <Link
          className="uw-button"
          to="/editor?tour=1"
          onClick={() =>
            update({
              status: "in_progress",
              ...(replay ||
              !progress.draft_id ||
              progress.status === "completed"
                ? { current_step: "welcome" }
                : {}),
            })
          }
        >
          {offer
            ? "Write My First Sentence"
            : progress.status === "completed"
              ? "Take the UnoWord Tour"
              : "Resume UnoWord Tour"}
        </Link>
      ) : (
        <>
          <p>
            The full writing editor is a Pro feature. Start with the Free Chrome
            extension to track your writing and explore Quick Prompt.
          </p>
          <a
            className="uw-button"
            href="#install"
            onClick={() =>
              update({ status: "in_progress", current_step: "extension" })
            }
          >
            Explore the Free Chrome Extension
          </a>
          <Link className="uw-button uw-button-outline" to="/account?plan=pro">
            Explore the Pro Writing Editor
          </Link>
          <p>
            In the extension, choose Settings → Take the UnoWord Tour for a
            short walkthrough of Start Session, word counts, progress, and
            prompts.
          </p>
        </>
      )}
      {offer ? (
        <button
          type="button"
          className="uw-button uw-button-outline"
          onClick={() => {
            update({ status: "paused" });
            setReplay(false);
          }}
        >
          Explore on My Own
        </button>
      ) : progress.status === "completed" && pro ? null : (
        <button
          type="button"
          className="uw-button uw-button-outline"
          onClick={() => {
            setReplay(true);
            update({ current_step: "welcome" });
          }}
        >
          Take the UnoWord Tour
        </button>
      )}
    </section>
  );
}
