import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./lib/queryClient";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);

if (window.location.pathname === "/" && root.dataset.prerendered === "true")
  hydrateRoot(root, app);
else createRoot(root).render(app);
