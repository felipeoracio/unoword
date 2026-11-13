import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { FormattingPanel } from "./EditorFormatting";
import { searchKey, setSearch, navigateMatch, replaceMatches } from "@/lib/document-search";
import { documentOutline, documentStatistics, countWords, insertPageBreak, printLayout } from "@/lib/document-tools";
import { printHTML } from "@/lib/document-print";
import { closeHistory } from "@tiptap/pm/history";
import "@/styles/editor-writing-tools.css";

type Props = { editor: Editor; documentId: string; title: string; subtitle: string; focus: boolean; busy: boolean; spanish: boolean; onSave: () => Promise<unknown>; onFocus: () => void; onLink: () => void };
export default function EditorWritingTools(props: Props) {
  const { editor, documentId, focus, busy, spanish, title, subtitle } = props;
  const tr = (en: string, es: string) => spanish ? es : en;
  const [version, refresh] = useState(0), [searchOpen, openSearch] = useState(false), [outlineOpen, openOutline] = useState(false), [replaceOpen, openReplace] = useState(false);
  const [replacementError, setReplacementError] = useState("");
  const [query, changeQuery] = useState(""), [matchCase, changeCase] = useState(false), [replacement, changeReplacement] = useState("");
  const [modal, setModal] = useState<"stats" | "shortcuts" | "print" | null>(null), [printing, setPrinting] = useState(false), [printError, setPrintError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef(props); callbacks.current = props;
  useEffect(() => { const update = () => refresh(value => value + 1); editor.on("transaction", update); return () => { editor.off("transaction", update); }; }, [editor]);
  useEffect(() => {
    changeQuery(""); changeReplacement(""); setReplacementError(""); openSearch(false); openOutline(false); setModal(null); setSearch(editor, "", false);
  }, [editor, documentId]);
  useEffect(() => { if (focus || busy) { openSearch(false); setModal(null); } }, [focus, busy]);
  useEffect(() => { const resize = () => refresh(value => value + 1); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => { setSearch(editor, searchOpen ? query : "", matchCase); }, [editor, query, matchCase, searchOpen]);
  useEffect(() => { if (searchOpen) input.current?.focus(); }, [searchOpen, replaceOpen]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  function showSearch(replace: boolean) {
    const { from, to } = editor.state.selection, selected = editor.state.doc.textBetween(from, to);
    if (callbacks.current.focus) callbacks.current.onFocus();
    if (selected && selected.length <= 200) changeQuery(selected);
    openOutline(false); openReplace(replace); openSearch(true);
  }
  const showSearchRef = useRef(showSearch); showSearchRef.current = showSearch;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]') || callbacks.current.busy) return;
      const root = editor.view.dom.closest(".uw-editor");
      if (!root?.contains(event.target as globalThis.Node)) return;
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (mod && !event.altKey && key === "s") { event.preventDefault(); void callbacks.current.onSave(); }
      else if (mod && !event.altKey && (key === "f" || (key === "h" && !event.metaKey))) { event.preventDefault(); showSearchRef.current(key === "h" || event.shiftKey); }
      else if (mod && !event.altKey && key === "p") { event.preventDefault(); setModal("print"); }
      else if (mod && event.shiftKey && key === "l") { event.preventDefault(); callbacks.current.onFocus(); }
      else if (mod && !event.shiftKey && !event.altKey && key === "k" && editor.isEditable) { event.preventDefault(); callbacks.current.onLink(); }
      else if (event.key === "Escape" && !document.querySelector('[popover]:popover-open')) { openSearch(false); openOutline(false); }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [editor]);
  // Stats/outline are cached by immutable document identity, not every caret tick.
  const doc = editor.state.doc;
  const headings = useMemo(() => documentOutline(doc), [doc]);
  const stats = useMemo(() => documentStatistics(doc, 0, 0), [doc]);
  const selected = documentStatisticsSelection(editor);
  const search = searchKey.getState(editor.state)!;
  const root = editor.view.dom.closest<HTMLElement>(".uw-editor") || document.body;
  const toolbarBox = root.querySelector(".uw-editor-toolbar")?.getBoundingClientRect();
  const floatingStyle = { top: Math.min((toolbarBox?.bottom || 220) + 8, innerHeight - 160) };
  const layout = printLayout(doc.attrs.printLayout);
  const preview = useMemo(() => modal === "print" ? printHTML(editor.getHTML(), title, subtitle, doc.attrs) : "", [modal, editor, doc, title, subtitle]);
  function replace(all: boolean) {
    const applied = replaceMatches(editor, replacement, all);
    setReplacementError(applied ? "" : tr("Replacement exceeds the document limits. Use shorter text or replace fewer matches.", "El reemplazo supera los límites del documento. Usa menos texto o reemplaza menos coincidencias."));
  }
  function closeModal() { dialog.current?.close(); setModal(null); root.querySelector<HTMLButtonElement>(`button[aria-label="${spanish ? "Edición" : "Editing"}"]`)?.focus(); }
  function updatePrint(key: string, value: string) {
    if (!editor.isEditable) return;
    editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute("printLayout", { ...layout, [key]: value }));
  }
  async function print() {
    const target = frame.current?.contentWindow;
    if (!target) return;
    setPrinting(true); setPrintError("");
    try {
      await target.document.fonts.ready;
      await Promise.allSettled([...target.document.images].map(image => image.decode()));
      target.focus(); target.print();
    } catch { setPrintError(tr("Printing could not start. Try again when the preview has loaded.", "No se pudo imprimir. Inténtalo cuando cargue la vista previa.")); }
    finally { setPrinting(false); }
  }
  return <>
    <FormattingPanel label={tr("Editing", "Edición")} disabled={busy} documentId={documentId}>
      <h3>{tr("Writing tools", "Herramientas de escritura")}</h3>
      <div className="uw-writing-tool-actions" onClick={event => { (event.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover(); }}>
        <button type="button" onClick={() => showSearch(false)}>{tr("Find", "Buscar")}</button>
        <button type="button" onClick={() => showSearch(true)}>{tr("Find and replace", "Buscar y reemplazar")}</button>
        <button type="button" aria-pressed={outlineOpen} onClick={() => { openSearch(false); openOutline(!outlineOpen); }}>{tr("Document outline", "Esquema del documento")}</button>
        <button type="button" onClick={() => setModal("stats")}>{tr("Document statistics", "Estadísticas del documento")}</button>
        <button type="button" disabled={!editor.isEditable || editor.state.selection.$from.depth !== 1 || editor.isActive("image")} onClick={() => insertPageBreak(editor)}>{tr("Insert page break", "Insertar salto de página")}</button>
        <button type="button" onClick={() => { editor.chain().focus().selectAll().run(); }}>{tr("Select all", "Seleccionar todo")}</button>
        <button type="button" onClick={() => setModal("print")}>{tr("Print preview", "Vista previa de impresión")}</button>
        <button type="button" onClick={() => setModal("shortcuts")}>{tr("Keyboard shortcuts", "Atajos de teclado")}</button>
      </div>
    </FormattingPanel>
    {searchOpen && !focus && !busy && createPortal(<section onKeyDown={event => event.stopPropagation()} style={floatingStyle} className="uw-document-search" aria-label={tr("Find in document", "Buscar en el documento")} data-version={version}>
      <div role="search"><Search size={16} aria-hidden="true" /><input ref={input} aria-label={tr("Find text", "Texto a buscar")} maxLength={200} value={query} onChange={event => changeQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); navigateMatch(editor, event.shiftKey ? -1 : search.matches.some(m => m.from === editor.state.selection.from && m.to === editor.state.selection.to) ? 1 : 0); } if (event.key === "Escape") { event.stopPropagation(); openSearch(false); editor.view.focus(); } }} />
      <button type="button" aria-label={tr("Previous match", "Coincidencia anterior")} disabled={!search.matches.length} onClick={() => navigateMatch(editor, -1)}><ChevronLeft size={16}/></button>
      <button type="button" aria-label={tr("Next match", "Siguiente coincidencia")} disabled={!search.matches.length} onClick={() => navigateMatch(editor, 1)}><ChevronRight size={16}/></button>
      <button type="button" aria-label={tr("Close find", "Cerrar búsqueda")} onClick={() => { openSearch(false); editor.view.focus(); }}><X size={16}/></button></div>
      <div className="uw-search-options"><label><input type="checkbox" checked={matchCase} onChange={event => changeCase(event.target.checked)}/>{tr("Match case", "Distinguir mayúsculas")}</label><label><input type="checkbox" checked={replaceOpen} onChange={event => openReplace(event.target.checked)}/>{tr("Replace", "Reemplazar")}</label><span role="status">{query ? search.matches.length ? `${search.active + 1} / ${search.matches.length}${search.limited ? "+" : ""}` : tr("No matches", "Sin coincidencias") : tr("Search this document", "Busca en este documento")}</span></div>
      {replaceOpen && <div className="uw-replace-controls"><input aria-label={tr("Replacement text", "Texto de reemplazo")} value={replacement} maxLength={2000} onChange={event => changeReplacement(event.target.value.replace(/[\r\n]/g, "").replaceAll("\0", ""))}/><button type="button" disabled={!editor.isEditable || !search.matches.length} onClick={() => replace(false)}>{tr("Replace one", "Reemplazar uno")}</button><button type="button" disabled={!editor.isEditable || !search.matches.length || search.limited} onClick={() => replace(true)}>{tr("Replace all", "Reemplazar todo")}</button></div>}
      {replacementError && <p role="alert">{replacementError}</p>}
      {search.limited && <p role="status">{tr("More than 10,000 matches. Refine your search before replacing all.", "Más de 10.000 coincidencias. Limita la búsqueda antes de reemplazar todo.")}</p>}
    </section>, root)}
    {outlineOpen && !focus && !busy && createPortal(<aside onKeyDown={event => event.stopPropagation()} style={floatingStyle} className="uw-document-outline" aria-label={tr("Document outline", "Esquema del documento")}><header><strong>{tr("Outline", "Esquema")}</strong><button type="button" aria-label={tr("Close outline", "Cerrar esquema")} onClick={() => openOutline(false)}><X size={16}/></button></header>{headings.length ? <nav><ol>{headings.map(heading => <li key={heading.pos} style={{ paddingInlineStart: (heading.level - 1) * 12 }}><button type="button" onClick={() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(heading.pos + 1))).scrollIntoView()); editor.view.focus(); }}>{heading.text}</button></li>)}</ol></nav> : <p>{tr("Add headings to navigate your writing.", "Añade encabezados para navegar por tu escritura.")}</p>}</aside>, root)}
    {createPortal(<dialog onKeyDown={event => event.stopPropagation()} aria-label={modal === "stats" ? tr("Document statistics", "Estadísticas del documento") : modal === "print" ? tr("Print preview", "Vista previa de impresión") : tr("Keyboard shortcuts", "Atajos de teclado")} className={`uw-writing-tools-dialog ${modal === "print" ? "uw-print-dialog" : ""}`} ref={dialog} onCancel={event => { event.preventDefault(); closeModal(); }} onClose={() => setModal(null)}>
      <header><h2>{modal === "stats" ? tr("Document statistics", "Estadísticas del documento") : modal === "print" ? tr("Print preview", "Vista previa de impresión") : tr("Keyboard shortcuts", "Atajos de teclado")}</h2><button type="button" aria-label={tr("Close writing tools", "Cerrar herramientas")} onClick={closeModal}><X size={18}/></button></header>
      {modal === "stats" && <><dl className="uw-document-statistics">{[[tr("Document words", "Palabras del documento"), stats.words], [tr("Characters", "Caracteres"), stats.characters], [tr("Characters without spaces", "Caracteres sin espacios"), stats.withoutSpaces], [tr("Paragraphs", "Párrafos"), stats.paragraphs], [tr("Reading time (minutes)", "Tiempo de lectura (minutos)"), stats.readingMinutes], [tr("Selected text words", "Palabras seleccionadas"), selected]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString(spanish ? "es" : "en")}</dd></div>)}</dl><p>{tr("Document totals include all writing and captions. Session progress counts new typed words separately. Characters include paragraph separators; spaces include all whitespace.", "Los totales incluyen el texto y los pies de imagen. La sesión cuenta las palabras nuevas por separado. Los caracteres incluyen separadores de párrafo; los espacios incluyen todo espacio en blanco.")}</p></>}
      {modal === "shortcuts" && <><p>{tr("Use Ctrl on Windows/Linux or ⌘ on Mac. Shortcuts apply inside the editor.", "Usa Ctrl en Windows/Linux o ⌘ en Mac. Los atajos se aplican dentro del editor.")}</p><dl className="uw-shortcut-list">{[["Bold / Italic / Underline", "Ctrl/⌘ B / I / U"], ["Undo / Redo", "Ctrl/⌘ Z / Shift Z"], ["Find / Replace", "Ctrl/⌘ F / Ctrl H (⌘ Shift F)"], ["Insert link", "Ctrl/⌘ K"], ["Save", "Ctrl/⌘ S"], ["Focus Mode", "Ctrl/⌘ Shift L"], ["Page break", "Ctrl/⌘ Enter"], ["Print preview", "Ctrl/⌘ P"], ["Select all", "Ctrl/⌘ A"], ["Lists / table cells", "Tab / Shift Tab"]].map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl></>}
      {modal === "print" && <><div className="uw-print-settings"><label>{tr("Page size", "Tamaño de página")}<select aria-label={tr("Page size", "Tamaño de página")} value={layout.size} disabled={!editor.isEditable} onChange={event => updatePrint("size", event.target.value)}><option value="letter">US Letter</option><option value="a4">A4</option></select></label><label>{tr("Page margins", "Márgenes de página")}<select aria-label={tr("Page margins", "Márgenes de página")} value={layout.margin} disabled={!editor.isEditable} onChange={event => updatePrint("margin", event.target.value)}><option value="normal">{tr("Normal · 1 in", "Normal · 2,54 cm")}</option><option value="narrow">{tr("Narrow · 0.5 in", "Estrecho · 1,27 cm")}</option><option value="wide">{tr("Wide · 1.25 in", "Amplio · 3,18 cm")}</option></select></label><button type="button" disabled={printing} onClick={() => void print()}>{printing ? tr("Preparing…", "Preparando…") : tr("Print document", "Imprimir documento")}</button></div><p>{tr("Continuous preview. Your browser's print dialog shows page boundaries; choose matching paper size and disable browser headers/footers.", "Vista continua. El diálogo de impresión muestra los límites de página; elige el mismo tamaño de papel y desactiva encabezados y pies del navegador.")}</p>{printError && <p role="alert">{printError}</p>}<iframe ref={frame} title={tr("Document print preview", "Vista previa del documento")} sandbox="allow-same-origin allow-modals" srcDoc={preview}/></>}
    </dialog>, document.body)}
  </>;
}
function documentStatisticsSelection(editor: Editor) {
  const { from, to } = editor.state.selection;
  return countWords(editor.state.doc.textBetween(from, to, "\n", "\n"));
}
