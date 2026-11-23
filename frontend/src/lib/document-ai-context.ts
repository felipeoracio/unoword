import type { WritingDocument } from "./writing";

/** Mirrors the server's target boundary. Persistent opt-in and one-request
 * consent remain separate; neither can silently change the chosen project. */
export function documentContextIncludesProject(document: Pick<WritingDocument, "ai_context_all_projects" | "ai_context_project_ids">, project: string | null, legacyMemberships: string[]) {
  if (document.ai_context_all_projects) return true;
  const ids = document.ai_context_project_ids ?? legacyMemberships;
  return project ? ids.includes(project) : ids.length === 0;
}
