import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useRewards,
  nextAchievement,
  claimReward,
  rewardLabels,
  rewardProgress,
  type Achievement,
  type Rewards,
} from "@/lib/rewards";
import "@/styles/rewards.css";
export function Badge({ achievement: a, fallbackImage }: { achievement: Achievement; fallbackImage?: string }) {
  return (
    <span
      className={"reward-badge reward-tier-" + a.tier}
      role="img"
      aria-label={a.name + " · " + a.tier}
    >
      {a.badge_image || fallbackImage ? (
        <img src={a.badge_image || fallbackImage} alt="" />
      ) : (
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 3 34 9v12c0 8-14 16-14 16S6 29 6 21V9Z" />
          <path d="m13 20 5 5 10-12" />
        </svg>
      )}
    </span>
  );
}
const translate = (data?: Rewards) => (value: string) =>
  data?.language === "es" ? rewardLabels[value] || value : value;
export function RewardsSettings({
  owner,
  language = "auto",
}: {
  owner?: string;
  language?: string;
}) {
  const rewards = useRewards(owner, language),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = translate(rewards.data);
  return (
    <section
      className="rewards-settings"
      aria-label={t("Rewards & Achievements")}
    >
      <h2>{t("Rewards & Achievements")}</h2>
      <p>{t("Celebrate your writing milestones at your own pace.")}</p>
      {rewards.error ? (
        <p role="status">{t("Rewards setup is not available yet.")}</p>
      ) : rewards.data ? (
        <>
          <p className="rewards-muted">
            {rewards.data.language === "es"
              ? "Celebra tu camino personal con hitos y logros. Puedes desactivar las recompensas en cualquier momento."
              : "Celebrate your personal writing journey with achievements, milestones, and encouraging reminders of how far you’ve come. Turn rewards off anytime for a distraction-free experience."}
          </p>
          {(["enabled", "celebrations", "widget"] as const).map((key, i) => (
            <label className="reward-toggle" key={key}>
              <input
                type="checkbox"
                checked={rewards.data!.preferences[key]}
                disabled={busy || (key !== "enabled" && !rewards.data!.enabled)}
                onChange={async (e) => {
                  setBusy(true);
                  setError("");
                  try {
                    await rewards.update({ [key]: e.target.checked });
                  } catch {
                    setError(
                      t(
                        "Settings changed on another device. Refresh and try again.",
                      ),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              {t(
                [
                  "Enable Writing Rewards",
                  "Achievement Celebrations",
                  "Show Rewards on Dashboard",
                ][i],
              )}
            </label>
          ))}
          {rewards.data.enabled ? (
            <Link to="/rewards">{t("View Rewards")} →</Link>
          ) : (
            <p>{t("Your achievements stay saved while rewards are off.")}</p>
          )}
        </>
      ) : (
        <p role="status">…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function RewardsWidget({
  owner,
  language = "auto",
  celebrate = false,
}: {
  owner?: string;
  language?: string;
  celebrate?: boolean;
}) {
  const { data } = useRewards(owner, language),
    next = nextAchievement(data),
    [toast, setToast] = useState<Achievement | null>(null),
    claiming = useRef(false);
  const t = translate(data);
  const latest = useRef({ data, owner, celebrate });
  latest.current = { data, owner, celebrate };
  const enabled = data?.enabled,
    celebrations = data?.preferences.celebrations;
  const unlockedKey = data?.achievements
    .filter((a) => a.unlocked)
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    if (!enabled || !celebrations || !celebrate) {
      setToast(null);
      return;
    }
    if (!owner || claiming.current) return;
    claiming.current = true;
    let active = true;
    void claimReward(owner)
      .then((result) => {
        const current = latest.current;
        if (
          active &&
          current.owner === owner &&
          current.celebrate &&
          current.data?.enabled &&
          current.data.preferences.celebrations &&
          result.achievement_id
        )
          setToast(
            current.data.achievements.find(
              (a) => a.id === result.achievement_id,
            ) || null,
          );
      })
      .catch(() => {})
      .finally(() => {
        claiming.current = false;
      });
    return () => {
      active = false;
    };
  }, [enabled, celebrations, unlockedKey, owner, celebrate]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(timeout);
  }, [toast]);
  if (!data?.enabled) return null;
  return (
    <>
      {data.preferences.widget && next && (
        <section className="reward-next">
          <Badge achievement={next} />
          <div>
            <small>{t("Your Next Milestone")}</small>
            <strong>{next.name}</strong>
            <span>{rewardProgress(next, data.language)}</span>
            <progress
              max={next.requirement}
              value={Math.min(next.progress, next.requirement)}
              aria-label={next.name}
            />
            <p>
              {t("You’re building something meaningful, one word at a time.")}
            </p>
            <Link to="/rewards">{t("View Rewards")} →</Link>
          </div>
        </section>
      )}
      {toast && data.preferences.celebrations && celebrate && (
        <aside className="reward-celebration" role="status" aria-live="polite">
          <Badge achievement={toast} />
          <div>
            <strong>{t("Achievement Unlocked!")}</strong>
            <p>{toast.name}</p>
            <Link to="/rewards">{t("View Rewards")}</Link>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label={t("Close")}
          >
            ×
          </button>
        </aside>
      )}
    </>
  );
}
export function RewardsContent({ owner, language = "auto" }: { owner: string; language?: string }) {
  const rewards = useRewards(owner, language),
    data = rewards.data,
    [error, setError] = useState("");
  const t = translate(data);
  if (!data)
    return (
      <p role="status">
        {rewards.error ? t("Rewards setup is not available yet.") : "…"}
      </p>
    );
  if (!data.enabled) return <RewardsSettings owner={owner} language={language} />;
  const earned = data.achievements.filter((a) => a.unlocked),
    categories = [
      ["words", "Words"],
      ["streaks", "Writing Streaks"],
      ["goals", "Daily Goals"],
      ["sessions", "Writing Sessions"],
      ["time", "Writing Time"],
      ["documents", "Document Completion"],
      ["growth", "Personal Growth"],
    ];
  return (
    <div className="rewards-page">
      <header>
        <small>
          UnoWord ·{" "}
          {t("Your personal journey has no comparisons or penalties.")}
        </small>
        <h1>{t("Rewards & Achievements")}</h1>
        <p>
          {earned.length} / {data.achievements.length} · {t("Unlocked")}
        </p>
      </header>
      <RewardsWidget owner={owner} celebrate />
      <section>
        <h2>{t("Your Private Showcase")}</h2>
        <p>{t("Choose up to three earned badges. Only you can see them.")}</p>
        <div className="reward-showcase">
          {data.preferences.showcase.map((id) => {
            const a = earned.find((x) => x.id === id);
            return a ? (
              <div key={id}>
                <Badge achievement={a} />
                <strong>{a.name}</strong>
              </div>
            ) : null;
          })}
        </div>
      </section>
      <section>
        <h2>{t("Recently Unlocked")}</h2>
        <ul>
          {[...earned]
            .sort(
              (a, b) =>
                (b.awarded_at || "").localeCompare(a.awarded_at || "") ||
                (b.earned_on || "").localeCompare(a.earned_on || ""),
            )
            .slice(0, 4)
            .map((a) => (
              <li key={a.id}>
                {a.name} · {a.earned_on}
              </li>
            ))}
        </ul>
      </section>
      {categories.map(([category, label]) => {
        const items = data.achievements.filter((a) => a.category === category);
        return items.length ? (
          <section key={category}>
            <h2>{t(label)}</h2>
            {category === "streaks" && (
              <p>
                {t("Every new writing day is another opportunity to begin.")}
              </p>
            )}
            <div className="rewards-grid">
              {items.map((a) => (
                <article
                  className={"reward-card " + (a.unlocked ? "is-earned" : "")}
                  key={a.id}
                >
                  <Badge achievement={a} />
                  <div>
                    <h3>{a.name}</h3>
                    <p>{a.description}</p>
                    <strong>{t(a.unlocked ? "Unlocked" : "Locked")}</strong>
                    <p>{rewardProgress(a, data.language)}</p>
                    <progress
                      value={
                        a.unlocked
                          ? a.requirement
                          : Math.min(a.progress, a.requirement)
                      }
                      max={a.requirement}
                      aria-label={a.name}
                    />
                    {a.earned_on && (
                      <p>
                        {t("Verified on")} {a.earned_on}
                      </p>
                    )}
                    {a.unlocked && (
                      <button
                        type="button"
                        disabled={
                          !data.preferences.showcase.includes(a.id) &&
                          data.preferences.showcase.length >= 3
                        }
                        onClick={async () => {
                          setError("");
                          try {
                            await rewards.update({
                              showcase: data.preferences.showcase.includes(a.id)
                                ? data.preferences.showcase.filter(
                                    (id) => id !== a.id,
                                  )
                                : [...data.preferences.showcase, a.id],
                            });
                          } catch {
                            setError(
                              t(
                                "Settings changed on another device. Refresh and try again.",
                              ),
                            );
                          }
                        }}
                      >
                        {t(
                          data.preferences.showcase.includes(a.id)
                            ? "Remove favorite"
                            : "Favorite",
                        )}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null;
      })}
      <section>
        <h2>{t("My Writing Journey")}</h2>
        <dl>
          {[
            ["First writing day", data.journey?.first_writing_day],
            ["First completed goal", data.journey?.first_goal_day],
            ["First completed document", data.journey?.first_document_day],
            ["Total words", data.totals?.words],
            ["Completed sessions", data.totals?.sessions],
            [
              "Active writing hours",
              Math.floor((data.totals?.seconds || 0) / 3600),
            ],
          ]
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([label, value]) => (
              <div key={String(label)}>
                <dt>{t(String(label))}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
        <ol>
          {[...earned]
            .sort((a, b) =>
              (a.earned_on || "").localeCompare(b.earned_on || ""),
            )
            .map((a) => (
              <li key={a.id}>
                <time>{a.earned_on}</time> · {a.name}
              </li>
            ))}
        </ol>
        <h3>{t("Personal highlights")}</h3>
        {data.personal_milestones?.slice(0, 8).map((m) => (
          <p key={m.occurred_on}>
            {m.occurred_on} · {t("New personal best in your recorded history")}:{" "}
            {m.value.toLocaleString()}
          </p>
        ))}
      </section>
      <p className="rewards-muted">
        {t(
          "Goal achievements use saved daily targets; older goals without evidence are not guessed.",
        )}{" "}
        {t("Monthly growth compares two fully observed, completed months.")}
      </p>
      <RewardsSettings owner={owner} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
