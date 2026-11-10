import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { currentWriter } from "@/lib/writing";
import { RewardsContent } from "@/components/rewards/Rewards";
import AppShell from "@/components/studio/AppShell";
import { StudioPageHeader } from "@/components/studio/StudioPrimitives";
import type { AuthUser } from "@/lib/auth-types";
import { useStudioPreferences } from "@/lib/studio-preferences";
export default function Rewards() {
  const [owner, setOwner] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [user, setUser] = useState<AuthUser | null>(null);
  const { language } = useStudioPreferences();
  useEffect(() => {
    let alive = true;
    void currentWriter()
      .then((u) => {
        if (alive) { setOwner(u.id); setUser(u); }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const content = (
    <main style={{ minHeight: user ? undefined : "100vh", background: user ? "transparent" : "#f4f8ff" }}>
      {!user && <nav style={{ padding: 20 }}>
        <Link to="/account">UnoWord · Account</Link> ·{" "}
        <Link to="/editor">Writing editor</Link>
      </nav>}
      {loading ? (
        <p role="status">…</p>
      ) : owner ? (
        <RewardsContent key={owner} owner={owner} language={language} />
      ) : (
        <p style={{ padding: 20 }}>
          <Link to="/account">
            Sign in to view your private writing rewards.
          </Link>
        </p>
      )}
    </main>
  );
  return user ? <AppShell user={user}>
    <StudioPageHeader title={language === "es" ? "Tus logros" : "Your milestones"}
      description={language === "es" ? "Celebra tu progreso, a tu propio ritmo." : "Celebrate your progress, at your own pace."} />
    {content}
  </AppShell> : content;
}
