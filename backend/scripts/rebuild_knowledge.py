"""Repair existing private sources: re-chunk oversized chunks, embed rows that
were stored without vectors, and build any missing per-source writing memory.

Run: cd /app/backend && python scripts/rebuild_knowledge.py
"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

from lib import knowledge  # noqa: E402
from lib.supabase_client import service_rest  # noqa: E402


async def main() -> None:
    docs = await service_rest(
        "GET", "ai_documents",
        params={"select": "id,user_id,document_title,source_kind,source_url,filename,file_type",
                "processing_status": "eq.ready"},
    )
    users: set[str] = set()
    for doc in docs or []:
        uid, did = doc["user_id"], doc["id"]
        users.add(uid)
        chunks = await service_rest(
            "GET", "ai_document_chunks",
            params={"select": "content,chunk_index", "document_id": f"eq.{did}", "order": "chunk_index.asc"},
        )
        text = "\n".join(c["content"] for c in chunks or [])
        if not text:
            continue
        if any(len(c["content"]) > knowledge.CHUNK_CHARS for c in chunks):
            meta = ({"source": "link", "url": doc.get("source_url"), "title": doc["document_title"]}
                    if doc["source_kind"] == "link"
                    else {"filename": doc["filename"], "file_type": doc["file_type"]})
            count, embedded = await knowledge.index_source(uid, None, did, text, meta)
            print(f"rechunked {did}: {count} chunks, {embedded} embedded")
        memories = await service_rest(
            "GET", "ai_memories", params={"select": "id", "user_id": f"eq.{uid}", "source_id": f"eq.{did}"},
        )
        if not memories:
            kind = "saved link" if doc["source_kind"] == "link" else "document"
            await knowledge.rebuild_source_memory(uid, None, did, title=doc["document_title"], text=text, kind=kind)
            print(f"memory built for {did}")
    for uid in users:
        while healed := await knowledge.heal_missing_embeddings(uid, limit=50):
            print(f"healed {healed} rows for {uid}")
    print("done")


asyncio.run(main())
