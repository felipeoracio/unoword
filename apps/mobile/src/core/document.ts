import type { JSONNode, Document } from "./types";
export const EMPTY: JSONNode = {
  type: "doc",
  attrs: { subtitle: null },
  content: [{ type: "paragraph" }],
};
export function bodyText(node: JSONNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return (node.content || [])
    .map(bodyText)
    .join(
      ["doc", "blockquote", "listItem", "bulletList", "orderedList"].includes(
        node.type,
      )
        ? "\n"
        : "",
    );
}
export function indexOf(doc: Document) {
  const {
    id,
    user_id,
    title,
    folder_id,
    favorite,
    status,
    completion_status,
    completed_at,
    ai_allowed,
    revision,
    mutation_id,
    created_at,
    updated_at,
  } = doc;
  return {
    id,
    user_id,
    title,
    folder_id,
    favorite,
    status,
    completion_status,
    completed_at,
    ai_allowed,
    revision,
    mutation_id,
    created_at,
    updated_at,
  };
}
export function canEdit(doc: Document) {
  return doc.status === "active" && doc.completion_status !== "completed";
}
export function documentToReopen(
  index: Pick<Document, "id" | "status" | "completion_status">[],
  previous: string | null,
) {
  // An explicitly completed last document never silently reopens another draft.
  if (!previous || previous === "__new__") return null;
  const doc = index.find((item) => item.id === previous);
  return doc?.status === "active" && doc.completion_status !== "completed"
    ? doc.id
    : null;
}
export function safeBody(content: JSONNode) {
  // Guard the native bridge. The backend still performs authoritative validation.
  const serialized = JSON.stringify(content).replace(
    /[\u0080-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  return (
    content?.type === "doc" &&
    serialized.length <= 930000 &&
    bodyText(content).length <= 200000
  );
}
