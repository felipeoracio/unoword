import {ProjectProvider} from "../src/providers/ProjectProvider";
import React, { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "../src/providers/AppProvider";
import { Login } from "../src/features/Login";
import { Loading, useTheme, selectTheme } from "../src/components/ui";
import { useReducedMotion } from "../src/components/motion";
import { motion } from "../src/components/motion-tokens";
function Gate() {
  const reduced = useReducedMotion();
  useEffect(() => {
    void AsyncStorage.getItem("uno.mobile.theme").then((value) => {
      if (value === "dark" || value === "light") selectTheme(value);
    });
  }, []);
  const { session, loading } = useApp();
  const p = useTheme();
  return (
    <>
      <StatusBar style={p.bg === "#0B1220" ? "light" : "dark"} />
      {loading ? (
        <Loading />
      ) : session ? (
        <Stack screenOptions={{ headerShown: false, animation: reduced ? "none" : "fade", animationDuration: motion.duration.page }} />
      ) : (
        <Login />
      )}
    </>
  );
}
export default function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ProjectProvider><Gate /></ProjectProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
