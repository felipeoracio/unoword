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
    let unavailable = false,
      soldout = false;
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
      if (endpoint === "/api/subscription/lifetime/offer")
        return route.fulfill({
          json: {
            amount: 10000,
            currency: "usd",
            capacity: 25,
            test_mode: true,
            checkout_available: !soldout,
            purchased: soldout ? 25 : 4,
            remaining: soldout ? 0 : 21,
            reserved: 0,
            available: soldout ? 0 : 21,
            refund_days: 14,
            ai_allowance: catalog.ai_allowance,
          },
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
      .getByRole("heading", { name: "Your Words. Your Voice. Your Story." })
      .waitFor();
    await page
      .getByRole("heading", { name: "Pro Monthly", exact: true })
      .waitFor();
    assert.equal(
      await page.title(),
      "UnoWord — Your Words. Your Voice. Your Story.",
    );
    assert.equal(
      await page.locator('meta[property="og:title"]').getAttribute("content"),
      "Your Words. Your Voice. Your Story. | UnoWord",
    );
    assert.ok(
      (
        await page.locator("meta[name=description]").getAttribute("content")
      ).includes("Track daily goals for free"),
    );
    assert.equal(await page.locator("h1").count(), 1);
    const cards = page.locator(".lp-price-card");
    assert.equal(await cards.count(), 3);
    const freeCard = cards.filter({
      has: page.getByRole("heading", { name: "Free", exact: true }),
    });
    const proCard = cards.filter({
      has: page.getByRole("heading", { name: "Pro Monthly", exact: true }),
    });
    const lifetime = cards.filter({
      has: page.getByRole("heading", { name: "Lifetime", exact: true }),
    });
    await lifetime
      .getByText("First 25 qualifying purchasers.", { exact: false })
      .waitFor();
    assert.ok(
      !(await freeCard.innerText()).includes("Built-in writing editor"),
    );
    assert.ok((await freeCard.innerText()).includes("up to 7 days"));
    assert.ok((await proCard.innerText()).includes("$20"));
    assert.ok((await proCard.innerText()).includes("10 suggestions/day"));
    assert.ok((await lifetime.innerText()).includes("$100"));
    assert.ok((await lifetime.innerText()).includes("21 places remain"));
    assert.equal(
      await page.locator(".lp-plan-comparison tbody tr").count(),
      16,
    );
    assert.equal(
      await page
        .locator(".lp-plan-comparison tbody tr")
        .filter({ hasText: "Built-in writing editor" })
        .locator("td")
        .first()
        .textContent(),
      "No",
    );
    assert.ok(
      (await page.locator(".lp-site").innerText()).includes(
        "AI That Helps You Write. Not AI That Writes for You.",
      ),
    );
    assert.ok(
      !(await page.locator(".lp-site").innerText()).includes(
        "AI text improvement",
      ),
    );
    const previousCalls = calls.length;
    await page.getByRole("tab", { name: "Guidance", exact: true }).click();
    await page.getByRole("tab", { name: "Questions", exact: true }).click();
    assert.equal(
      calls.length,
      previousCalls,
      "Marketing demos do not generate AI or fetch private writing",
    );
    const axePath=process.env.AXE_PATH || require.resolve('axe-core/axe.min.js',{paths:[__dirname]});
    await page.addScriptTag({path:axePath});
    const accessibility=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
    assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[],'Landing accessibility');
    const firstFAQ = page.locator(".lp-faq summary").first();
    await firstFAQ.focus();
    await page.keyboard.press("Enter");
    assert.equal(await firstFAQ.evaluate((e) => e.parentElement.open), true);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll(".lp-site a,.lp-site button")]
          .filter(
            (e) =>
              (e.offsetWidth && e.getBoundingClientRect().left < -1) ||
              (e.offsetWidth &&
                e.getBoundingClientRect().right > innerWidth + 1),
          )
          .map((e) => e.textContent),
      }));
      assert.equal(layout.overflow, false, "No overflow at " + width);
      assert.deepEqual(layout.clipped, [], "No clipped controls at " + width);
      if (output && [1440, 390].includes(width)) {
        fs.mkdirSync(output, { recursive: true });
        await page.evaluate(() => {
          document.activeElement?.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: output + "/landing-" + width + ".png",
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page
      .getByRole("button", { name: /Open menu|Open navigation/ })
      .click();
    await page
      .getByRole("navigation", { name: /Mobile/i })
      .getByRole("link", { name: "Pricing", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#pricing");
    await page
      .getByRole("link", { name: "Start Writing Free", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your next chapter starts here." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?mode=signup");
    await page.goto(origin);
    await page
      .getByRole("link", { name: "Get UnoWord Pro", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Welcome back to your words." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?plan=pro");
    await page.goto(origin);
    await page
      .getByRole("link", { name: "Get Lifetime Access", exact: true })
      .click();
    assert.equal(new URL(page.url()).pathname, "/lifetime");
    soldout = true;
    await page.goto(origin);
    await page
      .getByRole("link", { name: "Offer sold out — view plans" })
      .waitFor();
    assert.ok(
      (await page.locator(".lp-lifetime-price").innerText()).includes(
        "0 places remain",
      ),
    );
    unavailable = true;
    await page.reload();
    await page
      .getByText("Plan details are temporarily unavailable.", { exact: false })
      .first()
      .waitFor();
    assert.ok(
      !(await proCard.innerText()).includes("$20"),
      "Unavailable backend does not invent a price",
    );
    assert.ok(
      calls.every(
        (c) => c.method === "GET" || ["/api/auth/refresh"].includes(c.endpoint),
      ),
      "Browsing never starts checkout or AI",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS landing: new brand/SEO, 3 plans, verified quotas/capacity, 16-row comparison, paid labels, coaching demos, FAQ keyboard, 320–1440px layouts, signup/Pro/lifetime routes, sold out/configuration errors, no AI/payment calls.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
