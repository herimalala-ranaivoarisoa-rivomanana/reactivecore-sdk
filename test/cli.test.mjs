import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/reactivecore.mjs', import.meta.url));

test('initializes a frontend without overwriting it and issues a matching dev token', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'reactivecore-cli-'));
  try {
    const engine = join(workspace, 'engine');
    const frontend = join(workspace, 'frontend');
    const fixture = join(engine, 'scripts/test-fixtures/project');
    mkdirSync(fixture, { recursive: true });
    mkdirSync(frontend);
    writeFileSync(
      join(fixture, 'project.json'),
      JSON.stringify({ queries: {} }),
    );
    writeFileSync(join(frontend, 'package.json'), '{"private":true}');
    writeFileSync(join(frontend, '.gitignore'), 'node_modules');
    const run = (command) =>
      execFileSync(process.execPath, [cli, command], {
        cwd: frontend,
        env: { ...process.env, RC_ENGINE_DIR: engine },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });

    run('init');
    const settingsPath = join(frontend, 'reactivecore/.env');
    const settingsText = readFileSync(settingsPath, 'utf8');
    const settings = parseEnv(settingsText);
    if (process.platform !== 'win32')
      assert.equal(statSync(settingsPath).mode & 0o777, 0o600);
    assert.equal(
      readFileSync(join(frontend, '.gitignore'), 'utf8'),
      'node_modules\n/.reactivecore/\n/reactivecore/.env\n',
    );
    assert.equal(
      readFileSync(join(frontend, 'package.json'), 'utf8'),
      '{"private":true}',
    );
    assert.throws(() => run('init'), /reactivecore\/ already exists/);
    assert.equal(readFileSync(settingsPath, 'utf8'), settingsText);

    const [header, payload, signature] = run('token').trim().split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.tenant_id, settings.RC_TENANT_ID);
    assert.equal(claims.sub, settings.RC_USER_ID);
    assert.equal(claims.aud, 'reactivecore:frontend');
    assert.equal(claims.exp - claims.iat, 900);
    assert.equal(
      signature,
      createHmac('sha256', settings.RC_JWT_DEV_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url'),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
