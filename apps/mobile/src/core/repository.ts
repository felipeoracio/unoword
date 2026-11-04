import { ApiError } from "./api";
import { EMPTY, bodyText, indexOf } from "./document";
import type {
  Store,
  Transport,
  Draft,
  Document,
  DocumentIndex,
  Folder,
  Activity,
  Summary,
  Preferences,
} from "./types";

/** Owner-scoped offline repository. Server revisions remain the authority. */
export class Repository {
  index: DocumentIndex[] = [];
  folders: Folder[] = [];
  activities: Activity[] = [];
  documents = new Map<string, Draft>();
  summary: Summary | null = null;
  preferences: Preferences | null = null;
  status = "Loading";
  diskError = false;
  private busy = false;
  private disk = Promise.resolve();
  private disposed = false;
  private deferred = new Map<string, Draft>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  constructor(
    readonly owner: string,
    readonly store: Store,
    readonly api: Transport,
    readonly uuid: () => string,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  notify() {
    if (!this.disposed) this.listeners.forEach((fn) => fn());
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
    void this.flush().catch(() => {});
  }
  private async write(key: string, value: unknown) {
    const work = this.disk
      .catch(() => {})
      .then(() => this.store.set(key, value));
    this.disk = work;
    try {
      await work;
      this.diskError = false;
    } catch (error) {
      this.diskError = true;
      this.status =
        "Device storage error — keep this app open and copy your writing";
      this.notify();
      throw error;
    }
  }
  private async persistDeferred() {
    const pending = new Map(this.deferred); // Snapshot before awaiting device writes.
    for (const [id, doc] of pending) {
      await this.write("document:" + id, doc);
      if (this.deferred.get(id)?.local_version === doc.local_version)
        this.deferred.delete(id);
    }
    await this.write("index", this.index);
  }
  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persistDeferred();
    await this.disk;
  }
  async load() {
    [
      this.index,
      this.folders,
      this.activities,
      this.summary,
      this.preferences,
    ] = await Promise.all([
      this.store.get<DocumentIndex[]>("index").then((x) => x || []),
      this.store.get<Folder[]>("folders").then((x) => x || []),
      this.store.get<Activity[]>("activities").then((x) => x || []),
      this.store.get<Summary>("summary"),
      this.store.get<Preferences>("preferences"),
    ]);
    this.status = this.index.some((d) => d.dirty)
      ? "Pending Sync"
      : "Offline cache";
    this.notify();
  }
  async getDocument(id: string): Promise<Draft | null> {
    if (this.documents.has(id)) return this.documents.get(id)!;
    const local = await this.store.get<Draft>("document:" + id);
    if (local?.user_id === this.owner) {
      this.documents.set(id, local);
      return local;
    }
    return null;
  }
  async open(id: string) {
    const local = await this.getDocument(id);
    if (local?.dirty) return local;
    try {
      const remote = await this.api<Document>(
        "GET",
        "/workspace/documents/" + id,
      );
      if (this.disposed) return local;
      // An edit made while this request was in flight always wins locally.
      const current = this.documents.get(id);
      if (current?.dirty) return current;
      const draft = {
        ...remote,
        dirty: false,
        local_version: current?.local_version || 0,
      };
      this.documents.set(id, draft);
      await this.write("document:" + id, draft);
      return draft;
    } catch (error) {
      if (
        local &&
        !(error instanceof ApiError && [401, 403, 404].includes(error.status))
      )
        return local;
      throw error;
    }
  }
  async create(
    title = "Untitled",
    content = structuredClone(EMPTY),
    folder_id: string | null = null,
  ) {
    const now = new Date().toISOString();
    const doc: Draft = {
      id: this.uuid(),
      user_id: this.owner,
      title,
      content,
      plain_text: bodyText(content),
      folder_id,
      favorite: false,
      status: "active",
      completion_status: "draft",
      completed_at: null,
      ai_allowed: false,
      revision: 0,
      mutation_id: this.uuid(),
      created_at: now,
      updated_at: now,
      dirty: true,
      local_version: 1,
    };
    await this.saveLocal(doc);
    return doc;
  }
  private async saveLocal(doc: Draft, defer = false) {
    this.documents.set(doc.id, doc);
    this.index = [
      { ...indexOf(doc), dirty: doc.dirty, conflict: !!doc.conflict },
      ...this.index.filter((d) => d.id !== doc.id),
    ];
    if (defer) {
      this.deferred.set(doc.id, doc);
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.persistDeferred().catch(() => {});
      }, 250);
    } else {
      await this.write("document:" + doc.id, doc);
      await this.write("index", this.index);
    }
    this.status = "Pending Sync";
    this.notify();
  }
  async edit(
    id: string,
    patch: Partial<
      Pick<
        Document,
        | "title"
        | "content"
        | "folder_id"
        | "favorite"
        | "status"
        | "completion_status"
        | "ai_allowed"
      >
    >,
  ) {
    const doc = this.documents.get(id) ?? (await this.getDocument(id));
    if (!doc) throw new Error("Document not cached");
    const next = {
      ...doc,
      ...patch,
      plain_text: patch.content ? bodyText(patch.content) : doc.plain_text,
      mutation_id: this.uuid(),
      local_version: doc.local_version + 1,
      dirty: true,
      updated_at: new Date().toISOString(),
    };
    await this.saveLocal(next, true);
    return next;
  }
  async createFolder(name: string) {
    if (!name.trim()) throw new Error("Enter a folder name.");
    const folder = {
      id: this.uuid(),
      user_id: this.owner,
      name: name.trim().slice(0, 100),
      dirty: true,
    };
    this.folders.push(folder);
    await this.write("folders", this.folders);
    this.status = "Pending Sync";
    this.notify();
    return folder;
  }
  async putActivity(row: Activity) {
    this.activities = [row, ...this.activities.filter((a) => a.id !== row.id)];
    await this.write("activities", this.activities);
    this.notify();
  }
  async setPreferences(
    patch: Partial<
      Pick<Preferences, "daily_goal" | "timezone" | "language" | "themes">
    >,
  ) {
    if (!this.preferences)
      throw new Error("Refresh your account settings first.");
    const previous = await this.store.get<{ revision: number; patch: object }>(
      "pending-preferences",
    );
    await this.write("pending-preferences", {
      revision: previous?.revision ?? this.preferences.revision,
      patch: { ...previous?.patch, ...patch },
    });
    this.preferences = { ...this.preferences, ...patch };
    this.status = "Pending Sync";
    this.notify();
  }
  private pending() {
    return (
      this.index.some((d) => d.dirty) ||
      this.folders.some((f) => f.dirty) ||
      this.activities.some((a) => a.dirty)
    );
  }
  async sync(paid: boolean) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.status = "Syncing";
    this.notify();
    let preferencesChanged = false;
    try {
      await this.flush();
      // Shared account preferences use CAS; no new mobile-only goal/timezone.
      const pending = await this.store.get<{ revision: number; patch: object }>(
        "pending-preferences",
      );
      let prefs = await this.api<Preferences>("GET", "/progress/preferences");
      if (pending) {
        try {
          prefs = await this.api<Preferences>("PUT", "/progress/preferences", {
            expected_user_id: this.owner,
            revision: pending.revision,
            ...pending.patch,
          });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
          preferencesChanged = true;
        }
        const latest = await this.store.get<unknown>("pending-preferences");
        if (JSON.stringify(latest) === JSON.stringify(pending))
          await this.store.remove("pending-preferences");
        prefs = await this.api<Preferences>("GET", "/progress/preferences");
      }
      this.preferences = prefs;
      await this.write("preferences", prefs);
      if (paid) {
        for (const folder of [...this.folders].filter((f) => f.dirty)) {
          await this.api("PUT", "/workspace/folders/" + folder.id, {
            expected_user_id: this.owner,
            name: folder.name,
          });
          folder.dirty = false;
          await this.write("folders", this.folders);
        }
        for (const item of [...this.index].filter((d) => d.dirty)) {
          const snapshot = await this.getDocument(item.id);
          if (!snapshot || snapshot.conflict) continue;
          const {
            revision,
            mutation_id,
            title,
            content,
            folder_id,
            favorite,
            status,
            completion_status,
            ai_allowed,
          } = snapshot;
          try {
            const saved = await this.api<Document>(
              "PUT",
              "/workspace/documents/" + item.id,
              {
                expected_user_id: this.owner,
                revision,
                mutation_id,
                title,
                content,
                folder_id,
                favorite,
                status,
                completion_status,
                ai_allowed,
              },
            );
            const current = this.documents.get(item.id)!;
            const next: Draft =
              current.local_version === snapshot.local_version
                ? {
                    ...saved,
                    dirty: false,
                    local_version: current.local_version,
                  }
                : { ...current, revision: saved.revision, dirty: true };
            if (
              this.deferred.get(item.id)?.local_version === next.local_version
            )
              this.deferred.set(item.id, next);
            this.documents.set(item.id, next);
            await this.write("document:" + item.id, next);
            this.index = this.index.map((d) =>
              d.id === item.id
                ? {
                    ...indexOf(next),
                    dirty: next.dirty,
                    conflict: !!next.conflict,
                  }
                : d,
            );
            await this.write("index", this.index);
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 409))
              throw error;
            const remote = await this.api<Document>(
              "GET",
              "/workspace/documents/" + item.id,
            );
            const current = this.documents.get(item.id)!;
            const next = { ...current, conflict: remote };
            if (
              this.deferred.get(item.id)?.local_version === next.local_version
            )
              this.deferred.set(item.id, next);
            this.documents.set(item.id, next);
            await this.write("document:" + item.id, next);
            this.index = this.index.map((d) =>
              d.id === item.id ? { ...d, conflict: true } : d,
            );
            await this.write("index", this.index);
          }
        }
        // Activity waits until its document has actually been confirmed by cloud.
        for (const row of [...this.activities].filter((a) => a.dirty)) {
          const doc = await this.getDocument(row.document_id);
          if (!doc || doc.revision === 0) continue;
          const { dirty: _d, last_input_at: _l, ...payload } = row;
          await this.api("PUT", "/workspace/activity", {
            expected_user_id: this.owner,
            ...payload,
          });
          this.activities = this.activities.map((current) =>
            current.id === row.id && current.sequence === row.sequence
              ? { ...current, dirty: false }
              : current,
          );
          await this.write("activities", this.activities);
        }
        const remote: DocumentIndex[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = await this.api<DocumentIndex[]>(
            "GET",
            "/workspace/documents?offset=" + offset,
          );
          remote.push(...page);
          if (page.length < 200) break;
        }
        const dirty = this.index.filter((d) => d.dirty);
        this.index = [
          ...dirty,
          ...remote.filter((d) => !dirty.some((local) => local.id === d.id)),
        ];
        await this.write("index", this.index);
        const folders = await this.api<Folder[]>("GET", "/workspace/folders");
        this.folders = [
          ...this.folders.filter((f) => f.dirty),
          ...folders.filter(
            (f) => !this.folders.some((p) => p.dirty && p.id === f.id),
          ),
        ];
        await this.write("folders", this.folders);
      }
      const summary = await this.api<Summary>(
        "GET",
        "/progress/summary?timezone=" +
          encodeURIComponent(
            prefs.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
          ),
      );
      if (summary.user_id !== this.owner) throw new Error("account_changed");
      this.summary = summary;
      await this.write("summary", summary);
      this.status = this.index.some((d) => d.conflict)
        ? "Sync conflict — both versions are preserved"
        : this.pending() || (await this.store.get("pending-preferences"))
          ? "Pending Sync"
          : preferencesChanged
            ? "Settings changed on another device — latest account settings kept"
            : "Synced";
    } catch (error) {
      if (!this.diskError)
        this.status =
          error instanceof ApiError && error.status === 401
            ? "Sign in again — local writing preserved"
            : error instanceof ApiError
              ? "Sync Error — changes preserved"
              : "Offline · Pending Sync";
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async resolveConflict(id: string) {
    const doc = await this.getDocument(id);
    if (!doc?.conflict) return null;
    // Never overwrite either version. Keep remote at its ID and local as a copy.
    const copy = await this.create(
      doc.title + " (recovered mobile copy)",
      doc.content,
      doc.folder_id,
    );
    this.deferred.delete(id);
    const remote = doc.conflict;
    const current = { ...remote, dirty: false, local_version: 0 };
    this.documents.set(id, current);
    await this.write("document:" + id, current);
    this.index = this.index.map((item) =>
      item.id === id ? indexOf(current) : item,
    );
    await this.write("index", this.index);
    this.notify();
    return copy;
  }
}
