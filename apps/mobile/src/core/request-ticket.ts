/** Freeze an uncertain request for exact replay after a lost network response. */
export class RequestTicket {
  private pending: { key: string; payload: Record<string, unknown> } | null =
    null;
  constructor(readonly uuid: () => string) {}
  prepare(payload: Record<string, any>) {
    const key = JSON.stringify({
      ...payload,
      writing_progress: payload.writing_progress
        ? { ...payload.writing_progress, captured_at: undefined }
        : undefined,
    });
    if (this.pending?.key !== key)
      this.pending = { key, payload: { ...payload, request_id: this.uuid() } };
    return this.pending.payload;
  }
  complete() {
    this.pending = null;
  }
}
