import { Routes, Route } from "react-router-dom";
import AccountSecurity from "@/pages/AccountSecurity";
import Home from "@/pages/Home";
import AdminLogin from "@/admin/AdminLogin";
import AdminDashboard from "@/admin/AdminDashboard";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/account/security" element={<AccountSecurity />} />
      <Route path="/" element={<Home />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminDashboard />} />
    </Routes>
  );
}
