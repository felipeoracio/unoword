import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
export interface LifetimeOffer {
  amount: number;
  currency: string;
  capacity: number;
  test_mode: boolean;
  checkout_available: boolean;
  remaining: number | null;
  available: number | null;
  refund_days: number;
  daily_ai_limit: number;
  purchased: number | null;
  reserved: number | null;
}
export function useLifetimeOffer() {
  return useQuery({
    queryKey: ["lifetime-offer"],
    queryFn: () => apiGet<LifetimeOffer>("/subscription/lifetime/offer"),
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  });
}
