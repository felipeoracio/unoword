import Lifetime from "./pages/Lifetime";
import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// Build-time public HTML only: no session, model, or private API is involved.
export function renderLanding() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={client}>
        <StaticRouter location="/">
          <App />
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The promotional route is public static content with the same Suspense boundary
// as App; authentication and billing still happen only in the existing account flow.
export function renderLifetime() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={client}>
        <StaticRouter location="/lifetime">
          <Suspense>
            <Lifetime />
          </Suspense>
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
