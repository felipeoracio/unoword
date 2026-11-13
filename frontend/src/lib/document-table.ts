import { Table, TableRow, TableCell, TableHeader, TableView, createTable } from "@tiptap/extension-table";
import { Extension, type Editor, type Attributes } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { TableMap, selectedRect } from "@tiptap/pm/tables";
import { closeHistory } from "@tiptap/pm/history";

class AccessibleTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args);
    this.dom.setAttribute("role", "region"); this.dom.setAttribute("aria-label", "Document table"); this.dom.tabIndex = 0;
  }
}
export const DocumentTable = Table.configure({ resizable: true, cellMinWidth: 80, lastColumnResizable: false, allowTableNodeSelection: true, View: AccessibleTableView });
export const DocumentTableRow = TableRow;
function boundedCellAttributes(base: Attributes): Attributes {
  const span = (value: string | null, max: number) => Math.max(1, Math.min(max, Number.parseInt(value || "1", 10) || 1));
  return { ...base,
    colspan: { ...base.colspan, parseHTML: element => span(element.getAttribute("colspan"), 20) },
    rowspan: { ...base.rowspan, parseHTML: element => span(element.getAttribute("rowspan"), 100) },
    colwidth: { ...base.colwidth, parseHTML: element => {
      if ((element.getAttribute("colwidth") || "").length > 200) return null;
      const widths = base.colwidth?.parseHTML?.(element);
      if (!Array.isArray(widths) || widths.length !== span(element.getAttribute("colspan"), 20)) return null;
      return widths.map(value => Number.isFinite(value) ? value === 0 ? 0 : Math.max(80, Math.min(1600, Math.round(value))) : 0);
    } },
  };
}
export const DocumentTableCell = TableCell.extend({ addAttributes() { return boundedCellAttributes(this.parent?.() || {}); } });
export const DocumentTableHeader = TableHeader.extend({ addAttributes() { return boundedCellAttributes(this.parent?.() || {}); } }).configure({ HTMLAttributes: { scope: "col" } });
export const TableLimits = Extension.create({
  name: "tableLimits",
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged) return true;
      let valid = true;
      tr.doc.descendants(node => {
        if (node.type.name !== "table") return;
        // Bound raw spans before TableMap allocates a rectangular grid. This
        // also protects rich clipboard input, rather than relying on save validation.
        if (node.childCount > 100) { valid = false; return false; }
        node.forEach((row, _offset, rowIndex) => {
          let width = 0;
          row.forEach(cell => {
            const { colspan, rowspan, colwidth } = cell.attrs;
            if (!Number.isInteger(colspan) || colspan < 1 || colspan > 20 || !Number.isInteger(rowspan) || rowspan < 1 || rowspan > node.childCount - rowIndex) valid = false;
            width += colspan;
            if (colwidth && (!Array.isArray(colwidth) || colwidth.length !== colspan || colwidth.some((value: number) => !Number.isInteger(value) || (value !== 0 && (value < 80 || value > 1600))))) valid = false;
          });
          if (width > 20) valid = false;
        });
        if (!valid) return false;
        const map = TableMap.get(node);
        if (map.width > 20 || map.height > 100) valid = false;
        node.descendants(child => { if (child.type.name === "table") valid = false; });
        return false;
      });
      return valid;
    },
  })],
});
export function tableSize(editor: Editor) {
  if (!editor.isActive("table")) return null;
  try { const rect = selectedRect(editor.state); return { rows: rect.map.height, columns: rect.map.width }; }
  catch { return null; }
}
export function setColumnWidth(editor: Editor, width: number) {
  if (!editor.isActive("table") || !Number.isFinite(width)) return false;
  let rect: ReturnType<typeof selectedRect>;
  try { rect = selectedRect(editor.state); } catch { return false; }
  const { map, tableStart, table, left } = rect;
  const tr = closeHistory(editor.state.tr), seen = new Set<number>();
  width = Math.round(Math.max(80, Math.min(1600, width)));
  for (let row = 0; row < map.height; row++) {
    const offset = map.map[row * map.width + left];
    if (seen.has(offset)) continue; seen.add(offset);
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const firstColumn = map.findCell(offset).left;
    const colwidth = cell.attrs.colwidth ? [...cell.attrs.colwidth] : Array(cell.attrs.colspan).fill(0);
    colwidth[left - firstColumn] = width;
    tr.setNodeMarkup(tableStart + offset, undefined, { ...cell.attrs, colwidth });
  }
  editor.view.dispatch(tr); editor.view.focus(); return true;
}

export function insertDocumentTable(editor: Editor, rows: number, columns: number) {
  const { $to } = editor.state.selection;
  const insertion = $to.depth > 0 && $to.parent.isTextblock ? $to.after($to.depth) : editor.state.selection.to;
  const table = createTable(editor.schema, rows, columns, true);
  const tr = closeHistory(editor.state.tr).insert(insertion, table).setMeta("unoPreserveCredit", true);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertion + 1))).scrollIntoView();
  editor.view.dispatch(tr); editor.view.focus(); return true;
}
