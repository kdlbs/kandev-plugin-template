// Run only against a disposable host. This installs/configures/disables the
// template and creates local tasks; it does not start agents or use providers.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { eventually, request as smokeRequest } from './smoke-http.mjs';

const base = process.env.KANDEV_SMOKE_URL;
assert.ok(base, 'Set KANDEV_SMOKE_URL to a disposable host');
const record = JSON.parse(await readFile(new URL('../node_modules/@kdlbs/plugin-sdk/sdk-release.json', import.meta.url)));
const plugin = '/api/plugins/kandev-plugin-template';
const checks = [];
const passed = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const request = (path, options) => smokeRequest(base, path, options);
const json = async (path, options) => (await request(path, options)).json();
const post = (path, body) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function navigateWithinDocument(page, path) {
  await page.evaluate((target) => {
    history.pushState({}, '', target);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, path);
  await page.waitForURL((url) => url.pathname === path);
}
const health = await json('/health');
assert.equal(health.version, `v${record.min_kandev_version}`);
passed(`official host reports ${health.version}`);
if (process.env.KANDEV_SMOKE_PACKAGE) {
  const form = new FormData();
  form.set('package', new Blob([await readFile(process.env.KANDEV_SMOKE_PACKAGE)]), 'template.tar.gz');
  const installed = await json('/api/plugins/install', { method: 'POST', body: form });
  assert.equal(installed.warning, undefined);
  assert.equal(installed.plugin.status, 'active');
  assert.equal(installed.plugin.api_version, 1);
  assert.equal(installed.plugin.min_kandev_version, record.min_kandev_version);
  passed('archive installs active with API v1 and the published SDK floor');
}
const served = await request(`${plugin}/bundle`);
assert.equal(await served.text(), await readFile(new URL('../ui/bundle.js', import.meta.url), 'utf8'));
passed('host serves the exact packaged UI module');
assert.equal(await (await request(`${plugin}/webhooks/ping`, { method: 'POST' })).text(), 'Hello, webhook!');
passed('API v1 explicitly public webhook retains its default greeting');
await json(plugin, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { greeting: 'SDK smoke', api_token: 'disposable-fixture' } }) });
await eventually(async () => (await (await request(`${plugin}/webhooks/ping`, { method: 'POST' })).text()) === 'SDK smoke, webhook!', 'configuration restart did not reach Host.GetConfig');
assert.deepEqual((await json(`${plugin}/config`)).config, { greeting: 'SDK smoke', api_token: '********' });
passed('configuration restart reaches Host.GetConfig and masks the example secret');

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const pageErrors = [];
const consoleErrors = [];
try {
  for (const device of ['desktop', 'phone']) {
    const context = await browser.newContext(device === 'phone' ? devices['Pixel 5'] : { viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push({ device, text: message.text() });
    });
    await page.goto(`${base}/template`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Template plugin', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'About this page' }).click();
    await page.getByText('Where these rows come from', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${device} horizontal overflow`);
    passed(`${device}: native route, host components, popover, viewport fit`);

    const workspace = (await json('/api/v1/workspaces')).workspaces[0];
    const workflow = (await json(`/api/v1/workspaces/${workspace.id}/workflows`)).workflows[0];
    const title = `SDK smoke ${device} ${Date.now()}`;
    const task = await post('/api/v1/tasks', { workspace_id: workspace.id, workflow_id: workflow.id, title, start_agent: false });
    await page.getByRole('cell', { name: title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByText('No tasks created yet', { exact: true }).waitFor();
    passed(`${device}: task.created WS delivery, table and Clear`);

    // A task without a running agent still exposes the setup composer.
    await page.goto(`${base}/t/${task.id}`, { waitUntil: 'domcontentloaded' });
    const action = page.locator('#template-chat-action');
    await action.waitFor();
    assert.equal(await action.count(), 1);
    assert.match(await action.getAttribute('aria-label'), /Template.*open page/);
    if (device === 'phone') await action.tap();
    else { await action.focus(); await page.keyboard.press('Enter'); }
    await page.waitForURL('**/template');
    passed(`${device}: one composer Action, accessible name and ${device === 'phone' ? 'touch' : 'keyboard'} navigation`);

    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    // The operator UI owns unloading/loading browser registrations. A direct
    // backend API call changes the process status but does not run that UI hook.
    // Soft route changes keep the same JavaScript registry alive throughout.
    await navigateWithinDocument(page, '/settings/plugins/kandev-plugin-template');
    await page.getByRole('button', { name: 'Disable', exact: true }).click();
    await page.getByRole('button', { name: 'Enable', exact: true }).waitFor();
    await eventually(async () => (await json(plugin)).status === 'disabled', 'plugin did not disable');
    await navigateWithinDocument(page, `/t/${task.id}`);
    await page.getByTestId('chat-input-area').waitFor();
    await eventually(async () => await action.count() === 0, 'Action did not unregister on disable');
    await navigateWithinDocument(page, '/settings/plugins/kandev-plugin-template');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await page.getByRole('button', { name: 'Disable', exact: true }).waitFor();
    await eventually(async () => (await json(plugin)).status === 'active', 'plugin did not re-enable');
    await navigateWithinDocument(page, `/t/${task.id}`);
    await page.getByTestId('chat-input-area').waitFor();
    await action.waitFor();
    assert.equal(await action.count(), 1);
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, 'lifecycle check reloaded the browser document');
    assert.equal(await (await request(`${plugin}/webhooks/ping`, { method: 'POST' })).text(), 'SDK smoke, webhook!');
    passed(`${device}: disable/re-enable preserves config and exactly one registration`);
    if (process.env.KANDEV_SMOKE_SCREENSHOTS) {
      await mkdir(process.env.KANDEV_SMOKE_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.KANDEV_SMOKE_SCREENSHOTS}/${device}.png` });
    }
    await context.close();
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  passed('no browser page or console errors');
} finally {
  await browser.close();
}
console.log(JSON.stringify({ host: health.version, sdk: record.sdk_version, checks, consoleErrors }, null, 2));
