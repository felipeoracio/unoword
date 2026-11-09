import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/auth-types";
export default function LifetimeAccount({ user }: { user: AuthUser }) {
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
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const sending = useRef(false),
    currentOwner = useRef(user.id);
  currentOwner.current = user.id;
  useEffect(() => {
    setMessage("");
  }, [user.id]);
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
    <section className="uw-plan-intent" aria-label="Lifetime purchase">
      <h2>Your lifetime purchase</h2>
      <p>The lifetime offer is closed to new purchases. Existing verified access and eligible refund options remain available.</p>
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
        <p role="status">No new lifetime checkout is available. <Link to="/#pricing">View current plans</Link>.</p>
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
        <p role="status">Checking lifetime purchase status…</p>
      )}
      {status.isError && (
        <p role="status">
          Lifetime purchase status is unavailable. No payment has been started.
        </p>
      )}
      {state === "reserved" && (
        <p role="status">
          Your existing payment is awaiting verification. Pro access depends on
          the verified payment record; no new lifetime checkout can be opened.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      <Link className="uw-button uw-button-outline" to="/terms#lifetime-purchases">
        Lifetime purchase terms
      </Link>
      <Link className="uw-button uw-button-outline" to="/support">
        Support
      </Link>
    </section>
  );
}
