import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { WritingDocument } from "./writing";
import { useStudioAccount } from "./use-studio-account";
import { useAccountWriting, type WritingPreferences } from "./use-account-writing";

export type RecentWriting = Pick<WritingDocument, "id" | "user_id" | "title" | "status" | "completion_status" | "updated_at">;

/** Read-only Home queries. Mounting Home never starts sessions or creates drafts. */
export function useStudioHome() {
  const { user, account, owner, paid, online } = useStudioAccount();
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
