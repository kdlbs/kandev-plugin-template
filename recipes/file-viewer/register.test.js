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

test('recovers from a failed read with a mounted container on the next generation', async () => {
  const React = await import('react');
  const { create, act } = await import('react-test-renderer');
  const { registerFileViewer } = await import('./register.js');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let Viewer;
  const targets = [];
  const container = {};
  registerFileViewer({ registerFileViewer: entry => { Viewer = entry.Component; } }, {
    React, i18n: { useTranslation: () => ({ t: key => key }) },
  }, { id: 'shape', errorKey: 'failed', render: target => { targets.push(target); } });
  let tree;
  try {
    await act(async () => {
      tree = create(React.createElement(Viewer, {
        file: { generation: 1 }, readBytes: async () => { throw Error('failed read'); },
      }), { createNodeMock: element => element.type === 'div' ? container : null });
    });
    assert.equal(tree.root.findByProps({ role: 'alert' }).children[0], 'failed');
    await act(async () => {
      tree.update(React.createElement(Viewer, {
        file: { generation: 2 }, readBytes: async () => new ArrayBuffer(0),
      }));
    });
    assert.deepEqual(targets, [container]);
    assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0);
  } finally {
    await act(async () => tree?.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
