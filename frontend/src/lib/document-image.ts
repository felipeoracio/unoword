import { Extension, Node, mergeAttributes, type JSONContent } from "@tiptap/core";

import { Plugin } from "@tiptap/pm/state";
import { imageNodeView } from "./image-node-view";

export const MAX_IMAGE_BYTES = 192 * 1024;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export function safeImageSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= (MAX_IMAGE_BYTES * 4) / 3 + 64 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
// Keep keyboard guards ahead of paragraph shortcuts without changing the
// image node's schema order: default blocks must remain paragraphs.
const ImageCaptionGuards = Extension.create({
  name: "imageCaptionGuards",
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { handleDOMEvents: { beforeinput: (_view, event) => {
      const input = event as InputEvent, { $from, empty } = editor.state.selection;
      if ($from.parent.type.name !== "image") return false;
      if (input.inputType === "insertParagraph") {
        event.preventDefault(); editor.commands.keyboardShortcut("Enter"); return true;
      }
      if (empty && ((/delete.*Backward/.test(input.inputType) && $from.parentOffset === 0) || (/delete.*Forward/.test(input.inputType) && $from.parentOffset === $from.parent.content.size))) {
        event.preventDefault(); return true;
      }
      return false;
    } } } })];
  },
  addKeyboardShortcuts() {
    const guards = Object.fromEntries(["Mod-Alt-0", "Mod-Alt-1", "Mod-Alt-2", "Mod-Alt-3", "Mod-Shift-7", "Mod-Shift-8", "Mod-Shift-9", "Mod-Shift-b"].map(key => [key, () => this.editor.isActive("image")]));
    const boundary = (end: boolean) => {
      const { $from, empty } = this.editor.state.selection;
      return empty && $from.parent.type.name === "image" && $from.parentOffset === (end ? $from.parent.content.size : 0);
    };
    return { ...guards,
      Backspace: () => boundary(false), "Mod-Backspace": () => boundary(false), "Alt-Backspace": () => boundary(false),
      Delete: () => boundary(true), "Mod-Delete": () => boundary(true), "Alt-Delete": () => boundary(true),
      Enter: () => {
      const { $from } = this.editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === "image") {
          const after = $from.after(depth);
          return this.editor.chain().insertContentAt(after, { type: "paragraph" }).setTextSelection(after + 1).run();
        }
      }
      return false;
    } };
  },
});

export const DocumentImage = Node.create({
  name: "image",
  group: "block",
  content: "inline*",
  selectable: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      displayMode: { default: "auto", parseHTML: el => el.getAttribute("data-size-mode") || "auto", rendered: false },
      displayWidth: { default: null, parseHTML: el => Number(el.getAttribute("data-display-width")) || null, rendered: false },
      align: { default: "center", parseHTML: el => el.getAttribute("data-align") || "center", rendered: false },
      captionVisible: { default: false, rendered: false },
    };
  },
  parseHTML() {
    return [
      { tag: "figure[data-document-image]", contentElement: "figcaption", getAttrs: element => {
        const el = element as HTMLElement, img = el.querySelector("img");
        return img && safeImageSource(img.getAttribute("src")) ? {
          src: img.getAttribute("src"), alt: img.getAttribute("alt") || "", title: img.getAttribute("title"),
          width: Number(img.getAttribute("width")) || null, height: Number(img.getAttribute("height")) || null,
          displayMode: el.getAttribute("data-size-mode") || "auto", displayWidth: Number(el.getAttribute("data-display-width")) || null,
          align: el.getAttribute("data-align") || "center", captionVisible: Boolean(el.querySelector("figcaption")?.textContent),
        } : false;
      } },
      { tag: "img[src]", getAttrs: element => safeImageSource((element as HTMLElement).getAttribute("src")) ? null : false },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    if (!safeImageSource(node.attrs.src)) return ["span", {}, ""];
    const mode = ["auto", "original", "fit", "custom"].includes(node.attrs.displayMode) ? node.attrs.displayMode : "auto";
    const width = Math.max(80, Math.min(1600, Number(node.attrs.displayWidth) || 560));
    const natural = Math.max(1, Math.min(1600, Number(node.attrs.width) || 560));
    const align = ["left", "right"].includes(node.attrs.align) ? node.attrs.align : "center";
    const style = `width:${mode === "fit" ? "100%" : `min(100%, ${mode === "custom" ? width : natural}px${mode === "auto" ? ", 560px" : ""})`};max-width:100%;margin-left:${align === "left" ? "0" : "auto"};margin-right:${align === "right" ? "0" : "auto"}`;
    return ["figure", { "data-document-image": "true", "data-size-mode": mode, "data-display-width": node.attrs.displayWidth, "data-align": align, style },
      ["img", mergeAttributes(HTMLAttributes, { loading: "lazy", decoding: "async", style: "width:100%;max-width:100%;height:auto" })],
      ["figcaption", { hidden: !node.attrs.captionVisible && !node.content.size ? "hidden" : null }, 0],
    ];
  },
  addNodeView() { return props => imageNodeView(props, safeImageSource); },
  addExtensions() { return [ImageCaptionGuards]; },
});

export async function prepareDocumentImage(
  file: File,
): Promise<{ src: string; width: number; height: number }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("image_format");
  if (file.size > MAX_INPUT_BYTES) throw new Error("image_too_large");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image_invalid"));
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40000000
    )
      throw new Error("image_dimensions");
    let scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new Error("image_invalid");
      drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("image_invalid")),
          "image/webp",
          0.82,
        ),
      );
      if (blob.size <= MAX_IMAGE_BYTES) {
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("image_invalid"));
          reader.readAsDataURL(blob);
        });
        return { src, width: canvas.width, height: canvas.height };
      }
      scale *= 0.75;
    }
    throw new Error("image_too_large");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function imageDocumentFits(document: JSONContent): boolean {
  // Leave room for PostgreSQL JSON formatting and the backend's ASCII escaping.
  const serialized = JSON.stringify(document).replace(
    /[\u0080-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  return serialized.length <= 930000;
}

export function containsDocumentImage(node: JSONContent): boolean {
  return (
    node.type === "image" || (node.content || []).some(containsDocumentImage)
  );
}
