import { useState } from "react";
import { apiGet } from "@/lib/api";
import { Link } from "react-router-dom";
import { Flame } from "lucide-react";
import { useWritingStreak } from "@/lib/use-writing-streak";
export default function WritingStreak({
  owner,
  paid,
  language = "en",
}: {
  owner: string;
  paid: boolean;
  language?: string;
}) {
  const es = language === "es";
  const result = useWritingStreak(
    owner,
    paid,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const value = result.isError ? undefined : result.data;
  return (
    <section
      className="uw-ai-usage"
      aria-label={es ? "Racha de escritura" : "Writing streak"}
    >
      <strong>
        <Flame size={18} aria-hidden="true" />{" "}
        {value
          ? `${value.displayedStreak} ${es ? "días de escritura" : "Day Writing Streak"}`
          : es
            ? "Conéctate para actualizar tu racha"
            : "Connect to refresh your writing streak"}
      </strong>
      {value?.streakLimitReached ? (
        <>
          <h2>
            {value.journeyContinues
              ? es
                ? "Tu recorrido continúa."
                : "Your Writing Journey Continues."
              : es
                ? "¡Has creado un hábito de 7 días!"
                : "You've Built a 7-Day Writing Habit!"}
          </h2>
          <p>
            {es
              ? "Seguimos registrando tu actividad. Pro muestra tu racha completa y los próximos hitos."
              : "Seven days of showing up is worth celebrating. Keep writing: your activity is still tracked. Pro reveals your full qualifying streak and future milestones."}
          </p>
          <Link to="/account?plan=pro">
            {es ? "Desbloquear rachas ilimitadas" : "Unlock Unlimited Streaks"}
          </Link>
        </>
      ) : (
        <p>
          {es
            ? "Cuenta al menos una palabra escrita por día. Las palabras pegadas no cuentan para la racha."
            : "At least one typed word qualifies a writing day. Pasted words do not count toward your streak."}
        </p>
      )}
      {paid && value && (
        <>
          {value.longestStreak !== undefined && (
            <p>
              {es ? "Racha más larga registrada" : "Longest recorded streak"}:{" "}
              {value.longestStreak} {es ? "días" : "days"}
            </p>
          )}
          <div aria-label="Earned writing streak milestones">
            {(value.milestones || []).map((day) => (
              <span key={day}>
                ✓ {day} {es ? "días" : "days"}{" "}
              </span>
            ))}
          </div>
          <StreakHistory />
        </>
      )}
      <small>
        {es
          ? "La actividad sincronizada de la extensión y el editor comparte una racha. El texto no se envía para calcularla."
          : "Synced extension and editor activity share one streak. Writing text is not sent to calculate it."}
      </small>
    </section>
  );
}

function StreakHistory() {
  const [days, setDays] =
      useState<{ date: string; typed_words: number; sessions: number }[]>(),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  async function load(next: number) {
    try {
      const value = await apiGet<{ days: NonNullable<typeof days> }>(
        "/progress/history?timezone=" +
          encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone) +
          "&offset=" +
          next,
      );
      setDays(value.days);
      setOffset(next);
      setError("");
    } catch {
      setDays(undefined);
      setError("Reconnect or refresh your Pro access to view synced history.");
    }
  }
  return (
    <section id="writing-history">
      <button type="button" onClick={() => void load(0)}>
        View full synced streak history
      </button>
      {error && <p role="alert">{error}</p>}
      {days && (
        <>
          <ul>
            {days.map((day) => (
              <li key={day.date}>
                {day.date}: {day.typed_words} typed words · {day.sessions}{" "}
                sessions
              </li>
            ))}
          </ul>
          {days.length === 0 && (
            <p>
              No synced activity on this account yet. In the extension, use Sync
              this device’s writing history for available older sessions.
            </p>
          )}
          {offset > 0 && (
            <button onClick={() => void load(Math.max(0, offset - 100))}>
              Previous days
            </button>
          )}
          {days.length === 100 && (
            <button onClick={() => void load(offset + 100)}>Older days</button>
          )}
        </>
      )}
    </section>
  );
}
