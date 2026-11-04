// Browser-only fixtures for layout checks. Never included in the native routes.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FixtureProvider } from "./context";
import { Repository } from "../../src/core/repository";
import { WriterSessions } from "../../src/core/writer-sessions";
import type { Store, Transport } from "../../src/core/types";
import Home from "../../src/features/Home";
import Write from "../../src/features/Write";
import Ideas from "../../src/features/Ideas";
import Progress from "../../src/features/Progress";
import Profile from "../../src/features/Profile";
import { Button, Row, selectTheme } from "../../src/components/ui";
const owner = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const params = new URLSearchParams(location.search);
const paid = params.get("plan") !== "free";
selectTheme(params.get("theme") === "dark" ? "dark" : "light");
const contents = {
  type: "doc",
  attrs: { subtitle: "Notes for a more intentional writing habit" },
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Finding clarity in the everyday" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Some ideas arrive quietly. Today I am making room to notice them, one small detail at a time. This is my space to explore a thought before I know exactly where it will lead.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "What could change if I approached the familiar with a little more curiosity?",
        },
      ],
    },
  ],
};
const doc = {
  id,
  user_id: owner,
  title: "A quieter kind of progress",
  content: contents,
  plain_text: "A fixture",
  folder_id: null,
  favorite: true,
  status: "active",
  completion_status: "draft",
  completed_at: null,
  ai_allowed: false,
  revision: 1,
  mutation_id: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const map = new Map<string, string>();
const store: Store = {
  async get(k) {
    return map.has(k) ? JSON.parse(map.get(k)!) : null;
  },
  async set(k, v) {
    map.set(k, JSON.stringify(v));
  },
  async remove(k) {
    map.delete(k);
  },
};
const api: Transport = async (method, path, body: any) => {
  if (path === "/auth/me") return account as any;
  if (path === "/progress/preferences")
    return {
      user_id: owner,
      revision: 1,
      daily_goal: 1000,
      timezone: "America/Chicago",
      language: "en",
      themes: ["ideas"],
    } as any;
  if (path.startsWith("/progress/summary"))
    return {
      user_id: owner,
      reportingDate: "2026-11-03",
      timezone: "America/Chicago",
      dailyWordCount: 748,
      dailyGoal: 1000,
      dailyGoalProgress: 0.748,
      dailyActiveWritingSeconds: 2100,
      lifetimeActiveWritingSeconds: 7200,
      displayedStreak: paid ? 15 : 7,
      sessions: [],
      updatedAt: new Date().toISOString(),
    } as any;
  if (path.startsWith("/progress/statistics"))
    return {
      totalWords: 748,
      sessionCount: 3,
      activeWritingSeconds: 2100,
      buckets: [{ key: "2026-11-03", label: "Today", words: 748 }],
    } as any;
  if (path === "/progress/activity") return [] as any;
  if (path.startsWith("/workspace/documents?"))
    return [{ ...doc, content: undefined, plain_text: undefined }] as any;
  if (path === "/workspace/folders")
    return [{ id: "folder-1", name: "Personal growth", user_id: owner }] as any;
  if (path.includes("/workspace/documents/"))
    return {
      ...doc,
      ...body,
      revision: body ? body.revision + 1 : doc.revision,
    } as any;
  if (path.includes("/ai/usage/summary"))
    return {
      user_id: owner,
      remaining: 8,
      daily_limit: 10,
      suggestions_monthly_remaining: 173,
      suggestions_monthly_limit: 200,
      guidance_monthly_remaining: 27,
      guidance_monthly_limit: 30,
      monthly_reset_at: "2026-12-01T06:00:00Z",
    } as any;
  if (path === "/ai/ideas") return [] as any;
  if (path === "/ai/profile")
    return {
      user_id: owner,
      writing_goal: "Build a consistent writing practice",
      writing_style: "Thoughtful and conversational",
      primary_topics: ["creativity", "personal growth"],
      avoid_topics: [],
    } as any;
  if (path === "/subscription")
    return {
      plan: paid ? "pro" : "free",
      access_source: "stripe",
      status: paid ? "active" : "inactive",
    } as any;
  return {} as any;
};
const account = {
  id: owner,
  email: "fictional-writer@example.com",
  plan: paid ? "pro" : "free",
  ai_access: paid,
  features: {
    writing_editor: paid,
    goals_analytics: paid,
    unlimited_writing_streaks: paid,
  },
};
function Preview() {
  const [ready, setReady] = useState(false),
    [route, setRoute] = useState(params.get("screen") || "Home"),
    [repo] = useState(
      () => new Repository(owner, store, api, () => crypto.randomUUID()),
    ),
    [writer] = useState(
      () => new WriterSessions(repo, "fixture", () => crypto.randomUUID()),
    );
  useEffect(() => {
    void (async () => {
      await store.set("document:" + id, {
        ...doc,
        dirty: false,
        local_version: 0,
      });
      await repo.load();
      await repo.sync(paid);
      if (params.get("doc") === "open")
        await repo.store.set("last-document", id);
      setReady(true);
    })();
    (window as any).navigate = setRoute;
  }, []);
  if (!ready) return null;
  const value = {
    account,
    session: { user: account },
    repo,
    writer,
    online: true,
    api,
    refresh: () => repo.sync(paid),
    logout: async () => {},
    error: "",
  };
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={new QueryClient()}>
        <FixtureProvider value={value}>
          <View style={{ flex: 1, height: "100dvh" }}>
            <View style={{ flex: 1, minHeight: 0 }}>
              {route === "Home" ? (
                <Home />
              ) : route === "Write" ? (
                <Write />
              ) : route === "Ideas" ? (
                <Ideas />
              ) : route === "Progress" ? (
                <Progress />
              ) : (
                <Profile />
              )}
            </View>
            <View
              style={{
                padding: 6,
                backgroundColor: "#FFFFFF",
                borderTopColor: "#DFE8F7",
                borderTopWidth: 1,
              }}
            >
              <Row>
                {["Home", "Write", "Progress", "Ideas", "Profile"].map(
                  (name) => (
                    <View key={name} style={{ flex: 1 }}>
                      <Button
                        title={name}
                        secondary={route !== name}
                        onPress={() => setRoute(name)}
                      />
                    </View>
                  ),
                )}
              </Row>
            </View>
          </View>
        </FixtureProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
