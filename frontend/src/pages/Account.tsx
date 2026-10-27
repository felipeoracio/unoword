import GoogleSignIn from "@/components/GoogleSignIn";
import LifetimeAccount from "@/components/marketing/LifetimeAccount";
import AccountTour from "@/components/onboarding/AccountTour";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  const [confirmed, setConfirmed] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const submitting = useRef(false);
  const product = useProduct();
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
          if (data && oauth === "success" && next === "/editor")
            window.location.replace("/editor");
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
      if (fresh && params.get("next") === "/editor")
        window.location.assign("/editor");
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
  return (
    <div className="uw-site uw-account-page">
      <header className="uw-account-header uw-container">
        <Brand />
        <Link to="/" className="uw-text-link">
          <ArrowLeft size={15} /> Back to UnoWord
        </Link>
      </header>
      <main className="uw-account-main">
        <section className="uw-account-card" aria-labelledby="account-heading">
          {loading ? (
            <p role="status">Checking your session…</p>
          ) : user ? (
            <>
              <span className="uw-icon-tile">
                <Check />
              </span>
              <p className="uw-eyebrow">YOUR WORDS. YOUR POSSIBILITIES.</p>
              <h1 id="account-heading">
                You’re in.
                <br />
                Let’s get you writing.
              </h1>
              <p className="uw-account-email">
                Signed in as <strong>{user.email}</strong>
              </p>
              <p className="uw-account-plan">
                Current plan <span>{user.ai_access ? "Pro" : "Free"}</span>
              </p>
              {lifetimeIntent && <LifetimeAccount key={user.id} user={user} />}
              <AccountTour key={user.id} owner={user.id} pro={user.ai_access} />
              {proIntent && !user.ai_access && (
                <form
                  className="uw-plan-intent"
                  onSubmit={(event) => changePlan(event)}
                >
                  <div>
                    <Sparkles size={20} />
                    <h2>Continue with Pro</h2>
                  </div>
                  <p>
                    {product.data?.billing_available
                      ? subscription?.trial_eligible === false
                        ? "Pro costs $20 USD per month. Your account has already used its trial. Review your subscription in Stripe before confirming payment."
                        : "Try Pro free for 7 days, then $20 USD per month unless you cancel. A payment method is required. The trial is available once per account."
                      : "Billing is currently unavailable, so your plan will stay unchanged. Existing eligible Pro accounts keep their access."}
                  </p>
                  <label className="uw-confirm-plan">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      required
                      disabled={busy}
                    />
                    <span>
                      I confirm this Pro request is for{" "}
                      <strong>{user.email}</strong>.
                    </span>
                  </label>
                  <button
                    className="uw-button"
                    type="submit"
                    disabled={busy || !confirmed}
                  >
                    {busy ? "Please wait…" : "Confirm plan request"}
                    <ArrowRight size={15} />
                  </button>
                </form>
              )}
              {!proIntent && !lifetimeIntent && !user.ai_access && (
                <Link
                  className="uw-button uw-button-outline"
                  to="/account?plan=pro"
                >
                  Explore Pro
                </Link>
              )}
              {user.ai_access &&
                subscription?.access_source === "stripe_lifetime" &&
                !lifetimeIntent && (
                  <Link
                    className="uw-button uw-button-outline"
                    to="/account?offer=lifetime"
                  >
                    Manage lifetime purchase &amp; refunds
                  </Link>
                )}
              {subscription?.user_id === user.id &&
                subscription.access_source !== "stripe_lifetime" &&
                subscription.managed_by_stripe && (
                  <form
                    className="uw-plan-intent"
                    onSubmit={(event) => changePlan(event, "free")}
                  >
                    <h2>Your subscription</h2>
                    <p>
                      Status: {subscription.status.replaceAll("_", " ")}
                      {subscription.period_end && (
                        <>
                          {" "}
                          ·{" "}
                          {subscription.cancel_at_period_end
                            ? "Ends"
                            : subscription.status === "trialing"
                              ? "Trial ends"
                              : "Current period ends"}{" "}
                          {new Date(
                            subscription.period_end,
                          ).toLocaleDateString()}
                        </>
                      )}
                    </p>
                    <p>
                      Update payment details or cancel in Stripe. A scheduled
                      cancellation keeps access through the paid period or trial
                      end.
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
                        Manage the subscription for{" "}
                        <strong>{user.email}</strong>.
                      </span>
                    </label>
                    <button
                      className="uw-button uw-button-outline"
                      type="submit"
                      disabled={busy || !confirmed}
                    >
                      Manage subscription
                    </button>
                  </form>
                )}
              <div className="uw-install-card" id="install">
                <Link
                  className="uw-button"
                  to={user.ai_access ? "/editor" : "/account?plan=pro"}
                >
                  {user.ai_access
                    ? "Open Writing Editor"
                    : "Unlock the editor & document library with Pro"}{" "}
                  <ArrowRight size={16} />
                </Link>
                <div>
                  <Chrome size={24} />
                  <h2>Make room for UnoWord in Chrome.</h2>
                </div>
                {product.data?.chrome_store_url ? (
                  <a className="uw-button" href={product.data.chrome_store_url}>
                    Add to Chrome
                    <ArrowRight size={16} />
                  </a>
                ) : (
                  <>
                    <p>
                      A Chrome Web Store listing isn’t available yet. You can
                      install the developer release now:
                    </p>
                    <a
                      className="uw-button"
                      href="/downloads/unoword-extension.zip"
                      download
                    >
                      <Download size={16} /> Download UnoWord for Chrome
                    </a>
                    <ol>
                      <li>Unzip the downloaded file.</li>
                      <li>
                        Open <code>chrome://extensions</code> in Chrome and
                        enable Developer mode.
                      </li>
                      <li>
                        Choose <strong>Load unpacked</strong> and select the
                        extracted <strong>unoword</strong> folder.
                      </li>
                      <li>
                        Pin UnoWord, open it, choose your language, and start a
                        session. Sign in under Settings to access your account
                        features.
                      </li>
                    </ol>
                    <p className="uw-install-note">
                      Some managed browsers block developer extensions. Updates
                      to this developer release are installed manually.
                    </p>
                  </>
                )}
              </div>
              <button
                className="uw-text-link uw-account-signout"
                type="button"
                disabled={busy}
                onClick={signOut}
              >
                Sign out
              </button>
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
                  ? "Sign in to view the $100 USD lifetime offer. Signing in does not purchase a plan. Test checkout requires your confirmation."
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
          <Link to="/privacy">Privacy &amp; data</Link>
          <Link to="/terms">Terms of service</Link>
          <Link to="/support">Support</Link>
        </p>
      </main>
    </div>
  );
}
function PencilMark() {
  return <Chrome />;
}
