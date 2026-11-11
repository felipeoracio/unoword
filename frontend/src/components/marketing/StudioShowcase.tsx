import { useState, type KeyboardEvent } from "react";
import { StudioImage } from "@/components/studio/StudioPrimitives";
import { trackMarketingInteraction } from "@/lib/analytics";
import {
  productScreens,
  screenshotSources,
  type ProductScreen,
} from "@/lib/product-screens";
export function ProductCapture({
  screen,
  priority = false,
}: {
  screen: ProductScreen;
  priority?: boolean;
}) {
  const data = productScreens[screen];
  return (
    <figure className="lp-capture">
      <div className="lp-capture-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <b>UnoWord · {data.title}</b>
      </div>
      <a
        href={data.src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View full ${data.title} screenshot (opens in a new tab)`}
      >
        <StudioImage
          src={data.src}
          srcSet={screenshotSources(screen)}
          sizes="(max-width:899px) calc(100vw - 32px), (max-width:1440px) 60vw, 1050px"
          alt={`UnoWord ${data.title}: ${data.description}`}
          width={1440}
          height={1000}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "low"}
        />
      </a>
    </figure>
  );
}
const tabs = ["home", "editor", "ideas", "progress", "library"] as const;
export default function StudioShowcase() {
  const [selected, setSelected] = useState<(typeof tabs)[number]>("home");
  function choose(key: (typeof tabs)[number]) {
    setSelected(key);
    trackMarketingInteraction("showcase_tab", "showcase");
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
            tabs.length;
    choose(tabs[next]);
    document.getElementById("showcase-tab-" + tabs[next])?.focus();
  }
  return (
    <>
      <div
        className="lp-showcase-tabs"
        role="tablist"
        aria-label="Explore the writing studio"
      >
        {tabs.map((key, index) => (
          <button
            key={key}
            id={"showcase-tab-" + key}
            type="button"
            role="tab"
            aria-selected={selected === key}
            aria-controls={"showcase-panel-" + key}
            tabIndex={selected === key ? 0 : -1}
            onKeyDown={(event) => move(event, index)}
            onClick={() => choose(key)}
          >
            {productScreens[key].title}
          </button>
        ))}
      </div>
      {tabs.map((key) => (
        <div
          key={key}
          role="tabpanel"
          id={"showcase-panel-" + key}
          aria-labelledby={"showcase-tab-" + key}
          tabIndex={0}
          hidden={selected !== key}
        >
          {selected === key && <ProductCapture screen={key} />}
        </div>
      ))}
    </>
  );
}
