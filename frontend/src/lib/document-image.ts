import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";

export const MAX_IMAGE_BYTES = 192 * 1024;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export function safeImageSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= (MAX_IMAGE_BYTES * 4) / 3 + 64 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
export const DocumentImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) =>
          safeImageSource((element as HTMLElement).getAttribute("src"))
            ? null
            : false,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    if (!safeImageSource(HTMLAttributes.src)) return ["span", {}, ""];
    return [
      "img",
      mergeAttributes(HTMLAttributes, { loading: "lazy", decoding: "async" }),
    ];
  },
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
