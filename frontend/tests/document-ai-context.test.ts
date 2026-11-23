import { expect, it } from "vitest";
import { documentContextIncludesProject as includes } from "../src/lib/document-ai-context";

it("retains legacy memberships until the writer explicitly chooses context projects", () => {
  expect(includes({}, "memoir", ["memoir"])).toBe(true);
  expect(includes({}, "blog", ["memoir"])).toBe(false);
  expect(includes({}, null, ["memoir"])).toBe(false);
  expect(includes({}, null, [])).toBe(true);
});
it("uses explicit context projects independently of document membership", () => {
  const doc = { ai_context_project_ids: ["blog"] };
  expect(includes(doc, "blog", ["memoir"])).toBe(true);
  expect(includes(doc, "memoir", ["memoir"])).toBe(false);
  expect(includes(doc, null, ["memoir"])).toBe(false);
  expect(includes({ ai_context_project_ids: [] }, null, ["memoir"])).toBe(true);
});
it("All projects includes future projects and General writing", () => {
  const doc = { ai_context_all_projects: true, ai_context_project_ids: ["memoir"] };
  expect(includes(doc, "new-project", [])).toBe(true);
  expect(includes(doc, null, [])).toBe(true);
});
