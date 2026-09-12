import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { build } from 'esbuild';

// Always use a fresh local cluster. No existing connection or application data
// is read, and the cluster is removed even when an assertion fails.
const root = await mkdtemp(join(tmpdir(), 'ytdb-timeline-'));
const data = join(root, 'pg');
const bundle = join(process.cwd(), 'node_modules', `.ytdb-timeline-tests-${process.pid}.cjs`);
let started = false;
try {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${root}`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  await writeFile(join(root, 'server-only.js'), '');
  await build({ entryPoints: ['tests/migration-timeline.test.ts'], outfile: bundle, bundle: true,
    platform: 'node', format: 'cjs', packages: 'external',
    alias: { 'server-only': join(root, 'server-only.js') } });
  const result = spawnSync(process.execPath, ['--test', bundle], { stdio: 'inherit', env: {
    ...process.env, YTDB_TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres`,
  } });
  process.exitCode = result.status ?? 1;
} finally {
  if (started) execFileSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  await rm(bundle, { force: true });
  await rm(root, { recursive: true, force: true });
}
