import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useLifetimeOffer } from "@/lib/lifetime";
import type { AuthUser } from "@/lib/auth-types";
export default function LifetimeAccount({ user }: { user: AuthUser }) {
  const offer = useLifetimeOffer();
  const status = useQuery({
    queryKey: ["lifetime-status", user.id],
    queryFn: () =>
      apiGet<{
        user_id: string;
        status: string;
        can_checkout: boolean;
        can_refund: boolean;
      }>("/subscription/lifetime"),
    refetchInterval: (q) =>
      q.state.data?.status === "reserved" ? 5000 : false,
    retry: 1,
  });
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const sending = useRef(false),
    currentOwner = useRef(user.id);
  currentOwner.current = user.id;
  useEffect(() => {
    setConfirmed(false);
    setMessage("");
  }, [user.id]);
  async function purchase(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || sending.current) return;
    sending.current = true;
    setBusy(true);
    const owner = user.id;
    try {
      const fresh = await apiGet<AuthUser>("/auth/me");
      if (fresh.id !== owner)
        throw new Error("Your account changed. Refresh before continuing.");
      const result = await apiPost<{ url: string; destination: string }>(
        "/subscription/lifetime",
        { expected_user_id: owner, confirmed: true },
      );
      const after = await apiGet<AuthUser>("/auth/me");
      if (after.id !== owner || currentOwner.current !== owner)
        throw new Error("Your account changed. Refresh before continuing.");
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.host !== "checkout.stripe.com" ||
        result.destination !== "checkout"
      )
        throw new Error("Checkout could not be verified. Please try again.");
      window.location.assign(url.href);
    } catch (error) {
      let text =
        "Lifetime checkout could not be opened. Please retry or contact Support.";
      if (error instanceof ApiError) {
        const code = (error.body as { detail?: string })?.detail;
        const messages: Record<string, string> = {
          lifetime_capacity_unavailable:
            "All 25 places are purchased or held in checkout. Please check availability again later.",
          lifetime_unavailable: "Lifetime checkout is not configured yet.",
          lifetime_storage_unavailable:
            "Lifetime checkout is temporarily unavailable. Please contact Support.",
          lifetime_price_mismatch:
            "The one-time $100 price is not configured correctly. No payment has been taken.",
          lifetime_test_mode_required:
            "This lifetime offer is available in Stripe test mode only.",
          lifetime_existing_subscription:
            "You already have a subscription or open monthly checkout. Manage it first; the lifetime offer does not cancel an existing subscription automatically.",
          plan_managed_separately:
            "Your Pro access is managed separately. Contact Support before purchasing.",
          lifetime_already_purchased:
            "This account already has a lifetime purchase.",
          lifetime_payment_pending:
            "A payment for this offer is awaiting verification. Please check back shortly.",
          lifetime_review_required:
            "Your previous checkout needs review. Please contact Support before retrying.",
          account_changed: "Your account changed. Refresh before continuing.",
        };
        text = messages[code || ""] || text;
      } else if (error instanceof Error) text = error.message;
      setMessage(text);
      void status.refetch();
      void offer.refetch();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function requestRefund(event: React.FormEvent) {
    event.preventDefault();
    if (!refundConfirmed || sending.current) return;
    sending.current = true;
    setBusy(true);
    const owner = user.id;
    try {
      const fresh = await apiGet<AuthUser>("/auth/me");
      if (fresh.id !== owner || currentOwner.current !== owner)
        throw new Error("Your account changed. Refresh before continuing.");
      await apiPost("/subscription/lifetime/refund", {
        expected_user_id: owner,
        confirmed: true,
      });
      setMessage(
        "Your test refund request was submitted to Stripe. Refresh your account to see verified payment and access status.",
      );
      setRefundConfirmed(false);
      void status.refetch();
    } catch (error) {
      const code =
        error instanceof ApiError
          ? (error.body as { detail?: string })?.detail
          : "";
      setMessage(
        code === "lifetime_refund_window_closed"
          ? "The 14-day refund window has ended. Contact Support if you need help."
          : "The test refund could not be submitted. No unverified access changes were made; please retry or contact Support.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const state = status.data?.user_id === user.id ? status.data.status : "none";
  return (
    <section className="uw-plan-intent" aria-label="Lifetime offer">
      <h2>UnoWord Pro — $100 Lifetime Offer</h2>
      <p>
        A one-time $100 USD purchase for lifetime Pro access. Limited to the
        first 25 lifetime purchasers, with the same AI allowance as new Monthly Pro subscribers.
        {offer.data?.ai_allowance && <> {offer.data.ai_allowance.suggestions_daily} suggestions/day, {offer.data.ai_allowance.suggestions_monthly} suggestions/calendar month, and {offer.data.ai_allowance.guidance_monthly} Writing Guidance requests/calendar month. No rollover.</>}
      </p>
      <p>
        <strong>Stripe sandbox/test mode.</strong> This flow does not accept
        real-money lifetime purchases.
      </p>
      {state === "paid" ? (
        <p role="status">
          Your lifetime payment is verified. Pro access follows the
          server-verified payment record.
        </p>
      ) : state === "refunded" || state === "disputed" ? (
        <p role="status">
          Your lifetime purchase is {state}. Contact Support to review access.
        </p>
      ) : (
        <form onSubmit={(event) => void purchase(event)}>
          <label className="uw-confirm-plan">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={busy}
            />
            <span>
              I confirm the one-time $100 USD test purchase is for{" "}
              <strong>{user.email}</strong>. This does not cancel any existing
              subscription. I have reviewed the{" "}
              <a
                href="/lifetime#offer-terms"
                target="_blank"
                rel="noopener noreferrer"
              >
                AI limits and 14-day refund terms
              </a>
              .
            </span>
          </label>
          <button
            className="uw-button"
            type="submit"
            disabled={busy || !confirmed || !status.data?.can_checkout}
          >
            {busy
              ? "Opening Stripe…"
              : state === "reserved"
                ? "Resume Lifetime Test Checkout"
                : "Continue to $100 Test Checkout"}
          </button>
        </form>
      )}
      {state === "paid" && status.data?.can_refund && (
        <form onSubmit={(event) => void requestRefund(event)}>
          <p>
            Full refunds can be requested within 14 days of payment. Verified
            full refunds end the lifetime access from this purchase.
          </p>
          <label className="uw-confirm-plan">
            <input
              type="checkbox"
              checked={refundConfirmed}
              disabled={busy}
              onChange={(event) => setRefundConfirmed(event.target.checked)}
            />
            <span>
              I want to request a full refund of this test lifetime purchase.
            </span>
          </label>
          <button
            className="uw-button uw-button-outline"
            type="submit"
            disabled={!refundConfirmed || busy}
          >
            Request 14-Day Test Refund
          </button>
        </form>
      )}
      <button
        className="uw-button uw-button-outline"
        type="button"
        onClick={() => window.location.reload()}
      >
        Refresh verified account status
      </button>
      {status.isLoading && (
        <p role="status">Checking lifetime offer availability…</p>
      )}
      {status.isError && (
        <p role="status">
          Lifetime purchase status is unavailable. No payment has been started.
        </p>
      )}
      {offer.data && !offer.data.checkout_available && state === "none" && (
        <p role="status">
          {offer.data.available === 0
            ? "All places are currently purchased or reserved."
            : "Lifetime checkout is not open yet. Please check back soon."}
        </p>
      )}
      {state === "reserved" && (
        <p role="status">
          Your place is reserved while checkout is open. Pro unlocks only after
          verified payment, even if Stripe redirects you back here.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      <Link className="uw-button uw-button-outline" to="/lifetime">
        Back to the lifetime offer
      </Link>
      <Link className="uw-button uw-button-outline" to="/support">
        Support
      </Link>
    </section>
  );
}
