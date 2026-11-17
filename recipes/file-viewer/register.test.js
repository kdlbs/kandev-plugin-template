import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountFilePreview } from './register.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('mounts admitted bytes and disposes resources on collapse or close', async () => {
  const container = {}; const bytes = new ArrayBuffer(2); let disposed = 0; let signal;
  const close = mountFilePreview(container, async () => bytes, (target, data, abort) => {
    assert.equal(target, container); assert.equal(data, bytes); signal = abort;
    return () => disposed++;
  }, () => assert.fail('unexpected error'));
  await tick(); close(); close();
  assert.equal(disposed, 1); assert.equal(signal.aborted, true);
});
test('does not render a read that resolves after unmount', async () => {
  let complete; let rendered = false;
  const close = mountFilePreview({}, () => new Promise(resolve => { complete = resolve; }), () => { rendered = true; }, () => assert.fail());
  await tick(); close(); complete(new ArrayBuffer(0)); await tick();
  assert.equal(rendered, false);
});
test('reports failures without exposing raw parser errors', async () => {
  let errors = 0;
  mountFilePreview({}, async () => { throw Error('private path'); }, () => assert.fail(), () => errors++);
  await tick(); assert.equal(errors, 1);
});
