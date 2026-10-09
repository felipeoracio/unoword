import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { adminPost, errorText } from "@/lib/adminApi";
import { makeT, type Lang } from "./i18n";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>("en");
  const t = makeT(lang);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminPost("/login", { email, password });
      navigate("/admin");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2 text-indigo-400">
            <ShieldCheck size={22} />
            <span className="font-semibold tracking-tight">{t("app.title")}</span>
          </div>
          <button
            data-testid="admin-lang-toggle"
            onClick={() => setLang(lang === "en" ? "es" : "en")}
            className="text-xs rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            {lang === "en" ? "ES" : "EN"}
          </button>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("login.subtitle")}</p>
        <form onSubmit={submit} className="mt-6 space-y-4" data-testid="admin-login-form">
          <div>
            <label className="text-xs text-slate-400">{t("login.email")}</label>
            <input
              data-testid="admin-login-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">{t("login.password")}</label>
            <input
              data-testid="admin-login-password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          {error && <p data-testid="admin-login-error" className="text-sm text-rose-400">{error}</p>}
          <button
            data-testid="admin-login-submit" type="submit" disabled={loading}
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? t("login.loading") : t("login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
