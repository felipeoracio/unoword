import React, { useRef, useState } from "react";
import { Switch, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp, useRepository } from "../providers/AppProvider";
import { Button, Card, Input, Label, Row } from "../components/ui";
import type {
  Document,
  Suggestion,
  Summary,
  Usage,
  WritingTask,
} from "../core/types";
import { message } from "../core/api";
import { RequestTicket } from "../core/request-ticket";
function progress(summary: Summary) {
  return {
    daily_goal: summary.dailyGoal,
    words_written_today: summary.dailyWordCount,
    timezone: summary.timezone,
    date: summary.reportingDate,
    captured_at: new Date().toISOString(),
  };
}
export function UsageCard() {
  const { account, api, online } = useApp(),
    repo = useRepository();
  const usage = useQuery({
    queryKey: ["usage", account?.id],
    queryFn: () =>
      api<Usage>(
        "GET",
        "/ai/usage/summary?timezone=" +
          encodeURIComponent(repo?.preferences?.timezone || "UTC"),
      ),
    enabled: !!account?.ai_access && online,
    refetchInterval: 30000,
  });
  return (
    <Card>
      <Label style={{ fontWeight: "700" }}>Your AI Usage</Label>
      {usage.data ? (
        <>
          <Label>
            {usage.data.remaining} of {usage.data.daily_limit} suggestions
            remaining today
          </Label>
          <Label muted>
            Monthly suggestions:{" "}
            {usage.data.suggestions_monthly_remaining ?? "shared legacy pool"}
            {usage.data.suggestions_monthly_limit !== null
              ? " / " + usage.data.suggestions_monthly_limit
              : ""}
          </Label>
          <Label muted>
            Monthly Guidance:{" "}
            {usage.data.guidance_monthly_remaining ?? "shared legacy pool"}
            {usage.data.guidance_monthly_limit !== null
              ? " / " + usage.data.guidance_monthly_limit
              : ""}
          </Label>
          <Label size={12} muted>
            Monthly reset:{" "}
            {new Date(usage.data.monthly_reset_at).toLocaleString()}
          </Label>
        </>
      ) : (
        <Label muted>
          {usage.isPending
            ? "Loading verified account allowances…"
            : "Usage is unavailable. Connect and refresh to view your allowance."}
        </Label>
      )}
    </Card>
  );
}
export function Task({ task }: { task?: WritingTask }) {
  const [checked, setChecked] = useState<number[]>([]);
  if (!task) return null;
  return (
    <View style={{ gap: 8 }}>
      <Label muted>
        {task.goal_reached
          ? "Your daily goal is complete — this is optional inspiration."
          : `Aim for about ${task.target_words} words.`}
      </Label>
      {task.outline?.map((step, index) => (
        <Button
          key={index}
          title={
            (checked.includes(index) ? "✓ " : "○ ") +
            step.title +
            " · " +
            step.words +
            " words"
          }
          secondary
          onPress={() =>
            setChecked(
              checked.includes(index)
                ? checked.filter((i) => i !== index)
                : [...checked, index],
            )
          }
        />
      ))}
    </View>
  );
}
export function Suggestions() {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    client = useQueryClient();
  const [mode, setMode] = useState("new_topic"),
    [idea, setIdea] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Suggestion | null>(null),
    [saved, setSaved] = useState(false);
  const retry = useRef(new RequestTicket(Crypto.randomUUID));
  const owner = account?.id;
  const generate = async () => {
    if (!repo || !owner || busy) return;
    setBusy(true);
    setError("");
    try {
      await repo.sync(!!account?.features.writing_editor);
      if (!repo.summary) throw new Error("Refresh daily progress first.");
      const payload = {
        mode,
        language: repo.preferences?.language || "en",
        current_writing: mode === "expand_idea" ? idea : undefined,
        writing_progress: progress(repo.summary),
      };

      const value = await api<Suggestion>(
        "POST",
        "/ai/suggestion",
        retry.current.prepare(payload),
      );
      setResult(value);
      setSaved(false);
      retry.current.complete();
      client.invalidateQueries({ queryKey: ["usage", owner] });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <Label style={{ fontWeight: "700" }}>
        Personalized AI directions · Pro
      </Label>
      <Row>
        {[
          ["new_topic", "New Topic"],
          ["expand_idea", "Expand an Idea"],
          ["connect_dots", "Connect the Dots"],
        ].map(([key, label]) => (
          <Button
            key={key}
            title={label}
            secondary={key !== mode}
            disabled={busy}
            onPress={() => {
              setMode(key);
              retry.current.complete();
            }}
          />
        ))}
      </Row>
      {mode === "expand_idea" && (
        <Input
          accessibilityLabel="Idea to expand"
          placeholder="Share an idea to explore — only this input is sent."
          multiline
          value={idea}
          onChangeText={setIdea}
          maxLength={20000}
        />
      )}
      <Button
        title={
          busy
            ? "Finding inspiration…"
            : result
              ? "Generate another direction"
              : "Generate direction"
        }
        onPress={() => void generate()}
        disabled={
          busy ||
          !online ||
          !account?.ai_access ||
          (mode === "expand_idea" && !idea.trim())
        }
      />
      {!!error && <Label>{error}</Label>}
      {result && (
        <Card>
          <Label size={20} style={{ fontWeight: "700" }}>
            {result.title}
          </Label>
          <Label>{result.suggestion}</Label>
          {result.questions.map((q, i) => (
            <Label key={i}>• {q}</Label>
          ))}
          <Task key={result.id} task={result.writing_task} />
          <Label muted>{result.reason}</Label>
          <Button
            title={saved ? "Saved" : "Save idea"}
            secondary
            disabled={saved}
            onPress={() => {
              void api("PUT", "/ai/suggestions/" + result.id + "/save")
                .then(() => {
                  setSaved(true);
                  client.invalidateQueries({
                    queryKey: ["saved-ideas", owner],
                  });
                })
                .catch((e) => setError(message(e)));
            }}
          />
          <Row>
            <Button
              title="Helpful"
              secondary
              onPress={() =>
                void api("POST", "/ai/feedback", {
                  suggestion_id: result.id,
                  helpful: true,
                }).catch((e) => setError(message(e)))
              }
            />
            <Button
              title="Not helpful"
              secondary
              onPress={() =>
                void api("POST", "/ai/feedback", {
                  suggestion_id: result.id,
                  helpful: false,
                  reason: "wrong_direction",
                }).catch((e) => setError(message(e)))
              }
            />
          </Row>
        </Card>
      )}
      <Label size={12} muted>
        Your Writing Profile, chosen themes and authorized knowledge guide these
        directions. Progress changes never replace a suggestion you are working
        on.
      </Label>
    </View>
  );
}
export function Coach({ document }: { document: Document }) {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    client = useQueryClient();
  const [consent, setConsent] = useState(false),
    [action, setAction] = useState("next"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [items, setItems] = useState<
      { title: string; text: string; writing_task?: WritingTask }[]
    >([]);
  const retry = useRef(new RequestTicket(Crypto.randomUUID));
  const request = async () => {
    if (!repo || busy || !account) return;
    setBusy(true);
    setError("");
    try {
      await repo.sync(true);
      const current = await repo.getDocument(document.id);
      if (!current?.revision || current.dirty || current.conflict)
        throw new Error(
          "Save the current document online before requesting guidance.",
        );
      if (!repo.summary) throw new Error("Refresh daily progress.");
      const payload = {
        expected_user_id: account.id,
        document_id: document.id,
        action,
        consent,
        current_text: current.plain_text,
        language: repo.preferences?.language || "en",
        writing_progress: progress(repo.summary),
      };

      const response = await api<{
        items: { title: string; text: string; writing_task?: WritingTask }[];
      }>("POST", "/workspace/assistant", retry.current.prepare(payload));
      setItems(response.items);
      retry.current.complete();
      client.invalidateQueries({ queryKey: ["usage", account.id] });
    } catch (e) {
      setError(
        e instanceof Error && !(e as any).status ? e.message : message(e),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <Label size={20} style={{ fontWeight: "800" }}>
        AI Writing Coach
      </Label>
      <Label muted>You do the writing. UnoWord helps you keep going.</Label>
      <Row>
        {[
          ["next", "What next?"],
          ["guidance", "Help Me Continue"],
          ["block", "Writer’s Block"],
          ["brainstorm", "Brainstorm"],
        ].map(([key, label]) => (
          <Button
            key={key}
            title={label}
            secondary={action !== key}
            disabled={busy}
            onPress={() => setAction(key)}
          />
        ))}
      </Row>
      <Row>
        <Switch
          accessibilityLabel="Share this document for this AI request"
          value={consent}
          onValueChange={setConsent}
        />
        <Label size={13}>Share this draft for this request</Label>
      </Row>
      <Label size={12} muted>
        Only after your approval will this draft go to the existing online AI
        service. Other documents follow their saved permissions.
      </Label>
      <Button
        title={busy ? "Thinking…" : "Get writing guidance"}
        onPress={() => void request()}
        disabled={busy || !consent || !online || !account?.ai_access}
      />
      {!!error && <Label>{error}</Label>}
      {items.map((item, i) => (
        <Card key={i}>
          <Label style={{ fontWeight: "700" }}>{item.title}</Label>
          <Label>{item.text}</Label>
          <Task task={item.writing_task} />
        </Card>
      ))}
      <Label size={12} muted>
        Guidance offers questions and structure. It never inserts prose or
        rewrites your document.
      </Label>
    </View>
  );
}
