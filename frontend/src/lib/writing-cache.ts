/** IndexedDB stores private drafts by account AND tab so concurrent offline tabs
 * cannot overwrite one another. No credentials or AI requests are cached. */
import type { Draft, WritingDocument, Activity, Folder } from "./writing";
type Entry = { key: string; owner: string; kind: string; value: unknown };
let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  return (opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("uno-word-writing", 1);
    request.onupgradeneeded = () =>
      request.result
        .createObjectStore("records", { keyPath: "key" })
        .createIndex("owner", "owner");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  }));
}
export async function cachePut(
  owner: string,
  kind: string,
  id: string,
  value: unknown,
): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    const record = {
      key: `${owner}:${kind}:${id}`,
      owner,
      kind,
      value,
    } satisfies Entry;
    const store = tx.objectStore("records");
    const read = store.get(record.key);
    read.onsuccess = () => {
      const existing = read.result?.value;
      const incoming = value as {
        revision?: number;
        sequence?: number;
        dirty?: boolean;
      };
      if (kind === "document" && existing?.revision > Number(incoming.revision))
        return;
      if (kind === "activity" && existing?.sequence > Number(incoming.sequence))
        return;
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function cacheDelete(
  owner: string,
  kind: string,
  id: string,
): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").delete(`${owner}:${kind}:${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function cacheDeleteIfMutation(
  owner: string,
  kind: string,
  id: string,
  mutation: string,
): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite"),
      store = tx.objectStore("records"),
      key = `${owner}:${kind}:${id}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.value?.mutation_id === mutation) store.delete(key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function cachedRecords(owner: string): Promise<Entry[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("records")
      .objectStore("records")
      .index("owner")
      .getAll(owner);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadWritingCache(
  owner: string,
  tab: string,
  predecessor: string | null = null,
) {
  const records = await cachedRecords(owner);
  const documents = records
    .filter((e) => e.kind === "document")
    .map((e) => e.value as WritingDocument);
  const drafts = records
    .filter((e) => e.kind === "draft")
    .map((e) => e.value as Draft);
  const merged = new Map(
    documents.map((d) => [d.id, { ...d, dirty: false, tab_id: tab }]),
  );
  const currentIds = new Set(
    drafts.filter((d) => d.tab_id === tab).map((d) => d.id),
  );
  const adopted = drafts
    .filter(
      (d) =>
        d.tab_id === predecessor && d.tab_id !== tab && !currentIds.has(d.id),
    )
    .map((d) => ({ ...d, tab_id: tab }));
  adopted.forEach((d) => merged.set(d.id, d));
  drafts.filter((d) => d.tab_id === tab).forEach((d) => merged.set(d.id, d));
  const activity = new Map<string, Activity>(
    (
      (records.find((record) => record.kind === "activity_index")?.value ||
        []) as Activity[]
    ).map((row) => [row.id, row]),
  );
  records
    .filter((record) => record.kind === "activity")
    .forEach((record) => {
      const row = record.value as Activity,
        previous = activity.get(row.id);
      if (!previous || row.dirty || row.sequence >= previous.sequence)
        activity.set(row.id, row);
    });
  return {
    folders: [
      ...new Map(
        [
          ...((records.find((record) => record.kind === "folders")?.value ||
            []) as Folder[]),
          ...records
            .filter((record) => record.kind === "folder")
            .map((record) => record.value as Folder),
        ].map((folder) => [folder.id, folder]),
      ).values(),
    ],
    documents: [...merged.values()],
    recovery: drafts.filter(
      (d) => d.tab_id !== tab && d.tab_id !== predecessor && d.dirty,
    ),
    adopted,
    activities: [...activity.values()],
  };
}
