import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { eventually, request } from '../scripts/smoke-http.mjs';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('polls through restart HTTP 503 until the real endpoint recovers', async (t) => {
  let attempts = 0;
  const base = await serve(t, (_req, res) => {
    res.statusCode = ++attempts < 3 ? 503 : 200;
    res.end(attempts < 3 ? 'restarting' : 'active');
  });
  await eventually(async (signal) => (await (await request(base, '/plugin', { signal })).text()) === 'active', 'plugin did not recover', { timeoutMs: 2000, intervalMs: 1 });
  assert.equal(attempts, 3);
});

test('does not hide permanent authorization errors', async (t) => {
  let attempts = 0;
  const base = await serve(t, (_req, res) => { attempts++; res.writeHead(403).end('denied'); });
  await assert.rejects(eventually(async (signal) => (await request(base, '/plugin', { signal })).ok, 'timeout'), /403.*denied/);
  assert.equal(attempts, 1);
});

test('does not hide programming errors in a polling check', async () => {
  const failure = new TypeError('invalid predicate');
  await assert.rejects(eventually(async () => { throw failure; }, 'timeout'), (error) => error === failure);
});

test('persistent restart failures fail with the last endpoint error', async (t) => {
  let attempts = 0;
  const base = await serve(t, (_req, res) => { attempts++; res.writeHead(503).end('still restarting'); });
  await assert.rejects(eventually(async (signal) => (await request(base, '/plugin', { signal })).ok, 'plugin did not recover', { timeoutMs: 1000, intervalMs: 100 }), /plugin did not recover.*503.*still restarting/);
  assert.ok(attempts >= 2, 'persistent failure must exercise retries');
});

test('aborts a response that arrives after the polling deadline', async (t) => {
  const base = await serve(t, (_req, res) => { setTimeout(() => res.end('active'), 200); });
  await assert.rejects(eventually(async (signal) => (await (await request(base, '/plugin', { signal })).text()) === 'active', 'plugin did not recover', { timeoutMs: 50, intervalMs: 1 }), /plugin did not recover.*timeout/i);
});

test('aborts a response body that stalls after headers', async (t) => {
  const base = await serve(t, (_req, res) => { res.writeHead(200); res.flushHeaders(); setTimeout(() => res.end('active'), 200); });
  await assert.rejects(eventually(async (signal) => (await (await request(base, '/plugin', { signal })).text()) === 'active', 'body did not recover', { timeoutMs: 50, intervalMs: 1 }), /body did not recover.*timeout/i);
});

test('a recovered endpoint with an unsatisfied condition does not report stale HTTP errors', async (t) => {
  let attempts = 0;
  const base = await serve(t, (_req, res) => { res.writeHead(++attempts === 1 ? 503 : 200).end('starting'); });
  await assert.rejects(eventually(async (signal) => (await (await request(base, '/plugin', { signal })).text()) === 'active', 'waiting for active', { timeoutMs: 500, intervalMs: 300 }), (error) => error.message === 'waiting for active');
  assert.ok(attempts > 1);
});
