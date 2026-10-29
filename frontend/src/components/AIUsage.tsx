import type { AIUsageSummary } from "@/lib/use-ai-usage";

export default function AIUsage({
  usage,
  language = "en",
}: {
  usage?: AIUsageSummary | null;
  language?: string;
}) {
  const es = language === "es";
  if (!usage)
    return (
      <div className="uw-ai-usage" role="status">
        {es ? "Uso de IA no disponible" : "AI usage unavailable"}
      </div>
    );
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(es ? "es" : "en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: usage.timezone,
    }).format(new Date(date));
  const rows = usage.legacy_shared
    ? [
        [
          es
            ? "Solicitudes de IA hoy (plan protegido)"
            : "AI requests today (protected plan)",
          usage.used_today,
          usage.daily_limit,
          usage.remaining,
          usage.pending_today,
        ],
        [
          es ? "Solicitudes de IA este mes" : "AI requests this month",
          usage.suggestions_monthly_used + usage.guidance_monthly_used,
          null,
          null,
          usage.suggestions_monthly_pending + usage.guidance_monthly_pending,
        ],
        [
          es
            ? "Guía de escritura registrada este mes"
            : "Writing Guidance tracked this month",
          usage.guidance_monthly_used,
          null,
          null,
          usage.guidance_monthly_pending,
        ],
      ]
    : [
        [
          es ? "Sugerencias hoy" : "Suggestions Today",
          usage.used_today,
          usage.daily_limit,
          usage.remaining,
          usage.pending_today,
        ],
        [
          es ? "Sugerencias este mes" : "Suggestions This Month",
          usage.suggestions_monthly_used,
          usage.suggestions_monthly_limit,
          usage.suggestions_monthly_remaining,
          usage.suggestions_monthly_pending,
        ],
        [
          es ? "Guía de escritura" : "Writing Guidance",
          usage.guidance_monthly_used,
          usage.guidance_monthly_limit,
          usage.guidance_monthly_remaining,
          usage.guidance_monthly_pending,
        ],
      ];
  return (
    <section
      className="uw-ai-usage"
      aria-label={es ? "Tu uso de IA" : "Your AI Usage"}
    >
      <strong>{es ? "Tu uso de IA" : "Your AI Usage"}</strong>
      {rows.map(([label, used, limit, remaining, pending]) => (
        <div key={String(label)} className="uw-ai-usage-row">
          <span>{label}</span>
          <b>
            {used}
            {limit != null ? ` / ${limit}` : ""}
          </b>
          <small>
            {remaining != null
              ? `${remaining} ${es ? "disponibles" : "left"}`
              : es
                ? "Usa tu asignación diaria compartida protegida"
                : "Uses your protected shared daily allowance"}
            {Number(pending) > 0
              ? ` · ${pending} ${es ? "en curso" : "pending"}`
              : ""}
          </small>
          {limit != null && (
            <progress
              aria-label={String(label)}
              value={Number(used)}
              max={Number(limit)}
            />
          )}
          {Number(limit) > 0 &&
            Number(used) / Number(limit) >= usage.warning_percent / 100 && (
              <small>
                {es
                  ? "Te acercas al límite de este periodo."
                  : "You’re approaching this period’s allowance."}
              </small>
            )}
        </div>
      ))}
      <small>
        {es ? "Restablecimiento diario" : "Daily reset"}:{" "}
        {formatDate(usage.daily_reset_at)}
      </small>
      <small>
        {es ? "Restablecimiento mensual" : "Monthly reset"}:{" "}
        {formatDate(usage.monthly_reset_at)} ({usage.timezone})
      </small>
      <small>
        {es
          ? "Compartido con la extensión. Sin acumulación. Abrir sugerencias guardadas no consume usos."
          : "Shared with the extension. No rollover. Viewing saved ideas uses no credits."}
      </small>
      {usage.pending_timezone && (
        <small>
          {es
            ? "El cambio de zona horaria se aplicará el próximo mes."
            : "Your timezone change applies next calendar month."}
        </small>
      )}
    </section>
  );
}
