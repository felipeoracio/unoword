/** Actual native screen components rendered with RN Web and fictional account fixtures.
 * This checks layout/interaction and the editing canvas, not an iOS device runtime.
 */
const { build } = require("esbuild");
const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const root = path.resolve(__dirname, ".."),
    output = path.join(root, ".expo/native-ui-test.js");
  await build({
    entryPoints: [path.join(__dirname, "fixtures/preview.tsx")],
    outfile: output,
    bundle: true,
    platform: "browser",
    resolveExtensions: [
      ".web.tsx",
      ".tsx",
      ".web.ts",
      ".ts",
      ".web.jsx",
      ".jsx",
      ".web.js",
      ".js",
      ".json",
    ],
    format: "iife",
    jsx: "automatic",
    define: {
      __DEV__: "false",
      "process.env.NODE_ENV": '"production"',
      "process.env": "{}",
    },
    alias: { "react-native": "react-native-web" },
    plugins: [
      {
        name: "native-fixtures",
        setup(b) {
          b.onResolve({ filter: /AppProvider$/ }, () => ({
            path: path.join(__dirname, "fixtures/context.tsx"),
          }));
          b.onResolve({ filter: /components\/RichEditor$/ }, () => ({
            path: path.join(__dirname, "fixtures/editor.tsx"),
          }));
          b.onResolve(
            {
              filter:
                /^(expo-router|expo-crypto|expo-web-browser|expo-notifications|@react-native-async-storage\/async-storage)$/,
            },
            () => ({ path: path.join(__dirname, "fixtures/native-mocks.ts") }),
          );
        },
      },
    ],
  });
  const server = createServer((req, res) => {
    if (req.url === "/test.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(fs.readFileSync(output));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>',
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const out =
      process.env.MOBILE_SCREENSHOTS || path.join(root, ".expo", "screenshots");
    fs.mkdirSync(out, { recursive: true });
    for (const [width, height, name] of [
      [390, 844, "iphone"],
      [320, 740, "small-iphone"],
      [820, 1180, "ipad-portrait"],
      [1180, 820, "ipad-landscape"],
    ]) {
      await page.setViewportSize({ width, height });
      for (const screen of ["Home", "Write", "Projects", "Ideas", "Progress", "Profile"]) {
        await page.goto(origin + "/?screen=" + screen);
        await page.waitForTimeout(350);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "No horizontal overflow: " + screen + " " + name,
        );
        assert.ok(
          (await page.locator("body").innerText()).length > 80,
          "Screen renders account content: " +
            screen +
            " " +
            name +
            " " +
            JSON.stringify(errors) +
            " " +
            (await page.locator("body").innerText()),
        );
        await page.screenshot({
          path: path.join(out, name + "-" + screen.toLowerCase() + ".png"),
        });
      }
      await page.goto(origin + "/?screen=Write&doc=open");
      await page.waitForTimeout(500);
      const editor = page.frameLocator("iframe").locator(".tiptap");
      await editor.waitFor();
      assert.ok(
        (await editor.textContent()).includes("Some ideas arrive quietly"),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const box = await page.locator("iframe").boundingBox();
      assert.ok(
        box.height >= 180,
        "Editor keeps comfortable canvas height " + name,
      );
      const layout = await page.evaluate(() => ({
        height: innerHeight,
        scroll: document.documentElement.scrollHeight,
        frames: [...document.querySelectorAll("iframe")].map((e) => ({
          y: e.getBoundingClientRect().y,
          height: e.getBoundingClientRect().height,
        })),
        bottom: [...document.querySelectorAll("[role=button]")]
          .slice(-6)
          .map((e) => ({
            text: e.textContent,
            y: e.getBoundingClientRect().y,
            height: e.getBoundingClientRect().height,
          })),
      }));
      assert.ok(
        layout.scroll <= layout.height + 1,
        "Full native workspace fits viewport " +
          name +
          " " +
          JSON.stringify(layout),
      );
      await editor.click();
      await editor.press("ControlOrMeta+End");
      await editor.press("Enter");
      await editor.pressSequentially("My own words belong here.");
      assert.ok(
        (await editor.textContent()).includes("My own words belong here."),
      );
      await page.screenshot({ path: path.join(out, name + "-editor.png") });
      if (width >= 1000) {
        await page
          .getByRole("button", { name: "AI Coach", exact: true })
          .click();
        await page.getByText("AI Writing Coach", { exact: true }).waitFor();
        await page.screenshot({
          path: path.join(out, name + "-three-panels.png"),
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin+'/?screen=Projects');
    await page.getByRole('button',{name:'New Project',exact:true}).click();
    await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Native Memoir');
    await page.getByRole('button',{name:'Save project',exact:true}).click();
    await page.getByText('Native Memoir',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Open in editor',exact:true}).click();
    await page.getByRole('button',{name:'Project: Native Memoir',exact:true}).waitFor();
    await page.getByRole('button',{name:'AI Context: Current Project',exact:true}).click();
    await page.getByRole('button',{name:'No Library Context',exact:true}).click();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'AI Context: No Library Context',exact:true}).waitFor();
    console.log('PASS native Projects: create and save a project, open its workspace, and choose an explicit AI context using real provider/components with synthetic APIs.');
    await page.goto(origin + "/?screen=Write&plan=free");
    await page.getByText("Your space to write").waitFor();
    assert.equal(await page.locator("iframe").count(), 0);
    await page.goto(origin + "/?screen=Home&theme=dark");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "iphone-dark.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: native screen fixtures at 320/390/820/1180px, native editor bridge typing, paid gating, dark mode; no horizontal overflow or JS exceptions.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
