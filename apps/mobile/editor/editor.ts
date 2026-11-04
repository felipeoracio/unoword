import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { DocumentImage } from "../../../frontend/src/lib/document-image";
import { DocumentSubtitle } from "../../../frontend/src/lib/document-subtitle";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
    unoEditorReceive: (message: any) => void;
    unoEditor?: Editor;
  }
}
const send = (value: unknown) =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(value));
let inputType = "insertText",
  identity = "",
  loading = false;
let before = "";
const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: false },
      code: false,
      codeBlock: false,
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    DocumentImage,
    DocumentSubtitle,
  ],
  content: { type: "doc", content: [{ type: "paragraph" }] },
  editable: false,
  enableContentCheck: true,
  onContentError() {
    send({
      type: "error",
      message:
        "This document has unsupported formatting. Editing is disabled to preserve your original.",
    });
  },
  editorProps: {
    attributes: {
      "aria-label": "Document body",
      role: "textbox",
      "aria-multiline": "true",
    },
    handleDOMEvents: {
      beforeinput: (_view, event) => {
        inputType = (event as InputEvent).inputType || "insertText";
        return false;
      },
      paste: () => {
        inputType = "insertFromPaste";
        return false;
      },
      drop: () => {
        inputType = "insertFromDrop";
        return false;
      },
    },
  },
  onUpdate: ({ editor }) => {
    if (loading) return;
    const text = editor.getText({ blockSeparator: "\n" });
    send({
      type: "change",
      id: identity,
      content: editor.getJSON(),
      text,
      before,
      inputType,
    });
    before = text;
    inputType = "insertText";
  },
});
window.unoEditor = editor;
window.unoEditorReceive = (message) => {
  if (message.type === "load") {
    loading = true;
    identity = message.id;
    try {
      editor.commands.setContent(message.content, {
        emitUpdate: false,
        errorOnInvalidContent: true,
      });
      editor.view.dispatch(
        editor.state.tr.setDocAttribute(
          "subtitle",
          message.content.attrs?.subtitle ?? null,
        ),
      );
      editor.setEditable(!!message.editable);
      before = editor.getText({ blockSeparator: "\n" });
      send({ type: "loaded", id: identity });
    } catch {
      editor.setEditable(false);
      send({
        type: "error",
        message: "Unsupported formatting. Your original document is unchanged.",
      });
    } finally {
      loading = false;
    }
  } else if (message.type === "theme") {
    document.documentElement.dataset.theme = message.value;
  } else if (message.type === "editable") {
    editor.setEditable(!!message.value);
  } else if (message.type === "command" && editor.isEditable) {
    const chain = editor.chain().focus();
    const commands: Record<string, () => void> = {
      bold: () => chain.toggleBold().run(),
      italic: () => chain.toggleItalic().run(),
      underline: () => chain.toggleUnderline().run(),
      strike: () => chain.toggleStrike().run(),
      h1: () => chain.toggleHeading({ level: 1 }).run(),
      h2: () => chain.toggleHeading({ level: 2 }).run(),
      h3: () => chain.toggleHeading({ level: 3 }).run(),
      bullet: () => chain.toggleBulletList().run(),
      ordered: () => chain.toggleOrderedList().run(),
      quote: () => chain.toggleBlockquote().run(),
      divider: () => chain.setHorizontalRule().run(),
      undo: () => chain.undo().run(),
      redo: () => chain.redo().run(),
      left: () => chain.setTextAlign("left").run(),
      center: () => chain.setTextAlign("center").run(),
      right: () => chain.setTextAlign("right").run(),
      link: () => {
        if (
          typeof message.href === "string" &&
          /^https?:\/\/[^\s]+$/.test(message.href)
        )
          chain.setLink({ href: message.href }).run();
      },
    };
    // Formatting, undo and redo never count as newly typed writing.
    inputType = "format";
    commands[message.command]?.();
    inputType = "insertText";
  } else if (message.type === "snapshot")
    send({
      type: "change",
      id: identity,
      content: editor.getJSON(),
      text: editor.getText({ blockSeparator: "\n" }),
      before,
      inputType: "format",
    });
};
document.addEventListener("click", (event) => {
  if ((event.target as Element).closest("a")) event.preventDefault();
});
// No tokens, network APIs, remote scripts or private backend access in this canvas.
send({ type: "ready" });
