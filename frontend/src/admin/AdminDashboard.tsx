import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users as UsersIcon, CreditCard, PenLine, MessageSquare,
  Activity, Settings as SettingsIcon, LogOut, ShieldCheck, Menu,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { adminGet, adminPost, errorText } from "@/lib/adminApi";
import { makeT, type Lang } from "./i18n";

type Tab = "overview" | "users" | "subscriptions" | "writing" | "feedback" | "health" | "settings";
const PIE = ["#6366f1", "#22c55e"];

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" data-testid="stat-card">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-sm font-medium text-slate-200 mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>("en");
  const t = makeT(lang);
  const [tab, setTab] = useState<Tab>("overview");
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    adminGet<{ email: string }>("/me")
      .then((m) => { setEmail(m.email); setReady(true); })
      .catch(() => navigate("/admin/login"));
  }, [navigate]);

  async function signOut() {
    try { await adminPost("/logout"); } catch { /* ignore */ }
    navigate("/admin/login");
  }

  const nav: { id: Tab; icon: React.ReactNode; key: string }[] = [
    { id: "overview", icon: <LayoutDashboard size={18} />, key: "nav.overview" },
    { id: "users", icon: <UsersIcon size={18} />, key: "nav.users" },
    { id: "subscriptions", icon: <CreditCard size={18} />, key: "nav.subscriptions" },
    { id: "writing", icon: <PenLine size={18} />, key: "nav.writing" },
    { id: "feedback", icon: <MessageSquare size={18} />, key: "nav.feedback" },
    { id: "health", icon: <Activity size={18} />, key: "nav.health" },
    { id: "settings", icon: <SettingsIcon size={18} />, key: "nav.settings" },
  ];

  if (!ready) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">{t("common.loading")}</div>;
  }

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex overflow-x-hidden">
      {/* Sidebar */}
      <aside className={`${navOpen ? "fixed inset-y-0 left-0 z-40 w-64" : "hidden"} md:flex md:static md:w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/80 p-4`}>
        <div className="flex items-center gap-2 text-indigo-400 px-2 py-1">
          <ShieldCheck size={20} /><span className="font-semibold tracking-tight">{t("app.title")}</span>
        </div>
        <nav className="mt-6 flex-1 space-y-1">
          {nav.map((n) => (
            <button
              key={n.id} data-testid={`nav-${n.id}`}
              onClick={() => { setTab(n.id); setNavOpen(false); }}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${tab === n.id ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
            >
              {n.icon}<span>{t(n.key)}</span>
            </button>
          ))}
        </nav>
        <button data-testid="nav-signout" onClick={signOut}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-rose-300 transition-colors">
          <LogOut size={18} /><span>{t("nav.signout")}</span>
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 md:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden text-slate-400" onClick={() => setNavOpen(true)} data-testid="nav-mobile-open"><Menu size={20} /></button>
            <h1 className="text-lg font-semibold tracking-tight truncate">{t(`nav.${tab}`)}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-slate-500 truncate max-w-[180px]">{email}</span>
            <button data-testid="admin-lang-toggle" onClick={() => setLang(lang === "en" ? "es" : "en")}
              className="text-xs rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800">
              {lang === "en" ? "ES" : "EN"}
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden" data-testid={`panel-${tab}`}>
          {tab === "overview" && <Overview t={t} />}
          {tab === "users" && <UsersTab t={t} />}
          {tab === "subscriptions" && <Subscriptions t={t} />}
          {tab === "writing" && <Writing t={t} />}
          {tab === "feedback" && <Feedback t={t} />}
          {tab === "health" && <Health t={t} />}
          {tab === "settings" && <SettingsTab t={t} email={email} />}
        </main>
      </div>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}
    </div>
  );
}

type T = (k: string) => string;
function useData<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fn().then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(errorText(e)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, err, loading };
}

function State({ loading, err, empty, emptyText, children }: { loading: boolean; err: string | null; empty?: boolean; emptyText: string; children: React.ReactNode }) {
  if (loading) return <div className="text-sm text-slate-500 py-10 text-center">…</div>;
  if (err) return <div className="text-sm text-rose-400 py-10 text-center" data-testid="error-state">{err}</div>;
  if (empty) return <div className="text-sm text-slate-500 py-10 text-center" data-testid="empty-state">{emptyText}</div>;
  return <>{children}</>;
}

