import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "./api";
import { currentWriter, type WritingDocument } from "./writing";
import { useAccountWriting, type WritingPreferences } from "./use-account-writing";

export type RecentWriting = Pick<WritingDocument, "id" | "user_id" | "title" | "status" | "completion_status" | "updated_at">;

/** Read-only Home queries. Mounting Home never starts sessions or creates drafts. */
export function useStudioHome() {
  const client = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine);
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const account = useQuery({ queryKey: ["studio-home-account", sessionVersion], queryFn: currentWriter,
    enabled: online, staleTime: 0, gcTime: 0, retry: false,
    refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const user = account.isError ? undefined : account.data;
  const owner = user?.id, paid = !!user?.ai_access;
  useEffect(() => {
    if (!user) return;
    // Reuse the existing verified identity cache so beginSession's removal
    // also notifies other Home tabs on login/logout; never store credentials.
    try { localStorage.setItem("uno-writing-identity", JSON.stringify(user)); } catch { /* Online Home still works without browser storage. */ }
  }, [user]);
  useEffect(() => {
    const change = (event: StorageEvent) => {
      if (event.key === "uno-writing-identity" && event.newValue === null) {
        setSessionVersion(version => version + 1);
        client.removeQueries({ queryKey: ["studio-home-recent"] });
      }
    };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, [client]);
  const preferences = useQuery({ queryKey: ["studio-home-preferences", owner],
    queryFn: async () => {
      const result = await apiGet<WritingPreferences>("/progress/preferences");
      if (result.user_id !== owner) throw Error("account_changed");
      return result;
    }, enabled: !!owner && online, retry: false, gcTime: 0,
    refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const timezone = preferences.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const summary = useAccountWriting(owner, paid, timezone);
  const recent = useQuery({ queryKey: ["studio-home-recent", owner],
    queryFn: async () => {
      // Existing bounded metadata index; do not fetch document bodies for Home.
      const result = await apiGet<RecentWriting[]>("/workspace/documents?offset=0");
      if (!Array.isArray(result) || result.some(row => row.user_id !== owner)) throw Error("account_changed");
      return result.filter(row => row.status === "active")
        .sort((a,b) => b.updated_at.localeCompare(a.updated_at)).slice(0,3);
    }, enabled: !!owner && paid && online, retry: false, gcTime: 0,
    refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  return { user, account, owner, paid, online, preferences, summary, recent, timezone,
    refresh: () => Promise.all([account.refetch(), preferences.refetch(), summary.refetch(), ...(paid ? [recent.refetch()] : [])]) };
}
