#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';

const revision = 'a2790e494c670574ebcd12320fe61c77805f768a';
const repository =
  'https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb.git';
const root = process.cwd();
const project = join(root, 'reactivecore');
const manifestPath = join(project, 'project.json');
const configurationPath = join(project, '.env');
const cache = join(root, '.reactivecore');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const developmentIssuer = 'urn:reactivecore:development';

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: 'inherit', ...options });
}

function engineDirectory() {
  if (process.env.RC_ENGINE_DIR) return resolve(process.env.RC_ENGINE_DIR);
  mkdirSync(cache, { recursive: true });
  const destination = join(cache, revision);
  if (!existsSync(destination)) {
    const staging = mkdtempSync(join(cache, 'engine-'));
    try {
      run('git', ['init', '--quiet', staging]);
      run('git', [
        '-C',
        staging,
        'fetch',
        '--quiet',
        '--depth=1',
        repository,
        revision,
      ]);
      run('git', [
        '-C',
        staging,
        'checkout',
        '--quiet',
        '--detach',
        'FETCH_HEAD',
      ]);
      renameSync(staging, destination);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return destination;
}

function backend(engine, ...args) {
  return [
    process.execPath,
    [join(engine, 'scripts/reactivecore.mjs'), ...args],
  ];
}

function initialize() {
  if (!existsSync(join(root, 'package.json')))
    throw new Error(
      'Run init from the frontend directory containing package.json.',
    );
  if (existsSync(project))
    throw new Error(
      'reactivecore/ already exists. Use the existing project or back it up before initializing again.',
    );
  const ignore = join(root, '.gitignore');
  const existing = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  const missing = ['/.reactivecore/', '/reactivecore/.env'].filter(
    (entry) => !existing.split(/\r?\n/).includes(entry),
  );
  if (missing.length)
    writeFileSync(
      ignore,
      [existing.trimEnd(), ...missing].filter(Boolean).join('\n') + '\n',
    );

  const engine = engineDirectory();
  const source = join(engine, 'scripts/test-fixtures/project');
  const name =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^([0-9])/, 'app-$1')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'app';
  const manifest = JSON.parse(
    readFileSync(join(source, 'project.json'), 'utf8'),
  );
  manifest.name = name;
  manifest.mysql = { tables: ['items', 'charges'] };
  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(join(cache, 'project-'));
  const generated = join(staging, 'reactivecore');
  try {
    cpSync(source, generated, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    writeFileSync(
      join(generated, 'project.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    const password = () => randomBytes(24).toString('hex');
    writeFileSync(
      join(generated, '.env'),
      [
        'PORT=4000',
        'RC_CORS_ORIGINS=http://localhost:3000,http://localhost:5173',
        `RC_TENANT_ID=${randomUUID()}`,
        `RC_USER_ID=${randomUUID()}`,
        `RC_JWT_DEV_SECRET=${password()}`,
        'POSTGRES_PORT=56432',
        'REDIS_PORT=57379',
        `POSTGRES_PASSWORD=${password()}`,
        `REDIS_PASSWORD=${password()}`,
        `RC_PROVISION_APP_PASSWORD=${password()}`,
        `RC_PROVISION_WORKER_PASSWORD=${password()}`,
        '',
        '# To use your own SQL server, configure all three URLs.',
        '# RC_PROVISION_ADMIN_URL=',
        '# RC_APP_DATABASE_URL=',
        '# RC_WORKER_DATABASE_URL=',
        '# RC_PROVISION_EXISTING_DATABASE=1',
        '# To use your own Redis, configure its URL.',
        '# REDIS_URL=',
        '',
      ].join('\n'),
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(generated, project);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    'Created reactivecore/.env, the project manifest, migrations, and example functions.',
  );
}

function configuration() {
  if (!existsSync(manifestPath) || !existsSync(configurationPath))
    throw new Error('Run npx reactivecore init in this frontend first.');
  const settings = {
    ...parseEnv(readFileSync(configurationPath, 'utf8')),
    ...process.env,
  };
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name))
    throw new Error('Invalid backend project slug.');
  return { settings, name };
}

function runtimeSettings(settings, name) {
  const {
    RC_PROVISION_ADMIN_URL,
    RC_APP_DATABASE_URL,
    RC_WORKER_DATABASE_URL,
  } = settings;
  const external = Boolean(
    RC_PROVISION_ADMIN_URL || RC_APP_DATABASE_URL || RC_WORKER_DATABASE_URL,
  );
  if (
    external &&
    !(RC_PROVISION_ADMIN_URL && RC_APP_DATABASE_URL && RC_WORKER_DATABASE_URL)
  )
    throw new Error(
      'Set all three SQL URLs in reactivecore/.env to use your own database.',
    );
  const database = `reactivecore_${name.replaceAll('-', '_')}`;
  const pg = (role, password, db) =>
    `postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${settings.POSTGRES_PORT}/${db}`;
  const redisUrl =
    settings.REDIS_URL ||
    `redis://:${encodeURIComponent(settings.REDIS_PASSWORD)}@127.0.0.1:${settings.REDIS_PORT}`;
  const env = {
    ...settings,
    NODE_ENV: 'development',
    RC_HOST: '127.0.0.1',
    REDIS_URL: redisUrl,
    RC_JWT_ISSUER: developmentIssuer,
    RC_JWT_AUDIENCE: `reactivecore:${name}`,
    RC_JWKS_URL: '',
  };
  const admin = { ...env };
  if (external) {
    delete admin.RC_PROVISION_APP_PASSWORD;
    delete admin.RC_PROVISION_WORKER_PASSWORD;
  } else {
    admin.RC_PROVISION_ADMIN_URL = pg(
      'reactivecore',
      settings.POSTGRES_PASSWORD,
      'postgres',
    );
    delete admin.RC_PROVISION_EXISTING_DATABASE;
  }
  delete env.RC_PROVISION_ADMIN_URL;
  delete env.RC_PROVISION_APP_PASSWORD;
  delete env.RC_PROVISION_WORKER_PASSWORD;
  delete env.RC_APP_DATABASE_URL;
  delete env.RC_WORKER_DATABASE_URL;
  delete env.POSTGRES_PASSWORD;
  delete env.REDIS_PASSWORD;
  const worker = {
    ...env,
    DATABASE_URL:
      RC_WORKER_DATABASE_URL ||
      pg(
        'reactivecore_worker',
        settings.RC_PROVISION_WORKER_PASSWORD,
        database,
      ),
  };
  delete worker.RC_JWT_DEV_SECRET;
  return {
    admin,
    worker,
    api: {
      ...env,
      DATABASE_URL:
        RC_APP_DATABASE_URL ||
        pg('reactivecore_app', settings.RC_PROVISION_APP_PASSWORD, database),
    },
    services: [
      ...(external ? [] : ['postgres']),
      ...(settings.REDIS_URL ? [] : ['redis']),
    ],
  };
}

function generate(engine) {
  run(...backend(engine, 'codegen', project, 'reactivecore-client'), {
    cwd: engine,
  });
}

function token(settings, name) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = [
    encode({ alg: 'HS256' }),
    encode({
      iss: developmentIssuer,
      aud: `reactivecore:${name}`,
      sub: settings.RC_USER_ID,
      tenant_id: settings.RC_TENANT_ID,
      scope: 'query mutation subscribe',
      iat: now,
      exp: now + 900,
    }),
  ].join('.');
  const signature = createHmac('sha256', settings.RC_JWT_DEV_SECRET)
    .update(body)
    .digest('base64url');
  console.log(`${body}.${signature}`);
}

function buildEngine(engine) {
  if (!existsSync(join(engine, 'apps/api/dist/platform-main.js'))) {
    run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: engine });
    run(npm, ['run', 'build'], { cwd: engine });
  }
}

