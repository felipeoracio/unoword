import { lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { emailConfirmationRequest } from "@/lib/email-link";
import Home from "@/pages/Home";
import PageMetadata from "@/components/PageMetadata";

const Lifetime = lazy(() => import("@/pages/Lifetime"));
const Account = lazy(() => import("@/pages/Account"));
const WritingEditor = lazy(() => import("@/pages/WritingEditor"));
const AccountSecurity = lazy(() => import("@/pages/AccountSecurity"));
const EmailConfirmation = lazy(() => import("@/pages/EmailConfirmation"));
const Information = lazy(() => import("@/pages/Information"));
const AdminLogin = lazy(() => import("@/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("@/admin/AdminDashboard"));

export default function App() {
  const location = useLocation();
  const confirmation = emailConfirmationRequest(location);
  return (
    <>
      <PageMetadata />
      <Suspense
        fallback={
          <main
            style={{ padding: 40, fontFamily: "sans-serif", color: "#52698c" }}
            role="status"
          >
            Loading UnoWord…
          </main>
        }
      >
        {(confirmation.code || confirmation.invalid) &&
        location.pathname === "/" ? (
          <EmailConfirmation
            code={confirmation.code}
            invalid={confirmation.invalid}
          />
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/lifetime" element={<Lifetime />} />
            <Route path="/account" element={<Account />} />
            <Route path="/editor" element={<WritingEditor />} />
            <Route path="/account/security" element={<AccountSecurity />} />
            <Route path="/privacy" element={<Information kind="privacy" />} />
            <Route path="/terms" element={<Information kind="terms" />} />
            <Route path="/support" element={<Information kind="support" />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="*" element={<Information kind="not-found" />} />
          </Routes>
        )}
      </Suspense>
    </>
  );
}
