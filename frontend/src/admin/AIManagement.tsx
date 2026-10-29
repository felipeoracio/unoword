import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, errorText } from "@/lib/adminApi";

type Limits = {
  name: string;
  suggestions_daily: number;
  suggestions_monthly: number;
  guidance_monthly: number;
  cost_target: number;
  warning_percent: number;
};
type Version = Limits & {
  id: string;
  legacy_shared_daily: boolean;
  created_at: string;
};
type Management = {
  versions: Version[];
  releases: { version_id: string; effective_at: string }[];
  assignments: { version_id: string; subscribers: number }[];
  audit: {
    id: number;
    admin_id: string;
    action: string;
    version_id: string;
    created_at: string;
  }[];
  prices: Record<string, unknown>[];
};
type Analytics = {
  totals: {
    estimated_spend: number | null;
    unpriced_calls: number;
    active_pro_accounts: number;
    average_per_active_pro_account: number | null;
  };
  by_feature: Record<string, unknown>[];
  by_model: Record<string, unknown>[];
  highest_usage: Record<string, unknown>[];
  trends: Record<string, unknown>[];
  above_cost_target: Record<string, unknown>[];
  by_status: Record<string, unknown>[];
  note: string;
};
const fields: [keyof Omit<Limits, "name">, string][] = [
  ["suggestions_daily", "Suggestions per day"],
  ["suggestions_monthly", "Suggestions per calendar month"],
  ["guidance_monthly", "Writing Guidance per calendar month"],
  ["cost_target", "Internal cost target ($/subscriber/month)"],
  ["warning_percent", "Usage warning threshold (%)"],
];
const inputClass =
  "w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white";
