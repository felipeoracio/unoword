import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  initializeSupabase,
  cachedSession,
} from "../services/supabase";
import { API_URL } from "../services/config";
import { accountStore } from "../services/storage";
import { createTransport, bindOwner } from "../core/api";
import { Repository } from "../core/repository";
import { WriterSessions } from "../core/writer-sessions";
import type { Account, Transport } from "../core/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 10000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});
type State = {
  session: Session | null;
  loading: boolean;
  account: Account | null;
  repo: Repository | null;
  writer: WriterSessions | null;
  online: boolean;
  api: Transport;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  error: string;
};
const Context = createContext<State | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [account, setAccount] = useState<Account | null>(null),
    [repo, setRepo] = useState<Repository | null>(null),
    [writer, setWriter] = useState<WriterSessions | null>(null),
    [online, setOnline] = useState(true),
    [error, setError] = useState("");
  const verifiedAt = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const accountRef = useRef(account);
  accountRef.current = account;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const writerRef = useRef(writer);
  writerRef.current = writer;
  const refreshToken = useCallback(async () => {
    const { data, error } = await supabase!.auth.refreshSession();
    if (error || !data.session) throw error || new Error("Sign in again");
    sessionRef.current = data.session;
    setSession(data.session);
  }, []);
  const baseApi = useRef(
    createTransport(
      API_URL,
      () =>
        sessionRef.current
          ? {
              id: sessionRef.current.user.id,
              token: sessionRef.current.access_token,
            }
          : null,
      refreshToken,
    ),
  ).current;
  const owner = session?.user.id;
  const api = useMemo<Transport>(
    () => bindOwner(owner, () => sessionRef.current?.user.id, baseApi),
    [baseApi, owner],
  );
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    void NetInfo.fetch()
      .then(async (connection) => {
        const offline =
          connection.isConnected === false ||
          connection.isInternetReachable === false;
        const client = await initializeSupabase(offline);
        const { data, error } = offline
          ? { data: { session: await cachedSession() }, error: null }
          : await client.auth.getSession();
        if (!offline && AppState.currentState === "active")
          client.auth.startAutoRefresh();
        if (!alive) return;
        if (error) setError("Sign in again to connect.");
        sessionRef.current = data.session;
        setSession(data.session);
        setLoading(false);
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange((_event, value) => {
          if (alive) {
            if (_event === "INITIAL_SESSION" && offline && !value) return;
            sessionRef.current = value;
            setSession(value);
          }
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch(() => {
        if (alive) {
          setError(
            "Public authentication setup is unavailable. Check the mobile environment settings.",
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let current: Repository | null = null;
    verifiedAt.current = 0;
    setAccount(null);
    setRepo(null);
    setWriter(null);
    queryClient.clear();
    if (!session?.user.id) return;
    const owner = session.user.id;
    void (async () => {
      try {
        const store = await accountStore(owner);
        current = new Repository(owner, store, api, Crypto.randomUUID);
        await current.load();
        let device = await AsyncStorage.getItem("uno.mobile.device");
        if (!device) {
          device = "ios-" + Crypto.randomUUID();
          await AsyncStorage.setItem("uno.mobile.device", device);
        }
        const sessions = new WriterSessions(current, device, Crypto.randomUUID);
        await sessions.restore();
        const cached = await store.get<{ account: Account; verified: number }>(
          "verified-account",
        );
        if (disposed) {
          current.dispose();
          return;
        }
        setRepo(current);
        setWriter(sessions);
        // Offline editing uses at most 24h of a previously server-verified entitlement.
        if (
          cached &&
          Date.now() - cached.verified < 86400000 &&
          cached.account.id === owner
        ) {
          verifiedAt.current = cached.verified;
          setAccount(cached.account);
        }
        const verified = await api<Account>("GET", "/auth/me");
        if (disposed) return;
        verifiedAt.current = Date.now();
        setAccount(verified);
        await store.set("verified-account", {
          account: verified,
          verified: Date.now(),
        });
        await current.sync(!!verified.features.writing_editor);
      } catch {
        if (!disposed)
          setError(
            "Offline or session unavailable. Cached writing is preserved. Pull to refresh when connected.",
          );
      }
    })();
    return () => {
      disposed = true;
      current?.dispose();
    };
  }, [session?.user.id, api]);
  const refresh = useCallback(async () => {
    const current = repoRef.current;
    if (!current) return;
    try {
      const verified = await api<Account>("GET", "/auth/me");
      if (verified.id !== current.owner) return;
      verifiedAt.current = Date.now();
      setAccount(verified);
      await current.store.set("verified-account", {
        account: verified,
        verified: Date.now(),
      });
      setError("");
      await current.sync(!!verified.features.writing_editor);
      queryClient.invalidateQueries();
    } catch {
      setError("Could not refresh. Saved account data may be out of date.");
    }
  }, [api]);
  useEffect(() => {
    const net = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected !== false && state.isInternetReachable !== false;
      onlineRef.current = connected;
      setOnline(connected);
      onlineManager.setOnline(connected);
      if (connected) {
        if (AppState.currentState === "active")
          supabase?.auth.startAutoRefresh();
        void refresh();
      } else supabase?.auth.stopAutoRefresh();
    });
    const app = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      focusManager.setFocused(active);
      if (active) {
        if (verifiedAt.current && Date.now() - verifiedAt.current >= 86400000)
          setAccount(null);
        if (onlineRef.current) supabase?.auth.startAutoRefresh();
        void refresh();
      } else {
        supabase?.auth.stopAutoRefresh();
        void repoRef.current?.flush().catch(() => {});
        const w = writerRef.current;
        if (w?.active?.timer.status === "active")
          void w
            .change("paused")
            .then(() =>
              repoRef.current?.sync(
                !!accountRef.current?.features.writing_editor,
              ),
            )
            .catch(() => {});
      }
    });
    const poll = setInterval(() => {
      if (AppState.currentState === "active") {
        if (verifiedAt.current && Date.now() - verifiedAt.current >= 86400000)
          setAccount(null);
        void refresh();
      }
    }, 15000);
    const checkpoint = setInterval(() => {
      if (
        AppState.currentState === "active" &&
        writerRef.current?.active?.timer.status === "active"
      )
        void writerRef.current
          .tick()
          .then(() =>
            repoRef.current?.sync(
              !!accountRef.current?.features.writing_editor,
            ),
          )
          .catch(() => {});
    }, 10000);
    return () => {
      net();
      app.remove();
      clearInterval(poll);
      clearInterval(checkpoint);
    };
  }, [refresh]);
  const logout = async () => {
    if (writerRef.current?.active?.timer.status === "active")
      await writerRef.current.change("paused");
    await repoRef.current?.flush();
    // Local sign-out never revokes other devices; per-account encrypted drafts remain.
    await supabase?.auth.signOut({ scope: "local" });
    sessionRef.current = null;
    setSession(null);
    setAccount(null);
    setRepo(null);
    setWriter(null);
    queryClient.clear();
    setError("");
  };
  return (
    <QueryClientProvider client={queryClient}>
      <Context.Provider
        value={{
          session,
          loading,
          account: account?.id === owner ? account : null,
          repo: repo?.owner === owner ? repo : null,
          writer: writer?.repo.owner === owner ? writer : null,
          online,
          api,
          refresh,
          logout,
          error,
        }}
      >
        {children}
      </Context.Provider>
    </QueryClientProvider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing AppProvider");
  return value;
}
export function useRepository() {
  const { repo } = useApp();
  const [, update] = useState(0);
  useEffect(() => repo?.subscribe(() => update((n) => n + 1)), [repo]);
  return repo;
}
