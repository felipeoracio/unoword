import React from "react";
import { View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
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
export default function Home() {
  const { account, error, refresh, online } = useApp(),
    repo = useRepository(),
    router = useRouter(),
    p = useTheme(),
    wide = useWindowDimensions().width >= 700;
  const summary = repo?.summary;
  return (
    <Screen>
      <Row>
        <Label size={25} style={{ fontWeight: "900", color: p.blue }}>
          UnoWord
        </Label>
        <View style={{ flex: 1 }} />
        <Button title="Refresh" secondary onPress={() => void refresh()} />
      </Row>
      <View>
        <Heading>Make room for your next idea.</Heading>
        <Label muted>Every idea starts with UnoWord.</Label>
      </View>
      <Card>
        <Label muted>TODAY’S PROGRESS</Label>
        <Heading>
          {summary ? summary.dailyWordCount.toLocaleString() : "—"}{" "}
          <Label muted size={20}>
            / {summary?.dailyGoal ?? "—"} words
          </Label>
        </Heading>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: summary
              ? Math.min(100, Math.round(summary.dailyGoalProgress * 100))
              : 0,
          }}
          style={{
            height: 10,
            backgroundColor: p.line,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 10,
              width: `${Math.min(100, (summary?.dailyGoalProgress || 0) * 100)}%`,
              backgroundColor: p.blue,
            }}
          />
        </View>
        <Label muted>
          {online
            ? repo?.status || "Connecting…"
            : "Offline · saved account totals"}
          {summary
            ? " · " + summary.reportingDate + " · " + summary.timezone
            : ""}
        </Label>
      </Card>
      <Button
        title={
          account?.features.writing_editor
            ? "Open Writing Editor"
            : "Explore Your Writing Prompts"
        }
        onPress={() =>
          router.push(account?.features.writing_editor ? "/write" : "/ideas")
        }
      />
      <View style={{ flexDirection: wide ? "row" : "column", gap: 12 }}>
        {[
          [
            "Today’s Writing Time",
            summary ? duration(summary.dailyActiveWritingSeconds) : "—",
          ],
          [
            "Writing Streak",
            summary
              ? `${account?.features.unlimited_writing_streaks ? summary.displayedStreak : Math.min(7, summary.displayedStreak)} days`
              : "—",
          ],
          [
            "Total Writing Time",
            summary ? duration(summary.lifetimeActiveWritingSeconds) : "—",
          ],
        ].map(([label, value]) => (
          <Card key={label} style={{ flex: 1 }}>
            <Label muted>{label}</Label>
            <Label size={28} style={{ fontWeight: "800" }}>
              {value}
            </Label>
          </Card>
        ))}
      </View>
      {!!summary?.streakLimitReached &&
        !account?.features.unlimited_writing_streaks && (
          <Card>
            <Label style={{ fontWeight: "700" }}>Your first seven days!</Label>
            <Label>
              Your qualifying activity keeps being recorded. Pro reveals your
              full current streak and history.
            </Label>
          </Card>
        )}

      <Card>
        <Heading>One account. Every device.</Heading>
        <Label>
          Today’s totals include saved editor and extension activity across your
          devices. Individual session timers stay separate.
        </Label>
        {summary?.sessions.slice(0, 5).map((s) => (
          <View key={s.id}>
            <Label>
              {s.source === "editor" ? "Editor session" : "Extension session"} ·{" "}
              {s.status}
            </Label>
            <Label muted>{duration(s.active_seconds)} Session Time</Label>
          </View>
        ))}
        {!summary?.sessions.length && (
          <Label muted>No open sessions recorded.</Label>
        )}
      </Card>
      {!!error && <Label muted>{error}</Label>}
    </Screen>
  );
}
