import { Link } from "react-router-dom";
export default function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      className={`uw-brand${light ? " uw-brand-light" : ""}`}
      aria-label="Uno Word home"
    >
      <img src="/brand/unoword.svg" alt="" width="36" height="36" />
      <span>
        Uno Word<span className="uw-brand-dot">.</span>
      </span>
    </Link>
  );
}
