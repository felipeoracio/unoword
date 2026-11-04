import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useApp, useRepository } from "../providers/AppProvider";
import { Button, Card, Heading, Label, Row, Screen } from "../components/ui";
import { prompts } from "../core/engines";
import { Suggestions, UsageCard, Task } from "./coach";
import type { Suggestion } from "../core/types";
export default function Ideas() {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    [prompt, setPrompt] = useState<{ id: string; text: string } | null>(null),
    [category, setCategory] = useState("account");
  const next = async () => {
    if (!repo) return;
    const recent = (await repo.store.get<string[]>("prompt-history")) || [];
    const value = prompts.pickPrompt(
      category === "account"
        ? repo.preferences?.themes || ["surprise-me"]
        : [category],
      repo.preferences?.language || "en",
      recent,
    );
    if (value) {
      setPrompt(value);
      await repo.store.set(
        "prompt-history",
        [value.id, ...recent].slice(0, 10),
      );
      await repo.store.set("last-prompt", {
        day: new Date().toLocaleDateString(),
        value,
      });
    }
  };
  useEffect(() => {
    if (!repo) return;
    void repo.store
      .get<{ day: string; value: { id: string; text: string } }>("last-prompt")
      .then((cached) => {
        if (cached?.day === new Date().toLocaleDateString())
          setPrompt(cached.value);
        else void next();
      });
  }, [repo]);
  const saved = useQuery({
    queryKey: ["saved-ideas", account?.id],
    queryFn: () => api<Suggestion[]>("GET", "/ai/ideas"),
    enabled: !!account?.ai_access && online,
  });
  return (
    <Screen title="Find your next direction">
      <Label muted>Inspiration for your own words.</Label>
      <Card>
        <Heading>Quick Prompt</Heading>
        <Label muted>
          Free + Pro · Unlimited · Works offline · No AI usage
        </Label>
        <Row>
          {[
            ["account", "My themes"],
            ["personal-experiences", "Experiences"],
            ["fiction", "Fiction"],
            ["ideas", "Ideas"],
            ["journaling", "Journal"],
            ["surprise-me", "Surprise me"],
          ].map(([key, label]) => (
            <Button
              key={key}
              title={label}
              secondary={category !== key}
              onPress={() => setCategory(key)}
            />
          ))}
        </Row>
        <Label size={21}>
          {prompt?.text || "Choose another prompt to find inspiration."}
        </Label>
        <Button
          title="Another Quick Prompt"
          secondary
          onPress={() => void next()}
        />
      </Card>
      {account?.ai_access ? (
        <>
          <UsageCard />
          <Card>
            <Suggestions />
          </Card>
          <Card>
            <Heading>Saved ideas</Heading>
            {saved.data?.map((s) => (
              <View key={s.id} style={{ gap: 8, paddingVertical: 8 }}>
                <Label size={18} style={{ fontWeight: "700" }}>
                  {s.title}
                </Label>
                <Label>{s.suggestion}</Label>
                <Task task={s.writing_task} />
              </View>
            ))}
            {!saved.data?.length && <Label muted>No saved ideas yet.</Label>}
          </Card>
        </>
      ) : (
        <Card>
          <Heading>Make inspiration personal</Heading>
          <Label>
            Pro Monthly and Lifetime include New Topic, Expand an Idea, Connect
            the Dots, and your personalized Writing Profile.
          </Label>
          <Label muted>
            Existing subscriptions are recognized here. Purchases are
            unavailable in Expo Go.
          </Label>
        </Card>
      )}
    </Screen>
  );
}
