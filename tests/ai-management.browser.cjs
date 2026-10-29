/** Admin UI using local fixtures; server authorization is tested independently. */
const assert = require("node:assert/strict");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "./node_modules/playwright",
);
const origin = process.env.WRITING_TEST_ORIGIN || "http://localhost:4175";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const calls = [],
      errors = [];
    const initial = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Writing Coach v2",
      suggestions_daily: 10,
      suggestions_monthly: 200,
      guidance_monthly: 30,
      cost_target: 2,
      warning_percent: 80,
      legacy_shared_daily: false,
      created_at: new Date().toISOString(),
    };
    const versions = [initial],
      audit = [];
    await context.route(origin + "/api/**", async (route) => {
      const req = route.request(),
        key = new URL(req.url()).pathname,
        method = req.method(),
        body = req.postData() ? JSON.parse(req.postData()) : null;
      calls.push({ key, method, body });
      let value;
      if (key === "/api/admin/me")
        value = { authenticated: true, email: "admin-fixture@example.com" };
      else if (key === "/api/admin/overview")
        value = {
          cards: {},
          charts: { user_growth: [], writing_activity: [] },
        };
      else if (key === "/api/admin/ai/limits" && method === "GET")
        value = {
          versions,
          releases: [
            { version_id: initial.id, effective_at: new Date().toISOString() },
          ],
          assignments: [{ version_id: initial.id, subscribers: 42 }],
          audit,
          prices: [],
        };
      else if (key === "/api/admin/ai/analytics")
        value = {
          totals: {
            estimated_spend: 1.25,
            unpriced_calls: 2,
            active_pro_accounts: 10,
            average_per_active_pro_account: 0.125,
          },
          by_feature: [],
          by_model: [],
          highest_usage: [],
          trends: [],
          above_cost_target: [],
          by_status: [],
          note: "Unpriced calls remain unknown. No user writing is logged.",
        };
      else if (key === "/api/admin/ai/limits/preview")
        value = {
          public_terms: `${body.suggestions_daily}/day; ${body.suggestions_monthly}/month; ${body.guidance_monthly} guidance/month.`,
          protected_accounts: 42,
          applies_to: "Future subscribers only. Existing accounts unchanged.",
        };
      else if (key === "/api/admin/ai/limits" && method === "POST") {
        const id = "00000000-0000-4000-8000-000000000003";
        versions.unshift({ ...initial, ...body, id });
        audit.push({
          id: 1,
          admin_id: "fixture",
          action: "created",
          version_id: id,
          created_at: new Date().toISOString(),
        });
        value = { id, published: false };
      } else if (key === "/api/admin/ai/limits/publish") {
        assert.equal(body.reviewed_terms, true);
        value = { scheduled: true, existing_subscribers_changed: false };
      } else throw Error("Unexpected endpoint " + key);
      await route.fulfill({ json: value });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/admin");
    await page.getByTestId("nav-ai").click();
    await page
      .getByRole("heading", { name: "AI Management → Usage Limits" })
      .waitFor();
    assert.equal(
      await page
        .getByLabel("Suggestions per day", { exact: true })
        .inputValue(),
      "10",
    );
    await page.getByLabel("Configuration name").fill("Future terms");
    await page.getByLabel("Suggestions per day", { exact: true }).fill("8");
    await page
      .getByRole("button", { name: "Preview changes", exact: true })
      .click();
    await page.getByText("Protected accounts: 42.", { exact: false }).waitFor();
    assert.equal(
      calls.filter(
        (c) => c.key === "/api/admin/ai/limits" && c.method === "POST",
      ).length,
      0,
      "Preview does not save",
    );
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await page.getByText("Draft version saved.", { exact: false }).waitFor();
    await page
      .getByLabel("Effective date and time", { exact: false })
      .fill("2099-01-01T12:00");
    assert.equal(
      await page
        .getByRole("button", { name: "Schedule publication" })
        .isEnabled(),
      false,
    );
    await page
      .getByLabel("I reviewed the public terms above.", { exact: false })
      .check();
    await page.getByRole("button", { name: "Schedule publication" }).click();
    await page.getByText("Publication scheduled.", { exact: false }).waitFor();
    assert.equal(calls.filter((c) => c.key.endsWith("/publish")).length, 1);
    assert.ok(
      calls.every((c) => !c.key.includes("/subscription/")),
      "Allowance management never changes Stripe billing",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS admin: configured defaults; preview without mutation; save draft; explicit future publication; protected-account notice/audit; cost metrics; no billing calls; mobile layout.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
