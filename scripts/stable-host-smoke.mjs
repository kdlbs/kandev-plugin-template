// Browser smoke for an installed template package on a disposable Kandev host.
// Playwright comes from the sibling Kandev checkout; this template keeps its
// default JavaScript toolchain free of a second browser-test dependency.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const baseURL = process.env.KANDEV_URL ?? "http://127.0.0.1:18797";
const taskPath = process.env.KANDEV_SMOKE_TASK_PATH;
const expectedVersion = process.env.KANDEV_EXPECTED_VERSION ?? "v0.97.0";
const screenshotDir = process.env.KANDEV_SMOKE_SCREENSHOTS ?? "/tmp/kandev-plugin-smoke";
const pluginID = "kandev-plugin-template";
const actionSelector = "#template-chat-action";
const actionName = process.env.KANDEV_SMOKE_ACTION_NAME ?? "Template — open page";

if (!taskPath?.startsWith("/t/")) {
  throw new Error("Set KANDEV_SMOKE_TASK_PATH to a task route with a composer.");
}

const require = createRequire(import.meta.url);
const kandevRoot = resolve(process.env.KANDEV_CHECKOUT ?? "../kandev");
const hostWeb = resolve(kandevRoot, "apps/web");
const testPackage = require.resolve("@playwright/test", { paths: [hostWeb] });
const { chromium, devices } = require(require.resolve("playwright", { paths: [dirname(testPackage)] }));

const healthResponse = await fetch(`${baseURL}/health`);
assert.equal(healthResponse.status, 200, "host health endpoint responds");
const health = await healthResponse.json();
assert.equal(health.version, expectedVersion, "host is the expected stable release");
await mkdir(screenshotDir, { recursive: true });

const results = [];
const errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function openTask(targetPage) {
  await targetPage.goto(`${baseURL}${taskPath}`, { waitUntil: "domcontentloaded" });
  await targetPage
    .locator('[data-testid="chat-input-editor"][contenteditable="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
}

async function assertActionCount(targetPage, count) {
  await targetPage.waitForFunction(
    ({ selector, expected }) => document.querySelectorAll(selector).length === expected,
    { selector: actionSelector, expected: count },
    { timeout: 15000 },
  );
  assert.equal(await targetPage.locator(actionSelector).count(), count);
}

try {
  await openTask(page);
  await page.locator(actionSelector).waitFor({ state: "visible", timeout: 30000 });
  const action = page.locator(actionSelector);
  const accessibleAction = page.getByRole("button", { name: actionName, exact: true });
  assert.equal(await accessibleAction.count(), 1, "Action has its accessible label");
  assert.equal(await action.getAttribute("aria-label"), actionName);
  const desktopBounds = await action.boundingBox();
  assert.ok(desktopBounds && desktopBounds.width > 0 && desktopBounds.height > 0);
  assert.ok(desktopBounds.x + desktopBounds.width <= 1440);
  await page.screenshot({ path: resolve(screenshotDir, "desktop-action.png"), fullPage: true });
  results.push({ case: "desktop Chromium", accessibleName: actionName, bounds: desktopBounds });

  await action.focus();
  assert.equal(await action.evaluate((element) => document.activeElement === element), true);
  await action.press("Enter");
  await page.waitForURL("**/template", { timeout: 15000 });
  await page.getByText("buffer 0 of 5", { exact: true }).waitFor({ state: "visible" });
  results.push({ case: "keyboard focus and Enter navigation", passed: true });

  await page.goto(`${baseURL}/settings/plugins`, { waitUntil: "domcontentloaded" });
  const row = page.getByTestId(`plugin-row-${pluginID}`);
  await row.waitFor({ state: "visible", timeout: 20000 });
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await row.getByRole("button", { name: "Enable", exact: true }).waitFor({ state: "visible" });
  await page.goto(`${baseURL}${taskPath}`, { waitUntil: "domcontentloaded" });
  await assertActionCount(page, 0);
  results.push({ case: "disable removes the composer registration", actionCount: 0 });

  await page.goto(`${baseURL}/settings/plugins`, { waitUntil: "domcontentloaded" });
  const disabledRow = page.getByTestId(`plugin-row-${pluginID}`);
  await disabledRow.getByRole("button", { name: "Enable", exact: true }).click();
  await disabledRow.getByRole("button", { name: "Disable", exact: true }).waitFor({ state: "visible" });
  await openTask(page);
  await assertActionCount(page, 1);
  assert.equal(await page.getByRole("button", { name: actionName, exact: true }).count(), 1);
  results.push({ case: "re-enable restores one registration", actionCount: 1 });

  const mobileContext = await browser.newContext({
    ...devices["Pixel 5"],
    storageState: await context.storageState(),
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  mobile.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openTask(mobile);
  const mobileAction = mobile.locator(actionSelector);
  assert.equal(await mobileAction.getAttribute("data-surface"), "composer");
  assert.equal(await mobileAction.getAttribute("data-presentation"), "mobile");
  assert.equal(await mobile.getByRole("button", { name: actionName, exact: true }).count(), 1);
  const mobileBounds = await mobileAction.boundingBox();
  assert.ok(mobileBounds && mobileBounds.height >= 44, "phone target is at least 44px high");
  const phone = await mobile.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    touchPoints: navigator.maxTouchPoints,
  }));
  assert.equal(phone.width, devices["Pixel 5"].viewport.width);
  assert.equal(phone.coarsePointer, true, "phone uses coarse-pointer emulation");
  assert.ok(phone.touchPoints > 0, "phone touch input is enabled");
  assert.ok(phone.documentWidth <= phone.width, "composer has no horizontal overflow");
  assert.ok(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= phone.width + 1);
  await mobile.screenshot({ path: resolve(screenshotDir, "pixel-5-action.png"), fullPage: true });
  await mobileAction.tap();
  await mobile.waitForURL("**/template", { timeout: 15000 });
  await mobile.getByText("buffer 0 of 5", { exact: true }).waitFor({ state: "visible" });
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "plugin route has no horizontal overflow on phone",
  );
  results.push({ case: "Pixel 5 touch, target size, fit, and navigation", bounds: mobileBounds, ...phone });
  await mobileContext.close();

  assert.deepEqual(errors, [], "browser reports no plugin or host page errors");
  console.log(JSON.stringify({ hostVersion: health.version, results, pageErrors: errors }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
