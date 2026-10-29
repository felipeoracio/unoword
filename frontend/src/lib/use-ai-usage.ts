import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiGet } from "@/lib/api";

export type AIUsageSummary = {
  version_id: string;
  version_name: string;
  legacy_shared: boolean;
  timezone: string;
  pending_timezone?: string;
  daily_reset_at: string;
  monthly_reset_at: string;
  suggestions_monthly_limit: number | null;
  suggestions_monthly_used: number;
  suggestions_monthly_pending: number;
  suggestions_monthly_remaining: number | null;
  guidance_monthly_limit: number | null;
  guidance_monthly_used: number;
  guidance_monthly_pending: number;
  guidance_monthly_remaining: number | null;
  warning_percent: number;
  user_id: string;
  date: string;
  daily_limit: number;
  used_today: number;
  pending_today: number;
  remaining: number;
};

export function useAIUsage(
  userId: string | undefined,
  enabled: boolean,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const query = useQuery({
    queryKey: ["ai-usage", userId, timeZone],
    queryFn: async () => {
      const summary = await apiGet<AIUsageSummary>(
        "/ai/usage/summary?timezone=" + encodeURIComponent(timeZone),
      );
      if (summary.user_id !== userId) throw new Error("account_changed");
      return summary;
    },
    enabled: Boolean(userId && enabled),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!userId || !enabled) return;
    const refresh = () => void refetch();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [userId, enabled, refetch]);
  return query;
}
