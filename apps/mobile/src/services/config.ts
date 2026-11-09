import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiBase, cachedPublicConnection } from "../domain/site";
export const API_URL = apiBase(process.env.EXPO_PUBLIC_API_URL);
export const WEB_URL = new URL(API_URL).origin;
export function publicKey(value: string) {
  if (value.startsWith("sb_publishable_")) return true;
  if (value.startsWith("sb_secret_")) return false;
  try {
    const payload = JSON.parse(
      atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return value.split(".").length === 3 && payload.role === "anon";
  } catch {
    return false;
  }
}
export async function publicConnection(offline = false) {
  if (!API_URL.startsWith("https://"))
    throw new Error("A secure HTTPS API URL is required.");
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL,
    key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  let value: { supabase_url: string; supabase_anon_key: string };
  try {
    if (url && key) value = { supabase_url: url, supabase_anon_key: key };
    else {
      try {
        if (offline)
          throw new Error("Offline startup uses saved public configuration.");
        const response = await fetch(API_URL + "/auth/client-config", {
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("Public auth configuration is unavailable.");
        value = await response.json();
      } catch (error) {
        const cached = await cachedPublicConnection(API_URL, key => AsyncStorage.getItem(key));
        if (!cached) throw error;
        value = JSON.parse(cached);
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  value.supabase_url = value.supabase_url.replace(/\/$/, "");
  if (
    value.supabase_url !==
      (
        process.env.EXPO_PUBLIC_SUPABASE_URL ||
        "https://jvcbpnmtnjhftpukgppw.supabase.co"
      ).replace(/\/$/, "") ||
    !value.supabase_url.startsWith("https://") ||
    !publicKey(value.supabase_anon_key)
  )
    throw new Error(
      "Use only the existing project’s public publishable or anon key.",
    );
  await AsyncStorage.setItem(
    "uno.mobile.public-config:" + API_URL,
    JSON.stringify(value),
  );
  return value;
}
