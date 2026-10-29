/** Render the tracked, self-contained social card UI to a 1200x630 PNG. */
const fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "../../tests/node_modules/@playwright/test",
);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    const directory = path.resolve(__dirname, "../public/brand");
    await page.setContent(
      "<html><head><style>html,body{margin:0;width:1200px;height:630px;overflow:hidden}svg{display:block}</style></head><body>" +
        fs.readFileSync(path.join(directory, "social-card.svg"), "utf8") +
        "</body></html>",
    );
    await page.screenshot({ path: path.join(directory, "social-card.png") });
    console.log("Rendered UnoWord social card: 1200 × 630.");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
