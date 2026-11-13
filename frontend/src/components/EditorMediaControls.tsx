import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { FormattingPanel } from "./EditorFormatting";
import { formatChain } from "@/lib/document-formatting";
import { selectedImage } from "@/lib/selected-image";
import { prepareDocumentImage, imageDocumentFits } from "@/lib/document-image";
import { setColumnWidth, tableSize, insertDocumentTable } from "@/lib/document-table";

export function ImageControls({ editor, disabled, documentId, spanish = false }: { editor: Editor; disabled: boolean; documentId: string; spanish?: boolean }) {
  const image = selectedImage(editor), input = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState("");
  const [width, setWidth] = useState(560), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const owner = useRef(documentId), request = useRef(0); owner.current = documentId;
  const tr = (en: string, es: string) => spanish ? es : en;
  const invalidate = useCallback(() => { request.current++; }, []);
  useEffect(() => { setAlt(image?.node.attrs.alt || ""); }, [image?.pos, image?.node.attrs.alt]);
  useEffect(() => { setWidth(image?.node.attrs.displayWidth || Math.min(image?.node.attrs.width || 560, 560)); }, [image?.pos, image?.node.attrs.displayWidth, image?.node.attrs.width]);
  useEffect(() => { invalidate(); setBusy(false); setError(""); return invalidate; }, [documentId, invalidate]);
  function update(attrs: Record<string, unknown>) {
    const target = selectedImage(editor);
    if (!target || disabled || !editor.isEditable) return;
    editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...attrs }));
  }
  async function replace(file: File) {
    const target = selectedImage(editor);
    if (!target || disabled || !editor.isEditable) return;
    const source = target.node.attrs.src, identity = documentId, ticket = ++request.current;
    let bookmark = NodeSelection.create(editor.state.doc, target.pos).getBookmark();
    const map = ({ transaction }: { transaction: Transaction }) => { bookmark = bookmark.map(transaction.mapping); };
    editor.on("transaction", map); setBusy(true); setError("");
    try {
      const prepared = await prepareDocumentImage(file);
      if (ticket !== request.current || owner.current !== identity || editor.isDestroyed || !editor.isEditable) return;
      const selection = bookmark.resolve(editor.state.doc);
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image" || selection.node.attrs.src !== source) throw Error("changed");
      const transaction = closeHistory(editor.state.tr).setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...prepared });
      if (!imageDocumentFits(transaction.doc.toJSON())) throw Error("large");
      editor.view.dispatch(transaction); editor.view.focus();
    } catch { if (ticket === request.current) setError(tr("Image could not be replaced. Choose a PNG, JPEG or WebP under 10 MB.", "No se pudo reemplazar la imagen. Elige PNG, JPEG o WebP de menos de 10 MB.")); }
    finally { editor.off("transaction", map); if (ticket === request.current) setBusy(false); }
  }
  if (!image) return null;
  return <FormattingPanel label={tr("Image", "Imagen")} disabled={disabled} documentId={documentId}>
    <h3>{tr("Image layout", "Diseño de imagen")}</h3>
    <label className="uw-format-field"><span>{tr("Image description", "Descripción de imagen")}</span><input type="text" aria-label={tr("Image description", "Descripción de imagen")} maxLength={500} value={alt} onChange={e => setAlt(e.target.value)} onBlur={() => { if (alt !== image.node.attrs.alt) update({ alt }); }} /></label>
    <label className="uw-format-field"><span>{tr("Image alignment", "Alineación de imagen")}</span><select aria-label={tr("Image alignment", "Alineación de imagen")} value={image.node.attrs.align || "center"} onChange={e => update({ align: e.target.value })}>
      <option value="left">{tr("Left", "Izquierda")}</option><option value="center">{tr("Center", "Centro")}</option><option value="right">{tr("Right", "Derecha")}</option>
    </select></label>
    <label className="uw-format-field"><span>{tr("Image size", "Tamaño de imagen")}</span><select aria-label={tr("Image size", "Tamaño de imagen")} value={image.node.attrs.displayMode || "auto"} onChange={e => update({ displayMode: e.target.value, ...(e.target.value === "custom" ? { displayWidth: width } : {}) })}>
      <option value="auto">{tr("Comfortable", "Cómodo")}</option><option value="original">{tr("Original size", "Tamaño original")}</option><option value="fit">{tr("Fit to page", "Ajustar a la página")}</option><option value="custom">{tr("Custom width", "Ancho personalizado")}</option>
    </select></label>
    <form className="uw-image-width" onSubmit={e => { e.preventDefault(); if (Number.isFinite(width) && width >= 80 && width <= 1600) update({ displayMode: "custom", displayWidth: width }); }}>
      <label className="uw-format-field"><span>{tr("Width (px)", "Ancho (px)")}</span><input aria-label={tr("Image width", "Ancho de imagen")} type="number" min={80} max={1600} step={1} value={width} onChange={e => setWidth(e.target.valueAsNumber)} required /></label>
      <button type="submit" className="uw-format-action">{tr("Apply size", "Aplicar tamaño")}</button>
    </form>
    <p>{tr("Aspect ratio stays locked. Images stay on their own line.", "Se conserva la proporción. La imagen ocupa su propia línea.")}</p>
    <div className="uw-media-actions">
      <button type="button" className="uw-format-action" onClick={() => { const target = selectedImage(editor); if (!target) return; formatChain(editor).setNodeSelection(target.pos).updateAttributes("image", { captionVisible: true }).setTextSelection(target.pos + 1 + target.node.content.size).run(); document.querySelectorAll<HTMLElement>('.uw-format-panel:popover-open').forEach(panel => panel.hidePopover()); }}>{image.node.content.size ? tr("Edit caption", "Editar pie") : tr("Add caption", "Añadir pie")}</button>
      <button type="button" className="uw-format-action" disabled={busy} onClick={() => input.current?.click()}>{busy ? tr("Preparing…", "Preparando…") : tr("Replace image", "Reemplazar imagen")}</button>
      <button type="button" className="uw-format-action" onClick={() => { const target = selectedImage(editor); if (target) formatChain(editor).setNodeSelection(target.pos).deleteSelection().run(); }}>{tr("Delete image", "Eliminar imagen")}</button>
    </div>
    <input className="uw-sr-only" type="file" ref={input} aria-label={tr("Replacement image file", "Archivo de reemplazo")} accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void replace(file); e.target.value = ""; }} />
    {error && <p role="alert">{error}</p>}
  </FormattingPanel>;
}

