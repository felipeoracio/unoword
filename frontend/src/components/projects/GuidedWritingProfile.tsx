import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { cachePut, cachedRecords } from "@/lib/writing-cache";
import { useSurfaceCue } from "@/lib/use-surface-cue";
import type { useProjectWorkspace } from "@/lib/use-project-workspace";
type Question = {
  id: string;
  title: string;
  title_es: string;
  multiple: boolean;
  options: { id: string; label: string; label_es: string }[];
};
type Answer = {
  question_id: string;
  selected_option_ids: string[];
  custom_answer: string;
  notes: string;
  legacy_answer?: string;
  revision: number;
  draft?: boolean;
};
export default function GuidedWritingProfile({
  owner,
  language = "en",
  workspace,
  onSaved,
}: {
  owner: string;
  language?: string;
  workspace: ReturnType<typeof useProjectWorkspace>;
  onSaved?: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]),
    [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const current = useRef(owner);
  current.current = owner;
  const es = language === "es";
  const latest = useRef({ workspace, es });
  latest.current = { workspace, es };
  const tab = useRef(
    sessionStorage.getItem("uno-writing-tab") || crypto.randomUUID(),
  );
  useEffect(() => {
    let cancelled = false;
    setQuestions([]);
    setAnswers({});
    setStep(0);
    void (async () => {
      try {
        const records = (await cachedRecords(owner)).filter(
          (row) => row.kind === "guided_profile",
        );
        const cached = (
          records.find(
            (row) => row.key === `${owner}:guided_profile:${tab.current}`,
          ) || records[0]
        )?.value as
          | { questions: Question[]; answers: Record<string, Answer> }
          | undefined;
        let q = cached?.questions || [],
          rows = Object.values(cached?.answers || {});
        if (navigator.onLine) {
          [q, rows] = await Promise.all([
            apiGet<Question[]>("/workspace/projects/profile/questions"),
            apiGet<Answer[]>("/workspace/projects/profile/answers?expected_user_id="+owner),
          ]);
        }
        if (cancelled || current.current !== owner) return;
        const values = Object.fromEntries(
          rows.map((row) => [row.question_id, row]),
        );
        for (const answer of Object.values(cached?.answers || {}))
          if (answer.draft) values[answer.question_id] = answer;
        for (const operation of latest.current.workspace
          .pendingOperations()
          .filter((op) => op.type === "profile")) {
          const id = operation.question_id!;
          values[id] = {
            question_id: id,
            ...operation.body,
            revision: Number(operation.body.revision) + 1,
          } as Answer;
        }
        setQuestions(q);
        setAnswers(values);
      } catch {
        if (!cancelled)
          setError(
            latest.current.es
              ? "No se pudo abrir la configuración. Tu perfil existente se conserva."
              : "Profile setup could not load. Your existing profile is preserved.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner]);
  useEffect(() => {
    if (!questions.length) return;
    void cachePut(owner, "guided_profile", tab.current, {
      questions,
      answers,
    }).catch(() =>
      setError(
        es
          ? "No se pudo guardar en este dispositivo."
          : "Device storage could not save this profile draft.",
      ),
    );
  }, [owner, questions, answers, es]);
  const question = questions[step];
  const cue = useSurfaceCue<HTMLDivElement>(question?.id || "complete", questions.length > 0);
  const answer = question
    ? answers[question.id] || {
        question_id: question.id,
        selected_option_ids: [],
        custom_answer: "",
        notes: "",
        revision: 0,
      }
    : null;
  function change(patch: Partial<Answer>) {
    if (question && answer)
      setAnswers((all) => ({
        ...all,
        [question.id]: { ...answer, ...patch, draft: true },
      }));
  }
  async function save() {
    if (!question || !answer) return;
    const id = owner;
    setBusy(true);
    setError("");
    try {
      await workspace.saveAnswer(question.id, answer);
      if (current.current !== id) return;
      setAnswers((all) => ({
        ...all,
        [question.id]: {
          ...answer,
          revision: answer.revision + 1,
          draft: false,
        },
      }));
      setStatus(
        es
          ? "Guardado en este dispositivo; se sincronizará con tu cuenta."
          : "Saved on this device; synchronizing with your account.",
      );
      if (navigator.onLine && (await workspace.flush())) {
        setStatus(es ? "Guardado en tu cuenta." : "Saved to your account.");
        onSaved?.();
      }
      setStep((value) => value + 1);
    } catch {
      setError(
        es
          ? "No se pudo guardar. Tus respuestas siguen aquí."
          : "This answer could not be saved. Your choices are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  const completed = Object.values(answers).filter(
    (a) =>
      a.selected_option_ids.length ||
      a.custom_answer ||
      a.notes ||
      a.legacy_answer,
  ).length;
  return (
    <section
      className="uw-guided-profile"
      aria-label={
        es ? "Configuración guiada del perfil" : "Guided Writing Profile"
      }
    >
      <h3>
        {es
          ? "Conozcamos tu estilo de escritura"
          : "Let’s get to know your writing style"}
      </h3>
      <p>
        {es
          ? "Elige opciones o escribe tu respuesta. Tus campos de texto existentes se conservan."
          : "Choose options or write your own answer. Your existing free-text profile is preserved."}
      </p>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status" className="uw-support-notice">{status}</p>}
      {!questions.length && !error && (
        <p role="status">{es ? "Cargando preguntas…" : "Loading questions…"}</p>
      )}
      {question && answer ? (
        <div className="uw-guided-question" {...cue}>
          <p>
            {es ? "Pregunta" : "Question"} {step + 1} / {questions.length} ·{" "}
            {completed} {es ? "respondidas" : "answered"}
          </p>
          <progress
            max={questions.length}
            value={completed}
            aria-label={es ? "Progreso del perfil" : "Profile completion"}
          />
          <fieldset>
            <legend>{es ? question.title_es : question.title}</legend>
            <p>
              {question.multiple
                ? es
                  ? "Selecciona todas las que correspondan."
                  : "Select all that apply."
                : es
                  ? "Elige una opción o una respuesta personalizada."
                  : "Choose one option or a custom answer."}
            </p>
            <div className="uw-project-choices">
              {question.options.map((option) => (
                <label key={option.id}>
                  <input
                    type={question.multiple ? "checkbox" : "radio"}
                    name={"profile-" + question.id}
                    checked={answer.selected_option_ids.includes(option.id)}
                    onChange={(event) =>
                      change({
                        selected_option_ids: question.multiple
                          ? event.target.checked
                            ? [...answer.selected_option_ids, option.id]
                            : answer.selected_option_ids.filter(
                                (id) => id !== option.id,
                              )
                          : [option.id],
                      })
                    }
                  />
                  {es ? option.label_es : option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            {es
              ? "Otra / Escribir mi propia respuesta"
              : "Other / Write my own answer"}
            <textarea
              value={answer.custom_answer}
              maxLength={2000}
              onChange={(event) =>
                change({
                  custom_answer: event.target.value,
                  ...(!question.multiple && event.target.value
                    ? { selected_option_ids: [] }
                    : {}),
                })
              }
            />
          </label>
          <label>
            {es
              ? "Notas adicionales (opcional)"
              : "Additional notes (optional)"}
            <textarea
              value={answer.notes}
              maxLength={2000}
              onChange={(event) => change({ notes: event.target.value })}
            />
          </label>
          {answer.legacy_answer && (
            <p>
              {es
                ? "Respuesta anterior conservada:"
                : "Previous answer preserved:"}{" "}
              {answer.legacy_answer}
            </p>
          )}
          <div className="uw-project-actions">
            <button
              type="button"
              disabled={!step || busy}
              onClick={() => setStep((value) => value - 1)}
            >
              {es ? "Atrás" : "Back"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep((value) => value + 1)}
            >
              {es ? "Omitir" : "Skip"}
            </button>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy
                ? es
                  ? "Guardando…"
                  : "Saving…"
                : es
                  ? "Guardar y continuar"
                  : "Save & continue"}
            </button>
          </div>
        </div>
      ) : (
        questions.length > 0 && (
          <div className="uw-profile-complete" {...cue}>
            <h3>
              {es ? "Tu perfil está listo" : "Your Writing Profile is ready"}
            </h3>
            <p>
              {es
                ? "Puedes editar tus respuestas en cualquier momento."
                : "You can edit your answers at any time. Skipped questions remain optional."}
            </p>
            <button type="button" onClick={() => setStep(0)}>
              {es ? "Editar mis respuestas" : "Edit my answers"}
            </button>
          </div>
        )
      )}
    </section>
  );
}
