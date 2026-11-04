import React, { useEffect, useState } from "react";
import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useApp, useRepository } from "../providers/AppProvider";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  Row,
  Screen,
  selectTheme,
} from "../components/ui";
import { UsageCard } from "./coach";
import { message } from "../core/api";
import { reminder, cancelReminder } from "../services/reminders";
import { WEB_URL } from "../services/config";
export default function Profile() {
  const { account, session, logout, api, refresh } = useApp(),
    repo = useRepository(),
    [goal, setGoal] = useState(""),
    [timezone, setTimezone] = useState(""),
    [themes, setThemes] = useState(""),
    [language, setLanguage] = useState<"en" | "es">("en"),
    [error, setError] = useState(""),
    [hour, setHour] = useState("19"),
    [minute, setMinute] = useState("00"),
    [enabled, setEnabled] = useState(false),
    [profile, setProfile] = useState<any>(null);
  const subscription = useQuery({
    queryKey: ["subscription", account?.id],
    queryFn: () =>
      api<{
        plan: string;
        access_source: string;
        status: string;
        period_end: string | null;
      }>("GET", "/subscription"),
    enabled: !!account,
  });
  const writingProfile = useQuery({
    queryKey: ["profile", account?.id],
    queryFn: () => api<any>("GET", "/ai/profile"),
    enabled: !!account?.ai_access,
  });
  useEffect(() => {
    if (writingProfile.data) setProfile(writingProfile.data);
  }, [writingProfile.data]);
  useEffect(() => {
    if (repo?.preferences) {
      setGoal(String(repo.preferences.daily_goal));
      setTimezone(
        repo.preferences.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setThemes(repo.preferences.themes?.join(", ") || "surprise-me");
      setLanguage(repo.preferences.language);
    }
  }, [repo?.preferences?.revision]);
  useEffect(() => {
    if (!account) return;
    void AsyncStorage.getItem("uno.mobile.reminder:" + account.id).then(
      (raw) => {
        if (raw) {
          const r = JSON.parse(raw);
          setEnabled(true);
          setHour(String(r.hour));
          setMinute(String(r.minute).padStart(2, "0"));
        }
      },
    );
  }, [account?.id]);
  const save = async () => {
    try {
      const daily_goal = Number(goal);
      if (
        !Number.isInteger(daily_goal) ||
        daily_goal < 1 ||
        daily_goal > 1000000
      )
        throw new Error("Choose a goal from 1 to 1,000,000 words.");
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      await repo?.setPreferences({
        daily_goal,
        timezone,
        language,
        themes: themes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 30),
      });
      await repo?.sync(!!account?.features.writing_editor);
      setError("Settings saved locally. " + (repo?.status || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : message(e));
    }
  };
  return (
    <Screen title="Your UnoWord">
      <Card>
        <Label size={20} style={{ fontWeight: "700" }}>
          {account?.email || session?.user.email}
        </Label>
        <Label>
          {subscription.data?.access_source === "stripe_lifetime"
            ? "Lifetime Pro"
            : account?.features.writing_editor
              ? "UnoWord Pro"
              : "UnoWord Free"}
        </Label>
        <Label muted>{subscription.data?.status || "Verifying access…"}</Label>
        <Label muted>
          The same verified account access applies on the website, extension,
          and this app. Purchases and subscription changes are unavailable in
          this Expo Go version.
        </Label>
        <Button
          title="Refresh account access"
          secondary
          onPress={() => void refresh()}
        />
      </Card>
      <Card>
        <Heading>Your daily habit</Heading>
        <Label>Daily word goal</Label>
        <Input
          accessibilityLabel="Daily word goal"
          value={goal}
          onChangeText={setGoal}
          keyboardType="number-pad"
        />
        <Label>Account reporting timezone</Label>
        <Input
          accessibilityLabel="Reporting timezone"
          value={timezone}
          onChangeText={setTimezone}
          autoCapitalize="none"
          placeholder="America/Chicago"
        />
        <Label>Prompt themes (existing theme slugs, separated by commas)</Label>
        <Input
          accessibilityLabel="Prompt themes"
          value={themes}
          onChangeText={setThemes}
          autoCapitalize="none"
        />
        <Row>
          <Button
            title="English prompts"
            secondary={language !== "en"}
            onPress={() => setLanguage("en")}
          />
          <Button
            title="Spanish prompts"
            secondary={language !== "es"}
            onPress={() => setLanguage("es")}
          />
        </Row>
        <Button title="Save account preferences" onPress={() => void save()} />
        <Label muted size={12}>
          Changes synchronize with the website and extension. A conflicting
          newer setting is kept rather than silently overwritten.
        </Label>
      </Card>
      <Card>
        <Heading>Appearance</Heading>
        <Row>
          {(["system", "light", "dark"] as const).map((value) => (
            <Button
              key={value}
              title={value[0].toUpperCase() + value.slice(1)}
              secondary
              onPress={() => {
                selectTheme(value);
                void AsyncStorage.setItem("uno.mobile.theme", value);
              }}
            />
          ))}
        </Row>
      </Card>
      <Card>
        <Heading>Writing reminders</Heading>
        <Label muted>
          Optional local notifications on this device. They don’t require
          continuous background execution.
        </Label>
        <Row>
          <Input
            accessibilityLabel="Reminder hour"
            value={hour}
            onChangeText={setHour}
            keyboardType="number-pad"
            maxLength={2}
            style={{ width: 65 }}
          />
          <Label>:</Label>
          <Input
            accessibilityLabel="Reminder minute"
            value={minute}
            onChangeText={setMinute}
            keyboardType="number-pad"
            maxLength={2}
            style={{ width: 65 }}
          />
          <Label muted>24-hour local time</Label>
        </Row>
        <Button
          title={enabled ? "Update reminder" : "Enable reminder"}
          secondary
          onPress={() => {
            if (account)
              void reminder(account.id, Number(hour), Number(minute))
                .then(() => {
                  setEnabled(true);
                  setError("Reminder scheduled.");
                })
                .catch((e) => setError(e.message));
          }}
        />
        {enabled && (
          <Button
            title="Disable reminder"
            secondary
            onPress={() => {
              if (account)
                void cancelReminder(account.id)
                  .then(() => setEnabled(false))
                  .catch((e) => setError(e.message));
            }}
          />
        )}
      </Card>
      {account?.ai_access && (
        <>
          <UsageCard />
          <Card>
            <Heading>My Writing Profile</Heading>
            <Label muted>
              Your existing profile is the central personalization system,
              shared across UnoWord.
            </Label>
            {profile ? (
              <>
                <Label>Your writing goal</Label>
                <Input
                  accessibilityLabel="Writing profile goal"
                  value={profile.writing_goal || ""}
                  onChangeText={(writing_goal) =>
                    setProfile({ ...profile, writing_goal })
                  }
                  multiline
                />
                <Label>Writing style</Label>
                <Input
                  accessibilityLabel="Writing style"
                  value={profile.writing_style || ""}
                  onChangeText={(writing_style) =>
                    setProfile({ ...profile, writing_style })
                  }
                />
                <Label>Interests / primary topics</Label>
                <Input
                  accessibilityLabel="Primary topics"
                  value={(profile.primary_topics || []).join(", ")}
                  onChangeText={(text) =>
                    setProfile({
                      ...profile,
                      primary_topics: text
                        .split(",")
                        .map((s: string) => s.trim()),
                    })
                  }
                />
                <Label>Topics to avoid</Label>
                <Input
                  accessibilityLabel="Topics to avoid"
                  value={(profile.avoid_topics || []).join(", ")}
                  onChangeText={(text) =>
                    setProfile({
                      ...profile,
                      avoid_topics: text
                        .split(",")
                        .map((s: string) => s.trim()),
                    })
                  }
                />
                <Button
                  title="Save Writing Profile"
                  onPress={() => {
                    void api("PUT", "/ai/profile", {
                      ...profile,
                      expected_user_id: account.id,
                      ai_preferences: {
                        ...profile.ai_preferences,
                        prompt_themes: themes
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                      .then(() =>
                        setError(
                          "Writing Profile saved. Future suggestions use these preferences.",
                        ),
                      )
                      .catch((e) => setError(message(e)));
                  }}
                />
              </>
            ) : (
              <Label muted>Connect to load your profile.</Label>
            )}
          </Card>
        </>
      )}
      {!!error && <Label accessibilityLiveRegion="polite">{error}</Label>}
      <Card>
        <Heading>About & support</Heading>
        {[
          ["Privacy Policy", "/privacy"],
          ["Terms of Service", "/terms"],
          ["Support", "/support"],
        ].map(([title, path]) => (
          <Button
            key={path}
            title={title}
            secondary
            onPress={() => void WebBrowser.openBrowserAsync(WEB_URL + path)}
          />
        ))}
        <Label muted size={12}>
          Account deletion is not yet available in the mobile app. This is an
          Expo Go testing build; the App Store release requires a verified
          deletion workflow.
        </Label>
      </Card>
      <Button
        title="Sign out"
        secondary
        onPress={() =>
          Alert.alert(
            "Sign out?",
            "Unsynchronized writing stays encrypted for this account on this device. It cannot upload into another account.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: () =>
                  void (async () => {
                    if (account) await cancelReminder(account.id);
                    await logout();
                  })().catch((e) => setError(message(e))),
              },
            ],
          )
        }
      />
    </Screen>
  );
}
