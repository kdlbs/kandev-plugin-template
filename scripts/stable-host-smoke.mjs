// Browser smoke for an installed template package on a disposable Kandev host.
// Playwright comes from the sibling Kandev checkout; this template keeps its
// default JavaScript toolchain free of a second browser-test dependency.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const baseURL = process.env.KANDEV_URL ?? "http://127.0.0.1:18797";
const taskPath = process.env.KANDEV_SMOKE_TASK_PATH;
const expectedVersion = process.env.KANDEV_EXPECTED_VERSION ?? "v0.97.0";
const expectedReleaseCommit = "e43881c7555372897b57ec51c705f1e05da43c40";
const releaseSource = process.env.KANDEV_RELEASE_SOURCE;
const hostLogPath = process.env.KANDEV_SMOKE_HOST_LOG;
const screenshotDir = process.env.KANDEV_SMOKE_SCREENSHOTS ?? "/tmp/kandev-plugin-smoke";
const pluginID = "kandev-plugin-template";
const actionSelector = "#template-chat-action";
const actionName = process.env.KANDEV_SMOKE_ACTION_NAME ?? "Template — open page";

if (!taskPath?.startsWith("/t/")) {
  throw new Error("Set KANDEV_SMOKE_TASK_PATH to a task route with a composer.");
}
if (!releaseSource) {
  throw new Error("Set KANDEV_RELEASE_SOURCE to the detached Kandev v0.97.0 source checkout.");
}
if (!hostLogPath) {
  throw new Error("Set KANDEV_SMOKE_HOST_LOG to the task-owned runtime backend log.");
}

const releaseRoot = resolve(releaseSource);
const releaseCommit = execFileSync("git", ["-C", releaseRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(releaseCommit, expectedReleaseCommit, "release source is the exact v0.97.0 commit");
execFileSync("git", ["-C", releaseRoot, "diff", "--quiet"]);
execFileSync("git", ["-C", releaseRoot, "diff", "--cached", "--quiet"]);
const releaseWebDist = resolve(releaseRoot, "apps/web/dist");

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

async function listFiles(root, prefix = "") {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function assetReferences(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((reference) => reference.includes("/assets/"))
    .sort();
}

async function verifyServedReleaseAssets() {
  const sourceIndex = await readFile(resolve(releaseWebDist, "index.html"), "utf8");
  const hostLog = await readFile(hostLogPath, "utf8");
  assert.match(hostLog, /Web SPA static serving enabled.*"dist_dir": "embedded"/);
  const response = await fetch(`${baseURL}/`);
  assert.equal(response.status, 200, "host serves the SPA shell");
  const servedIndex = await response.text();
  const expectedReferences = assetReferences(sourceIndex);
  const servedReferences = assetReferences(servedIndex);
  assert.ok(expectedReferences.length > 0, "release shell references built JS/CSS assets");
  assert.deepEqual(servedReferences, expectedReferences, "served shell uses the exact release JS/CSS references");

  const files = (await listFiles(releaseWebDist)).filter((file) => file !== "index.html");
  assert.ok(files.length > 0, "release web build contains static assets");
  const fileDigests = new Array(files.length);
  let totalBytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const relative = files[index];
      const sourceBytes = await readFile(resolve(releaseWebDist, relative));
      const urlPath = relative.split("/").map(encodeURIComponent).join("/");
      const assetResponse = await fetch(`${baseURL}/${urlPath}`);
      assert.equal(assetResponse.status, 200, `host serves release asset ${relative}`);
      const servedBytes = Buffer.from(await assetResponse.arrayBuffer());
      assert.deepEqual(servedBytes, sourceBytes, `served asset matches v0.97.0 build: ${relative}`);
      fileDigests[index] = createHash("sha256").update(sourceBytes).digest("hex");
      totalBytes += sourceBytes.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, files.length) }, worker));
  const tree = createHash("sha256");
  files.forEach((relative, index) => {
    tree.update(relative).update("\0").update(fileDigests[index]).update("\n");
  });
  const referenceDigest = createHash("sha256").update(JSON.stringify(expectedReferences)).digest("hex");
  return {
    sourceCommit: releaseCommit,
    hostAssetSource: "embedded",
    filesCompared: files.length,
    bytesCompared: totalBytes,
    treeSha256: tree.digest("hex"),
    shellReferencesCompared: expectedReferences.length,
    shellReferencesSha256: referenceDigest,
  };
}

