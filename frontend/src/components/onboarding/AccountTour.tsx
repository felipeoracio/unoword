import { useState } from "react";
import { Link } from "react-router-dom";
import { useTourProgress } from "@/lib/onboarding";
import "@/styles/onboarding.css";
export default function AccountTour({
  owner,
  pro,
  language = "en",
}: {
  owner: string;
  pro: boolean;
  language?: string;
}) {
  const { progress, update, notice } = useTourProgress(owner);
  const [replay, setReplay] = useState(false);
  const t = (en: string, es: string) => language === "es" ? es : en;
  if (!progress) return null;
  const offer = progress.status === "not_started" || replay;
  return (
    <section className="uw-account-tour" aria-label={t("UnoWord onboarding", "Introducción a UnoWord")}>
      <h2>
        {offer
          ? t("Every Great Story Starts Somewhere", "Toda gran historia tiene un comienzo")
          : progress.status === "completed"
            ? t("Keep your writing momentum", "Mantén tu impulso al escribir")
            : t("Your first sentence is waiting", "Tu primera frase te espera")}
      </h2>
      {offer && (
        <p>
          {t("Welcome to UnoWord. You don’t need a perfect idea, a detailed plan, or even a lot of time. All you need is one sentence.", "Te damos la bienvenida a UnoWord. No necesitas una idea perfecta, un plan detallado ni mucho tiempo. Solo necesitas una frase.")}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pro ? (
        <Link
          className="uw-button"
          to="/editor?tour=1"
          onClick={() =>
            update({
              status: "in_progress",
              ...(replay ||
              !progress.draft_id ||
              progress.status === "completed"
                ? { current_step: "welcome" }
                : {}),
            })
          }
        >
          {offer
            ? t("Write My First Sentence", "Escribir mi primera frase")
            : progress.status === "completed"
              ? t("Take the UnoWord Tour", "Hacer el recorrido de UnoWord")
              : t("Resume UnoWord Tour", "Continuar el recorrido de UnoWord")}
        </Link>
      ) : (
        <>
          <p>
            {t("The full writing editor is a Pro feature. Start with the Free Chrome extension to track your writing and explore Quick Prompt.", "El editor completo es una función Pro. Empieza con la extensión gratuita de Chrome para registrar tu escritura y explorar ideas rápidas.")}
          </p>
          <a
            className="uw-button"
            href="#install"
            onClick={() =>
              update({ status: "in_progress", current_step: "extension" })
            }
          >
            {t("Explore the Free Chrome Extension", "Explorar la extensión gratuita de Chrome")}
          </a>
          <Link className="uw-button uw-button-outline" to="/account?plan=pro">
            {t("Explore the Pro Writing Editor", "Explorar el editor de escritura Pro")}
          </Link>
          <p>
            {t("In the extension, choose Settings → Take the UnoWord Tour for a short walkthrough of Start Session, word counts, progress, and prompts.", "En la extensión, elige Ajustes → Hacer el recorrido de UnoWord para conocer las sesiones, el recuento de palabras, el progreso y las ideas rápidas.")}
          </p>
        </>
      )}
      {offer ? (
        <button
          type="button"
          className="uw-button uw-button-outline"
          onClick={() => {
            update({ status: "paused" });
            setReplay(false);
          }}
        >
          {t("Explore on My Own", "Explorar por mi cuenta")}
        </button>
      ) : progress.status === "completed" && pro ? null : (
        <button
          type="button"
          className="uw-button uw-button-outline"
          onClick={() => {
            setReplay(true);
            update({ current_step: "welcome" });
          }}
        >
          {t("Take the UnoWord Tour", "Hacer el recorrido de UnoWord")}
        </button>
      )}
    </section>
  );
}
