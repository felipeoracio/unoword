import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Brand from "@/components/marketing/Brand";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import "@/styles/account.css";
import "@/styles/marketing.css";

export default function EmailConfirmation({
  code,
  invalid,
}: {
  code: string;
  invalid: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const spanish = navigator.language.startsWith("es");
  const text = (en: string, es: string) => (spanish ? es : en);
  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    const previousRobots = robots?.content;
    const clean = new URL(window.location.href);
    clean.searchParams.delete("code");
    for (const field of [
      "error",
      "error_code",
      "error_description",
      "access_token",
      "refresh_token",
      "expires_in",
      "expires_at",
      "token_type",
    ])
      clean.searchParams.delete(field);
    window.history.replaceState(
      window.history.state,
      "",
      clean.pathname + clean.search,
    );
    document.title = spanish
      ? "Confirma tu correo — UnoWord"
      : "Confirm your email — UnoWord";
    if (robots) robots.content = "noindex, nofollow";
    return () => {
      document.title = previousTitle;
      if (robots && previousRobots !== undefined)
        robots.content = previousRobots;
    };
  }, [spanish]);
  async function complete() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await apiPost<{ redirect: string }>(
        "/auth/signup/complete",
        { code },
      );
      const destination = new URL(result.redirect, location.origin);
      if (
        destination.origin !== location.origin ||
        destination.pathname !== "/account"
      )
        throw new Error();
      beginSession();
      location.replace(destination.pathname + destination.search);
    } catch {
      setMessage(
        text(
          "This confirmation could not be completed on this browser. If you already clicked the email link, try signing in with your email and password. Otherwise, request a new confirmation by submitting Create free account again.",
          "No se pudo completar la confirmación en este navegador. Si ya abriste el enlace del correo, intenta iniciar sesión con tu correo y contraseña. Si no, solicita otra confirmación mediante Crear cuenta.",
        ),
      );
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <main
      className="uw-site uw-account-page"
      style={{ minHeight: "100vh", padding: "32px 20px" }}
    >
      <Brand />
      <section
        className="uw-account-card"
        style={{ maxWidth: 500, margin: "48px auto" }}
      >
        <h1>
          {text(
            "Finish confirming your account",
            "Completa la confirmación de tu cuenta",
          )}
        </h1>
        <p>
          {text(
            "Continue to finish setup securely on this browser. If you opened the email on a different device, you can sign in with your password after confirming your email.",
            "Continúa para completar la configuración de forma segura en este navegador. Si abriste el correo en otro dispositivo, puedes iniciar sesión con tu contraseña después de confirmar tu correo.",
          )}
        </p>
        {(message || invalid) && (
          <p role="status">
            {message ||
              text(
                "This confirmation link is invalid or expired. Sign in if you have already confirmed your email, or request a new confirmation.",
                "Este enlace no es válido o ha caducado. Inicia sesión si ya confirmaste tu correo o solicita otra confirmación.",
              )}
          </p>
        )}
        {!invalid && (
          <button
            type="button"
            className="uw-button uw-button-primary"
            disabled={busy}
            onClick={() => void complete()}
          >
            {busy
              ? text("Checking…", "Comprobando…")
              : text(
                  "Confirm email and continue",
                  "Confirmar correo y continuar",
                )}
          </button>
        )}
        <p>
          <Link to="/account?mode=signin">
            {text(
              "Sign in with email or Google",
              "Iniciar sesión con correo o Google",
            )}
          </Link>
        </p>
        {(message || invalid) && (
          <p>
            <Link to="/account?mode=signup">
              {text(
                "Request a new confirmation",
                "Solicitar otra confirmación",
              )}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
