import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// No patched release exists as of 2026-11-18. Test discovery uses repository-owned
// glob patterns. Keep this exception limited to development dependencies and
// this advisory. Remove it when upstream publishes a fix; review by 2026-12-18.
const advisoryURL = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expires = Date.parse('2026-12-18T00:00:00Z');
export function blockingVulnerabilities(report, lock, now = new Date()) {
  if (!report.vulnerabilities || !lock.packages) throw Error('Invalid audit or lockfile response');
  function allowed(name, visited = new Set()) {
    const entry = report.vulnerabilities[name];
    if (!entry || visited.has(name) || now.getTime() >= expires) return false;
    if (!entry.nodes?.length || entry.nodes.some(node => lock.packages[node]?.dev !== true)) return false;
    const next = new Set([...visited, name]);
    return entry.via?.length > 0 && entry.via.every(via =>
      typeof via === 'string' ? allowed(via, next) : via.url === advisoryURL);
  }
  return Object.entries(report.vulnerabilities)
    .filter(([name, entry]) => ['high', 'critical'].includes(entry.severity) && !allowed(name))
    .map(([name]) => name);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', timeout: 120000 });
  if (result.error || ![0, 1].includes(result.status)) throw result.error ?? Error(result.stderr);
  const report = JSON.parse(result.stdout);
  if (report.error) throw Error(JSON.stringify(report.error));
  const blocked = blockingVulnerabilities(report, JSON.parse(readFileSync('package-lock.json', 'utf8')));
  if (blocked.length) {
    console.error(result.stdout);
    console.error('Blocking vulnerabilities:', blocked.join(', '));
    process.exitCode = 1;
  } else {
    console.log('No blocking high or critical vulnerabilities.');
    if (Object.keys(report.vulnerabilities).length) {
      console.log(`Development-only exception: ${advisoryURL}, expires 2026-12-18.`);
    }
  }
}