async function requireAvailablePort(port) {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Set PORT to an available TCP port in reactivecore/.env.');
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `Port ${port} is unavailable. Set another PORT in reactivecore/.env.`,
        ),
      ),
    );
    probe.listen(Number(port), '127.0.0.1', () => probe.close(resolvePort));
  });
}

async function development(engine, settings, name, frontend) {
  const port = settings.PORT ?? '4000';
  await requireAvailablePort(port);
  const runtime = runtimeSettings(settings, name);
  buildEngine(engine);
  generate(engine);
  if (runtime.services.length) {
    const projectName =
      'reactivecore-' +
      createHash('sha256').update(root).digest('hex').slice(0, 12);
    run(
      'docker',
      [
        'compose',
        '-f',
        join(engine, 'compose.yaml'),
        '-p',
        projectName,
        'up',
        '-d',
        '--wait',
        ...runtime.services,
      ],
      {
        env: {
          ...settings,
          POSTGRES_DB: 'postgres',
          POSTGRES_USER: 'reactivecore',
        },
      },
    );
  }
  run(...backend(engine, 'provision', project), {
    cwd: engine,
    env: runtime.admin,
  });
  run(...backend(engine, 'tenant', project, settings.RC_TENANT_ID), {
    cwd: engine,
    env: runtime.admin,
  });

  const children = [];
  let stopping = false;
  function stop() {
    stopping = true;
    for (const child of children) {
      if (!child.pid) continue;
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  function start(file, args, cwd, env) {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    children.push(child);
    return new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const api = start(
      ...backend(engine, 'serve', project),
      engine,
      runtime.api,
    );
    const worker = start(
      ...backend(engine, 'worker', project),
      engine,
      runtime.worker,
    );
    const exited = Promise.race([api, worker]).then((code) => code || 1);
    const origin = `http://127.0.0.1:${port}`;
    const deadline = AbortSignal.timeout(30000);
    async function waitReady() {
      while (!stopping && !deadline.aborted) {
        const response = await fetch(`${origin}/api/health/ready`, {
          signal: deadline,
        }).catch(() => undefined);
        if (response?.ok) return;
        await delay(200);
      }
      throw new Error('The ReactiveCore API did not become ready.');
    }
    const premature = await Promise.race([waitReady(), exited]);
    if (premature !== undefined) {
      if (!stopping)
        throw new Error('The ReactiveCore runtime exited before readiness.');
      return;
    }
    console.log(
      `ReactiveCore API ready at ${origin}. Run npx reactivecore token for a development JWT.`,
    );
    const result = frontend.length
      ? await Promise.race([
          exited,
          start(frontend[0], frontend.slice(1), root, process.env),
        ])
      : await exited;
    if (!stopping) process.exitCode = result;
  } finally {
    stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

async function main() {
  const [command, delimiter, ...frontend] = process.argv.slice(2);
  if (
    !['init', 'dev', 'codegen', 'token'].includes(command) ||
    (delimiter !== undefined &&
      (command !== 'dev' || delimiter !== '--' || !frontend.length))
  )
    throw new Error(
      'Usage: reactivecore <init|dev|codegen|token> [-- <frontend command>]',
    );
  if (command === 'init') return initialize();
  const { settings, name } = configuration();
  if (command === 'token') return token(settings, name);
  const engine = engineDirectory();
  if (command === 'codegen') {
    buildEngine(engine);
    return generate(engine);
  }
  await development(engine, settings, name, frontend);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
