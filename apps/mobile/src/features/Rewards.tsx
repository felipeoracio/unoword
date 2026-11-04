import React, { useEffect, useRef, useState } from "react";
import { Image, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  nextAchievement,
  rewardLabels,
  rewardProgress,
  type Achievement,
  type Rewards,
  type RewardPreferences,
} from "../../../../shared/rewards";
function useRewards() {
  const { account, api, online } = useApp(),
    repo = useRepository(),
    client = useQueryClient(),
    language = repo?.preferences?.language || "en";
  const query = useQuery({
    queryKey: ["rewards", account?.id, language],
    enabled: !!account && online,
    retry: false,
    gcTime: 0,
    refetchInterval: 15000,
    queryFn: async () => {
      const data = await api<Rewards>("GET", "/rewards?language=" + language);
      if (data.user_id !== account?.id) throw new Error("account_changed");
      return data;
    },
  });
  const update = async (patch: Partial<RewardPreferences>) => {
    if (!account || !query.data) return;
    try {
      await api("PUT", "/rewards/preferences", {
        expected_user_id: account.id,
        revision: query.data.preferences.revision,
        ...patch,
      });
    } finally {
      await client.invalidateQueries({ queryKey: ["rewards", account.id] });
    }
  };
  return {
    ...query,
    data: !account || query.isError ? undefined : query.data,
    update,
  };
}
const translator = (data?: Rewards) => (label: string) =>
  data?.language === "es" ? rewardLabels[label] || label : label;
