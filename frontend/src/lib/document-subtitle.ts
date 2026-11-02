import { Extension } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";

// Document metadata travels in the existing revisioned JSON, rather than being
// a paragraph in the writing canvas. It never contributes to body word counts.
export const DocumentSubtitle = Extension.create({
  name: "documentSubtitle",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: { subtitle: { default: null, rendered: false } },
      },
    ];
  },
});
export function documentSubtitle(content?: JSONContent): string {
  return typeof content?.attrs?.subtitle === "string"
    ? content.attrs.subtitle
    : "";
}