export function TableControls({ editor, disabled, documentId, spanish = false }: { editor: Editor; disabled: boolean; documentId: string; spanish?: boolean }) {
  const [rows, setRows] = useState(3), [columns, setColumns] = useState(3), [width, setWidth] = useState(160);
  const tableChain = () => formatChain(editor).command(({ tr }) => { tr.setMeta("unoPreserveCredit", true); return true; });
  const tr = (en: string, es: string) => spanish ? es : en, size = tableSize(editor);
  const actions = [
    ["Add row above", "Añadir fila arriba", () => tableChain().addRowBefore().run(), !size || size.rows >= 100],
    ["Add row below", "Añadir fila abajo", () => tableChain().addRowAfter().run(), !size || size.rows >= 100],
    ["Add column before", "Añadir columna antes", () => tableChain().addColumnBefore().run(), !size || size.columns >= 20],
    ["Add column after", "Añadir columna después", () => tableChain().addColumnAfter().run(), !size || size.columns >= 20],
    ["Delete row", "Eliminar fila", () => tableChain().deleteRow().run(), !size],
    ["Delete column", "Eliminar columna", () => tableChain().deleteColumn().run(), !size],
    ["Merge cells", "Combinar celdas", () => tableChain().mergeCells().run(), !size || !editor.can().mergeCells()],
    ["Split cell", "Dividir celda", () => tableChain().splitCell().run(), !size || !editor.can().splitCell()],
    ["Toggle header row", "Alternar encabezados", () => tableChain().toggleHeaderRow().run(), !size],
    ["Delete table", "Eliminar tabla", () => tableChain().deleteTable().run(), !size],
  ] as const;
  return <FormattingPanel label={tr("Table", "Tabla")} disabled={disabled} documentId={documentId}>
    <h3>{size ? tr("Edit table", "Editar tabla") : tr("Insert table", "Insertar tabla")}</h3>
    {!size ? <form onSubmit={e => { e.preventDefault(); if (Number.isInteger(rows) && rows >= 1 && rows <= 100 && Number.isInteger(columns) && columns >= 1 && columns <= 20) insertDocumentTable(editor, rows, columns); }}>
      <label className="uw-format-field"><span>{tr("Rows", "Filas")}</span><input type="number" aria-label={tr("Table rows", "Filas de tabla")} min={1} max={100} value={rows} onChange={e => setRows(e.target.valueAsNumber)} required /></label>
      <label className="uw-format-field"><span>{tr("Columns", "Columnas")}</span><input type="number" aria-label={tr("Table columns", "Columnas de tabla")} min={1} max={20} value={columns} onChange={e => setColumns(e.target.valueAsNumber)} required /></label>
      <button className="uw-format-action" type="submit">{tr("Insert table", "Insertar tabla")}</button>
    </form> : <>
      <p>{size.rows} × {size.columns}</p>
      <div className="uw-table-actions">{actions.map(([en, es, run, unavailable]) => <button type="button" className="uw-format-action" key={en} disabled={unavailable} onClick={run}>{tr(en, es)}</button>)}</div>
      <label className="uw-format-field"><span>{tr("Cell alignment", "Alineación de celda")}</span><select aria-label={tr("Cell alignment", "Alineación de celda")} value={editor.getAttributes("paragraph").textAlign || editor.getAttributes("tableCell").align || editor.getAttributes("tableHeader").align || "left"} onChange={e => formatChain(editor).setTextAlign(e.target.value).run()}>
        {[['left','Left','Izquierda'],['center','Center','Centro'],['right','Right','Derecha'],['justify','Justify','Justificado']].map(([value,en,es]) => <option value={value} key={value}>{tr(en, es)}</option>)}
      </select></label>
      <form onSubmit={e => { e.preventDefault(); setColumnWidth(editor, width); }}>
        <label className="uw-format-field"><span>{tr("Column width (px)", "Ancho de columna (px)")}</span><input aria-label={tr("Column width", "Ancho de columna")} type="number" min={80} max={1600} value={width} onChange={e => setWidth(e.target.valueAsNumber)} required /></label>
        <button className="uw-format-action" type="submit">{tr("Apply column width", "Aplicar ancho de columna")}</button>
      </form>
    </>}
    <p>{tr("Tab moves between cells. Use Shift + click to select cells for merging.", "Tab recorre las celdas. Mayús + clic selecciona celdas para combinar.")}</p>
  </FormattingPanel>;
}
