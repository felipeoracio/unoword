import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { currentWriter } from "./writing";

/** Verified studio identity shared by pages that must not mount the editor. */
export function useStudioAccount() {
  const client = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine);
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const account = useQuery({ queryKey: ["studio-home-account", sessionVersion], queryFn: currentWriter,
    enabled: online, staleTime: 0, gcTime: 0, retry: false,
    refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const user = account.isError ? undefined : account.data;
  useEffect(() => {
    if (!user) return;
    try { localStorage.setItem("uno-writing-identity", JSON.stringify(user)); } catch { /* Online studio works without storage. */ }
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
  return { user, account, owner: user?.id, paid: !!user?.ai_access, online };
}
