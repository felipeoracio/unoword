import { Link } from "react-router-dom";
export default function Brand({
  light = false,
  joined = false,
}: {
  light?: boolean;
  joined?: boolean;
}) {
  return (
    <Link
      to="/"
      className={`uw-brand${light ? " uw-brand-light" : ""}`}
      aria-label={`${joined ? "UnoWord" : "Uno Word"} home`}
    >
      <img src="/brand/unoword.svg" alt="" width="36" height="36" />
      <span>
        {joined ? (
          "UnoWord"
        ) : (
          <>
            Uno Word<span className="uw-brand-dot">.</span>
          </>
        )}
      </span>
    </Link>
  );
}
