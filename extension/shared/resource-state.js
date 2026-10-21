/** A title/URL or a database "ready" flag alone is not proof of an AI index. */
(function attach(scope) {
  function websiteStatus(link) {
    if (link.enabled === false) return 'disabled';
    if (['pending', 'processing'].includes(link.processing_status)) return 'processing';
    if (link.processing_status === 'failed') return 'failed';
    return link.processing_status === 'ready' && link.word_count > 0 && link.chunk_count > 0 &&
      link.indexing_status === 'indexed' ? 'ready' : 'not_indexed';
  }
  function publicWebUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch (_error) { return null; }
  }
  const api = { websiteStatus, publicWebUrl };
  scope.WCResourceState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
