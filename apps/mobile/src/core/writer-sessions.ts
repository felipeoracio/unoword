import type { Repository } from "./repository";
import type { Activity, Timer } from "./types";
import {
  newActivity,
  checkpoint,
  transition,
  restoreActivity,
  applyInput,
  crossesDay,
} from "./session";
/** Only this device's session is controlled locally; account totals stay server-owned. */
export class WriterSessions {
  active: Activity | null = null;
  constructor(
    readonly repo: Repository,
    readonly device: string,
    readonly uuid: () => string,
  ) {}
  async restore() {
    const row = this.repo.activities.find(
      (a) => a.device_id === this.device && a.timer.status !== "ended",
    );
    if (row) {
      this.active = restoreActivity(row);
      await this.repo.putActivity(this.active);
    }
  }
  async start(documentId: string, now = Date.now()) {
    if (
      this.active &&
      this.active.document_id === documentId &&
      this.active.timer.status !== "ended"
    )
      return this.active;
    if (this.active && this.active.timer.status !== "ended")
      await this.change("ended", now);
    this.active = newActivity(documentId, this.device, this.uuid, now);
    await this.repo.putActivity(this.active);
    return this.active;
  }
  async change(status: Timer["status"], now = Date.now()) {
    if (!this.active) return;
    this.active = transition(this.active, status, now);
    await this.repo.putActivity(this.active);
  }
  async tick(now = Date.now()) {
    if (!this.active || this.active.timer.status === "ended") return;
    this.active = checkpoint(this.active, now);
    await this.repo.putActivity(this.active);
  }
  async input(
    documentId: string,
    before: string,
    after: string,
    inputType: string,
    now = Date.now(),
  ) {
    if (
      !this.active ||
      this.active.document_id !== documentId ||
      this.active.timer.status !== "active"
    )
      return;
    if (
      crossesDay(
        this.active,
        this.repo.preferences?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "UTC",
        now,
      )
    ) {
      await this.change("ended", now);
      await this.start(documentId, now);
    }
    this.active = applyInput(
      checkpoint(this.active!, now),
      before,
      after,
      inputType,
      now,
    );
    await this.repo.putActivity(this.active);
  }
}
