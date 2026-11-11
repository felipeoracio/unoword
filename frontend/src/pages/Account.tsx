import ConnectSubstack from "@/components/substack/ConnectSubstack";
import { legacyRecovery, recoveryPath } from "@/lib/domain-recovery";
import { RewardsSettings, RewardsWidget } from "@/components/rewards/Rewards";
import WritingStreak from "@/components/WritingStreak";
import AIUsage from "@/components/AIUsage";
import { useAIUsage } from "@/lib/use-ai-usage";
import GoogleSignIn from "@/components/GoogleSignIn";
import LifetimeAccount from "@/components/marketing/LifetimeAccount";
import AccountTour from "@/components/onboarding/AccountTour";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Chrome,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import Brand from "@/components/marketing/Brand";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { AuthResult, AuthUser } from "@/lib/auth-types";
import { beginSession } from "@/lib/session";
import { useProduct } from "@/lib/product";
import "@/styles/marketing.css";
import "@/styles/account.css";
import AppShell from "@/components/studio/AppShell";
import { useStudioPreferences } from "@/lib/studio-preferences";
import { StudioPageHeader } from "@/components/studio/StudioPrimitives";
import "@/styles/studio-settings.css";

async function currentUser(): Promise<AuthUser | null> {
  try {
    return await apiGet<AuthUser>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    try {
      await apiPost("/auth/refresh");
    } catch {
      return null;
    }
    return apiGet<AuthUser>("/auth/me");
  }
}
function messageFor(error: unknown) {
  if (!(error instanceof ApiError))
    return "We couldn’t connect. Please try again.";
  const detail = (error.body as { detail?: unknown })?.detail;
  if (detail === "email_confirmation_required")
    return "Confirm your email before signing in. Check your inbox and spam folder, or use Continue with Google.";
  if (
    ["email_signup_unavailable", "email_confirmation_not_configured"].includes(
      String(detail),
    )
  )
    return "Email signup is temporarily unavailable. Please use Continue with Google or try again later.";
  if (
    detail === "billing_unavailable" ||
    detail === "live_billing_not_approved"
  )
    return "Billing is currently unavailable. Your plan has not changed.";
  if (detail === "plan_managed_separately")
    return "Your Pro access is managed separately. No purchase is needed for your current access.";
  if (detail === "no_paid_subscription")
    return "There is no Stripe subscription to manage for this account.";
  if (detail === "billing_busy")
    return "Another billing request is in progress. Please wait a moment and retry.";
  if (
    [
      "billing_storage_unavailable",
      "billing_price_mismatch",
      "billing_price_not_found",
      "billing_key_invalid",
      "billing_permission_denied",
      "billing_checkout_configuration_invalid",
      "billing_portal_not_configured",
    ].includes(String(detail))
  )
    return "Billing setup is incomplete. Your plan has not changed. Please contact Support.";
  if (detail === "email_workflow_not_configured")
    return "Email recovery is not configured yet. Please see Support for help.";
  if (detail === "account_changed")
    return "Your account changed. Refresh this page before requesting a plan change.";
  if (error.status === 429)
    return "Too many attempts. Please wait a few minutes and try again.";
  if (error.status === 401 || error.status === 400)
    return "That sign-in was not accepted. Check your email and password and try again.";
  if (error.status === 422)
    return "Please enter a valid email and a password of at least 8 characters.";
  return "This request could not be completed. Please try again.";
}
type Subscription = {
  access_source?: string | null;
  user_id: string;
  managed_by_stripe: boolean;
  trial_eligible: boolean;
  status: string;
  billing_status?: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
};
function redirectToBilling(result: { url: string; destination: string }) {
  const url = new URL(result.url);
  const host =
    result.destination === "portal"
      ? "billing.stripe.com"
      : "checkout.stripe.com";
  if (url.protocol !== "https:" || url.host !== host)
    throw new Error("Invalid billing redirect");
  window.location.assign(url.href);
}
export default function Account() {
  const { language: studioLanguage } = useStudioPreferences();
  const location = useLocation(), es = studioLanguage === "es";
  const t = (en: string, spanish: string) => es ? spanish : en;
  const [params] = useSearchParams();
  const requested = params.get("mode");
  const mode =
    requested === "signup"
      ? "signup"
      : requested === "recovery"
        ? "recovery"
        : "signin";
  const lifetimeIntent = params.get("offer") === "lifetime";
  const proIntent = !lifetimeIntent && params.get("plan") === "pro";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const submitting = useRef(false);
  const product = useProduct();
  const aiUsage = useAIUsage(user?.id, Boolean(user?.ai_access));
  const initialAuthRedirect = useRef({
    oauth: params.get("oauth"),
    next: params.get("next"),
  });
  useEffect(() => {
    let cancelled = false;
    const { oauth, next } = initialAuthRedirect.current;
    if (oauth === "success") beginSession();
    const oauthErrors: Record<string, string> = {
      expired:
        "Google sign-in expired or was already used. Please start again.",
      canceled: "Google sign-in was canceled. You can try again or use email.",
      failed: "Google sign-in could not be completed. Please try again.",
    };
    if (oauth) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("oauth");
      window.history.replaceState(
        window.history.state,
        "",
        clean.pathname + clean.search + clean.hash,
      );
      if (oauthErrors[oauth]) setMessage(oauthErrors[oauth]);
    }
    currentUser()
      .then((data) => {
        if (!cancelled) {
          setUser(data);
          if (data && oauth === "success" && ["/editor", "/app", "/ideas", "/progress", "/library", "/settings", "/projects"].includes(next || ""))
            window.location.replace(recoveryPath(next!));
        }
      })
      .catch(() => {
        if (!cancelled)
          setMessage(
            "We couldn’t check your session. You can try signing in below.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!params.get("oauth")) setMessage("");
    setPassword("");
    setShowPassword(false);
  }, [mode, params]);
  const billingOwner = user?.id;
  useEffect(() => {
    if (!billingOwner) {
      setSubscription(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const owner = billingOwner;
    async function refreshBilling() {
      try {
        const status = await apiGet<Subscription>("/subscription");
        if (cancelled || status.user_id !== owner) return;
        setSubscription(status);
        if (
          params.get("billing") === "success" ||
          params.get("billing") === "return"
        ) {
          const fresh = await currentUser();
          if (cancelled) return;
          if (!fresh || fresh.id !== owner) {
            setUser(fresh);
            setConfirmed(false);
            return;
          }
          setUser(fresh);
          if (params.get("billing") === "return") {
            if (status.status === "canceled")
              setMessage(
                "Your Stripe subscription has ended. Your saved writing stays in your account, and Free features remain available.",
              );
            else if (status.cancel_at_period_end)
              setMessage(
                "Cancellation is scheduled. Pro remains available until the trial or paid period ends.",
              );
            else if (
              [
                "past_due",
                "unpaid",
                "paused",
                "incomplete",
                "incomplete_expired",
              ].includes(status.status)
            )
              setMessage(
                "Your subscription needs attention. Open Manage subscription to review payment details. Your saved writing is preserved.",
              );
            else
              setMessage(
                "Your subscription details have been refreshed. Recent changes may take a moment to appear.",
              );
            // Portal changes can arrive after the browser returns. Continue
            // reading verified state even while the account still has Pro.
            if (++attempts < 6) timer = setTimeout(refreshBilling, 5000);
          } else if (fresh.ai_access) {
            setMessage(
              "Your Pro access is confirmed. Reopen the extension to refresh your account.",
            );
          } else if (
            [
              "canceled",
              "past_due",
              "unpaid",
              "paused",
              "incomplete_expired",
            ].includes(status.status)
          ) {
            setMessage(
              "Your subscription is not currently active. Open Manage subscription to review its status. Your saved writing and Free features are preserved.",
            );
          } else {
            setMessage(
              "Waiting for Stripe verification. Your plan updates only after the subscription is confirmed. You can refresh this page shortly.",
            );
            if (++attempts < 6) timer = setTimeout(refreshBilling, 5000);
          }
        }
      } catch {
        if (
          !cancelled &&
          ["success", "return"].includes(params.get("billing") || "")
        ) {
          setMessage(
            "We couldn’t refresh your subscription yet. We’ll retry shortly; your access changes only after verification.",
          );
          if (++attempts < 6) timer = setTimeout(refreshBilling, 5000);
        }
      }
    }
    void refreshBilling();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [billingOwner, params]);
  async function authenticate(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (mode === "recovery") {
        await apiPost("/auth/recovery", { email });
        setMessage(
          "If an eligible account exists, a recovery link will be sent. Check your inbox and spam folder.",
        );
        return;
      }
      const result = await apiPost<AuthResult>(
        mode === "signup" ? "/auth/signup" : "/auth/login",
        {
          email,
          password,
          ...(mode === "signup"
            ? {
                intent: lifetimeIntent
                  ? "lifetime"
                  : proIntent
                    ? "pro"
                    : params.get("next") === "/editor"
                      ? "editor"
                      : "account",
              }
            : {}),
        },
      );
      if (!result.authenticated) {
        setMessage(
          result.message ||
            "Check your email to confirm your account, then sign in. You can submit Create free account again to request another confirmation.",
        );
        return;
      }
      beginSession();
      const fresh = await currentUser();
      setUser(fresh);
      if (fresh && ["/editor", "/app", "/ideas", "/progress", "/library", "/settings", "/projects"].includes(params.get("next") || ""))
        window.location.assign(recoveryPath(params.get("next")!));
      if (!fresh) setMessage("Please sign in again to continue.");
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPassword("");
      setBusy(false);
      submitting.current = false;
    }
  }
  async function changePlan(event: FormEvent, target: "pro" | "free" = "pro") {
    event.preventDefault();
    if (!user || !confirmed || submitting.current) return;
    const owner = user.id;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const fresh = await currentUser();
      if (!fresh || fresh.id !== owner) {
        setUser(fresh);
        setConfirmed(false);
        setMessage(
          "Your account changed. Review your account before continuing.",
        );
        return;
      }
      const result = await apiPost<{ url: string; destination: string }>(
        "/subscription/change",
        {
          target_plan: target,
          confirmed: true,
          expected_user_id: owner,
        },
      );
      const after = await currentUser();
      if (!after || after.id !== owner) {
        setUser(after);
        setConfirmed(false);
        setSubscription(null);
        setMessage(
          "Your account changed. Review your account before continuing.",
        );
        return;
      }
      redirectToBilling(result);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      await apiPost("/auth/logout");
      beginSession();
      setUser(null);
      setConfirmed(false);
      setPassword("");
    } catch {
      setMessage("Sign-out could not be completed. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function requestRecovery() {
    if (!user?.email || submitting.current) return;
    submitting.current = true; setBusy(true); setRecoveryNotice("");
    try {
      const fresh = await currentUser();
      if (!fresh || fresh.id !== user.id) { setRecoveryNotice(t("Your account changed. Refresh before requesting recovery.", "Tu cuenta cambió. Actualiza antes de solicitar la recuperación.")); return; }
      await apiPost("/auth/recovery", { email: user.email });
      setRecoveryNotice(t("If an eligible account exists, a recovery link will be sent. Check your inbox and spam folder.", "Si existe una cuenta válida, recibirás un enlace de recuperación. Revisa tu bandeja y la carpeta de spam."));
    } catch (error) { setRecoveryNotice(messageFor(error)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const content = (
    <div className={`uw-site uw-account-page${user ? " uw-settings" : ""}`}>
      <header className="uw-account-header uw-container">
        <Brand />
        <Link to="/" className="uw-text-link">
          <ArrowLeft size={15} /> Back to UnoWord
        </Link>
      </header>
      {user && <><StudioPageHeader title={t("Your settings", "Tus ajustes")} eyebrow={t("Make yourself at home.", "Siéntete como en casa.")} description={t("Your account, preferences and connections, in one place.", "Tu cuenta, preferencias y conexiones, en un solo lugar.")} /><nav className="uw-settings-nav" aria-label={t("Settings sections", "Secciones de ajustes")}>{[
        ["account-settings", t("Account", "Cuenta")], ["settings-subscription", t("Plan & subscription", "Plan y suscripción")], ["settings-preferences", t("Preferences", "Preferencias")], ["settings-security", t("Security", "Seguridad")], ["install", t("Chrome extension", "Extensión de Chrome")],
      ].map(([id, name]) => <Link key={id} to={recoveryPath(location.pathname + location.search + "#" + id)} aria-current={(location.hash || "#account-settings") === "#" + id ? "location" : undefined}>{name}</Link>)}</nav></>}
      <main className="uw-account-main">
        <section className="uw-account-card" aria-labelledby="account-heading">
          {legacyRecovery() && <p role="status">Previous-domain recovery: sign in to the same account to sync or export drafts saved on this browser.</p>}
          {loading ? (
            <p role="status">Checking your session…</p>
          ) : user ? (
            <>
              <section className="uw-settings-section" aria-labelledby="account-heading">
              <span className="uw-icon-tile">
                <Check />
              </span>
              <p className="uw-eyebrow">{t("YOUR WORDS. YOUR POSSIBILITIES.", "TUS PALABRAS. TUS POSIBILIDADES.")}</p>
              <h2 id="account-heading">
                {t("Your account", "Tu cuenta")}
              </h2>
              <p className="uw-account-email">
                {t("Signed in as", "Sesión iniciada como")} <strong>{user.email}</strong>
              </p>
              <p className="uw-account-plan" id="account-settings" tabIndex={-1}>
                {t("Current plan", "Plan actual")} <span>{user.ai_access ? "Pro" : "Free"}</span>
              </p>
              <Link className="uw-button" to={recoveryPath("/app")}>{studioLanguage === "es" ? "Abrir Inicio" : "Open Home"}<ArrowRight size={16}/></Link>
              <Link className="uw-button uw-button-outline" to={recoveryPath("/library")}>{t("Open Library", "Abrir biblioteca")}<ArrowRight size={16}/></Link>
              <AccountTour key={user.id} owner={user.id} pro={user.ai_access} language={studioLanguage} />
              </section>
              <section className="uw-settings-section" id="settings-subscription" tabIndex={-1} aria-labelledby="settings-subscription-heading">
              <h2 id="settings-subscription-heading">{t("Plan & subscription", "Plan y suscripción")}</h2>
              {lifetimeIntent && <LifetimeAccount key={user.id} user={user} />}
              <ConnectSubstack key={"substack-" + user.id} owner={user.id} language={studioLanguage} onAccessChange={async()=>{const fresh=await currentUser();if(fresh?.id===user.id){setUser(fresh);const next=await apiGet<Subscription>("/subscription");if(next.user_id===user.id)setSubscription(next);}}}/>
              {proIntent && !user.ai_access && (
                <form
                  className="uw-plan-intent"
                  onSubmit={(event) => changePlan(event)}
                >
                  <div>
                    <Sparkles size={20} />
                    <h2>{t("Continue with Pro", "Continuar con Pro")}</h2>
                  </div>
                  <p>
                    {product.data?.billing_available
                      ? subscription?.trial_eligible === false
                        ? t("Pro costs $20 USD per month. Your account has already used its trial. Review your subscription in Stripe before confirming payment.", "Pro cuesta 20 USD al mes. Tu cuenta ya usó la prueba. Revisa tu suscripción en Stripe antes de confirmar el pago.")
                        : t("Try Pro free for 7 days, then $20 USD per month unless you cancel. A payment method is required. The trial is available once per account.", "Prueba Pro gratis durante 7 días; después, 20 USD al mes hasta que canceles. Se requiere un método de pago. La prueba está disponible una vez por cuenta.")
                      : t("Billing is currently unavailable, so your plan will stay unchanged. Existing eligible Pro accounts keep their access.", "La facturación no está disponible. Tu plan no cambia y las cuentas Pro válidas conservan su acceso.")}
                  </p>
                  {product.data?.ai_allowance && (
                    <p>
                      New-subscriber AI allowance:{" "}
                      {product.data.ai_allowance.suggestions_daily}{" "}
                      suggestions/day,{" "}
                      {product.data.ai_allowance.suggestions_monthly}{" "}
                      suggestions/calendar month, and{" "}
                      {product.data.ai_allowance.guidance_monthly} Writing
                      Guidance requests/calendar month. No rollover. Your coach
                      provides directions, never prose. Existing accounts retain
                      their assigned terms.
                    </p>
                  )}
                  <label className="uw-confirm-plan">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      required
                      disabled={busy}
                    />
                    <span>
                      {t("I confirm this Pro request is for", "Confirmo que esta solicitud de Pro es para")}{" "}
                      <strong>{user.email}</strong>.
                    </span>
                  </label>
                  <button
                    className="uw-button"
                    type="submit"
                    disabled={busy || !confirmed}
                  >
                    {busy ? t("Please wait…", "Espera…") : t("Confirm plan request", "Confirmar solicitud del plan")}
                    <ArrowRight size={15} />
                  </button>
                </form>
              )}
              {!proIntent && !lifetimeIntent && !user.ai_access && (
                <Link
                  className="uw-button uw-button-outline"
                  to="/account?plan=pro"
                >
                  {t("Explore Pro", "Explorar Pro")}
                </Link>
              )}
              {user.ai_access &&
                subscription?.access_source === "stripe_lifetime" &&
                !lifetimeIntent && (
                  <Link
                    className="uw-button uw-button-outline"
                    to="/account?offer=lifetime"
                  >
                    {t("Manage lifetime purchase & refunds", "Gestionar compra de por vida y reembolsos")}
                  </Link>
                )}
              {subscription?.user_id === user.id &&
                subscription.access_source !== "stripe_lifetime" &&
                subscription.managed_by_stripe && (
                  <form
                    className="uw-plan-intent"
                    onSubmit={(event) => changePlan(event, "free")}
                  >
                    <h2>{t("Your subscription", "Tu suscripción")}</h2>
                    <p>
                      {t("Status", "Estado")}: {(subscription.billing_status || subscription.status).replaceAll("_", " ")}
                      {subscription.period_end && (
                        <>
                          {" "}
                          ·{" "}
                          {subscription.cancel_at_period_end
                            ? t("Ends", "Finaliza")
                            : subscription.status === "trialing"
                              ? t("Trial ends", "La prueba finaliza")
                              : t("Current period ends", "El periodo actual finaliza")}{" "}
                          {new Date(
                            subscription.period_end,
                          ).toLocaleDateString(studioLanguage)}
                        </>
                      )}
                    </p>
                    <p>
                      {t("Update payment details or cancel in Stripe. A scheduled cancellation keeps access through the paid period or trial end.", "Actualiza el pago o cancela en Stripe. Una cancelación programada conserva el acceso hasta el final del periodo pagado o de prueba.")}
                    </p>
                    <label className="uw-confirm-plan">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        disabled={busy}
                        required
                      />
                      <span>
                        {t("Manage the subscription for", "Gestionar la suscripción de")}{" "}
                        <strong>{user.email}</strong>.
                      </span>
                    </label>
                    <button
                      className="uw-button uw-button-outline"
                      type="submit"
                      disabled={busy || !confirmed}
                    >
                      {t("Manage subscription", "Gestionar suscripción")}
                    </button>
                  </form>
                )}
              </section>
              <section className="uw-settings-section" id="settings-preferences" tabIndex={-1} aria-labelledby="settings-preferences-heading">
              <h2 id="settings-preferences-heading">{t("Preferences & milestones", "Preferencias y logros")}</h2>
              <p>{t("Use the theme and language controls above to personalize this browser. Milestone preferences are saved to your account.", "Usa los controles de tema e idioma de arriba para personalizar este navegador. Las preferencias de logros se guardan en tu cuenta.")}</p>
              <RewardsWidget key={"reward-widget-" + user.id} owner={user.id} language={studioLanguage} celebrate />
              <RewardsSettings key={"reward-settings-" + user.id} owner={user.id} language={studioLanguage} />
              <div id="writing-progress" tabIndex={-1}>
                <WritingStreak key={user.id} owner={user.id} paid={user.ai_access} language={studioLanguage} />
              </div>
              <Link className="uw-text-link" to="/progress">{t("View your writing progress", "Ver tu progreso de escritura")}</Link>
              {user.ai_access && <AIUsage usage={aiUsage.data} language={studioLanguage} />}
              </section>
              <section className="uw-settings-section" aria-labelledby="settings-extension-heading">
              <h2 id="settings-extension-heading">{t("Chrome extension", "Extensión de Chrome")}</h2>
              {!user.ai_access && <section id="quick-prompt" className="uw-studio-prompt-help" tabIndex={-1} aria-labelledby="quick-prompt-heading">
                <h2 id="quick-prompt-heading">Quick Prompt</h2>
                <p>{studioLanguage === "es" ? "Encuentra tu próxima idea en la extensión de Chrome de UnoWord. Quick Prompt está incluido en Free y Pro y no consume créditos de IA." : "Find your next idea in the UnoWord Chrome extension. Quick Prompt is included with Free and Pro and does not use AI credits."}</p>
                <Link to="/account#install">{studioLanguage === "es" ? "Configurar la extensión de Chrome" : "Set up the Chrome extension"}</Link>
              </section>}
              <div className="uw-install-card" id="install" tabIndex={-1}>
                <Link
                  className="uw-button"
                  to={recoveryPath(user.ai_access ? "/editor" : "/account?plan=pro")}
                >
                  {user.ai_access
                    ? t("Open Writing Editor", "Abrir editor de escritura")
                    : t("Unlock Your Writing Space with Pro", "Desbloquear tu espacio de escritura con Pro")}{" "}
                  <ArrowRight size={16} />
                </Link>
                <div>
                  <Chrome size={24} />
                  <h2>{t("Make room for UnoWord in Chrome.", "Haz espacio para UnoWord en Chrome.")}</h2>
                </div>
                {product.data?.chrome_store_url ? (
                  <a className="uw-button" href={product.data.chrome_store_url}>
                    {t("Add to Chrome", "Añadir a Chrome")}
                    <ArrowRight size={16} />
                  </a>
                ) : (
                  <>
                    <p>
                      {t("A Chrome Web Store listing isn’t available yet. You can install the developer release now:", "Aún no hay una ficha en Chrome Web Store. Puedes instalar la versión para desarrolladores:")}
                    </p>
                    <a
                      className="uw-button"
                      href="/downloads/unoword-extension.zip"
                      download
                    >
                      <Download size={16} /> {t("Download UnoWord for Chrome", "Descargar UnoWord para Chrome")}
                    </a>
                    <ol>
                      <li>{t("Unzip the downloaded file.", "Descomprime el archivo descargado.")}</li>
                      <li>
                        {t("Open", "Abre")} <code>chrome://extensions</code> {t("in Chrome and enable Developer mode.", "en Chrome y activa el modo de desarrollador.")}
                      </li>
                      <li>
                        {t("Choose", "Elige")} <strong>{t("Load unpacked", "Cargar descomprimida")}</strong> {t("and select the extracted", "y selecciona la carpeta extraída")} <strong>unoword</strong>.
                      </li>
                      <li>
                        {t("Pin UnoWord, open it, choose your language, and start a session. Sign in under Settings to access your account features.", "Fija UnoWord, ábrelo, elige tu idioma e inicia una sesión. Inicia sesión en Ajustes para acceder a las funciones de tu cuenta.")}
                      </li>
                    </ol>
                    <p className="uw-install-note">
                      {t("Some managed browsers block developer extensions. Updates to this developer release are installed manually.", "Algunos navegadores administrados bloquean las extensiones para desarrolladores. Las actualizaciones de esta versión se instalan manualmente.")}
                    </p>
                  </>
                )}
              </div>
              </section>
              <section className="uw-settings-section" id="settings-security" tabIndex={-1} aria-labelledby="settings-security-heading">
              <h2 id="settings-security-heading">{t("Account security", "Seguridad de la cuenta")}</h2>
              <p>{t("Password recovery uses a secure link sent to your account email. Email verification links continue to open the dedicated verification page.", "La recuperación usa un enlace seguro enviado al correo de tu cuenta. Los enlaces de verificación siguen abriendo la página dedicada.")}</p>
              <button className="uw-button uw-button-outline" type="button" disabled={busy || !user.email} onClick={() => void requestRecovery()}>{t("Send password reset email", "Enviar correo para restablecer la contraseña")}</button>
              {recoveryNotice && <p role="status">{recoveryNotice}</p>}
              <button
                className="uw-text-link uw-account-signout"
                type="button"
                disabled={busy}
                onClick={signOut}
              >
                {t("Sign out", "Cerrar sesión")}
              </button>
              </section>
            </>
          ) : (
            <>
              <span className="uw-icon-tile">
                {proIntent ? <Sparkles /> : <PencilMark />}
              </span>
              <p className="uw-eyebrow">EVERY IDEA STARTS SOMEWHERE</p>
              <h1 id="account-heading">
                {mode === "signup"
                  ? "Your next chapter starts here."
                  : mode === "recovery"
                    ? "Let’s get you back to your words."
                    : "Welcome back to your words."}
              </h1>
              <p>
                {lifetimeIntent
                  ? "Sign in to manage an existing lifetime purchase. The lifetime offer is closed to new purchases."
                  : proIntent
                    ? "Sign in to review your account and continue your Pro request."
                    : mode === "signup"
                      ? "Create your free UnoWord account, then install the Chrome extension."
                      : mode === "recovery"
                        ? "Enter your account email to request a secure recovery link."
                        : "Sign in to your existing UnoWord account."}
              </p>
              {mode !== "recovery" && (
                <GoogleSignIn
                  intent={
                    lifetimeIntent
                      ? "lifetime"
                      : proIntent
                        ? "pro"
                        : params.get("next") === "/editor"
                          ? "editor"
                          : "account"
                  }
                  busy={busy}
                  setBusy={setBusy}
                  onError={setMessage}
                />
              )}
              <form className="uw-auth-form" onSubmit={authenticate}>
                <label htmlFor="launch-email">
                  Email address
                  <input
                    id="launch-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </label>
                {mode !== "recovery" && (
                  <label htmlFor="launch-password">
                    <span id="launch-password-label">Password</span>
                    <span className="uw-password-field">
                      <input
                        id="launch-password"
                        aria-labelledby="launch-password-label"
                        aria-describedby={
                          mode === "signup" ? "launch-password-hint" : undefined
                        }
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          mode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        minLength={8}
                        maxLength={200}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={busy}
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </span>
                    {mode === "signup" && (
                      <small id="launch-password-hint">
                        At least 8 characters. Your account’s password policy
                        also applies.
                      </small>
                    )}
                  </label>
                )}
                <button className="uw-button" type="submit" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : mode === "signup"
                      ? "Create free account"
                      : mode === "recovery"
                        ? "Send recovery link"
                        : "Sign in"}
                  <ArrowRight size={16} />
                </button>
              </form>
              {mode !== "recovery" && (
                <Link
                  className="uw-forgot-link"
                  to={
                    "/account?mode=recovery" +
                    (lifetimeIntent ? "&offer=lifetime" : "")
                  }
                >
                  Forgot password?
                </Link>
              )}
              <p className="uw-auth-switch">
                {mode === "signup"
                  ? "Already have an account?"
                  : "New to UnoWord?"}{" "}
                <Link
                  to={
                    mode === "signup"
                      ? `/account?mode=signin${lifetimeIntent ? "&offer=lifetime" : proIntent ? "&plan=pro" : ""}`
                      : `/account?mode=signup${lifetimeIntent ? "&offer=lifetime" : proIntent ? "&plan=pro" : ""}`
                  }
                >
                  {mode === "signup" ? "Sign in" : "Create a free account"}
                </Link>
              </p>
              <p className="uw-cookie-note">
                <LockKeyhole size={14} /> Your session uses a secure, HTTP-only
                cookie. Passwords are not saved in extension storage.
              </p>
            </>
          )}
          {message && (
            <p className="uw-account-message" role="status">
              {message}
            </p>
          )}
        </section>
        <p className="uw-account-footer">
          <Link to="/privacy">{t("Privacy & data", "Privacidad y datos")}</Link>
          <Link to="/terms">{t("Terms of service", "Términos del servicio")}</Link>
          <Link to="/support">{t("Support", "Ayuda")}</Link>
        </p>
      </main>
    </div>
  );
  return user ? <AppShell user={user}>{content}</AppShell> : content;
}
function PencilMark() {
  return <Chrome />;
}
