import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingVulnerabilities } from './audit-dependencies.mjs';
const advisory = { url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' };
const audit = { vulnerabilities: {
  picomatch: { severity: 'high', via: [advisory], nodes: ['node_modules/picomatch'] },
  vitest: { severity: 'high', via: ['picomatch'], nodes: ['node_modules/vitest'] },
} };
const lock = { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/vitest': { dev: true } } };
const now = new Date('2026-11-18');
test('permits only the known development-only advisory before its expiry', () => {
  assert.deepEqual(blockingVulnerabilities(audit, lock, now), []);
});
test('blocks production exposure and expired exceptions', () => {
  assert.equal(blockingVulnerabilities(audit, { packages: {} }, now).length, 2);
  assert.equal(blockingVulnerabilities(audit, lock, new Date('2026-12-19')).length, 2);
});
test('blocks any additional advisory, including a transitive one', () => {
  const report = structuredClone(audit);
  report.vulnerabilities.picomatch.via.push({ url: 'https://github.com/advisories/GHSA-new' });
  assert.equal(blockingVulnerabilities(report, lock, now).length, 2);
});
