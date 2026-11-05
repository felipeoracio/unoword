import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import "@/styles/substack.css";
export type SubstackStatus = {
  user_id: string;
  available: boolean;
  configured: boolean;
  connected: boolean;
  active: boolean;
  access_enabled?: boolean;
  publication_url?: string;
  subscriptions: {
    masked_email: string;
    status: string;
    active: boolean;
    paid_through: string | null;
    cancel_at_period_end: boolean;
    verified_at: string | null;
  }[];
  pending_request: {
    id: string;
    status: "pending" | "verified";
    expires_at: string;
    masked_email: string;
  } | null;
};
const messages: Record<string, [string, string]> = {
  substack_verification_invalid: [
    "That code is invalid, expired, or already used. Request a new code if needed.",
    "El código no es válido, ha caducado o ya se usó. Solicita otro si es necesario.",
  ],
  substack_email_rate_limited: [
    "Please wait before requesting another verification email.",
    "Espera antes de solicitar otro correo de verificación.",
  ],
  substack_no_verified_paid_subscription: [
    "No eligible paid subscription could be verified for this email. Check the email used for your Substack payment, or contact support.",
    "No se pudo verificar una suscripción de pago válida. Revisa el correo usado para pagar Substack o contacta con soporte.",
  ],
  substack_subscription_already_linked: [
    "This subscription is already connected to another UnoWord account. Disconnect it there first or contact support.",
    "Esta suscripción ya está conectada a otra cuenta de UnoWord. Desconéctala allí o contacta con soporte.",
  ],
  substack_email_delivery_failed: [
    "The verification email could not be delivered. Please try again later.",
    "No se pudo enviar el correo de verificación. Inténtalo más tarde.",
  ],
  account_changed: [
    "Your account changed. Sign in again before connecting.",
    "Tu cuenta cambió. Inicia sesión de nuevo antes de conectar.",
  ],
};
export default function ConnectSubstack({
  owner,
  language = "en",
  onAccessChange,
}: {
  owner: string;
  language?: string;
  onAccessChange?: () => Promise<unknown>;
}) {
  const es = language === "es",
    t = (en: string, spanish: string) => (es ? spanish : en),
    client = useQueryClient();
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const status = useQuery({
    queryKey: ["substack-subscription", owner],
    gcTime: 0,
    retry: false,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const data = await apiGet<SubstackStatus>("/subscription/substack");
      if (data.user_id !== owner) throw Error("account_changed");
      return data;
    },
  });
  const data = status.isError ? undefined : status.data;
  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiPost<{ request_id?: string }>(
        "/subscription/substack/" + action,
        { expected_user_id: owner, ...body },
      );
      if (action === "connect") {
        setEmail("");
        setNotice(
          t(
            "Check your email for an eight-digit code.",
            "Revisa tu correo para obtener un código de ocho dígitos.",
          ),
        );
      }
      if (
        action === "verify" ||
        action === "finish" ||
        action === "reverify" ||
        action === "disconnect"
      )
        await onAccessChange?.();
      await client.invalidateQueries({
        queryKey: ["substack-subscription", owner],
      });
      return result;
    } catch (e) {
      const detail =
        e instanceof ApiError ? (e.body as { detail?: string })?.detail : "";
      const pair = detail ? messages[detail] : undefined;
      setError(
        pair
          ? pair[es ? 1 : 0]
          : t(
              "We could not verify the connection right now. Your other subscriptions are unchanged. You can retry without requesting another code after verifying your email.",
              "No se pudo verificar la conexión. Tus otras suscripciones no cambian. Puedes reintentar sin pedir otro código después de verificar tu correo.",
            ),
      );
      await client.invalidateQueries({
        queryKey: ["substack-subscription", owner],
      });
    } finally {
      setCode("");
      setBusy(false);
    }
  };
  const latestAccessCallback = useRef(onAccessChange);
  latestAccessCallback.current = onAccessChange;
  const lastActive = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    if (lastActive.current !== undefined && lastActive.current !== data.active)
      void latestAccessCallback.current?.().catch(() => {});
    lastActive.current = data.active;
  }, [data]);
  const pending = data?.pending_request;
  return (
    <section
      className="uw-substack"
      id="subscription"
      aria-label={t(
        "Subscription · Connect Substack",
        "Suscripción · Conectar Substack",
      )}
    >
      <small>{t("SETTINGS · SUBSCRIPTION", "AJUSTES · SUSCRIPCIÓN")}</small>
      <h2>{t("Connect Substack", "Conectar Substack")}</h2>
      <p>
        {t(
          "Already a paid reader of UnoWord on Substack? Connect your verified subscription to receive Pro without a second charge.",
          "¿Ya pagas por UnoWord en Substack? Conecta tu suscripción verificada para obtener Pro sin un segundo pago.",
        )}
      </p>
      <p className="uw-substack-note">
        {t(
          "Your Substack email can differ from your UnoWord login. Connecting does not change your login email or cancel either subscription.",
          "Tu correo de Substack puede ser distinto al de UnoWord. Conectar no cambia tu correo de acceso ni cancela ninguna suscripción.",
        )}
      </p>
      {!data ? (
        <p role="status">
          {status.error
            ? t(
                "Subscription linking is temporarily unavailable.",
                "La conexión no está disponible temporalmente.",
              )
            : "…"}
        </p>
      ) : (
        <>
          {data.connected && (
            <div className="uw-substack-status" role="status">
              <h3>{t("Subscription Connected", "Suscripción conectada")}</h3>
              <strong>
                {data.active
                  ? t("Active Pro Access", "Acceso Pro activo")
                  : t(
                      "Substack Pro access is not currently active. Your other plans are preserved.",
                      "El acceso Pro de Substack no está activo. Tus otros planes se conservan.",
                    )}
              </strong>
              {data.subscriptions.map((sub, i) => (
                <p key={i}>
                  {sub.masked_email}
                  {sub.paid_through && (
                    <>
                      {" "}
                      · {t("Verified through", "Verificada hasta")}{" "}
                      <time dateTime={sub.paid_through}>
                        {new Date(sub.paid_through).toLocaleDateString(
                          es ? "es" : "en",
                          { dateStyle: "long" },
                        )}
                      </time>
                    </>
                  )}
                  {sub.cancel_at_period_end && (
                    <>
                      {" "}
                      · {t("Cancellation scheduled", "Cancelación programada")}
                    </>
                  )}
                </p>
              ))}
              <div className="uw-substack-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run("reverify")}
                >
                  {t("Reverify Subscription", "Volver a verificar")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run("disconnect")}
                >
                  {t("Disconnect Subscription", "Desconectar suscripción")}
                </button>
              </div>
            </div>
          )}
          {pending ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(pending.status === "verified" ? "finish" : "verify", {
                  request_id: pending.id,
                  ...(pending.status === "verified" ? {} : { code }),
                });
              }}
            >
              <h3>{t("Verify Email", "Verificar correo")}</h3>
              <p>
                {pending.masked_email} ·{" "}
                {t(
                  "Code expires in ten minutes.",
                  "El código caduca en diez minutos.",
                )}
              </p>
              {pending.status === "verified" ? (
                <p>
                  {t(
                    "Email verified. Retry connecting your subscription.",
                    "Correo verificado. Reintenta conectar tu suscripción.",
                  )}
                </p>
              ) : (
                <label>
                  {t(
                    "Eight-digit verification code",
                    "Código de verificación de ocho dígitos",
                  )}
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{8}"
                    minLength={8}
                    maxLength={8}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
              )}
              <button type="submit" disabled={busy}>
                {busy
                  ? "…"
                  : pending.status === "verified"
                    ? t("Retry Connection", "Reintentar conexión")
                    : t("Verify Email", "Verificar correo")}
              </button>
            </form>
          ) : data.available ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("connect", { email });
              }}
            >
              <label>
                {t(
                  "Substack payment email",
                  "Correo usado para pagar Substack",
                )}
                <input
                  type="email"
                  name="substack_email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "…" : t("Connect Subscription", "Conectar suscripción")}
              </button>
            </form>
          ) : (
            <p role="status">
              {t(
                "Substack linking is being prepared. Your existing UnoWord subscription is unchanged.",
                "Estamos preparando la conexión con Substack. Tu suscripción de UnoWord no cambia.",
              )}
            </p>
          )}
          {pending && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("cancel", { request_id: pending.id })}
            >
              {t("Cancel verification", "Cancelar verificación")}
            </button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
