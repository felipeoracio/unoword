import type { ComponentProps, ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export function StudioContainer({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div {...props} className={cn("uw-shared-container", className)} />;
}

export function StudioSectionHeading({
  id,
  title,
  description,
  eyebrow,
}: {
  id?: string;
  title: string;
  description?: string;
  eyebrow?: string;
}) {
  return (
    <header className="uw-shared-section-heading">
      {eyebrow && <p className="uw-studio-eyebrow">{eyebrow}</p>}
      <h2 id={id}>{title}</h2>
      {description && <p>{description}</p>}
    </header>
  );
}

export function StudioImage({
  className,
  alt,
  ...props
}: ComponentProps<"img"> & { alt: string }) {
  return (
    <img
      {...props}
      alt={alt}
      className={cn("uw-responsive-image", className)}
    />
  );
}

export function StudioAccordion({
  items,
}: {
  items: { question: string; answer: ReactNode }[];
}) {
  return (
    <div className="uw-shared-accordion">
      {items.map((item) => (
        <details key={item.question}>
          <summary>
            {item.question}
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div>{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

export function StudioButton({
  className,
  size,
  variant = "default",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      data-studio-size={size}
      data-studio-variant={variant}
      className={cn("uw-studio-button", className)}
    />
  );
}

/** Navigation keeps native link semantics, even when styled as a primary CTA. */
export function StudioLink({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Link
      {...props}
      data-studio-variant={variant}
      className={cn(buttonVariants({ variant }), "uw-studio-button", className)}
    />
  );
}

export function StudioCard({
  className,
  ...props
}: ComponentProps<typeof Card>) {
  return <Card {...props} className={cn("uw-studio-card", className)} />;
}

export function StudioPageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="uw-studio-page-header">
      <div>
        {eyebrow && <p className="uw-studio-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="uw-studio-page-actions">{actions}</div>}
    </header>
  );
}

// Callers supply a confirmed status. Connectivity alone must never mean "Synced".
export function StudioStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "pending" | "error";
}) {
  return (
    <span
      className="uw-studio-status"
      data-tone={tone}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
