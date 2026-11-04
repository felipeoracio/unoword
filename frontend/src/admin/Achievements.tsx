import { useEffect, useState, type FormEvent } from "react";
import { adminGet, adminPatch, adminPost, errorText } from "@/lib/adminApi";
import { prepareDocumentImage } from "@/lib/document-image";
import type { Lang } from "./i18n";
type Definition = {
  id: string;
  name: string;
  name_es: string;
  description: string;
  description_es: string;
  threshold: number;
  metric: string;
  category: string;
  tier: string;
  active: boolean;
  revision: number;
  badge_image: string | null;
  unlock_count: number;
};
export default function Achievements({ language }: { language: Lang }) {
  const [rows, setRows] = useState<Definition[]>([]),
    [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null),
    [backfillBusy, setBackfillBusy] = useState(false),
    [backfillMessage, setBackfillMessage] = useState("");
  const backfill = async () => {
    setBackfillBusy(true);
    try {
      const result = await adminPost<{
        processed: number;
        next_cursor: string | null;
        has_more: boolean;
      }>("/achievements/backfill", { after: cursor });
      setCursor(result.has_more ? result.next_cursor : null);
      setBackfillMessage(
        language === "es"
          ? `${result.processed} cuentas revisadas. ${result.has_more ? "Continúa con el siguiente lote." : "Revisión completa."}`
          : `${result.processed} accounts reconciled. ${result.has_more ? "Continue with the next batch." : "Backfill complete."}`,
      );
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBackfillBusy(false);
    }
  };
  const load = () =>
    adminGet<Definition[]>("/achievements")
      .then(setRows)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        {language === "es"
          ? "Logros personales"
          : "Personal writing achievements"}
      </h2>
      <p>
        {language === "es"
          ? "Los cambios no revocan logros ya obtenidos. Solo se muestran totales agregados."
          : "Stable identifiers and earned badges are preserved when definitions change. Counts below are aggregate unlocks, without private writing or user lists."}
      </p>
      <button
        type="button"
        className="rounded bg-blue-600 p-3"
        disabled={backfillBusy}
        onClick={() => void backfill()}
      >
        {backfillBusy
          ? "…"
          : language === "es"
            ? "Revisar historial (25 cuentas)"
            : "Backfill verified history (25 accounts)"}
      </button>
      <p role="status">{backfillMessage}</p>
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <Edit
          key={row.id + ":" + row.revision}
          row={row}
          saved={load}
          language={language}
        />
      ))}
    </div>
  );
}
function Edit({
  row,
  saved,
  language,
}: {
  row: Definition;
  saved: () => Promise<unknown>;
  language: Lang;
}) {
  const [badge, setBadge] = useState(row.badge_image),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await adminPatch("/achievements/" + row.id, {
        revision: row.revision,
        name: form.get("name"),
        name_es: form.get("name_es"),
        description: form.get("description"),
        description_es: form.get("description_es"),
        threshold: Number(form.get("threshold")),
        active: form.get("active") === "on",
        badge_image: badge,
      });
      await saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-xl border border-slate-700 p-4">
      <summary className="cursor-pointer">
        {language === "es" ? row.name_es : row.name} · {row.unlock_count}{" "}
        {language === "es" ? "logros obtenidos" : "unlocks"} ·{" "}
        {row.active ? "✓" : "—"}
      </summary>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <p>
          {row.id} · {row.category} · {row.metric} · {row.tier}
        </p>
        {(["name", "name_es", "description", "description_es"] as const).map(
          (key) => (
            <label key={key} className="grid gap-1">
              {key}
              <input
                name={key}
                defaultValue={row[key]}
                required
                maxLength={key.startsWith("name") ? 100 : 500}
                className="rounded border border-slate-600 bg-slate-800 p-2"
              />
            </label>
          ),
        )}
        <label>
          Requirement (
          {row.metric === "seconds" ? "active seconds" : row.metric})
          <input
            type="number"
            min="1"
            max="1000000000000"
            name="threshold"
            required
            defaultValue={row.threshold}
            className="ml-3 rounded bg-slate-800 p-2"
          />
        </label>
        <label>
          <input type="checkbox" name="active" defaultChecked={row.active} />{" "}
          Enabled for new unlocks
        </label>
        <label>
          Badge artwork (PNG/JPEG/WebP)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                setBadge((await prepareDocumentImage(file)).src);
              } catch {
                setError(
                  "Choose a supported image up to 10 MB. SVG is not accepted.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {badge && (
          <img src={badge} width={64} height={64} alt="Badge preview" />
        )}
        <button type="button" onClick={() => setBadge(null)}>
          Use category badge
        </button>
        <button
          disabled={busy}
          className="rounded bg-blue-600 p-3"
          type="submit"
        >
          {busy
            ? "…"
            : language === "es"
              ? "Guardar definición"
              : "Save definition"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
