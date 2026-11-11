/** Public production bundle: accurate plan copy, real navigation, no AI/payment requests. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "./node_modules/playwright",
);
const origin = process.env.LANDING_TEST_ORIGIN || "http://localhost:4175";
const output = process.env.LANDING_SCREENSHOTS;
const free = {
  session_tracking: true,
  quick_prompt: true,
  basic_history: true,
  writing_goals: true,
};
const paid = {
  ...free,
  writing_editor: true,
  rich_text_formatting: true,
  full_streak_history: true,
  document_library: true,
  document_folders: true,
  unlimited_writing_streaks: true,
  personalized_ai_suggestions: true,
  ai_writing_guidance: true,
  personalized_writing_profile: true,
  writing_profile: true,
  editor_ai: true,
  goals_analytics: true,
  new_topic: true,
  expand_idea: true,
  connect_dots: true,
  knowledge_sources: true,
};
const catalog = {
  name: "UnoWord",
  billing_available: true,
  chrome_store_url: null,
  ai_allowance: {
    id: "v2",
    suggestions_daily: 10,
    suggestions_monthly: 200,
    guidance_monthly: 30,
  },
  plans: [
    { id: "free", name: "Free", price: null, features: free },
    {
      id: "pro",
      name: "Pro",
      price: {
        amount: 2000,
        currency: "usd",
        interval: "month",
        trial_days: 7,
      },
      features: paid,
    },
  ],
  features: [],
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    let unavailable = false;
    const errors = [],
      calls = [];
    await context.route(origin + "/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        endpoint = url.pathname;
      calls.push({ method: req.method(), endpoint });
      if (endpoint === "/api/product")
        return route.fulfill({
          status: unavailable ? 503 : 200,
          json: unavailable ? { detail: "unavailable" } : catalog,
        });
      if (endpoint === "/api/auth/google")
        return route.fulfill({ json: { enabled: false } });
      if (endpoint === "/api/onboarding")
        return route.fulfill({
          json: {
            version: 1,
            status: "completed",
            current_step: "summary",
            completed_actions: {},
            skipped_steps: [],
          },
        });
      assert.ok(
        ["/api/auth/me", "/api/auth/refresh"].includes(endpoint),
        "Unexpected private/paid request " + endpoint,
      );
      return route.fulfill({
        status: 401,
        json: { detail: "Authentication required" },
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("heading", {
        level: 1,
        name: "Your ideas deserve a place to grow.",
      })
      .waitFor();
    const title = "UnoWord | Build Your Writing Habit & Discover New Ideas";
    assert.equal(await page.title(), title);
    assert.equal(
      await page.locator('meta[property="og:title"]').getAttribute("content"),
      title,
    );
    assert.equal(
      await page.locator('meta[name="description"]').getAttribute("content"),
      "Meet UnoWord, your personal writing companion. Track your writing progress, build consistency, and discover new ideas with thoughtful AI guidance.",
    );
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://unoword.app/",
    );
    assert.ok(
      fs
        .readFileSync("frontend/dist/index.html", "utf8")
        .includes("Your ideas deserve"),
    );
    assert.equal(
      await page.locator('script[type="application/ld+json"]').count(),
      1,
    );
    const cards = page.locator(".lp-price-card");
    assert.equal(await cards.count(), 2);
    const freeCard = cards.filter({
        has: page.getByRole("heading", { name: "Free", exact: true }),
      }),
      proCard = cards.filter({
        has: page.getByRole("heading", { name: "Pro", exact: true }),
      });
    await proCard.getByText("$20.00", { exact: true }).waitFor();
    assert.ok(
      !(await freeCard.innerText()).includes("Built-in writing editor"),
    );
    assert.ok((await freeCard.innerText()).includes("up to 7 days"));
    assert.ok((await proCard.innerText()).includes("10 suggestions/day"));
    assert.ok((await proCard.innerText()).includes("7-day free trial"));
    assert.equal(await page.locator('a[href="/lifetime"]').count(), 0);
    assert.equal(await page.locator(".lp-faq details").count(), 10);
    const before = calls.length;
    const tabs = page.getByRole("tablist", {
      name: "Explore the writing studio",
    });
    for (const name of ["Home", "Write", "Ideas", "Progress", "Library"]) {
      await tabs.getByRole("tab", { name, exact: true }).click();
      await page
        .getByRole("tabpanel")
        .locator("img")
        .evaluate((img) => img.decode());
      assert.ok(
        (
          await page.getByRole("tabpanel").locator("img").getAttribute("src")
        ).endsWith(".webp"),
      );
    }
    assert.equal(
      calls.length,
      before,
      "Screenshot tabs do not fetch private writing or AI",
    );
    await tabs.getByRole("tab", { name: "Library", exact: true }).focus();
    await page.keyboard.press("Home");
    assert.equal(
      await tabs
        .getByRole("tab", { name: "Home", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("End");
    assert.equal(
      await tabs
        .getByRole("tab", { name: "Library", exact: true })
        .getAttribute("tabindex"),
      "0",
    );
    const axePath =
      process.env.AXE_PATH ||
      process.env.AXE_SCRIPT ||
      require.resolve("axe-core/axe.min.js", { paths: [__dirname] });
    await page.addScriptTag({ path: axePath });
    async function audit(label) {
      if (!(await page.evaluate(() => !!window.axe)))
        await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      );
      assert.deepEqual(violations, [], label);
    }
    await audit("Light landing");
    const firstFAQ = page.locator(".lp-faq summary").first();
    await firstFAQ.focus();
    await page.keyboard.press("Enter");
    assert.equal(await firstFAQ.evaluate((el) => el.parentElement.open), true);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        // Full-page evidence includes artwork that normally loads while scrolling.
        for (const img of document.querySelectorAll('img[loading="lazy"]'))
          img.loading = "eager";
        await Promise.all([...document.images].map((img) => img.decode()));
        scrollTo(0, 0);
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No overflow " + width,
      );
      const primary = page.locator(".lp-hero-buttons a").first();
      const box = await primary.boundingBox();
      assert.ok(
        box && box.y + box.height < 1000,
        "Hero CTA remains in first viewport " + width,
      );
      if (output) {
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({
          path: output + "/landing-" + width + ".png",
          fullPage: true,
        });
        await page.screenshot({ path: output + "/hero-" + width + ".png" });
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Pricing", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#pricing");
    assert.equal(
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Features", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await freeCard
      .getByRole("link", { name: "Get Started Free", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your next chapter starts here." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?mode=signup");
    assert.equal(
      await page
        .locator(".uw-account-page")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--studio-navy").trim(),
        ),
      "#102b55",
    );
    await page.goto(origin + "/#pricing");
    await proCard
      .getByRole("link", { name: "Explore Pro", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Welcome back to your words." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?plan=pro");
    catalog.billing_available = false;
    catalog.plans[1].price.amount = 2400;
    catalog.plans[1].price.currency = "eur";
    catalog.chrome_store_url =
      "https://chromewebstore.google.com/detail/verified-fixture";
    await page.goto(origin);
    await proCard.getByText("€24.00", { exact: true }).waitFor();
    assert.ok(!(await proCard.innerText()).includes("7-day free trial"));
    assert.ok(
      (await proCard.innerText()).includes("Checkout is currently unavailable"),
    );
    assert.equal(
      await page.locator(".lp-hero-buttons a").first().getAttribute("href"),
      "/account?mode=signup",
      "Signup CTA never becomes an extension install",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Chrome Web Store", exact: false })
        .getAttribute("href"),
      catalog.chrome_store_url,
    );
    await page.evaluate(() =>
      localStorage.setItem("uno-writing-theme", "dark"),
    );
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector(".lp-site")?.dataset.studioTheme === "dark",
    );
    await audit("Dark landing");
    if (output)
      await page.screenshot({
        path: output + "/landing-dark.png",
        fullPage: true,
      });
    unavailable = true;
    await page.reload();
    await page
      .getByRole("status")
      .filter({ hasText: "Plan details are temporarily unavailable." })
      .first()
      .waitFor();
    assert.equal(
      await page.locator(".lp-price-card li").count(),
      0,
      "Unavailable config does not invent plan benefits",
    );
    assert.equal(
      calls.some(
        (r) => r.method !== "GET" && !r.endpoint.startsWith("/api/auth/"),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS modern marketing: shared tokens, SSR/SEO, real screenshot tabs/keyboard, truthful API-driven Free/Pro prices/benefits/trials, working signup/Pro/store destinations, no private data/AI/payment mutation, 320–1440px, mobile menu/focus, light/dark axe.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
