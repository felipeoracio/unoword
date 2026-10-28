import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiGet } from "@/lib/api";

type AIUsage = {
  user_id: string;
  date: string;
  daily_limit: number;
  used_today: number;
  pending_today: number;
  remaining: number;
};

export function useAIUsage(userId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ai-usage", userId],
    queryFn: async () => {
      const summary = await apiGet<AIUsage>("/ai/usage/summary");
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
