import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiPost } from "./api";
import type { Rewards, RewardPreferences } from "../../../shared/rewards";
export * from "../../../shared/rewards";
export function useRewards(owner?: string, language = "auto") {
  const query = useQuery({
    queryKey: ["rewards", owner, language],
    enabled: !!owner,
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const data = await apiGet<Rewards>("/rewards?language=" + language);
      if (data.user_id !== owner) throw new Error("account_changed");
      return data;
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const client = useQueryClient();
  const update = async (
    patch: Partial<Omit<RewardPreferences, "user_id" | "revision">>,
  ) => {
    if (!query.data || !owner) return;
    try {
      await apiPut("/rewards/preferences", {
        expected_user_id: owner,
        revision: query.data.preferences.revision,
        ...patch,
      });
    } finally {
      await client.invalidateQueries({ queryKey: ["rewards", owner] });
    }
  };
  return { ...query, data: query.isError ? undefined : query.data, update };
}
export async function claimReward(owner: string) {
  return apiPost<{ achievement_id: string | null }>(
    "/rewards/celebrations/claim",
    { expected_user_id: owner },
  );
}
