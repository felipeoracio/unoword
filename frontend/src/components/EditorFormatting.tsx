import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { TextSelection } from "@tiptap/pm/state";
import { ChevronDown, Bold, Italic, Underline, Highlighter, Link2, Heading2 } from "lucide-react";
import { blockStyle, clearFormatting, formatChain, setTextStyle, indent, FONT_FAMILIES, FONT_SIZES, HIGHLIGHTS, LINE_HEIGHTS, PARAGRAPH_SPACING, TEXT_COLORS, typography } from "@/lib/document-formatting";

export function FormattingPanel({ label, children, disabled, documentId }: { label: string; children: ReactNode; disabled: boolean; documentId?: string }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (panel.current?.matches(":popover-open")) panel.current.hidePopover(); }, [disabled, documentId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || document.querySelector("dialog[open]") || !panel.current?.matches(":popover-open")) return;
      event.preventDefault(); event.stopPropagation(); panel.current.hidePopover(); trigger.current?.focus();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);
  return <>
    <button type="button" className="uw-format-trigger" ref={trigger} popoverTarget={id} disabled={disabled} aria-label={label}>
      {label}<ChevronDown size={13} aria-hidden="true" />
    </button>
    <div id={id} popover="auto" className="uw-format-panel" ref={panel} aria-label={label} onBeforeToggle={event => {
      if ((event.nativeEvent as ToggleEvent).newState !== "open") return;
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const el = event.currentTarget;
      el.style.left = `${Math.max(12, Math.min(box.left, innerWidth - 292))}px`;
      el.style.top = `${Math.min(box.bottom + 8, innerHeight - 100)}px`;
      el.style.maxHeight = `${Math.max(80, innerHeight - box.bottom - 24)}px`;
    }}>{children}</div>
  </>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="uw-format-field"><span>{label}</span>{children}</label>;
}
const names = { serif: ["Serif · Georgia", "Serif · Georgia"], sans: ["Sans · Inter", "Sans · Inter"], mono: ["Mono · JetBrains", "Mono · JetBrains"] };
export default function EditorFormatting({ editor, disabled, documentId, spanish = false, selectionTools, onSelectionTools }: {
  editor: Editor; disabled: boolean; documentId?: string; spanish?: boolean; selectionTools: boolean; onSelectionTools: (enabled: boolean) => void;
}) {
  const tr = (en: string, es: string) => spanish ? es : en;
  const text = editor.getAttributes("textStyle"), block = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph");
  const doc = typography(editor.state.doc.attrs.typography);
  function updateDocument(key: string, value: string | number) {
    formatChain(editor).command(({ tr }) => { tr.setDocAttribute("typography", { ...typography(editor.state.doc.attrs.typography), [key]: value }); return true; }).run();
  }
  return <>
    <FormattingPanel label={tr("Text", "Texto")} disabled={disabled} documentId={documentId}>
      <h3>{tr("Selected text", "Texto seleccionado")}</h3>
      <Field label={tr("Font family", "Tipo de letra")}><select aria-label={tr("Font family", "Tipo de letra")} value={text.fontFamily || ""} onChange={e => setTextStyle(editor, { fontFamily: e.target.value || null })}>
        <option value="">{tr("Document default", "Predeterminado del documento")}</option>
        {Object.keys(FONT_FAMILIES).map(key => <option key={key} value={key}>{names[key as keyof typeof names][spanish ? 1 : 0]}</option>)}
      </select></Field>
      <Field label={tr("Font size", "Tamaño de letra")}><select aria-label={tr("Font size", "Tamaño de letra")} value={text.fontSize || ""} onChange={e => setTextStyle(editor, { fontSize: Number(e.target.value) || null })}>
        <option value="">{tr("Document default", "Predeterminado del documento")}</option>{FONT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
      </select></Field>
      <Field label={tr("Text color", "Color del texto")}><select aria-label={tr("Text color", "Color del texto")} value={TEXT_COLORS.includes(text.color) ? text.color : ""} onChange={e => setTextStyle(editor, { color: e.target.value || null })}>
        <option value="">{tr("Automatic", "Automático")}</option>{TEXT_COLORS.map((c, i) => <option value={c} key={c}>{tr(["Navy", "Blue", "Green", "Amber", "Red", "Purple"][i], ["Azul marino", "Azul", "Verde", "Ámbar", "Rojo", "Morado"][i])}</option>)}
      </select></Field>
      <Field label={tr("Highlight color", "Color de resaltado")}><select aria-label={tr("Highlight color", "Color de resaltado")} value={editor.isActive("highlight") ? editor.getAttributes("highlight").color : ""} onChange={e => e.target.value ? formatChain(editor).setMark("highlight", { color: e.target.value }).run() : formatChain(editor).unsetMark("highlight").run()}>
        <option value="">{tr("None", "Ninguno")}</option>{HIGHLIGHTS.map((c, i) => <option value={c} key={c}>{tr(["Sunlight", "Sky", "Sage", "Rose", "Lavender"][i], ["Sol", "Cielo", "Salvia", "Rosa", "Lavanda"][i])}</option>)}
      </select></Field>
      <button className="uw-format-action" type="button" onClick={() => clearFormatting(editor)}>{tr("Clear formatting", "Borrar formato")}</button>
    </FormattingPanel>
    <FormattingPanel label={tr("Paragraph", "Párrafo")} disabled={disabled} documentId={documentId}>
      <h3>{tr("Paragraph settings", "Ajustes del párrafo")}</h3>
      <Field label={tr("Alignment", "Alineación")}><select aria-label={tr("Alignment", "Alineación")} value={block.textAlign || "left"} onChange={e => formatChain(editor).setTextAlign(e.target.value).run()}>
        {[['left','Left','Izquierda'],['center','Center','Centro'],['right','Right','Derecha'],['justify','Justify','Justificado']].map(([value,en,es]) => <option key={value} value={value}>{tr(en,es)}</option>)}
      </select></Field>
      <Field label={tr("Line spacing", "Interlineado")}><select aria-label={tr("Line spacing", "Interlineado")} value={block.lineHeight || ""} onChange={e => blockStyle(editor, { lineHeight: Number(e.target.value) || null })}>
        <option value="">{tr("Document default", "Predeterminado del documento")}</option>{LINE_HEIGHTS.map(n => <option key={n} value={n}>{n}×</option>)}
      </select></Field>
      <Field label={tr("Paragraph spacing", "Espacio entre párrafos")}><select aria-label={tr("Paragraph spacing", "Espacio entre párrafos")} value={block.paragraphSpacing ?? ""} onChange={e => blockStyle(editor, { paragraphSpacing: e.target.value === "" ? null : Number(e.target.value) })}>
        <option value="">{tr("Document default", "Predeterminado del documento")}</option>{PARAGRAPH_SPACING.map(n => <option key={n} value={n}>{n} em</option>)}
      </select></Field>
      <div className="uw-format-indent">
        <button type="button" className="uw-format-action" onClick={() => indent(editor, -1)}>{tr("Decrease indent", "Reducir sangría")}</button>
        <button type="button" className="uw-format-action" onClick={() => indent(editor, 1)}>{tr("Increase indent", "Aumentar sangría")}</button>
      </div>
      <p>{tr("Indent with Alt/Option + Shift + ←/→. Use Tab and Shift+Tab inside lists.", "Sangría: Alt/Option + Mayús + ←/→. Tab y Mayús+Tab dentro de listas.")}</p>
    </FormattingPanel>
    <FormattingPanel label={tr("Document style", "Estilo del documento")} disabled={disabled} documentId={documentId}>
      <h3>{tr("Document typography", "Tipografía del documento")}</h3>
      <Field label={tr("Default font", "Fuente predeterminada")}><select aria-label={tr("Default font", "Fuente predeterminada")} value={doc.fontFamily} onChange={e => updateDocument("fontFamily", e.target.value)}>
        {Object.keys(FONT_FAMILIES).map(key => <option value={key} key={key}>{names[key as keyof typeof names][spanish ? 1 : 0]}</option>)}
      </select></Field>
      <Field label={tr("Default font size", "Tamaño predeterminado")}><select aria-label={tr("Default font size", "Tamaño predeterminado")} value={doc.fontSize} onChange={e => updateDocument("fontSize", Number(e.target.value))}>{FONT_SIZES.map(n => <option key={n} value={n}>{n} px</option>)}</select></Field>
      <Field label={tr("Default line spacing", "Interlineado predeterminado")}><select aria-label={tr("Default line spacing", "Interlineado predeterminado")} value={doc.lineHeight} onChange={e => updateDocument("lineHeight", Number(e.target.value))}>{LINE_HEIGHTS.map(n => <option key={n} value={n}>{n}×</option>)}</select></Field>
      <Field label={tr("Default paragraph spacing", "Espaciado predeterminado")}><select aria-label={tr("Default paragraph spacing", "Espaciado predeterminado")} value={doc.paragraphSpacing} onChange={e => updateDocument("paragraphSpacing", Number(e.target.value))}>{PARAGRAPH_SPACING.map(n => <option key={n} value={n}>{n} em</option>)}</select></Field>
      <label className="uw-format-toggle"><input type="checkbox" checked={selectionTools} onChange={e => onSelectionTools(e.target.checked)} />{tr("Show selection toolbar", "Mostrar barra de selección")}</label>
      <p>{tr("Defaults apply to this document. Selected-text and paragraph overrides are kept.", "Los valores se aplican a este documento y respetan los formatos específicos.")}</p>
    </FormattingPanel>
  </>;
}

export function SelectionFormatting({ editor, onLink, enabled, spanish = false }: { editor: Editor; onLink: () => void; enabled: boolean; spanish?: boolean }) {
  if (!enabled) return null;
  const buttons = [
    { name: spanish ? "Negrita" : "Bold", icon: Bold, active: editor.isActive("bold"), run: () => formatChain(editor).toggleBold().run() },
    { name: spanish ? "Cursiva" : "Italic", icon: Italic, active: editor.isActive("italic"), run: () => formatChain(editor).toggleItalic().run() },
    { name: spanish ? "Subrayado" : "Underline", icon: Underline, active: editor.isActive("underline"), run: () => formatChain(editor).toggleUnderline().run() },
    { name: spanish ? "Encabezado 2" : "Heading 2", icon: Heading2, active: editor.isActive("heading", { level: 2 }), run: () => formatChain(editor).toggleHeading({ level: 2 }).updateAttributes("heading", { styleVariant: null }).updateAttributes("paragraph", { styleVariant: null }).run() },
    { name: spanish ? "Enlace" : "Link", icon: Link2, active: editor.isActive("link"), run: onLink },
    { name: spanish ? "Resaltar" : "Highlight", icon: Highlighter, active: editor.isActive("highlight"), run: () => editor.isActive("highlight") ? formatChain(editor).unsetMark("highlight").run() : formatChain(editor).setMark("highlight", { color: HIGHLIGHTS[0] }).run() },
  ];
  return <BubbleMenu editor={editor} pluginKey="unoSelectionFormatting" className="uw-selection-toolbar" role="toolbar" aria-label={spanish ? "Formato de selección" : "Selection formatting"}
    updateDelay={80} appendTo={() => editor.view.dom.closest<HTMLElement>(".uw-editor") || document.body}
    options={{ strategy: "fixed", placement: "top", offset: 10, flip: { boundary: editor.view.dom.closest<HTMLElement>(".uw-editor-paper-scroll") || undefined, padding: 12 }, shift: { boundary: editor.view.dom.closest<HTMLElement>(".uw-editor-paper-scroll") || undefined, padding: 12 }, scrollTarget: editor.view.dom.closest<HTMLElement>(".uw-editor-paper-scroll") || window }}
    shouldShow={({ state, view, element }) => editor.isEditable && !view.composing && state.selection instanceof TextSelection && !state.selection.empty && Boolean(state.doc.textBetween(state.selection.from, state.selection.to).trim()) && (view.hasFocus() || element.contains(document.activeElement)) && !document.querySelector('dialog[open], [popover]:popover-open')}>
    {buttons.map(({ name, icon: Icon, active, run }) => <button type="button" disabled={Icon === Heading2 && editor.isActive("image")} aria-label={`${spanish ? "Selección" : "Selection"}: ${name}`} aria-pressed={active} key={name} onMouseDown={e => e.preventDefault()} onClick={run}><Icon size={16} /></button>)}
  </BubbleMenu>;
}