interface Overview { cards: Record<string, number | null>; charts: { user_growth: { date: string; value: number }[]; writing_activity: { date: string; sessions: number; words: number }[]; accounts: { name: string; value: number }[] }; }
function Overview({ t }: { t: T }) {
  const { data, err, loading } = useData<Overview>(() => adminGet("/overview"), []);
  const c = data?.cards;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? t("common.unavailable") : v.toLocaleString());
  return (
    <State loading={loading} err={err} emptyText={t("common.empty")}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label={t("card.total_users")} value={fmt(c?.total_users)} />
        <Card label={t("card.new_7d")} value={fmt(c?.new_7d)} />
        <Card label={t("card.new_30d")} value={fmt(c?.new_30d)} />
        <Card label={t("card.active_users_30d")} value={fmt(c?.active_users_30d)} hint="30d sessions/AI" />
        <Card label={t("card.free_users")} value={fmt(c?.free_users)} />
        <Card label={t("card.paid_users")} value={fmt(c?.paid_users)} />
        <Card label={t("card.conversion_rate")} value={c?.conversion_rate != null ? `${c.conversion_rate}%` : t("common.unavailable")} />
        <Card label={t("card.revenue")} value={t("common.unavailable")} hint="no billing provider" />
        <Card label={t("card.writing_sessions")} value={fmt(c?.writing_sessions)} />
        <Card label={t("card.total_words")} value={fmt(c?.total_words)} />
        <Card label={t("card.feedback")} value={fmt(c?.feedback)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
        <div className="lg:col-span-2"><Panel title={t("chart.user_growth")}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data?.charts.user_growth ?? []}>
              <XAxis dataKey="date" hide /><YAxis hide allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f133" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel></div>
        <Panel title={t("chart.accounts")}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data?.charts.accounts ?? []} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                {(data?.charts.accounts ?? []).map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <div className="mt-4"><Panel title={t("chart.writing_activity")}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data?.charts.writing_activity ?? []}>
            <XAxis dataKey="date" hide /><YAxis hide allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="sessions" fill="#22c55e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel></div>
    </State>
  );
}