function Badge({ item }: { item: Achievement }) {
  const p = useTheme();
  const colors: Record<string, string> = {
    bronze: "#9a552b",
    silver: "#526782",
    gold: "#9b6b00",
    platinum: "#4d5cc2",
    diamond: "#087399",
  };
  return (
    <View
      accessible
      accessibilityLabel={item.name + " · " + item.tier}
      style={{
        height: 48,
        width: 48,
        borderRadius: 16,
        backgroundColor: p.bg,
        borderWidth: 2,
        borderColor: colors[item.tier] || p.blue,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <>
        {item.badge_image ? (
          <Image
            source={{ uri: item.badge_image }}
            style={{ height: 40, width: 40 }}
            resizeMode="contain"
          />
        ) : (
          <Label size={27} style={{ color: colors[item.tier] || p.blue }}>
            {item.unlocked ? "✓" : "◇"}
          </Label>
        )}
      </>
    </View>
  );
}
export function RewardSettings() {
  const rewards = useRewards(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    t = translator(rewards.data);
  return (
    <Card>
      <Heading>{t("Rewards & Achievements")}</Heading>
      <Label muted>
        {t("Celebrate your writing milestones at your own pace.")}
      </Label>
      {rewards.data ? (
        (["enabled", "celebrations", "widget"] as const).map((key, i) => (
          <Row key={key}>
            <Switch
              accessibilityLabel={t(
                [
                  "Enable Writing Rewards",
                  "Achievement Celebrations",
                  "Show Rewards on Dashboard",
                ][i],
              )}
              value={rewards.data!.preferences[key]}
              disabled={busy || (key !== "enabled" && !rewards.data!.enabled)}
              onValueChange={async (value) => {
                setBusy(true);
                setError("");
                try {
                  await rewards.update({ [key]: value });
                } catch {
                  setError(
                    t(
                      "Settings changed on another device. Refresh and try again.",
                    ),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
            <View style={{ flex: 1 }}>
              <Label>
                {t(
                  [
                    "Enable Writing Rewards",
                    "Achievement Celebrations",
                    "Show Rewards on Dashboard",
                  ][i],
                )}
              </Label>
            </View>
          </Row>
        ))
      ) : (
        <Label muted>
          {rewards.error ? t("Rewards setup is not available yet.") : "…"}
        </Label>
      )}
      {error && <Label>{error}</Label>}
      {rewards.data && !rewards.data.enabled && (
        <Label muted>
          {t("Your achievements stay saved while rewards are off.")}
        </Label>
      )}
    </Card>
  );
}
export function RewardWidget() {
  const rewards = useRewards(),
    { api, account } = useApp(),
    router = useRouter(),
    data = rewards.data,
    t = translator(data),
    next = nextAchievement(data),
    [toast, setToast] = useState<Achievement | null>(null),
    busy = useRef(false);
  useEffect(() => {
    if (!data?.enabled || !data.preferences.celebrations) {
      setToast(null);
      return;
    }
    if (!data.preferences.celebrations || !account || busy.current) return;
    busy.current = true;
    let active = true;
    void api<{ achievement_id: string | null }>(
      "POST",
      "/rewards/celebrations/claim",
      { expected_user_id: account.id },
    )
      .then((result) => {
        if (active)
          setToast(
            data.achievements.find((a) => a.id === result.achievement_id) ||
              null,
          );
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
    return () => {
      active = false;
    };
  }, [
    data?.enabled,
    data?.preferences.celebrations,
    data?.achievements
      .filter((a) => a.unlocked)
      .map((a) => a.id)
      .join(","),
    account?.id,
  ]);
  if (!data?.enabled) return null;
  return (
    <>
      {data.preferences.widget && next && (
        <Card>
          <Label muted>{t("Your Next Milestone")}</Label>
          <Row>
            <Badge item={next} />
            <View style={{ flex: 1 }}>
              <Label size={20} style={{ fontWeight: "700" }}>
                {next.name}
              </Label>
              <Label>{rewardProgress(next, data.language)}</Label>
            </View>
          </Row>
          <Label muted>
            {t("You’re building something meaningful, one word at a time.")}
          </Label>
          <Button
            title={t("View Rewards")}
            secondary
            onPress={() => router.push("/rewards")}
          />
        </Card>
      )}
      {!data.preferences.widget && (
        <Button
          title={t("View Rewards")}
          secondary
          onPress={() => router.push("/rewards")}
        />
      )}{" "}
      {toast && data.preferences.celebrations && (
        <Card>
          <Label style={{ fontWeight: "700" }}>
            {t("Achievement Unlocked!")}
          </Label>
          <Label>{toast.name}</Label>
          <Button title={t("Close")} secondary onPress={() => setToast(null)} />
        </Card>
      )}
    </>
  );
}
export default function RewardsPage() {
  const rewards = useRewards(),
    data = rewards.data,
    t = translator(data),
    router = useRouter(),
    p = useTheme(),
    [error, setError] = useState("");
  return (
    <Screen title={t("Rewards & Achievements")}>
      <Button
        title={data?.language === "es" ? "Volver" : "Back"}
        secondary
        onPress={() => router.back()}
      />
      {!data ? (
        <Label>
          {rewards.error ? t("Rewards setup is not available yet.") : "…"}
        </Label>
      ) : !data.enabled ? (
        <RewardSettings />
      ) : (
        <>
          <Label muted>
            {t("Your personal journey has no comparisons or penalties.")}
          </Label>
          <Heading>
            {data.achievements.filter((a) => a.unlocked).length} /{" "}
            {data.achievements.length}
          </Heading>
          <Card>
            <Heading>{t("Your Private Showcase")}</Heading>
            <Label muted>
              {t("Choose up to three earned badges. Only you can see them.")}
            </Label>
            {data.preferences.showcase.map((id) => {
              const a = data.achievements.find((a) => a.id === id);
              return a ? (
                <Row key={id}>
                  <Badge item={a} />
                  <View style={{ flex: 1 }}>
                    <Label>{a.name}</Label>
                  </View>
                </Row>
              ) : null;
            })}
          </Card>
          <Card>
            <Heading>{t("Recently Unlocked")}</Heading>
            {[...data.achievements]
              .filter((a) => a.unlocked)
              .sort(
                (a, b) =>
                  (b.awarded_at || "").localeCompare(a.awarded_at || "") ||
                  (b.earned_on || "").localeCompare(a.earned_on || ""),
              )
              .slice(0, 4)
              .map((a) => (
                <Label key={a.id}>
                  {a.name} · {a.earned_on}
                </Label>
              ))}
          </Card>
          {[
            "words",
            "streaks",
            "goals",
            "sessions",
            "time",
            "documents",
            "growth",
          ].map((category, i) => {
            const items = data.achievements.filter(
              (a) => a.category === category,
            );
            return items.length ? (
              <View key={category} style={{ gap: 12 }}>
                <Heading>
                  {t(
                    [
                      "Words",
                      "Writing Streaks",
                      "Daily Goals",
                      "Writing Sessions",
                      "Writing Time",
                      "Document Completion",
                      "Personal Growth",
                    ][i],
                  )}
                </Heading>
                {category === "streaks" && (
                  <Label muted>
                    {t(
                      "Every new writing day is another opportunity to begin.",
                    )}
                  </Label>
                )}
                {items.map((a) => (
                  <Card key={a.id}>
                    <Row>
                      <Badge item={a} />
                      <View style={{ flex: 1 }}>
                        <Label size={20} style={{ fontWeight: "700" }}>
                          {a.name}
                        </Label>
                        <Label muted>
                          {t(a.unlocked ? "Unlocked" : "Locked")}
                        </Label>
                      </View>
                    </Row>
                    <Label>{a.description}</Label>
                    <Label>{rewardProgress(a, data.language)}</Label>
                    <View
                      accessibilityRole="progressbar"
                      accessibilityLabel={a.name}
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: a.unlocked
                          ? 100
                          : Math.min(
                              100,
                              Math.floor((a.progress / a.requirement) * 100),
                            ),
                      }}
                      style={{
                        height: 8,
                        borderRadius: 6,
                        backgroundColor: p.line,
                      }}
                    >
                      <View
                        style={{
                          height: 8,
                          borderRadius: 6,
                          width: `${a.unlocked ? 100 : Math.min(100, (a.progress / a.requirement) * 100)}%`,
                          backgroundColor: p.blue,
                        }}
                      />
                    </View>
                    {a.earned_on && (
                      <Label muted>
                        {t("Verified on")} {a.earned_on}
                      </Label>
                    )}
                    {a.unlocked && (
                      <Button
                        title={t(
                          data.preferences.showcase.includes(a.id)
                            ? "Remove favorite"
                            : "Favorite",
                        )}
                        secondary
                        disabled={
                          !data.preferences.showcase.includes(a.id) &&
                          data.preferences.showcase.length >= 3
                        }
                        onPress={() =>
                          void rewards
                            .update({
                              showcase: data.preferences.showcase.includes(a.id)
                                ? data.preferences.showcase.filter(
                                    (id) => id !== a.id,
                                  )
                                : [...data.preferences.showcase, a.id],
                            })
                            .catch(() =>
                              setError(
                                t(
                                  "Settings changed on another device. Refresh and try again.",
                                ),
                              ),
                            )
                        }
                      />
                    )}
                  </Card>
                ))}
              </View>
            ) : null;
          })}
          <Card>
            <Heading>{t("My Writing Journey")}</Heading>
            {[
              ["First writing day", data.journey?.first_writing_day],
              ["First completed goal", data.journey?.first_goal_day],
              ["First completed document", data.journey?.first_document_day],
              ["Total words", data.totals?.words],
              ["Completed sessions", data.totals?.sessions],
              [
                "Active writing hours",
                Math.floor((data.totals?.seconds || 0) / 3600),
              ],
            ]
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([label, value]) => (
                <Label key={String(label)}>
                  {t(String(label))}: {String(value)}
                </Label>
              ))}
            {data.achievements
              .filter((a) => a.unlocked)
              .sort((a, b) =>
                (a.earned_on || "").localeCompare(b.earned_on || ""),
              )
              .map((a) => (
                <Label key={a.id}>
                  {a.earned_on} · {a.name}
                </Label>
              ))}
          </Card>
          <Card>
            <Heading>{t("Personal highlights")}</Heading>
            {data.personal_milestones?.slice(0, 8).map((m) => (
              <Label key={m.occurred_on}>
                {m.occurred_on} ·{" "}
                {t("New personal best in your recorded history")}:{" "}
                {m.value.toLocaleString()}
              </Label>
            ))}
          </Card>
          <Label muted>
            {t(
              "Goal achievements use saved daily targets; older goals without evidence are not guessed.",
            )}
          </Label>
          <Label muted>
            {t("Monthly growth compares two fully observed, completed months.")}
          </Label>
          <RewardSettings />
        </>
      )}
      {error && <Label>{error}</Label>}
    </Screen>
  );
}
