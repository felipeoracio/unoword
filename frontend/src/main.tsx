import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./lib/queryClient";
import { emailConfirmationRequest } from "./lib/email-link";

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

// Email confirmation has different content from the public prerendered home.
const confirmation = emailConfirmationRequest();
if (
  window.location.pathname === "/" &&
  root.dataset.prerendered === "true" &&
  !confirmation.code &&
  !confirmation.invalid
)
  hydrateRoot(root, app);
else createRoot(root).render(app);
