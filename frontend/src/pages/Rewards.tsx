import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { currentWriter } from "@/lib/writing";
import { RewardsContent } from "@/components/rewards/Rewards";
export default function Rewards() {
  const [owner, setOwner] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void currentWriter()
      .then((u) => {
        if (alive) setOwner(u.id);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main style={{ minHeight: "100vh", background: "#f4f8ff" }}>
      <nav style={{ padding: 20 }}>
        <Link to="/account">UnoWord · Account</Link> ·{" "}
        <Link to="/editor">Writing editor</Link>
      </nav>
      {loading ? (
        <p role="status">…</p>
      ) : owner ? (
        <RewardsContent key={owner} owner={owner} />
      ) : (
        <p style={{ padding: 20 }}>
          <Link to="/account">
            Sign in to view your private writing rewards.
          </Link>
        </p>
      )}
    </main>
  );
}
