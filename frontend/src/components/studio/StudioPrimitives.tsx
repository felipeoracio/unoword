import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StudioButton({ className, size, ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} size={size} data-studio-size={size} className={cn("uw-studio-button", className)} />;
}

export function StudioCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card {...props} className={cn("uw-studio-card", className)} />;
}

export function StudioPageHeader({ title, description, eyebrow, actions }: {
  title: string; description?: string; eyebrow?: string; actions?: ReactNode;
}) {
  return <header className="uw-studio-page-header">
    <div>
      {eyebrow && <p className="uw-studio-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="uw-studio-page-actions">{actions}</div>}
  </header>;
}

// Callers supply a confirmed status. Connectivity alone must never mean "Synced".
export function StudioStatus({ children, tone = "neutral" }: {
  children: ReactNode; tone?: "neutral" | "success" | "pending" | "error";
}) {
  return <span className="uw-studio-status" data-tone={tone} role="status" aria-live="polite">
    <span aria-hidden="true" />{children}
  </span>;
}
