import { useEffect, useState } from "react";
import { adminGet, adminPost, errorText } from "@/lib/adminApi";
import type { Lang } from "./i18n";
type Status = {
  configured: boolean;
  configuration_error?: string;
  configuration_checks?: Record<string, string>;
  last_worker_at?: string;
  enabled: boolean;
  live_approval: boolean;
  mode?: string;
  account_id?: string;
  publication_url: string;
  email_configured: boolean;
  connection?: Record<string, unknown>;
  last_successful_sync?: string;
  verified_at?: string;
  import_cursor?: string | null;
  last_import_completed_at?: string;
  linked_subscribers?: number;
  active_entitlements?: number;
  pending_verifications?: number;
  failed_event_count?: number;
  last_webhook_received?: string;
  failed_events?: {
    event_id: string;
    event_type: string;
    state: string;
    attempts: number;
    last_error: string;
  }[];
  csv_review?: {
    row_hash: string;
    masked_email: string;
    claimed_status: string;
    review_status: string;
  }[];
  required_events: string[];
};
export default function SubstackIntegration({ language }: { language: Lang }) {
  const t = (en: string, es: string) => (language === "es" ? es : en);
  const [data, setData] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const load = () => adminGet<Status>("/integrations/substack").then(setData);
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
  }, []);
  const action = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminPost<Record<string, unknown>>(
        "/integrations/substack/" + path,
        body,
      );
      setNotice(JSON.stringify(result));
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-5 max-w-5xl">
      <h2 className="text-xl font-semibold">
        {t("Integrations · Substack", "Integraciones · Substack")}
      </h2>
      <p>
        {t("Publication", "Publicación")}:{" "}
        <a
          className="text-blue-300 underline"
          href="https://unoword.substack.com"
          target="_blank"
          rel="noreferrer"
        >
          unoword.substack.com
        </a>
      </p>
      <p>
        {t(
          "This connection only reads Stripe. It never creates charges or changes a Substack subscription. Native UnoWord Monthly and Lifetime grants remain separate.",
          "Esta conexión solo lee Stripe. No crea cargos ni cambia suscripciones de Substack. Los accesos Mensuales y de por vida de UnoWord siguen separados.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-red-300 break-words">
          {error}
        </p>
      )}
      {notice && (
        <pre
          role="status"
          className="whitespace-pre-wrap break-words rounded border border-slate-700 p-3 text-sm"
        >
          {notice}
        </pre>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [
                t("Stripe connection", "Conexión Stripe"),
                data.configured
                  ? data.account_id
                  : t("Not configured", "Sin configurar"),
              ],
              [
                t("Access changes", "Cambios de acceso"),
                data.enabled
                  ? t("Enabled", "Activados")
                  : t("Disabled", "Desactivados"),
              ],
              [t("Mode", "Modo"), data.mode || "—"],
              [
                t("Resend sender", "Remitente Resend"),
                data.email_configured ? "✓" : "—",
              ],
              [
                t("Webhook destination verified", "Destino webhook verificado"),
                data.connection?.webhook_destination_verified ? "✓" : "—",
              ],
              [
                t("Last successful synchronization", "Última sincronización"),
                data.last_successful_sync || "—",
              ],
              [
                t("Linked subscribers", "Suscriptores conectados"),
                data.linked_subscribers ?? 0,
              ],
              [
                t("Active Substack entitlements", "Accesos Substack activos"),
                data.active_entitlements ?? 0,
              ],
              [
                t("Pending email verifications", "Verificaciones pendientes"),
                data.pending_verifications ?? 0,
              ],
              [
                t("Failed events", "Eventos fallidos"),
                data.failed_event_count ?? 0,
              ],
              [
                t("Last webhook received", "Último webhook recibido"),
                data.last_webhook_received || "—",
              ],
              [
                t("Recovery worker last seen", "Última ejecución del proceso"),
                data.last_worker_at || "—",
              ],
            ].map(([label, value]) => (
              <div
                className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0"
                key={String(label)}
              >
                <h3 className="text-sm text-slate-300">{label}</h3>
                <p className="break-words mt-2 font-semibold">
                  {String(value)}
                </p>
              </div>
            ))}
          </div>
          {data.configuration_error && (
            <p role="status">{data.configuration_error}</p>
          )}
          {data.configuration_checks && (
            <details
              className="rounded border border-slate-700 p-3"
              open={!data.configured}
            >
              <summary>
                {t(
                  "Backend settings received",
                  "Configuración recibida por el backend",
                )}
              </summary>
              <p>
                {t(
                  "Only presence and format are shown. Secret values are never displayed; format checks do not verify provider access.",
                  "Solo se muestran presencia y formato. No se muestran secretos; el formato no verifica el acceso al proveedor.",
                )}
              </p>
              <dl className="grid gap-3 mt-3">
                {Object.entries(data.configuration_checks).map(
                  ([name, status]) => (
                    <div key={name} className="grid gap-1">
                      <dt className="break-words font-mono text-sm">{name}</dt>
                      <dd>{status}</dd>
                    </div>
                  ),
                )}
              </dl>
            </details>
          )}
          {!data.configured && (
            <p>
              {t(
                "Configure the separate Substack account, restricted key, eligible product/price allowlist, email protection secret and Resend verified sender in backend environment settings. Do not reuse UnoWord payment keys.",
                "Configura la cuenta Substack independiente, la clave restringida, los productos o precios válidos, el secreto de correo y el remitente verificado Resend en el backend. No reutilices claves de pago de UnoWord.",
              )}
            </p>
          )}
          {data.connection && (
            <details className="rounded border border-slate-700 p-3">
              <summary>
                {t("Read-only readiness report", "Informe de verificación")}
              </summary>
              <pre className="whitespace-pre-wrap break-words text-sm">
                {JSON.stringify(data.connection, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap gap-3">
            {[
              [
                "inspect",
                t("Check Stripe connection", "Verificar conexión Stripe"),
              ],
              [
                "import",
                data.import_cursor
                  ? t("Continue import", "Continuar importación")
                  : t(
                      "Import existing subscriptions",
                      "Importar suscripciones existentes",
                    ),
              ],
              [
                "subscriptions",
                t("Reconcile subscriptions", "Revisar suscripciones"),
              ],
              [
                "events",
                t("Process pending events", "Procesar eventos pendientes"),
              ],
              [
                "retry_failed",
                t("Retry failed events", "Reintentar eventos fallidos"),
              ],
            ].map(([operation, label]) => (
              <button
                key={operation}
                type="button"
                className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-50"
                disabled={busy || !data.configured}
                onClick={() =>
                  void action("reconcile", {
                    operation,
                    ...(operation === "import" && data.import_cursor
                      ? { cursor: data.import_cursor }
                      : {}),
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            {t(
              "Imports only add or refresh individually verified subscriptions. Missing rows never revoke access. Importing does not create UnoWord accounts or send email.",
              "Las importaciones solo añaden o actualizan suscripciones verificadas individualmente. Las filas ausentes no revocan acceso. Importar no crea cuentas de UnoWord ni envía correo.",
            )}
          </p>
          <fieldset className="grid gap-3 rounded-xl border border-slate-700 p-4">
            <legend>
              {t("Activation controls", "Controles de activación")}
            </legend>
            <p>
              {t(
                "Live access stays blocked until the owner explicitly approves it, the backend live-approval setting is enabled, and the read-only readiness check passes. Disabling here removes only Substack access eligibility.",
                "El acceso real queda bloqueado hasta la aprobación explícita del propietario, la configuración de aprobación y una verificación correcta. Desactivar aquí solo elimina el acceso de Substack.",
              )}
            </p>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t(
                "I confirm this integration access change.",
                "Confirmo este cambio de acceso.",
              )}
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={
                  busy ||
                  !confirmed ||
                  !data.configured ||
                  (data.mode === "live" && !data.live_approval)
                }
                className="rounded-lg bg-blue-600 px-4 py-2 disabled:opacity-50"
                onClick={() =>
                  void action("activation", { enabled: true, confirmed })
                }
              >
                {t("Enable verified access", "Activar acceso verificado")}
              </button>
              <button
                type="button"
                disabled={busy || !confirmed || !data.enabled}
                className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-50"
                onClick={() =>
                  void action("activation", { enabled: false, confirmed })
                }
              >
                {t("Disable Substack access", "Desactivar acceso Substack")}
              </button>
            </div>
          </fieldset>
          <section>
            <h3 className="font-semibold">
              {t(
                "Failed and retrying events",
                "Eventos fallidos y en reintento",
              )}
            </h3>
            <ul>
              {data.failed_events?.map((event) => (
                <li
                  key={event.event_id}
                  className="break-words border-b border-slate-700 py-2"
                >
                  {event.event_type} · {event.state} · {event.attempts} ·{" "}
                  {event.last_error}
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-3">
            <h3 className="font-semibold">
              {t("CSV fallback reconciliation", "Revisión alternativa CSV")}
            </h3>
            <p>
              {t(
                "Required column: email. Optional: stripe_subscription_id, paid_through (ISO timestamp with timezone), status. Maximum 500 rows. CSV claims alone never grant access; entries missing from Stripe remain for manual review.",
                "Columna obligatoria: email. Opcionales: stripe_subscription_id, paid_through (ISO con zona horaria), status. Máximo 500 filas. Un CSV no concede acceso por sí solo; los registros ausentes de Stripe quedan para revisión.",
              )}
            </p>
            <label>
              {t("Import Substack CSV", "Importar CSV de Substack")}
              <input
                className="block mt-2"
                type="file"
                accept=".csv,text/csv"
                disabled={busy || !data.configured}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 524288) {
                    setError(
                      t(
                        "CSV must be smaller than 512 KB.",
                        "El CSV debe tener menos de 512 KB.",
                      ),
                    );
                    return;
                  }
                  await action("csv", { text: await file.text() });
                  e.target.value = "";
                }}
              />
            </label>
            {data.csv_review?.map((row) => (
              <div
                key={row.row_hash}
                className="flex flex-wrap gap-3 items-center rounded border border-slate-700 p-3"
              >
                <span>
                  {row.masked_email} · {row.claimed_status} ·{" "}
                  {row.review_status}
                </span>
                <button
                  disabled={busy}
                  type="button"
                  className="rounded border border-slate-600 px-3 py-2"
                  onClick={() =>
                    void action("reconcile", {
                      operation: "csv",
                      row_hash: row.row_hash,
                    })
                  }
                >
                  {t("Verify with Stripe", "Verificar con Stripe")}
                </button>
              </div>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
