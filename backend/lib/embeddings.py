"""OpenAI embeddings service for UnoWord's private-per-user RAG pipeline.

All calls run server-side. The API key never leaves FastAPI, and callers pass
already-authorised text (a user's own document chunk, saved writing chunk, or
memory) or a query. The embedding model and version stamped on each vector let
future model swaps be identified and backfilled selectively.
"""

from __future__ import annotations

import hashlib
import logging
import os
from collections import OrderedDict
from dataclasses import dataclass

from openai import AsyncOpenAI, OpenAIError
from lib.ai_quota import record_provider_call
from types import SimpleNamespace

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBED_MODEL = "text-embedding-3-small"
DEFAULT_EMBED_VERSION = "v1"


@dataclass(frozen=True)
class EmbeddingResult:
    embedding: list[float]
    model: str
    version: str


class EmbeddingsService:
    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        version: str = DEFAULT_EMBED_VERSION,
        cache_size: int = 512,
    ) -> None:
        self._model = model
        self._version = version
        self._client: AsyncOpenAI | None = AsyncOpenAI(api_key=api_key) if api_key else None
        # Bounded LRU so we never pay to embed identical text twice (e.g. the
        # same suggestion query or a re-processed chunk). Cleared on restart.
        self._cache: "OrderedDict[str, list[float]]" = OrderedDict()
        self._cache_size = max(0, cache_size)
        self.cache_hits = 0
        self.cache_misses = 0

    def _cache_key(self, value: str) -> str:
        return f"{self._model}:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"

    @property
    def enabled(self) -> bool:
        return self._client is not None

    @property
    def model(self) -> str:
        return self._model

    @property
    def version(self) -> str:
        return self._version

    async def embed(self, text: str) -> EmbeddingResult | None:
        if not self._client:
            return None
        value = (text or "").strip()
        if not value:
            return None
        value = value[:8000]
        key = self._cache_key(value)
        if self._cache_size and key in self._cache:
            self._cache.move_to_end(key)
            self.cache_hits += 1
            return EmbeddingResult(
                embedding=list(self._cache[key]), model=self._model, version=self._version
            )
        try:
            response = await self._client.embeddings.create(
                model=self._model,
                input=value,
                encoding_format="float",
            )
        except OpenAIError as error:
            await record_provider_call(self._model, status="failed")
            logger.warning("embedding_failed model=%s error=%s", self._model, error)
            return None
        await record_provider_call(self._model, SimpleNamespace(input_tokens=getattr(getattr(response, "usage", None), "prompt_tokens", None), output_tokens=0))
        vector = response.data[0].embedding
        if len(vector) != EMBEDDING_DIMENSIONS:
            logger.error(
                "embedding_dimension_mismatch expected=%d got=%d model=%s",
                EMBEDDING_DIMENSIONS,
                len(vector),
                self._model,
            )
            return None
        self.cache_misses += 1
        if self._cache_size:
            self._cache[key] = list(vector)
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return EmbeddingResult(embedding=list(vector), model=self._model, version=self._version)

    async def embed_many(self, texts: list[str]) -> list[EmbeddingResult | None]:
        """Batch bounded inputs in one provider call, preserving order and cache."""
        if len(texts) > 32:
            raise ValueError("Embedding batches are limited to 32 passages")
        values = [(text or "").strip()[:8000] for text in texts]
        results: list[EmbeddingResult | None] = [None] * len(values)
        missing: dict[str, str] = {}
        for index, value in enumerate(values):
            if not value or not self._client:
                continue
            key = self._cache_key(value)
            if key in self._cache:
                self._cache.move_to_end(key)
                self.cache_hits += 1
                results[index] = EmbeddingResult(list(self._cache[key]), self._model, self._version)
            else:
                missing[key] = value
        if not missing:
            return results
        try:
            response = await self._client.embeddings.create(
                model=self._model, input=list(missing.values()), encoding_format="float", timeout=25.0,
            )
            await record_provider_call(self._model, SimpleNamespace(input_tokens=getattr(getattr(response, "usage", None), "prompt_tokens", None), output_tokens=0))
            by_index = {item.index: item.embedding for item in response.data}
            if set(by_index) != set(range(len(missing))) or any(len(v) != EMBEDDING_DIMENSIONS for v in by_index.values()):
                return results
        except OpenAIError:
            await record_provider_call(self._model, status="failed")
            logger.warning("embedding_batch_failed model=%s", self._model)
            return results
        vectors = dict(zip(missing, (by_index[i] for i in range(len(missing)))))
        for index, value in enumerate(values):
            if results[index] is None and value and self._cache_key(value) in vectors:
                vector = vectors[self._cache_key(value)]
                results[index] = EmbeddingResult(list(vector), self._model, self._version)
        self.cache_misses += len(missing)
        if self._cache_size:
            for key, vector in vectors.items():
                self._cache[key] = list(vector)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return results


_service: EmbeddingsService | None = None
_service_key: str | None = None
_service_model: str | None = None


def get_embeddings_service() -> EmbeddingsService:
    """Resolve the embeddings service from the centralized OpenAI config.

    Rebuilt when the resolved key or model changes so a newly-saved admin key is
    used for subsequent embedding calls without a redeploy. With no key the
    service is disabled (``embed`` returns None) and retrieval still works over
    any pre-existing vectors.
    """
    global _service, _service_key, _service_model
    from lib import openai_config

    api_key, _source = openai_config.resolve_openai_key()
    model = openai_config.get_embed_model()
    if _service is None or _service_key != api_key or _service_model != model:
        _service = EmbeddingsService(
            api_key=api_key or None,
            model=model,
            cache_size=int(os.environ.get("AI_EMBED_CACHE_SIZE", "512")),
        )
        _service_key, _service_model = api_key, model
    return _service
