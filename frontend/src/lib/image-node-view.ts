import type { NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

export function imageNodeView({ node: initial, editor, getPos }: NodeViewRendererProps, safeSource: (value: unknown) => value is string) {
  let node = initial, destroyed = false, finishDrag: (() => void) | null = null;
  const dom = document.createElement("figure"), media = document.createElement("div"), img = document.createElement("img"), caption = document.createElement("figcaption");
  dom.className = "uw-document-image"; dom.dataset.documentImage = "true";
  img.contentEditable = "false"; img.draggable = true;
  img.loading = "lazy"; img.decoding = "async";
  caption.className = "uw-image-caption"; caption.setAttribute("aria-label", "Image caption");
  media.className = "uw-image-media"; media.contentEditable = "false"; media.append(img);
  dom.append(media, caption);
  const handles: HTMLButtonElement[] = [];
  function position() {
    const pos = getPos();
    return !destroyed && !editor.isDestroyed && typeof pos === "number" && editor.state.doc.nodeAt(pos)?.type.name === "image" ? pos : null;
  }
  function select() {
    const pos = position();
    if (pos === null) return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    editor.view.focus();
  }
  function available() { return Math.max(80, Math.min(1600, dom.parentElement?.clientWidth || 560)); }
  function resize(width: number) {
    const pos = position();
    if (pos === null || !editor.isEditable) return;
    width = Math.max(80, Math.min(1600, Math.round(width)));
    const tr = closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, displayMode: "custom", displayWidth: width });
    tr.setMeta("unoImageLayout", true);
    editor.view.dispatch(tr);
  }
  for (const side of ["left", "right"]) {
    const handle = document.createElement("button"); handles.push(handle);
    handle.type = "button"; handle.contentEditable = "false"; handle.draggable = false;
    handle.className = `uw-image-handle uw-image-handle-${side}`;
    handle.hidden = true; handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", `Resize image from ${side}`); handle.setAttribute("aria-orientation", "horizontal");
    handle.setAttribute("aria-valuemin", "80"); handle.setAttribute("aria-valuemax", "1600");
    handle.title = "Drag to resize, or use arrow keys. Shift changes size by 50 pixels.";
    handle.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 50 : 10;
      resize(event.key === "Home" ? 80 : event.key === "End" ? available() : dom.getBoundingClientRect().width + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step));
    });
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !editor.isEditable) return;
      event.preventDefault(); event.stopPropagation(); select(); finishDrag?.();
      const start = event.clientX, width = dom.getBoundingClientRect().width, limit = available();
      let next = width;
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        next = Math.max(80, Math.min(limit, width + (moveEvent.clientX - start) * (side === "left" ? -1 : 1)));
        dom.style.width = `${next}px`;
      };
      const done = () => { cleanup(); resize(next); };
      const cancel = () => { cleanup(); render(); };
      const cleanup = () => {
        handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", done); handle.removeEventListener("pointercancel", cancel);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        finishDrag = null;
      };
      finishDrag = cancel;
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", done); handle.addEventListener("pointercancel", cancel);
    });
    media.append(handle);
  }
  img.addEventListener("click", event => { event.preventDefault(); select(); });
  function render() {
    if (safeSource(node.attrs.src)) img.src = node.attrs.src;
    else img.removeAttribute("src");
    img.alt = node.attrs.alt || "";
    if (node.attrs.title) img.title = node.attrs.title; else img.removeAttribute("title");
    if (node.attrs.width) img.width = node.attrs.width;
    if (node.attrs.height) img.height = node.attrs.height;
    const mode = node.attrs.displayMode || "auto", natural = Math.max(1, Math.min(1600, Number(node.attrs.width) || 560));
    dom.style.width = mode === "fit" ? "100%" : mode === "original" ? `min(100%, ${natural}px)` : mode === "custom" && node.attrs.displayWidth ? `min(100%, ${node.attrs.displayWidth}px)` : `min(100%, ${natural}px, 560px)`;
    dom.dataset.align = ["left", "right"].includes(node.attrs.align) ? node.attrs.align : "center";
    caption.hidden = !node.attrs.captionVisible && node.content.size === 0;
    caption.dataset.empty = String(node.content.size === 0);
    for (const handle of handles) {
      const width = node.attrs.displayWidth || Math.min(natural, 560);
      handle.setAttribute("aria-valuenow", String(width)); handle.setAttribute("aria-valuetext", `${width} pixels wide, aspect ratio locked`);
      handle.disabled = !editor.isEditable;
    }
  }
  render();
  return {
    dom, contentDOM: caption,
    update(next: ProseMirrorNode) { if (next.type !== node.type) return false; node = next; render(); return true; },
    selectNode() { dom.classList.add("ProseMirror-selectednode"); for (const handle of handles) handle.hidden = !editor.isEditable; },
    deselectNode() { dom.classList.remove("ProseMirror-selectednode"); for (const handle of handles) handle.hidden = true; },
    stopEvent(event: Event) { return handles.some(handle => handle === event.target || handle.contains(event.target as globalThis.Node)); },
    ignoreMutation(mutation: { type: string; target: globalThis.Node }) { return mutation.type !== "selection" && ((mutation.type === "attributes" && mutation.target === caption) || !caption.contains(mutation.target)); },
    destroy() { finishDrag?.(); destroyed = true; },
  };
}
