import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

export interface Product {
  ai_allowance?: { id: string; name: string; suggestions_daily: number; suggestions_monthly: number; guidance_monthly: number } | null;
  name: string;
  billing_available: boolean;
  chrome_store_url: string | null;
  plans: {
    id: string;
    name: string;
    price: null | {
      amount: number;
      currency: string;
      interval: string;
      trial_days: number;
    };
    features: Record<string, boolean>;
  }[];
  features: { id: string; label: string }[];
}
export function useProduct() {
  return useQuery({
    queryKey: ["public-product"],
    queryFn: () => apiGet<Product>("/product"),
    staleTime: 60_000,
    retry: 1,
  });
}
export const FREE_START = "/account?mode=signup";
export const PRO_START = "/account?plan=pro";
