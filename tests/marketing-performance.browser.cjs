/** One local lab sample. Synthetic product API; not field Web Vitals. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "./node_modules/playwright",
);
(async () => {
  const server =
    await require("./helpers/production-fixture-server.cjs").start();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await context.route(server.origin + "/api/**", (route) => {
      assert.equal(new URL(route.request().url()).pathname, "/api/product");
      return route.fulfill({
        json: {
          name: "UnoWord",
          billing_available: false,
          plans: [],
          features: [],
          chrome_store_url: null,
        },
      });
    });
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
    });
    await page.addInitScript(() => {
      window.__marketingLab = { lcp: 0, shifts: 0, longTasks: [] };
      for (const [type, read] of [
        [
          "largest-contentful-paint",
          (entries) => {
            window.__marketingLab.lcp = entries.at(-1)?.startTime || 0;
          },
        ],
        [
          "layout-shift",
          (entries) => {
            for (const e of entries)
              if (!e.hadRecentInput) window.__marketingLab.shifts += e.value;
          },
        ],
        [
          "longtask",
          (entries) =>
            window.__marketingLab.longTasks.push(
              ...entries.map((e) => e.duration),
            ),
        ],
      ])
        if (PerformanceObserver.supportedEntryTypes.includes(type))
          new PerformanceObserver((list) => read(list.getEntries())).observe({
            type,
            buffered: true,
          });
    });
    await page.goto(server.origin, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.locator(".lp-hero-preview img").evaluate((img) => img.decode());
    const report = await page.evaluate(() => ({
      scope:
        "Local 390x844 Chromium, 4x CPU, 150ms latency/1.6Mbps download, cold browser cache, synthetic unthrottled product API. Single observation, not field LCP/CLS.",
      ...window.__marketingLab,
      paint: performance
        .getEntriesByType("paint")
        .map((p) => ({ name: p.name, milliseconds: p.startTime })),
      resources: performance
        .getEntriesByType("resource")
        .map((r) => ({
          path: new URL(r.name).pathname,
          bytes: r.transferSize,
          duration: r.duration,
        })),
    }));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const out = path.resolve("tests/artifacts/marketing");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "performance.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      "PASS mobile lab navigation and no overflow: " +
        JSON.stringify({
          lcp: report.lcp,
          shiftSum: report.shifts,
          paint: report.paint,
          transferredBytes: report.resources.reduce((n, r) => n + r.bytes, 0),
        }),
    );
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