interface UserRow { id: string; email: string; created_at: string | null; last_sign_in_at: string | null; language: string | null; plan: string; status: string; sessions: number; words: number; }
function UsersTab({ t }: { t: T }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("all");
  const [page, setPage] = useState(1);
  const { data, err, loading } = useData<{ total: number; users: UserRow[]; page_size: number }>(
    () => adminGet(`/users?search=${encodeURIComponent(q)}&plan=${plan}&page=${page}&page_size=15`), [q, plan, page]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(search); }} className="flex-1 min-w-[180px]">
          <input data-testid="users-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </form>
        <select data-testid="users-plan-filter" value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}
          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm">
          <option value="all">{t("common.all")}</option>
          <option value="free">{t("common.free")}</option>
          <option value="paid">{t("common.paid")}</option>
        </select>
      </div>
      <State loading={loading} err={err} empty={!!data && data.users.length === 0} emptyText={t("common.empty")}>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm" data-testid="users-table">
            <thead className="bg-slate-900/80 text-slate-400 text-xs">
              <tr>
                <th className="text-left px-3 py-2">{t("users.email")}</th>
                <th className="text-left px-3 py-2">{t("users.plan")}</th>
                <th className="text-left px-3 py-2">{t("users.status")}</th>
                <th className="text-left px-3 py-2">{t("users.created")}</th>
                <th className="text-right px-3 py-2">{t("users.sessions")}</th>
                <th className="text-right px-3 py-2">{t("users.words")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-900/50">
                  <td className="px-3 py-2 truncate max-w-[220px]">{u.email}</td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${u.plan !== "free" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-300"}`}>{u.plan}</span></td>
                  <td className="px-3 py-2 text-slate-400">{u.status}</td>
                  <td className="px-3 py-2 text-slate-400">{d(u.created_at)}</td>
                  <td className="px-3 py-2 text-right">{u.sessions}</td>
                  <td className="px-3 py-2 text-right">{u.words.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <span>{data?.total ?? 0} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">{t("common.prev")}</button>
            <span className="px-1 py-1">{page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">{t("common.next")}</button>
          </div>
        </div>
      </State>
    </div>
  );
}

interface Sub { user_id: string; email: string; plan: string; status: string; valid_until: string | null; updated_at: string | null; }
function Subscriptions({ t }: { t: T }) {
  const { data, err, loading } = useData<{ subscriptions: Sub[] }>(() => adminGet("/subscriptions"), []);
  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
  return (
    <div>
      <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{t("subs.note")}</div>
      <State loading={loading} err={err} empty={!!data && data.subscriptions.length === 0} emptyText={t("common.empty")}>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm" data-testid="subs-table">
            <thead className="bg-slate-900/80 text-slate-400 text-xs"><tr>
              <th className="text-left px-3 py-2">{t("users.email")}</th>
              <th className="text-left px-3 py-2">{t("users.plan")}</th>
              <th className="text-left px-3 py-2">{t("users.status")}</th>
              <th className="text-left px-3 py-2">{t("subs.renewal")}</th>
              <th className="text-left px-3 py-2">{t("subs.updated")}</th>
            </tr></thead>
            <tbody>
              {data?.subscriptions.map((s) => (
                <tr key={s.user_id} className="border-t border-slate-800">
                  <td className="px-3 py-2 truncate max-w-[220px]">{s.email}</td>
                  <td className="px-3 py-2">{s.plan}</td>
                  <td className="px-3 py-2 text-slate-400">{s.status}</td>
                  <td className="px-3 py-2 text-slate-400">{d(s.valid_until)}</td>
                  <td className="px-3 py-2 text-slate-400">{d(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </State>
    </div>
  );
}

function Writing({ t }: { t: T }) {
  const { data, err, loading } = useData<{ sessions: number; words: number; avg_duration_seconds: number; daily: { date: string; sessions: number; words: number }[] }>(() => adminGet("/writing-activity?range=30d"), []);
  return (
    <State loading={loading} err={err} emptyText={t("common.empty")}>
      <div className="grid grid-cols-3 gap-3">
        <Card label={t("card.writing_sessions")} value={(data?.sessions ?? 0).toLocaleString()} />
        <Card label={t("card.total_words")} value={(data?.words ?? 0).toLocaleString()} />
        <Card label={t("writing.avg")} value={`${data?.avg_duration_seconds ?? 0}s`} />
      </div>
      <div className="mt-4"><Panel title={t("chart.writing_activity")}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data?.daily ?? []}>
            <XAxis dataKey="date" hide /><YAxis hide allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="words" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel></div>
    </State>
  );
}

interface Fb { id: string; email: string | null; helpful: boolean | null; reason: string | null; note: string | null; created_at: string | null; plan: string; }
function Feedback({ t }: { t: T }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, err, loading } = useData<{ total: number; feedback: Fb[]; page_size: number }>(() => adminGet(`/feedback?search=${encodeURIComponent(q)}&page=${page}&page_size=15`), [q, page]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div>
      <div className="mb-3 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">{t("feedback.privacy")}</div>
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(search); }} className="mb-3">
        <input data-testid="feedback-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      </form>
      <State loading={loading} err={err} empty={!!data && data.feedback.length === 0} emptyText={t("common.empty")}>
        <div className="space-y-2" data-testid="feedback-list">
          {data?.feedback.map((f) => (
            <div key={f.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="truncate max-w-[200px]">{f.email ?? "—"} · {f.plan}</span>
                <span>{f.created_at ? new Date(f.created_at).toLocaleString() : "—"}</span>
              </div>
              <div className="mt-1 text-sm text-slate-200">{f.note || f.reason || "—"}</div>
              {f.helpful != null && <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[11px] ${f.helpful ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{t("feedback.helpful")}: {String(f.helpful)}</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <span>{data?.total ?? 0} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">{t("common.prev")}</button>
            <span className="px-1 py-1">{page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">{t("common.next")}</button>
          </div>
        </div>
      </State>
    </div>
  );
}

function Health({ t }: { t: T }) {
  const { data, err, loading } = useData<{ checked_at: string; checks: Record<string, { status: string; available: boolean; model?: string }> }>(() => adminGet("/system-health"), []);
  const color = (ok: boolean, avail: boolean) => (!avail ? "bg-slate-600" : ok ? "bg-emerald-500" : "bg-rose-500");
  return (
    <State loading={loading} err={err} emptyText={t("common.empty")}>
      <Panel title={t("health.title")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data && Object.entries(data.checks).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm">
              <span className="capitalize text-slate-300">{k.replace(/_/g, " ")}</span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {v.model && <span className="text-slate-500">{v.model}</span>}
                <span className={`h-2.5 w-2.5 rounded-full ${color(v.status === "ok" || v.status === "configured", v.available)}`} />
                {v.available ? v.status : t("common.unavailable")}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-500">checked: {data ? new Date(data.checked_at).toLocaleString() : "—"}</div>
      </Panel>
    </State>
  );
}

interface Audit { admin_email: string | null; action: string; record_id: string | null; created_at: string | null; }
function SettingsTab({ t, email }: { t: T; email: string }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const audit = useData<{ entries: Audit[] }>(() => adminGet("/audit-log?page_size=20"), [msg]);

  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setErr(null);
    try {
      await adminPost("/change-password", { current_password: cur, new_password: nw });
      setMsg(t("settings.pwChanged")); setCur(""); setNw("");
    } catch (ex) { setErr(errorText(ex)); }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel title={t("settings.account")}>
        <div className="text-sm text-slate-300">{email}</div>
        <form onSubmit={changePw} className="mt-4 space-y-3" data-testid="change-pw-form">
          <div className="text-sm font-medium text-slate-200">{t("settings.changePw")}</div>
          <input data-testid="pw-current" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={t("settings.current")} required
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <input data-testid="pw-new" type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder={t("settings.new")} required minLength={10}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          {msg && <p className="text-sm text-emerald-400" data-testid="pw-msg">{msg}</p>}
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <button data-testid="pw-submit" type="submit" className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-medium transition-colors">{t("settings.save")}</button>
        </form>
      </Panel>
      <Panel title={t("settings.audit")}>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="text-slate-400 text-xs"><tr>
              <th className="text-left px-2 py-1">{t("settings.action")}</th>
              <th className="text-left px-2 py-1">{t("settings.admin")}</th>
              <th className="text-left px-2 py-1">{t("settings.when")}</th>
            </tr></thead>
            <tbody>
              {audit.data?.entries.map((a, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="px-2 py-1">{a.action}</td>
                  <td className="px-2 py-1 text-slate-400 truncate max-w-[160px]">{a.admin_email ?? "—"}</td>
                  <td className="px-2 py-1 text-slate-500">{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
