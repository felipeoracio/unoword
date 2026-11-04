import "react-native-url-polyfill/auto";
import {
  createClient,
  type SupabaseClient,
  type Session,
  processLock,
} from "@supabase/supabase-js";
import { secureSessionStorage } from "./secure-session";
import { publicConnection } from "./config";
export let supabase: SupabaseClient | null = null;
let storageKey = "";
export async function cachedSession(): Promise<Session | null> {
  if (!storageKey) return null;
  const raw = await secureSessionStorage.getItem(storageKey);
  if (!raw) return null;
  const value = JSON.parse(raw);
  return value?.user?.id && value?.access_token && value?.refresh_token
    ? value
    : null;
}
let initializing: Promise<SupabaseClient> | null = null;
export async function initializeSupabase(offline = false) {
  if (supabase) return supabase;
  if (initializing) return initializing;
  initializing = (async () => {
    const config = await publicConnection(offline);
    storageKey = "uno.mobile.auth.v1." + new URL(config.supabase_url).hostname;
    supabase = createClient(config.supabase_url, config.supabase_anon_key, {
      auth: {
        storage: secureSessionStorage,
        storageKey,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "pkce",
        lock: processLock,
      },
    });
    return supabase;
  })();
  try {
    return await initializing;
  } catch (error) {
    initializing = null;
    throw error;
  }
}