async function openQuickChat(targetPage, mobile = false) {
  await targetPage.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  if (mobile) {
    await targetPage.getByTestId("app-nav-trigger").tap();
    await targetPage.getByTestId("mobile-quick-chat-button").tap();
  } else {
    await targetPage.getByTestId("sidebar-quick-chat-shortcut").click();
  }
  const dialog = targetPage.getByRole("dialog", { name: "Quick Chat" });
  await dialog.waitFor({ state: "visible", timeout: 20000 });
  await dialog.getByTestId("quick-chat-setup").waitFor({ state: "visible", timeout: 15000 });
  await dialog
    .locator('[data-testid="task-description-input"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await dialog.getByTestId("quick-chat-send").waitFor({ state: "visible" });
  await dialog.locator(actionSelector).waitFor({ state: "visible", timeout: 15000 });
  if (mobile) {
    // Quick Chat enters as an animated dialog. Wait for the host-owned touch
    // target to reach its settled size before measuring its minimum geometry.
    await targetPage.waitForFunction(
      (selector) => {
        const element = document.querySelector(selector);
        const bounds = element?.getBoundingClientRect();
        return Boolean(bounds && bounds.width >= 44 && bounds.height >= 44);
      },
      actionSelector,
      { timeout: 5000 },
    );
  }
  return dialog;
}

async function dismissFirstRunOnboarding(targetPage) {
  await targetPage.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await targetPage.waitForFunction(
    () =>
      document.querySelector('[data-testid="sidebar-quick-chat-shortcut"]') ||
      [...document.querySelectorAll("h1, h2, h3")].some((heading) => heading.textContent?.trim() === "AI Agents"),
    undefined,
    { timeout: 15000 },
  );
  const agentsStep = targetPage.getByRole("heading", { name: "AI Agents", exact: true });
  if (await agentsStep.count()) {
    await targetPage.getByRole("button", { name: "Skip", exact: true }).click();
    await agentsStep.waitFor({ state: "detached", timeout: 10000 });
  }
}

async function assertUnscopedQuickChatAction(targetPage, dialog, presentation) {
  const action = dialog.locator(actionSelector);
  const accessibleAction = dialog.getByRole("button", { name: actionName, exact: true });
  assert.equal(await accessibleAction.count(), 1, "opening composer action has accessible name");
  assert.equal(await action.getAttribute("data-surface"), "composer");
  assert.equal(await action.getAttribute("data-presentation"), presentation);
  assert.equal(await dialog.getByText("Select agent", { exact: true }).count(), 1);
  const sendButton = dialog.getByTestId("quick-chat-send");
  assert.equal(await sendButton.isDisabled(), true, "opening composer send is disabled before a profile/prompt");
  assert.equal(await action.isDisabled(), false, "navigation action stays enabled while send is disabled");
  assert.notEqual(await action.getAttribute("aria-disabled"), "true");

  // The template action appends task context to its tooltip when the host
  // supplies a task id/title. An unscoped opening composer has no such suffix.
  if (presentation === "desktop") {
    await action.hover();
    const tooltip = targetPage.getByRole("tooltip");
    await tooltip.waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await tooltip.innerText(), actionName, "opening composer has no task context");
    await targetPage.mouse.move(0, 0);
  }
  return { sendDisabled: true, actionDisabled: false, taskContext: null, presentation };
}

