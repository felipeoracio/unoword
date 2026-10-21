import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import PageMetadata from "@/components/PageMetadata";

const Account = lazy(() => import("@/pages/Account"));
const AccountSecurity = lazy(() => import("@/pages/AccountSecurity"));
const Information = lazy(() => import("@/pages/Information"));
const AdminLogin = lazy(() => import("@/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("@/admin/AdminDashboard"));

export default function App() {
  return (
    <>
      <PageMetadata />
      <Suspense
        fallback={
          <main
            style={{ padding: 40, fontFamily: "sans-serif", color: "#52698c" }}
            role="status"
          >
            Loading Uno Word…
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/account" element={<Account />} />
          <Route path="/account/security" element={<AccountSecurity />} />
          <Route path="/privacy" element={<Information kind="privacy" />} />
          <Route path="/terms" element={<Information kind="terms" />} />
          <Route path="/support" element={<Information kind="support" />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="*" element={<Information kind="not-found" />} />
        </Routes>
      </Suspense>
    </>
  );
}