const buttonClass =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50";
export default function AIManagement({
  language = "en",
}: {
  language?: string;
}) {
  const es = language === "es";
  const [data, setData] = useState<Management>();
  const [analytics, setAnalytics] = useState<Analytics>();
  const [draft, setDraft] = useState<Limits>();
  const [preview, setPreview] = useState<{
    public_terms: string;
    protected_accounts: number;
    applies_to: string;
  }>();
  const [saved, setSaved] = useState("");
  const [when, setWhen] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [management, costs] = await Promise.all([
      adminGet<Management>("/ai/limits"),
      adminGet<Analytics>("/ai/analytics"),
    ]);
    setData(management);
    setAnalytics(costs);
    const latest = management.versions.find((v) => !v.legacy_shared_daily);
    if (latest)
      setDraft(
        (current) =>
          current || {
            name: `${latest.name} — proposal`,
            suggestions_daily: latest.suggestions_daily,
            suggestions_monthly: latest.suggestions_monthly,
            guidance_monthly: latest.guidance_monthly,
            cost_target: latest.cost_target,
            warning_percent: latest.warning_percent,
          },
      );
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(errorText(e)));
  }, [refresh]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function change(key: keyof Limits, value: string | number) {
    setDraft((d) => d && { ...d, [key]: value });
    setPreview(undefined);
    setSaved("");
    setReviewed(false);
  }
  const money = (n: number | null | undefined) =>
    n == null ? "Unknown" : `$${n.toFixed(4)}`;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        {es ? "Gestión de IA → Límites de uso" : "AI Management → Usage Limits"}
      </h1>
      <p className="text-sm text-slate-300">
        {es
          ? "Los cambios se aplican solo a futuros suscriptores. Las asignaciones existentes se conservan."
          : "Published changes apply only to future subscribers. Existing Monthly and Lifetime assignments remain protected."}
      </p>
      <div role="status" className="text-sm text-blue-200">
        {message}
      </div>
      {draft && (
        <section className="rounded-xl border border-slate-700 p-4 space-y-4">
          <h2 className="font-semibold">
            {es ? "Proponer una nueva versión" : "Propose a new version"}
          </h2>
          <label className="block text-sm">
            Configuration name
            <input
              className={inputClass}
              value={draft.name}
              maxLength={100}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  className={inputClass}
                  type="number"
                  min={key === "cost_target" ? 0.01 : 1}
                  max={key === "warning_percent" ? 100 : 1000000}
                  step={key === "cost_target" ? 0.01 : 1}
                  value={draft[key]}
                  onChange={(e) => change(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-300">
            The cost target is monitoring only. It never removes promised
            credits. Quick Prompt and goal adjustments remain unlimited.
          </p>
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setPreview(await adminPost("/ai/limits/preview", draft));
              })
            }
          >
            Preview changes
          </button>
          {preview && (
            <div className="rounded-lg bg-slate-800 p-3 space-y-3 text-sm">
              <p>{preview.public_terms}</p>
              <p>
                {preview.applies_to} Protected accounts:{" "}
                {preview.protected_accounts}.
              </p>
              <button
                className={buttonClass}
                disabled={busy || Boolean(saved)}
                onClick={() =>
                  void run(async () => {
                    const result = await adminPost<{ id: string }>(
                      "/ai/limits",
                      draft,
                    );
                    setSaved(result.id);
                    await refresh();
                    setMessage(
                      "Draft version saved. Public terms have not changed.",
                    );
                  })
                }
              >
                Save configuration
              </button>
            </div>
          )}
          {saved && (
            <div className="space-y-3 border-t border-slate-700 pt-4">
              <h3>Publish for future subscribers</h3>
              <label className="block text-sm">
                Effective date and time (your local timezone)
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed the public terms above. Publishing updates the
                landing page and new-subscriber allowances together.
              </label>
              <button
                className={buttonClass}
                disabled={busy || !when || !reviewed}
                onClick={() =>
                  void run(async () => {
                    await adminPost("/ai/limits/publish", {
                      version_id: saved,
                      effective_at: new Date(when).toISOString(),
                      reviewed_terms: reviewed,
                    });
                    await refresh();
                    setSaved("");
                    setMessage(
                      "Publication scheduled. Existing subscriber benefits are unchanged.",
                    );
                  })
                }
              >
                Schedule publication
              </button>
            </div>
          )}
        </section>
      )}
      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="font-semibold">Current and historical configurations</h2>
        {data?.versions.map((v) => (
          <article className="rounded-lg bg-slate-900 p-3 text-sm" key={v.id}>
            <strong>{v.name}</strong>
            {!v.legacy_shared_daily && (
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const proposed = {
                      name: v.name,
                      suggestions_daily: v.suggestions_daily,
                      suggestions_monthly: v.suggestions_monthly,
                      guidance_monthly: v.guidance_monthly,
                      cost_target: v.cost_target,
                      warning_percent: v.warning_percent,
                    };
                    setDraft(proposed);
                    setPreview(await adminPost("/ai/limits/preview", proposed));
                    setSaved(v.id);
                    setReviewed(false);
                  })
                }
              >
                Review for publication
              </button>
            )}
            <p>
              {v.legacy_shared_daily
                ? "Protected legacy shared daily pool (individual allowance retained)"
                : `${v.suggestions_daily}/day · ${v.suggestions_monthly} suggestions/month · ${v.guidance_monthly} guidance/month`}
            </p>
            <p>
              {data.assignments.find((a) => a.version_id === v.id)
                ?.subscribers || 0}{" "}
              assigned accounts · Target ${v.cost_target}/month · Warning{" "}
              {v.warning_percent}%
            </p>
            <p>
              {data.releases
                .filter((r) => r.version_id === v.id)
                .map(
                  (r) =>
                    `Published from ${new Date(r.effective_at).toLocaleString()}`,
                )
                .join(" · ") || "Unpublished draft"}
            </p>
          </article>
        ))}
      </section>
      <section className="rounded-xl border border-slate-700 p-4 space-y-4">
        <h2 className="font-semibold">
          AI cost monitoring · UTC calendar month
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            Estimated spending
            <strong className="block text-xl">
              {money(analytics?.totals.estimated_spend)}
            </strong>
          </div>
          <div>
            Average / active Pro account
            <strong className="block text-xl">
              {money(analytics?.totals.average_per_active_pro_account)}
            </strong>
          </div>
          <div>
            Unpriced calls
            <strong className="block text-xl">
              {analytics?.totals.unpriced_calls ?? "Unknown"}
            </strong>
          </div>
        </div>
        <p className="text-xs text-slate-300">{analytics?.note}</p>
        {(
          [
            ["Costs by feature", analytics?.by_feature],
            ["Costs by model", analytics?.by_model],
            ["Highest usage accounts", analytics?.highest_usage],
            ["Daily usage trends", analytics?.trends],
            ["Above internal cost target", analytics?.above_cost_target],
            ["Request status", analytics?.by_status],
          ] as const
        ).map(([label, rows]) => (
          <details key={label}>
            <summary className="cursor-pointer text-sm">{label}</summary>
            <ul className="space-y-2 py-2 text-xs">
              {rows?.length ? (
                rows.map((row, i) => (
                  <li key={i} className="break-all rounded bg-slate-900 p-2">
                    {Object.entries(row)
                      .map(([k, v]) => `${k}: ${v ?? "unknown"}`)
                      .join(" · ")}
                  </li>
                ))
              ) : (
                <li>No records yet.</li>
              )}
            </ul>
          </details>
        ))}
      </section>
      <ModelPricing prices={data?.prices || []} refresh={refresh} />
      <section className="rounded-xl border border-slate-700 p-4 space-y-2">
        <h2 className="font-semibold">Audit log</h2>
        {data?.audit.map((a) => (
          <p key={a.id} className="break-all text-xs text-slate-300">
            {new Date(a.created_at).toLocaleString()} · {a.action} · Admin{" "}
            {a.admin_id} · {a.version_id}
          </p>
        ))}
      </section>
    </div>
  );
}
function ModelPricing({
  prices,
  refresh,
}: {
  prices: Record<string, unknown>[];
  refresh: () => Promise<void>;
}) {
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [cached, setCached] = useState("");
  const [output, setOutput] = useState("");
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-xl border border-slate-700 p-4 space-y-3">
      <h2 className="font-semibold">
        Versioned model pricing · USD per million tokens
      </h2>
      {prices.map((p) => (
        <p key={String(p.id)} className="break-all text-xs">
          {String(p.model)} · input ${String(p.input_per_million)} · cached $
          {String(p.cached_input_per_million)} · output $
          {String(p.output_per_million)} · {String(p.effective_at)}
        </p>
      ))}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await adminPost("/ai/model-prices", {
              model,
              input_per_million: input,
              cached_input_per_million: cached,
              output_per_million: output,
              source_url: source,
            });
            await refresh();
            setMessage(
              "Price added. Historical events keep their original rates.",
            );
          } catch (error) {
            setMessage(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {(
          [
            ["Model ID", model, setModel],
            ["Input rate", input, setInput],
            ["Cached input rate", cached, setCached],
            ["Output rate", output, setOutput],
            ["Official OpenAI pricing URL", source, setSource],
          ] as const
        ).map(([label, value, update]) => (
          <label key={label} className="text-sm">
            {label}
            <input
              className={inputClass}
              required
              value={value}
              onChange={(e) => update(e.target.value)}
            />
          </label>
        ))}
        <button className={buttonClass} disabled={busy}>
          Add verified model price
        </button>
        <p role="status" className="text-xs">
          {message}
        </p>
      </form>
    </section>
  );
}