try {
  const servedWebAssets = await verifyServedReleaseAssets();
  await dismissFirstRunOnboarding(page);
  await openTask(page);
  await page.locator(actionSelector).waitFor({ state: "visible", timeout: 30000 });
  const action = page.locator(actionSelector);
  const accessibleAction = page.getByRole("button", { name: actionName, exact: true });
  assert.equal(await accessibleAction.count(), 1, "Action has its accessible label");
  assert.equal(await action.getAttribute("aria-label"), actionName);
  const desktopBounds = await action.boundingBox();
  assert.ok(desktopBounds, "desktop Action has a visible bounding box");
  assert.equal(desktopBounds.width, 28, "host owns the 28px desktop action width");
  assert.equal(desktopBounds.height, 28, "host owns the 28px desktop action height");
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

  const quickChat = await openQuickChat(page);
  const quickChatDesktop = await assertUnscopedQuickChatAction(page, quickChat, "desktop");
  const quickChatDesktopBounds = await quickChat.locator(actionSelector).boundingBox();
  assert.ok(quickChatDesktopBounds, "desktop Quick Chat Action has a visible bounding box");
  assert.equal(quickChatDesktopBounds.width, 28, "Quick Chat keeps host 28px desktop width");
  assert.equal(quickChatDesktopBounds.height, 28, "Quick Chat keeps host 28px desktop height");
  await page.screenshot({ path: resolve(screenshotDir, "quick-chat-opening-desktop.png"), fullPage: true });
  await quickChat.locator(actionSelector).focus();
  assert.equal(
    await quickChat.locator(actionSelector).evaluate((element) => document.activeElement === element),
    true,
  );
  await quickChat.locator(actionSelector).press("Enter");
  await page.waitForURL("**/template", { timeout: 15000 });
  await page.getByText("buffer 0 of 5", { exact: true }).waitFor({ state: "visible" });
  results.push({
    case: "desktop Quick Chat opening composer, no task/session scope, disabled send, keyboard navigation",
    bounds: quickChatDesktopBounds,
    ...quickChatDesktop,
  });

  const mobileContext = await browser.newContext({
    ...devices["Pixel 5"],
    storageState: await context.storageState(),
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  mobile.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await dismissFirstRunOnboarding(mobile);
  await openTask(mobile);
  const mobileTaskAction = mobile.locator(actionSelector);
  assert.equal(await mobileTaskAction.getAttribute("data-surface"), "composer");
  assert.equal(await mobileTaskAction.getAttribute("data-presentation"), "mobile");
  assert.equal(await mobile.getByRole("button", { name: actionName, exact: true }).count(), 1);
  const mobileTaskBounds = await mobileTaskAction.boundingBox();
  assert.ok(mobileTaskBounds, "phone task Action has a visible bounding box");
  assert.ok(mobileTaskBounds.width >= 44, "phone task target is at least 44px wide");
  assert.ok(mobileTaskBounds.height >= 44, "phone task target is at least 44px high");
  const phone = await mobile.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    touchPoints: navigator.maxTouchPoints,
  }));
  assert.equal(phone.width, devices["Pixel 5"].viewport.width);
  assert.equal(phone.coarsePointer, true, "phone uses coarse-pointer emulation");
  assert.ok(phone.touchPoints > 0, "phone touch input is enabled");
  assert.ok(phone.documentWidth <= phone.width, "task composer has no horizontal overflow");
  assert.ok(mobileTaskBounds.x >= 0 && mobileTaskBounds.x + mobileTaskBounds.width <= phone.width + 1);
  await mobile.screenshot({ path: resolve(screenshotDir, "pixel-5-action.png"), fullPage: true });
  await mobileTaskAction.tap();
  await mobile.waitForURL("**/template", { timeout: 15000 });
  await mobile.getByText("buffer 0 of 5", { exact: true }).waitFor({ state: "visible" });
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "plugin route has no horizontal overflow on phone",
  );
  results.push({ case: "Pixel 5 task composer touch, target size, fit, and navigation", bounds: mobileTaskBounds, ...phone });

  const mobileQuickChat = await openQuickChat(mobile, true);
  const quickChatMobile = await assertUnscopedQuickChatAction(mobile, mobileQuickChat, "mobile");
  const mobileAction = mobileQuickChat.locator(actionSelector);
  assert.equal(await mobileAction.getAttribute("data-surface"), "composer");
  assert.equal(await mobileAction.getAttribute("data-presentation"), "mobile");
  assert.equal(await mobile.getByRole("button", { name: actionName, exact: true }).count(), 1);
  const mobileBounds = await mobileAction.boundingBox();
  assert.ok(mobileBounds, "phone Quick Chat Action has a visible bounding box");
  assert.ok(mobileBounds.width >= 44, "phone target is at least 44px wide");
  assert.ok(mobileBounds.height >= 44, "phone target is at least 44px high");
  const quickChatPhone = await mobile.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    touchPoints: navigator.maxTouchPoints,
  }));
  assert.equal(quickChatPhone.width, devices["Pixel 5"].viewport.width);
  assert.equal(quickChatPhone.coarsePointer, true, "phone uses coarse-pointer emulation");
  assert.ok(quickChatPhone.touchPoints > 0, "phone touch input is enabled");
  assert.ok(quickChatPhone.documentWidth <= quickChatPhone.width, "Quick Chat has no horizontal overflow");
  assert.ok(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= quickChatPhone.width + 1);
  await mobile.screenshot({ path: resolve(screenshotDir, "quick-chat-opening-pixel-5.png"), fullPage: true });
  await mobileAction.tap();
  await mobile.waitForURL("**/template", { timeout: 15000 });
  await mobile.getByText("buffer 0 of 5", { exact: true }).waitFor({ state: "visible" });
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "plugin route has no horizontal overflow on phone",
  );
  results.push({
    case: "Pixel 5 Quick Chat opening composer, no task/session scope, disabled send, touch navigation",
    bounds: mobileBounds,
    ...quickChatMobile,
    ...quickChatPhone,
  });
  await mobileContext.close();

  assert.deepEqual(errors, [], "browser reports no plugin or host page errors");
  console.log(
    JSON.stringify({ hostVersion: health.version, servedWebAssets, results, pageErrors: errors }, null, 2),
  );
} finally {
  await context.close();
  await browser.close();
}
