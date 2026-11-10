import React from "react";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "../../src/components/ui";
const icons = {
  index: "home-outline",
  projects: "folder-open-outline",
  write: "create-outline",
  progress: "bar-chart-outline",
  ideas: "bulb-outline",
  profile: "person-circle-outline",
} as const;
export default function Layout() {
  const p = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: p.blue,
        tabBarInactiveTintColor: p.muted,
        tabBarStyle: { backgroundColor: p.card, borderTopColor: p.line },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={icons[route.name as keyof typeof icons]}
            color={String(color)}
            size={size}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
      <Tabs.Screen name="write" options={{ title: "Write" }} />
      <Tabs.Screen name="progress" options={{ title: "Progress" }} />
      <Tabs.Screen name="ideas" options={{ title: "Ideas" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
