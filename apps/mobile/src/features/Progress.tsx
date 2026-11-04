import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useApp, useRepository } from "../providers/AppProvider";
import {
  Button,
  Card,
  Heading,
  Label,
  Row,
  Screen,
  useTheme,
} from "../components/ui";
import { duration } from "../core/engines";
import type { Activity, Statistics } from "../core/types";
export default function Progress() {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    p = useTheme(),
    [range, setRange] = useState("today"),
    paid = !!account?.features.goals_analytics;
  const timezone =
    repo?.preferences?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  useEffect(() => {
    if (!paid) setRange("today");
  }, [paid]);
  const stats = useQuery({
    queryKey: ["statistics", account?.id, paid, range, timezone],
    queryFn: () =>
      api<Statistics>(
        "GET",
        `/progress/statistics?range=${range}&timezone=${encodeURIComponent(timezone)}`,
      ),
    enabled: !!account && online && (range === "today" || paid),
    refetchInterval: 15000,
  });
  const history = useQuery({
    queryKey: ["history", account?.id, paid],
    queryFn: () => api<Activity[]>("GET", "/progress/activity"),
    enabled: !!account && online,
    refetchInterval: 15000,
  });
  const max = Math.max(1, ...(stats.data?.buckets.map((b) => b.words) || []));
  return (
    <Screen title="Your writing progress">
      <Label muted>Real activity, shared across every UnoWord client.</Label>
      <Row>
        {["today", ...(paid ? ["week", "month", "year", "all"] : [])].map(
          (value) => (
            <Button
              key={value}
              title={value[0].toUpperCase() + value.slice(1)}
              secondary={range !== value}
              onPress={() => setRange(value)}
            />
          ),
        )}
      </Row>
      <Card>
        <Heading>
          {stats.data?.totalWords?.toLocaleString() ??
            repo?.summary?.dailyWordCount.toLocaleString() ??
            "—"}{" "}
          words
        </Heading>
        <Label>
          {duration(
            stats.data?.activeWritingSeconds ??
              repo?.summary?.dailyActiveWritingSeconds ??
              0,
          )}{" "}
          writing time
        </Label>
        <Label muted>
          {stats.data?.sessionCount ?? "—"} sessions · {timezone}
        </Label>
      </Card>
      {!!stats.error && (
        <Label muted>Statistics could not refresh. Pull down to retry.</Label>
      )}
      <Card>
        <Label style={{ fontWeight: "700" }}>Words over time</Label>
        {stats.data?.buckets.map((bucket) => (
          <View key={bucket.key} style={{ gap: 4 }}>
            <Row>
              <Label size={13}>{bucket.label}</Label>
              <Label size={13} muted>
                {bucket.words} words
              </Label>
            </Row>
            <View
              style={{ height: 8, backgroundColor: p.line, borderRadius: 8 }}
            >
              <View
                style={{
                  height: 8,
                  width: `${(bucket.words / max) * 100}%`,
                  backgroundColor: p.blue,
                  borderRadius: 8,
                }}
              />
            </View>
          </View>
        ))}
        {!stats.data?.buckets.length && (
          <Label muted>No chart data available yet.</Label>
        )}
      </Card>
      {!paid && (
        <Card>
          <Label>
            Free includes today’s statistics and recent session history. Pro
            Monthly and Lifetime include extended history and uncapped streaks.
          </Label>
        </Card>
      )}
      <Card>
        <Heading>Recent sessions</Heading>
        {history.data
          ?.filter(
            (row) =>
              paid || Date.parse(row.started_at) >= Date.now() - 86400000,
          )
          .slice(0, 30)
          .map((row) => (
            <View
              key={row.id}
              style={{
                borderBottomColor: p.line,
                borderBottomWidth: 1,
                paddingBottom: 10,
              }}
            >
              <Label>{new Date(row.started_at).toLocaleString()}</Label>
              <Label muted>
                {row.typed_words} typed words · {duration(row.duration_seconds)}{" "}
                Session Time · {row.timer?.status || "ended"}
              </Label>
            </View>
          ))}
        {!history.data?.length && (
          <Label muted>No synchronized sessions to show.</Label>
        )}
      </Card>
    </Screen>
  );
}
