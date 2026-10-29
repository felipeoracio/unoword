import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiGet } from "./api";
export type StreakDisplay = {
  longestStreak?: number;
  milestones?: number[];
  user_id: string;
  displayedStreak: number;
  hasUnlimitedStreakAccess: boolean;
  streakLimitReached: boolean;
  journeyContinues: boolean;
  timezone: string;
  asOf: string;
};
export function useWritingStreak(
  owner: string | undefined,
  paid: boolean,
  timeZone: string,
  revision?: string,
) {
  const query = useQuery({
    queryKey: ["writing-streak", owner, paid, timeZone],
    queryFn: async () => {
      const value = await apiGet<StreakDisplay>(
        "/progress/streak?timezone=" + encodeURIComponent(timeZone),
      );
      if (value.user_id !== owner) throw new Error("account_changed");
      return value;
    },
    enabled: Boolean(owner && navigator.onLine),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!owner || !navigator.onLine) return;
    const timer = setTimeout(() => void refetch(), 1000);
    return () => clearTimeout(timer);
  }, [revision, owner, refetch]);
  return query;
}
