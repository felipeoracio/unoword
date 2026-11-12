import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { MotionSurface } from "../components/motion";
import { Button, Card, Heading, Input, Label, Row } from "../components/ui";
import { useApp, useRepository } from "../providers/AppProvider";
import { useProjects } from "../providers/ProjectProvider";
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
  revision: number;
  draft?: boolean;
  legacy_answer?: string;
};
export default function GuidedProfile() {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    p = useProjects();
  const [questions, setQuestions] = useState<Question[]>([]),
    [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [step, setStep] = useState(0),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const es = repo?.preferences?.language === "es";
  useEffect(() => {
    let cancelled = false;
    if (!repo) return;
    void (async () => {
      try {
        const cached = await repo.store.get<{
          questions: Question[];
          answers: Record<string, Answer>;
        }>("guided-profile");
        let q = cached?.questions || [],
          rows = cached?.answers || {};
        if (online) {
          q = await api("GET", "/workspace/projects/profile/questions");
          const remote = await api<Answer[]>(
            "GET",
            "/workspace/projects/profile/answers?expected_user_id="+account?.id,
          );
          rows = {
            ...Object.fromEntries(remote.map((r) => [r.question_id, r])),
            ...Object.fromEntries(
              Object.entries(rows).filter(([, answer]) => answer.draft),
            ),
          };
          for (const op of p
            .pendingOperations()
            .filter((op) => op.type === "profile"))
            rows[op.question_id!] = {
              question_id: op.question_id!,
              ...op.body,
              revision: Number(op.body.revision) + 1,
            } as Answer;
        }
        if (!cancelled) {
          setQuestions(q);
          setAnswers(rows);
        }
      } catch {
        if (!cancelled)
          setStatus(
            es
              ? "No se pudo cargar. Tus respuestas se conservan."
              : "Could not load setup. Your existing answers are preserved.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, account?.id]);
  const question = questions[step],
    answer = question
      ? answers[question.id] || {
          question_id: question.id,
          selected_option_ids: [],
          custom_answer: "",
          notes: "",
          revision: 0,
        }
      : null;
  async function change(patch: Partial<Answer>) {
    if (!question || !answer || !repo) return;
    const next = {
      ...answers,
      [question.id]: { ...answer, ...patch, draft: true },
    };
    setAnswers(next);
    try {
      await repo.store.set("guided-profile", { questions, answers: next });
    } catch {
      setStatus(
        "Device storage could not save this answer. Keep this page open.",
      );
    }
  }
  async function save() {
    if (!answer || !question || !repo) return;
    setBusy(true);
    try {
      await p.saveAnswer(question.id, answer);
      const next = {
        ...answers,
        [question.id]: {
          ...answer,
          revision: answer.revision + 1,
          draft: false,
        },
      };
      await repo.store.set("guided-profile", { questions, answers: next });
      setAnswers(next);
      setStatus(
        es
          ? "Guardado en el dispositivo; sincronizando."
          : "Saved on device; syncing.",
      );
      if (online && (await p.flush()))
        setStatus(es ? "Guardado en tu cuenta." : "Saved to your account.");
      setStep(step + 1);
    } catch {
      setStatus(
        es
          ? "No se pudo guardar. Tus respuestas siguen aquí."
          : "Could not save. Your answers are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Heading>{es ? "Mi perfil de escritura" : "My Writing Profile"}</Heading>
      <Label muted>
        {es
          ? "Elige opciones o escribe tu respuesta. Tu perfil anterior se conserva."
          : "Choose options or write your own answer. Your existing free-text profile is preserved."}
      </Label>
      {!!status && <Label>{status}</Label>}
      <MotionSurface identity={question?.id || "complete"}>
      {question && answer ? (
        <>
          <Label>
            {es ? "Pregunta" : "Question"} {step + 1} / {questions.length}
          </Label>
          <Heading>{es ? question.title_es : question.title}</Heading>
          <Label muted>
            {question.multiple
              ? es
                ? "Selecciona todas las opciones que correspondan."
                : "Select all that apply."
              : es
                ? "Elige una opción o escribe tu respuesta."
                : "Choose one option or your own answer."}
          </Label>
          {question.options.map((option) => (
            <Button
              key={option.id}
              title={
                (answer.selected_option_ids.includes(option.id) ? "✓ " : "○ ") +
                (es ? option.label_es : option.label)
              }
              secondary={!answer.selected_option_ids.includes(option.id)}
              onPress={() =>
                void change({
                  selected_option_ids: question.multiple
                    ? answer.selected_option_ids.includes(option.id)
                      ? answer.selected_option_ids.filter(
                          (id) => id !== option.id,
                        )
                      : [...answer.selected_option_ids, option.id]
                    : [option.id],
                })
              }
            />
          ))}
          <Label>
            {es ? "Otra / Escribe tu respuesta" : "Other / Write my own answer"}
          </Label>
          <Input
            multiline
            accessibilityLabel={es ? "Otra / Escribe tu respuesta" : "Other / Write my own answer"}
            maxLength={2000}
            value={answer.custom_answer}
            onChangeText={(custom_answer) =>
              void change({
                custom_answer,
                ...(!question.multiple && custom_answer
                  ? { selected_option_ids: [] }
                  : {}),
              })
            }
          />
          <Label>
            {es ? "Notas (opcional)" : "Additional notes (optional)"}
          </Label>
          <Input
            multiline
            accessibilityLabel={es ? "Notas (opcional)" : "Additional notes (optional)"}
            maxLength={2000}
            value={answer.notes}
            onChangeText={(notes) => void change({ notes })}
          />
          {!!answer.legacy_answer && <Label>{answer.legacy_answer}</Label>}
          <Row>
            <Button
              title={es ? "Atrás" : "Back"}
              secondary
              disabled={!step || busy}
              onPress={() => setStep(step - 1)}
            />
            <Button
              title={es ? "Omitir" : "Skip"}
              secondary
              disabled={busy}
              onPress={() => setStep(step + 1)}
            />
            <Button
              title={es ? "Guardar y continuar" : "Save & continue"}
              disabled={busy}
              onPress={() => void save()}
            />
          </Row>
        </>
      ) : questions.length ? (
        <>
          <Label>
            {es
              ? "Tu perfil está listo. Puedes editarlo cuando quieras."
              : "Your profile is ready. You can edit it any time."}
          </Label>
          <Button
            title={es ? "Editar respuestas" : "Edit answers"}
            secondary
            onPress={() => setStep(0)}
          />
        </>
      ) : (
        <Label>{es ? "Cargando preguntas…" : "Loading questions…"}</Label>
      )}
      </MotionSurface>
    </Card>
  );
}
