/** Built marketing page + existing API contracts, isolated HTTP fixtures. No paid AI calls. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "../../tests/node_modules/playwright",
);
const dist = path.resolve(__dirname, "../dist");
const screenshotDir = process.env.MARKETING_SCREENSHOTS;
const features = [
  ["session_tracking", "Writing session tracking", true],
  ["quick_prompt", "Quick Prompt", true],
  ["basic_history", "Recent writing history (24 hours)", true],
  ["writing_profile", "Editable Writing Profile", true],
  ["new_topic", "New Topic AI suggestions", false],
  ["expand_idea", "Expand an Idea AI suggestions", false],
  ["connect_dots", "Connect the Dots AI suggestions", false],
  ["knowledge_sources", "AI document, website & writing knowledge", false],
  ["goals_analytics", "Writing goals & extended history", false],
];
const catalog = {
  name: "UnoWord",
  billing_available: false,
  chrome_store_url: null,
  features: features.map(([id, label]) => ({ id, label })),
  plans: ["free", "pro"].map((id) => ({
    id,
    name: id === "pro" ? "Pro" : "Free",
    price: null,
    features: Object.fromEntries(
      features.map(([key, _, free]) => [key, id === "pro" || free]),
    ),
  })),
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
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    let authenticated = false,
      failCatalog = false,
      storeUrl = null;
    const user = {
      id: "isolated-fixture-user",
      email: "writer@example.com",
      ai_access: false,
      plan: "free",
    };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("http://marketing.test/**", async (r) => {
      const url = new URL(r.request().url());
      if (url.pathname.startsWith("/api/")) {
        const route = url.pathname.slice(4),
          method = r.request().method();
        const body = r.request().postData() ? r.request().postDataJSON() : null;
        requests.push({ route, method, body });
        let result,
          status = 200;
        if (route === "/product") {
          status = failCatalog ? 503 : 200;
          result = failCatalog
            ? { detail: "unavailable" }
            : { ...catalog, chrome_store_url: storeUrl };
        } else if (route === "/auth/me") {
          status = authenticated ? 200 : 401;
          result = authenticated ? user : { detail: "Authentication required" };
        } else if (route === "/auth/refresh") {
          status = 401;
          result = { detail: "No refresh session" };
        } else if (["/auth/login", "/auth/signup"].includes(route)) {
          authenticated = true;
          result = { authenticated: true, user };
        } else if (route === "/auth/logout") {
          authenticated = false;
          status = 204;
        } else if (route === "/auth/recovery") {
          status = 503;
          result = { detail: "email_workflow_not_configured" };
        } else if (route === "/subscription/change") {
          status = 503;
          result = { detail: "billing_unavailable" };
        } else throw Error("Unexpected marketing API request: " + route);
        return r.fulfill({
          status,
          ...(status === 204 ? {} : { json: result }),
        });
      }
      const candidate = path.join(
        dist,
        url.pathname === "/" ? "index.html" : url.pathname,
      );
      const file =
        fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : path.join(dist, "index.html");
      const contentType =
        {
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
          ".json": "application/json",
          ".zip": "application/zip",
          ".txt": "text/plain",
        }[path.extname(file)] || "text/html";
      return r.fulfill({ body: fs.readFileSync(file), contentType });
    });
    async function load(route = "/") {
      await page.goto("http://marketing.test" + route);
      await page.evaluate(() => document.fonts.ready);
    }
    async function layout(label) {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        label + " horizontal overflow",
      );
    }
    async function capture(name, fullPage = true) {
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({
          path: path.join(screenshotDir, name + ".png"),
          fullPage,
        });
      }
    }
    async function audit(label) {
      const axeFile =
        process.env.AXE_MODULE ||
        path.resolve(__dirname, "../../tests/node_modules/axe-core/axe.min.js");
      assert.ok(
        fs.existsSync(axeFile),
        "Install tests dependencies or set AXE_MODULE for accessibility audits",
      );
      await page.addScriptTag({ path: axeFile });
      const findings = await page.evaluate(async () => {
        const r = await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        }));
      });
      assert.deepEqual(findings, [], label + " accessibility violations");
    }
    assert.ok(
      fs
        .readFileSync(path.join(dist, "index.html"), "utf8")
        .includes("Writing isn’t always"),
      "Landing copy exists in delivered HTML before JavaScript",
    );
    await load();
    await page.locator("#pricing li").first().waitFor();
    assert.equal(await page.locator("h1").count(), 1);
    assert.ok((await page.title()).includes("AI Writing Companion"));
    assert.equal(
      await page.locator("link[rel=canonical]").getAttribute("href"),
      "https://unoword.vercel.app/",
    );
    assert.ok(
      (
        await page.locator('meta[property="og:image"]').getAttribute("content")
      ).endsWith("/brand/social-card.png"),
    );
    assert.equal(
      await page.locator('script[type="application/ld+json"]').count(),
      1,
    );
    assert.equal(
      await page
        .locator(".uw-price-card")
        .first()
        .getByText("Editable Writing Profile", { exact: true })
        .count(),
      1,
      "Free profile permissions reflected accurately",
    );
    assert.equal(
      await page
        .locator(".uw-price-card")
        .first()
        .getByText("New Topic AI suggestions", { exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator(".uw-price-pro li").count(), 9);
    assert.equal(
      await page.locator('a[href*="chromewebstore.google.com"]').count(),
      0,
      "No invented listing",
    );
    assert.ok(
      !(await page.locator("#pricing").textContent()).includes("unlimited"),
    );
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await layout("Landing " + width);
      assert.ok(
        await page
          .locator("h1")
          .evaluate((el) => getComputedStyle(el).lineHeight !== "0px"),
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture("desktop");
    await capture("desktop-hero", false);
    await audit("Desktop");
    for (const label of [
      "Quick Prompt",
      "New Topic",
      "Expand an Idea",
      "Connect the Dots",
    ]) {
      await page.getByRole("tab", { name: new RegExp(label) }).click();
      assert.equal(await page.getByRole("tab", { selected: true }).count(), 1);
      assert.ok(await page.getByRole("tabpanel").isVisible());
      assert.ok(
        (await page.getByRole("tabpanel").textContent()).includes(
          "not a live AI response",
        ),
      );
    }
    const lastTab = page.getByRole("tab", { name: /Connect the Dots/ });
    await lastTab.focus();
    await page.keyboard.press("Home");
    assert.equal(
      await page
        .getByRole("tab", { name: /Quick Prompt/ })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page
        .getByRole("tab", { name: /New Topic/ })
        .getAttribute("aria-selected"),
      "true",
    );
    await audit("AI showcase");
    for (const target of [
      "features",
      "how-it-works",
      "ai-companion",
      "pricing",
      "faq",
    ]) {
      await page.locator(`.uw-desktop-nav a[href="#${target}"]`).click();
      assert.equal(new URL(page.url()).hash, "#" + target);
      assert.ok(
        (await page.locator("#" + target).boundingBox()).y >= 65,
        "Anchor stays below sticky header",
      );
    }
    const faqs = page.locator(".uw-faq-item button");
    for (let i = 0; i < (await faqs.count()); i++) {
      if ((await faqs.nth(i).getAttribute("aria-expanded")) === "true")
        await faqs.nth(i).click();
      await faqs.nth(i).click();
      assert.equal(await faqs.nth(i).getAttribute("aria-expanded"), "true");
      assert.ok(await page.locator("#faq-answer-" + i).isVisible());
      await faqs.nth(i).click();
      assert.ok(await page.locator("#faq-answer-" + i).isHidden());
    }
    assert.ok(
      !requests.some((r) => r.route.startsWith("/ai/")),
      "Marketing interactions never call AI APIs",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await capture("mobile");
    await capture("mobile-hero", false);
    await audit("Mobile");
    await page.getByRole("button", { name: "Open navigation" }).click();
    assert.ok(
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .isVisible(),
    );
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Features" })
      .focus();
    await page.keyboard.press("Escape");
    assert.ok(
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .isHidden(),
    );
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Pricing" })
      .click();
    assert.ok(
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .isHidden(),
    );
    await layout("Mobile expanded nav");
    // Each public footer destination resolves to an implemented route.
    for (const [route, heading] of [
      ["/privacy", "Privacy & data"],
      ["/terms", "Terms of service"],
      ["/support", "Let’s get you writing."],
    ]) {
      await load(route);
      await page.getByRole("heading", { level: 1, name: heading }).waitFor();
      await layout(route);
    }
    await load("/account?mode=signup");
    await page
      .getByRole("heading", { name: "Your next chapter starts here." })
      .waitFor();
    assert.equal(
      await page.locator("meta[name=robots]").getAttribute("content"),
      "noindex, nofollow",
    );
    await audit("Free signup");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("writer@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("fixture-signup-password");
    await page.getByRole("button", { name: "Show password" }).click();
    assert.equal(
      await page.locator("#launch-password").getAttribute("type"),
      "text",
    );
    await page.getByRole("button", { name: "Create free account" }).click();
    await page.getByText("You’re in.", { exact: false }).waitFor();
    assert.ok(requests.some((r) => r.route === "/auth/signup"));
    assert.equal(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
      0,
      "No credentials/tokens persisted in browser storage",
    );
    await page.getByText("Current plan", { exact: false }).waitFor();
    await layout("Account install");
    await capture("account-install");
    const download = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download UnoWord for Chrome" })
      .click();
    assert.equal((await download).suggestedFilename(), "unoword-extension.zip");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Create free account" }).waitFor();
    await load("/account?plan=pro");
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Confirm plan request" }).count(),
      0,
      "No plan mutation before login",
    );
    await page
      .getByLabel("Email address", { exact: true })
      .fill("writer@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("fixture-signin-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Confirm plan request" }).waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "Confirm plan request" })
        .isDisabled(),
    );
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm plan request" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Billing is currently unavailable" })
      .waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.route === "/subscription/change" &&
          r.body.confirmed &&
          r.body.expected_user_id === user.id,
      ),
    );
    assert.equal(
      await page.locator(".uw-account-plan span").textContent(),
      "Free",
    );
    const beforeSwap = requests.filter(
      (r) => r.route === "/subscription/change",
    ).length;
    user.id = "another-fixture-user";
    await page.getByRole("button", { name: "Confirm plan request" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Your account changed" })
      .waitFor();
    assert.equal(
      requests.filter((r) => r.route === "/subscription/change").length,
      beforeSwap,
      "Account changes cancel a stale plan intent",
    );
    user.id = "isolated-fixture-user";
    await layout("Pro confirmation");
    await audit("Pro account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await load("/account?mode=recovery");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("writer@example.com");
    await page.getByRole("button", { name: "Send recovery link" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "not configured yet" })
      .waitFor();
    failCatalog = true;
    await load();
    await page
      .getByText("Plan details are temporarily unavailable.", { exact: false })
      .first()
      .waitFor();
    assert.equal(
      await page.locator("#pricing li").count(),
      0,
      "No invented fallback features if product API fails",
    );
    failCatalog = false;
    storeUrl =
      "https://chromewebstore.google.com/detail/example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await load();
    await page.waitForFunction(() =>
      document
        .querySelector(".uw-header-actions>.uw-button")
        .href.includes("chromewebstore"),
    );
    assert.equal(
      await page.locator(".uw-header-actions>.uw-button").getAttribute("href"),
      storeUrl,
      "Configured store listing drives primary CTA",
    );
    await load("/missing");
    await page
      .getByRole("heading", {
        level: 1,
        name: "This page hasn’t been written yet.",
      })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 320–1440px; desktop/mobile menus and anchors; all four keyboard-accessible demos; FAQ; truthful dynamic pricing and failure state; signup/install/download/signout; authenticated confirmed Pro request without granting access; recovery setup message; all footer routes; SEO; no paid AI calls; screenshots; accessibility audits.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
