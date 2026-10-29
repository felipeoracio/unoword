import { useState } from "react";
import { apiGet } from "@/lib/api";
export default function WritingRecovery({ owner }: { owner: string }) {
  const [rows, setRows] = useState<
      { id: string; title: string; updated_at: string }[]
    >([]),
    [error, setError] = useState(""),
    [opened, setOpened] = useState(false),
    [offset, setOffset] = useState(0);
  async function load(next: number) {
    try {
      const value = await apiGet<typeof rows>(
        "/workspace/recovery/index?offset=" + next,
      );
      setRows(value);
      setOffset(next);
      setOpened(true);
    } catch {
      setError(
        "Saved writing is preserved. Connect and sign in again to retrieve it.",
      );
    }
  }
  return (
    <section className="uw-ai-usage" key={owner}>
      <h2>Your saved writing stays yours.</h2>
      <p>
        Editing and organizing require Pro. You can still download your existing
        documents. Downgrading never deletes them.
      </p>
      <button type="button" onClick={() => void load(0)}>
        Retrieve saved writing
      </button>
      {error && <p role="alert">{error}</p>}
      {opened && (
        <>
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <strong>{row.title}</strong> ·{" "}
                {new Date(row.updated_at).toLocaleDateString()}{" "}
                <a href={`/api/workspace/recovery/${row.id}/export/txt`}>
                  Download TXT
                </a>{" "}
                ·{" "}
                <a href={`/api/workspace/recovery/${row.id}/export/docx`}>
                  Download Word
                </a>
              </li>
            ))}
          </ul>
          {!rows.length && (
            <p>
              No cloud documents on this account. Local drafts are preserved in
              this browser.
            </p>
          )}
          <div>
            {offset > 0 && (
              <button onClick={() => void load(Math.max(0, offset - 100))}>
                Previous
              </button>
            )}
            {rows.length === 100 && (
              <button onClick={() => void load(offset + 100)}>
                Next documents
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
