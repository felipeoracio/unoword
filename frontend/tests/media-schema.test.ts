import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocumentImage } from "../src/lib/document-image";
import { DocumentTable, DocumentTableRow, DocumentTableCell, DocumentTableHeader } from "../src/lib/document-table";
it("uses paragraphs as default blocks in documents and table cells", () => {
  const schema = getSchema([StarterKit, DocumentImage, DocumentTable, DocumentTableRow, DocumentTableCell, DocumentTableHeader]);
  expect(schema.nodes.doc.contentMatch.defaultType?.name).toBe("paragraph");
  expect(schema.nodes.tableCell.contentMatch.defaultType?.name).toBe("paragraph");
  expect(schema.nodes.tableHeader.contentMatch.defaultType?.name).toBe("paragraph");
  const old = schema.nodeFromJSON({type:"doc",content:[{type:"image",attrs:{src:"data:image/png;base64,AA==",width:800,height:400,alt:"Legacy picture"}}]});
  expect(old.firstChild?.type.name).toBe("image");
  expect(old.firstChild?.content.size).toBe(0);
  expect(old.firstChild?.attrs.displayMode).toBe("auto");
});
