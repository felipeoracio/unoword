import home from "@/assets/marketing/screenshots/home.webp";
import editor from "@/assets/marketing/screenshots/editor.webp";
import ideas from "@/assets/marketing/screenshots/ideas.webp";
import progress from "@/assets/marketing/screenshots/progress.webp";
import library from "@/assets/marketing/screenshots/library.webp";
import guidance from "@/assets/marketing/screenshots/guidance.webp";

export const productScreens = {
  home: {
    src: home,
    title: "Home",
    description:
      "Your daily prompt, writing goals, and recent work in one welcoming place.",
  },
  editor: {
    src: editor,
    title: "Write",
    description:
      "A quiet writing surface with formatting, focus mode, and persistent save status. Pro feature.",
  },
  ideas: {
    src: ideas,
    title: "Ideas",
    description:
      "Explore non-AI Quick Prompts and save starting points for another day.",
  },
  progress: {
    src: progress,
    title: "Progress",
    description:
      "Keep session, daily, and lifetime time distinct. Pro adds extended trends and history.",
  },
  library: {
    src: library,
    title: "Library",
    description:
      "Find writing, projects, references, memory, and your Writing Profile. Pro feature.",
  },
  guidance: {
    src: guidance,
    title: "AI guidance",
    description:
      "Choose context and consent for a request. Guidance stays separate from your authored words. Pro feature.",
  },
};
export type ProductScreen = keyof typeof productScreens;

const variants = import.meta.glob<string>(
  "../assets/marketing/screenshots/*-*.webp",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);
export function screenshotSources(screen: ProductScreen) {
  return [640, 960]
    .map(
      (width) =>
        `${variants[`../assets/marketing/screenshots/${screen}-${width}.webp`]} ${width}w`,
    )
    .concat(`${productScreens[screen].src} 1440w`)
    .join(", ");
}
