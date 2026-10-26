/** Public production bundle only; fixtures never create users, payments, or AI requests. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "./node_modules/playwright",
);
const origin = process.env.LANDING_TEST_ORIGIN || "http://localhost:4175";
const screenshots = process.env.LANDING_SCREENSHOTS;
const flags = {
  writing_editor: false,
  editor_ai: false,
  session_tracking: true,
  quick_prompt: true,
  basic_history: true,
  writing_profile: true,
  new_topic: false,
  expand_idea: false,
  connect_dots: false,
  knowledge_sources: false,
  goals_analytics: false,
};
const catalog = {
  name: "Uno Word",
  billing_available: true,
  chrome_store_url: null,
  plans: [
    { id: "free", name: "Free", price: null, features: flags },
    {
      id: "pro",
      name: "Pro",
      price: {
        amount: 2000,
        currency: "usd",
        interval: "month",
        trial_days: 7,
      },
      features: Object.fromEntries(Object.keys(flags).map((k) => [k, true])),
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
      viewport: { width: 1312, height: 1000 },
      reducedMotion: "reduce",
    });
    const requests = [],
      errors = [];
    let product = structuredClone(catalog),
      unavailable = false;
    await context.route(origin + "/api/**", async (route) => {
      const req = route.request(),
        endpoint = new URL(req.url()).pathname;
      requests.push({ method: req.method(), endpoint });
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
            draft_id: null,
            words: 0,
          },
        });
      if (endpoint === "/api/product")
        return route.fulfill({
          status: unavailable ? 503 : 200,
          json: unavailable ? { detail: "unavailable" } : product,
        });
      assert.ok(
        ["/api/auth/me", "/api/auth/refresh"].includes(endpoint),
        "Marketing and logged-out navigation must not call paid/private APIs: " +
          endpoint,
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
      .getByRole("link", { name: "Start 7-Day Free Trial", exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page.title(),
      "UnoWord — AI Writing Editor, Word Counter & Writing Companion",
    );
    assert.ok(
      (
        await page.locator('meta[name="description"]').getAttribute("content")
      ).startsWith(
        "Write, track progress, and discover personalized AI ideas with UnoWord.",
      ),
    );
    assert.equal(await page.locator("h1").count(), 1);
    assert.ok(
      (await page.locator("h1").textContent()).includes("All in One Place."),
    );
    const schema = JSON.parse(
      await page.locator('script[type="application/ld+json"]').textContent(),
    );
    assert.equal(schema.name, "UnoWord");
    assert.equal(
      new URL(await page.locator('link[rel="canonical"]').getAttribute("href"))
        .protocol,
      "https:",
    );
    const branding = await page.evaluate(
      () =>
        document.body.innerText +
        [...document.querySelectorAll("[alt],[aria-label],meta")]
          .map((e) =>
            [
              e.getAttribute("alt"),
              e.getAttribute("aria-label"),
              e.getAttribute("content"),
            ].join(" "),
          )
          .join(" ") +
        document.title,
    );
    assert.ok(
      !/Uno Word|Uno word|Unoword/.test(branding),
      "Landing branding must always be UnoWord, even if API brand is legacy",
    );
    assert.match(
      await page.locator(".lp-price-pro .lp-price").innerText(),
      /\$20\s*\/month/,
    );
    assert.equal(
      await page
        .locator(".lp-price-card:not(.lp-price-pro)")
        .getByText("Quick Prompt — no AI request needed", { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(".lp-price-card:not(.lp-price-pro)")
        .getByText("New Topic", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".lp-price-card:not(.lp-price-pro)")
        .getByText("Writing editor & document library", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".lp-price-pro")
        .getByText("Writing editor & document library", { exact: true })
        .count(),
      1,
    );
    // Every on-page destination exists; account links preserve the established flow.
    for (const href of await page
      .locator('a[href^="#"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
      assert.equal(await page.locator(href).count(), 1, href);
    for (const href of await page
      .locator('a:not([href^="#"])')
      .evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
      assert.ok(
        [
          "/",
          "/editor",
          "/account?mode=signup",
          "/account?mode=signin",
          "/account?plan=pro",
          "/privacy",
          "/terms",
          "/support",
        ].includes(href),
        "Unknown marketing destination: " + href,
      );
    // Demonstration switches without network or editing anyone’s documents.
    await page.getByRole("tab", { name: "Improve", exact: true }).click();
    await page
      .getByRole("tabpanel")
      .getByText("Keep your voice. Find your flow.")
      .waitFor();
    await page
      .getByRole("tab", { name: "Improve", exact: true })
      .press("ArrowRight");
    await page
      .getByRole("tabpanel")
      .getByText("Where could this thought lead?")
      .waitFor();
    assert.equal(
      await page
        .getByRole("tab", { name: "Continue", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page
      .getByRole("tab", { name: "Continue", exact: true })
      .press("Home");
    await page
      .getByRole("tabpanel")
      .getByText("What should I write next?")
      .waitFor();
    // Native FAQ is keyboard accessible and exposes accurate consent/counting details.
    const question = page
      .locator("summary")
      .filter({ hasText: "How does UnoWord count words?" });
    await question.focus();
    await question.press("Enter");
    assert.ok(
      await page
        .locator("details[open]")
        .innerText()
        .then((t) => t.includes("Pasted text, imports, and inserted AI text")),
    );
    await question.press("Enter");
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    for (const width of [
      320, 360, 390, 640, 641, 768, 960, 961, 1024, 1200, 1201, 1312, 1440,
      1920,
    ]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
        clipped: [...document.querySelectorAll("a,button,summary")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width &&
              (r.left < -1 ||
                r.right > innerWidth + 1 ||
                e.scrollWidth > e.clientWidth + 2)
            );
          })
          .map((e) => e.textContent.trim()),
      }));
      assert.equal(
        layout.scroll,
        layout.viewport,
        "Horizontal scrolling at " + width,
      );
      assert.deepEqual(layout.clipped, [], "Clipped controls at " + width);
      if ([320, 390, 768, 1312, 1440].includes(width) && screenshots) {
        await page.screenshot({
          path: path.join(screenshots, "landing-" + width + ".png"),
          fullPage: true,
        });
        await page.screenshot({
          path: path.join(screenshots, "landing-" + width + "-viewport.png"),
        });
      }
    }
    // WCAG audits in both desktop and narrow mobile layouts.
    if (process.env.AXE_SCRIPT) {
      for (const width of [1312, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.addScriptTag({ path: process.env.AXE_SCRIPT });
        const violations = await page.evaluate(async () =>
          (
            await window.axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        );
        assert.deepEqual(
          violations,
          [],
          "Accessibility violations at " + width,
        );
      }
    }
    // Mobile menu: links scroll, Escape restores focus, signup stays prominent.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Pricing" })
      .click();
    assert.equal(new URL(page.url()).hash, "#pricing");
    assert.equal(
      await page.getByRole("navigation", { name: "Mobile navigation" }).count(),
      0,
    );
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "FAQ" })
      .focus();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Open navigation" })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator(".lp-header-cta").click();
    await page
      .getByRole("heading", { name: "Your next chapter starts here." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?mode=signup");
    await page.goto(origin);
    await page
      .getByRole("link", { name: "Start 7-Day Free Trial", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Welcome back to your words." })
      .waitFor();
    assert.equal(new URL(page.url()).search, "?plan=pro");
    assert.equal(
      requests.some((r) =>
        /billing|checkout|assistant|suggestion/.test(r.endpoint),
      ),
      false,
      "Signed-out CTA cannot start a charge or AI request",
    );
    await page.goto(origin);
    await page.getByRole("link", { name: "Explore the Pro Editor" }).click();
    await page.getByRole("heading", { name: "Sign in to write" }).waitFor();
    for (const [route, heading] of [
      ["/privacy", "Privacy & data"],
      ["/terms", "Terms of service"],
      ["/support", "Let’s get you writing."],
    ]) {
      await page.goto(origin + route);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    }
    // Changed backend offer, no trial, feature removal, billing disabled, and outage.
    product.plans[1].price = {
      amount: 3500,
      currency: "usd",
      interval: "year",
      trial_days: 3,
    };
    product.plans[1].features.connect_dots = false;
    await page.goto(origin);
    await page
      .getByRole("link", { name: "Start 3-Day Free Trial", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".lp-price-pro .lp-price").innerText(),
      /\$35\s*\/year/,
    );
    assert.equal(
      await page
        .locator(".lp-price-pro")
        .getByText("Connect the Dots", { exact: true })
        .count(),
      0,
    );
    assert.ok(!(await page.locator(".lp-pricing").innerText()).includes("$20"));
    product.plans[1].price.trial_days = 0;
    await page.reload();
    await page
      .locator(".lp-price-pro")
      .getByRole("link", { name: "View Pro in Your Account" })
      .waitFor();
    assert.equal(await page.locator(".lp-pricing .lp-trial").count(), 0);
    product.billing_available = false;
    await page.reload();
    await page
      .getByText("Checkout is currently unavailable.", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("link", { name: /Start .*Free Trial/ }).count(),
      0,
    );
    unavailable = true;
    await page.reload();
    await page
      .getByText(
        "Plan details are temporarily unavailable. Check your account for current access.",
      )
      .first()
      .waitFor();
    assert.equal(
      await page
        .locator(".lp-price-pro")
        .getByText("$35", { exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, [], "No browser errors, including SSR hydration");
    console.log(
      "PASS landing: 14 viewport widths, branding/SEO, keyboard demo/FAQ/menu, all links, signup/Pro/editor auth gates, live-config pricing/entitlements/failure states, zero paid API calls, WCAG audits, screenshots.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
