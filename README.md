# ReactiveCore SDK

Add live queries and offline mutations to an existing React, Next.js, Vue or Nuxt app. The SDK connects to a running ReactiveCore API. The backend runs an API and an outbox worker. Connect them to a PostgreSQL or MySQL database and a Redis instance of your choice.

## Start from an existing frontend

Run these steps from the React, Next.js, Vue or Nuxt app that already contains your `package.json`. Use Node.js 24 and Git. For the default local PostgreSQL and Redis services, install Docker with Compose.

### Install the SDK with the development CLI

The development CLI is included in version `0.2.0-alpha.7` and later. Once that version is available on npm, install it from your frontend root.

```sh
npm install reactivecore-client@0.2.0-alpha.7
```

To try the CLI from source instead, set `SDK_DIR` to an absolute path to the SDK checkout that includes `bin/reactivecore.mjs`.

```sh
SDK_DIR=/absolute/path/to/reactivecore-sdk
test -f "$SDK_DIR/bin/reactivecore.mjs"
SDK_ARCHIVE=$(cd "$SDK_DIR" && npm ci >&2 && npm pack --silent)
npm install "$SDK_DIR/$SDK_ARCHIVE"
```

If you already have a running ReactiveCore API and only need the frontend library, you can use the published SDK instead. [Install the library](#2-install-in-your-existing-frontend)

### Initialize and run the app

From the frontend root, create the backend project files once.

```sh
npx reactivecore init
```

| Path | Purpose |
| --- | --- |
| `reactivecore/application.mjs` | Your queries and mutations. The initializer includes the live items example. |
| `reactivecore/project.json` | The project name and the function contracts used to generate types. |
| `reactivecore/migrations/` | Your PostgreSQL and MySQL migrations. |
| `reactivecore/.env` | Your development settings and backend credentials. This file is ignored by Git. |
| `.reactivecore/` | The pinned MultiDB checkout and build used by the CLI. This directory is ignored by Git. |

For the default PostgreSQL and Redis containers, go straight to startup. To use services you already manage, first edit `reactivecore/.env` with the connection settings below. [Use your own database or Redis](#use-your-own-database-or-redis)

```sh
npx reactivecore dev -- npm run dev
```

On the first start, the CLI builds the backend, prepares the database, registers a development tenant and writes the typed client to `reactivecore/client.ts`. It starts the API and worker, waits for readiness and then launches your existing frontend development script. Use `npx reactivecore dev` if you run the frontend separately.

### Connect the browser and verify a live update

1. From a second terminal at the frontend root, check readiness and generate a JWT. The expected health response is `{"status":"ready"}`.

   ```sh
   curl -fsS http://127.0.0.1:4000/api/health/ready
   printf '\n'
   npx reactivecore token
   ```

2. Add the live example for your framework. Replace its `./reactivecore-client` import with the relative path to `reactivecore/client.ts` in your project. For example, from `src/app/LiveItems.tsx`, use `../../reactivecore/client`. [React and Next.js](#react-and-nextjs) · [Vue and Nuxt](#vue-and-nuxt)
3. Open the address printed by your frontend dev server. Paste the JWT value into **Development token** and click **Connect**. The token lasts 15 minutes. Run `npx reactivecore token` again to renew it.
4. Keep the page open and send the example mutation from the second terminal. **My first live item** should appear without a reload.

   ```sh
   TOKEN=$(npx reactivecore token)
   curl -fsS http://127.0.0.1:4000/api/v1/mutation \
     -H "Authorization: Bearer $TOKEN" \
     -H "Idempotency-Key: $(node -p 'crypto.randomUUID()')" \
     -H 'Content-Type: application/json' \
     -d '{"name":"items.create","args":{"title":"My first live item"}}'
   ```

Keep your functions and migrations under `reactivecore/`. After changing function contracts, run `npx reactivecore codegen` from the frontend root. Restart `dev` to apply migrations or reload backend changes. Ctrl+C stops the API, worker and frontend. The local database and Redis containers keep their data between runs.

### Enable offline writes from the frontend

The initialized project provides the server-side mutation used by the offline example. In your frontend, connect the **Create** action to the SDK's IndexedDB queue. For React or Next.js, the guide includes a form, an operation list, and a **Cancel** button. For Vue or Nuxt, use the same queue helper with your components. [Add the offline example](#6-queue-and-cancel-an-offline-mutation)

### Use your own database or Redis

Edit `reactivecore/.env` in the frontend workspace. This file is read by the development CLI and excluded from Git. Choose one of the SQL engines below and set all three SQL URLs to use an existing service. Set `REDIS_URL` independently if you want to use your own Redis. Leave the SQL URLs unset for local PostgreSQL managed by the CLI. Leave `REDIS_URL` unset for local Redis managed by the CLI.

```dotenv
RC_PROVISION_ADMIN_URL=postgresql://owner:OWNER_PASSWORD@pg.example.com:5432/reactivecore_my_project?sslmode=verify-full
RC_APP_DATABASE_URL=postgresql://reactivecore_app:APP_PASSWORD@pg.example.com:5432/reactivecore_my_project?sslmode=verify-full
RC_WORKER_DATABASE_URL=postgresql://reactivecore_worker:WORKER_PASSWORD@pg.example.com:5432/reactivecore_my_project?sslmode=verify-full
RC_PROVISION_EXISTING_DATABASE=1
REDIS_URL=rediss://default:REDIS_PASSWORD@redis.example.com:6380
RC_CORS_ORIGINS=http://localhost:3000
```

For MySQL 8.4, set these SQL values instead and omit `RC_PROVISION_EXISTING_DATABASE`. Keep the same Redis settings if you want to reuse Redis.

```dotenv
RC_PROVISION_ADMIN_URL=mysql://owner:OWNER_PASSWORD@mysql.example.com:3306/reactivecore_my_project?ssl=verify-full
RC_APP_DATABASE_URL=mysql://reactivecore_app:APP_PASSWORD@mysql.example.com:3306/reactivecore_my_project?ssl=verify-full
RC_WORKER_DATABASE_URL=mysql://reactivecore_worker:WORKER_PASSWORD@mysql.example.com:3306/reactivecore_my_project?ssl=verify-full
```

The database name must match the generated project name in `reactivecore/project.json`. Pre-create the database and runtime accounts and grant the permissions shown in the database setup below. The CLI runs the backend from the frontend workspace. The database provider still controls database creation, users, network access and certificates. [Database setup](#1-prepare-the-backend)

This workflow uses a loopback API and a development JWT. For deployment, run the API and worker with your production identity provider. [Deployment guide](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb/blob/master/OPERATIONS.md#start-a-deployment)

## 1. Prepare the backend

Use this section for a backend you provision separately or to prepare your own database for the development CLI. If you already run a ReactiveCore API with the queries and mutations your app needs, use its URL and continue to step 2. The SDK connects to the API over HTTP and SSE. Keep database and Redis credentials on the backend.

### Choose where your data services run

Choose **one SQL engine** for the backend project. PostgreSQL 16 is supported, and MySQL 8.4 is available in preview. Redis is a separate service. You can run either service locally, on your own server, or with a cloud provider. For example, you can use a managed PostgreSQL database with a local Redis instance during development.

| Resource | Local connection example | Remote connection example with TLS |
| --- | --- | --- |
| PostgreSQL | `postgresql://reactivecore_app:APP_PASSWORD@127.0.0.1:5432/reactivecore_my_project` | `postgresql://reactivecore_app:APP_PASSWORD@pg.example.com:5432/reactivecore_my_project?sslmode=verify-full` |
| MySQL 8.4 | `mysql://reactivecore_app:APP_PASSWORD@127.0.0.1:3306/reactivecore_my_project` | `mysql://reactivecore_app:APP_PASSWORD@mysql.example.com:3306/reactivecore_my_project?ssl=verify-full` |
| Redis | `redis://:REDIS_PASSWORD@127.0.0.1:6379` | `rediss://default:REDIS_PASSWORD@redis.example.com:6380` |

Replace the hosts, ports, and credentials with the values for your setup. Use the database assigned to your project. When provisioning with the backend CLI, name it after the project slug, such as `reactivecore_my_project` for `my-project`. The Redis username and port depend on your provider. URL-encode special characters in credentials. For remote services, use the provider's TLS hostname and configure its trusted CA if required. The API and worker must be able to reach both services. In a container, `127.0.0.1` refers to that container. Use the service hostname when the database or Redis runs in a different container.

### Provision a project and start the API and worker

1. Build MultiDB and create the example project with `items.list` and `items.create` using steps 1 and 2 of the backend walkthrough. Use its Docker Compose step if you want local PostgreSQL and Redis supplied by the guide. Use your existing service endpoints for any services you already run. [Backend walkthrough](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#1-install-the-prerequisites)
2. Apply the project migrations to the database you chose and register a tenant. Use a provisioning account for this step, then grant the API and worker their separate runtime permissions. The PostgreSQL guide covers an existing database. For MySQL, create the project database first and apply the MySQL migrations and grants. [Existing PostgreSQL database](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb/blob/master/OPERATIONS.md#use-a-managed-postgresql-database) · [MySQL setup](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#run-the-same-project-on-mysql-84)
3. Start the API and worker in separate terminals. In the API terminal, set `DATABASE_URL` to the URL for `reactivecore_app`. In the worker terminal, set it to the URL for `reactivecore_worker`. Both URLs must point to the same project database. Set `REDIS_URL` to your Redis endpoint in both terminals. Keep the JWT settings from the API startup example when testing locally. [API and worker commands](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#5-run-the-api-and-worker-in-separate-terminals)
4. Set `RC_CORS_ORIGINS` on the API to the exact browser origin of your frontend, such as `http://localhost:3000` for Next.js or Nuxt or `http://localhost:5173` for Vite. Restart the API after changing it.

Check readiness and dependency status from a backend terminal. If your API runs elsewhere, replace `http://127.0.0.1:4000` with its URL here and in the frontend examples.

```sh
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS http://127.0.0.1:4000/api/health
```

The first command returns `{"status":"ready"}` when the SQL backend is ready. The second reports the active SQL engine and Redis separately. Both should be `up` before you run the live example.

## 2. Install in your existing frontend

From your frontend root, choose one of these commands.

```sh
npm install reactivecore-client@next
pnpm add reactivecore-client@next
yarn add reactivecore-client@next
```

React and Vue are optional peers, supplied by the frontend that uses them. To test an unpublished change from GitHub, build a local archive.

```sh
git clone https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-sdk.git
cd reactivecore-sdk
npm ci
npm test
npm pack
```

From your frontend root, use the absolute path to the file printed by `npm pack`.

```sh
npm install /absolute/path/to/archive.tgz
```

## 3. Generate the typed client and get a token

If you ran `npx reactivecore dev` in the frontend, the client is already generated in `reactivecore/client.ts`. Use `npx reactivecore token` to get a development token and continue to step 4.

For a separately managed backend, run this from its ReactiveCore repository root.

```sh
npm run project -- codegen ../my-project reactivecore-client
```

Copy `../my-project/client.ts` to your frontend source directory as `reactivecore-client.ts`. Rerun generation and copy the file again whenever you change the functions in `project.json`. With an older backend CLI, run `codegen` with the project path alone, then change the generated import from `@reactivecore/client` to `reactivecore-client`.

Use the JWT from step 6 of the backend guide. Generate or renew it there, then verify it and print its value from the backend root. Copy the value alone into the frontend example. [Generate the development token](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#6-sign-a-local-development-token-and-query-the-api)

```sh
source ../my-project/.env.token
curl -fsS http://127.0.0.1:4000/api/v1/session -H "Authorization: Bearer $TOKEN"
printf '\n%s\n' "$TOKEN"
```

The token lasts 15 minutes. In your actual app, use a token provider from your sign-in flow. Keep development tokens out of source files and public environment variables.

## 4. Read once and send an online mutation

With the generated file beside your frontend module, create the client and call the typed functions. This snippet expects a token from your sign-in flow or a development token entered at runtime.

```ts
import { createClient } from './reactivecore-client';

export async function createAndRead(token: string) {
  const client = createClient('http://127.0.0.1:4000', () => token);
  const args = { title: 'My first SDK item' };
  const key = crypto.randomUUID();
  const receipt = await client.mutate('items.create', args, key);
  const snapshot = await client.query('items.list', {});
  return { receipt, snapshot };
}
```

The receipt contains the created item and its commit sequence. Keep the same key and arguments if delivery is uncertain. Use a fresh key for a new action.

## 5. Show live data in your framework

### React and Next.js

Save this as `LiveItems.tsx` beside the generated client. In Next.js, put both files in `src/app/` (or `app/` if your project has no `src/`), then import `LiveItems` in `page.tsx` and render `<LiveItems />`. In React, render it in your existing app. Enter the local token and click **Connect**. Then run `items.create` from the backend walkthrough with a new key. The item should appear without reloading.

```tsx
'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from 'reactivecore-client/react';
import { createClient } from './reactivecore-client';

export default function LiveItems() {
  const [token, setToken] = useState('');
  const client = useMemo(
    () => createClient('http://127.0.0.1:4000', () => token),
    [token],
  );
  const subscribe = useCallback(
    (signal: AbortSignal) => client.subscribe('items.list', {}, signal),
    [client],
  );
  const state = useQuery(token ? subscribe : null);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('token') as HTMLInputElement;
    setToken(input.value.trim());
    input.value = '';
  }

  return (
    <section>
      <form onSubmit={connect}>
        <label htmlFor="rc-token">Development token</label>
        <input id="rc-token" name="token" type="password" autoComplete="off" required />
        <button type="submit">Connect</button>
      </form>
      {token && state.status === 'loading' && <p>Waiting for the first snapshot…</p>}
      {state.status === 'error' && <p role="alert">{String(state.error)}</p>}
      {state.status === 'ready' && (
        <ul>{state.snapshot.data.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
      )}
    </section>
  );
}
```

### Vue and Nuxt

Save this as `LiveItems.vue` beside the generated client. Render it after sign-in and pass the current token as the `token` prop. For a local test, use the form below in your existing page and mount `LiveItems` after submitting. In Nuxt, wrap `LiveItems` in `<ClientOnly>`.

```vue
<script setup lang="ts">
import { useQuery } from 'reactivecore-client/vue';
import { createClient } from './reactivecore-client';

const props = defineProps<{ token: string }>();
const state = useQuery((signal) => {
  const token = props.token;
  const client = createClient('http://127.0.0.1:4000', () => token);
  return client.subscribe('items.list', {}, signal);
});
</script>

<template>
  <p v-if="state.status === 'loading'">Waiting for the first snapshot…</p>
  <p v-else-if="state.status === 'error'" role="alert">{{ String(state.error) }}</p>
  <ul v-else>
    <li v-for="item in state.snapshot.data" :key="item.id">{{ item.title }}</li>
  </ul>
</template>
```

For a local Vue or Nuxt test, put this in a page beside `LiveItems.vue`.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import LiveItems from './LiveItems.vue';

const draft = ref('');
const token = ref('');
function connect() {
  token.value = draft.value.trim();
  draft.value = '';
}
</script>

<template>
  <form @submit.prevent="connect">
    <label for="rc-token">Development token</label>
    <input id="rc-token" v-model="draft" type="password" autocomplete="off" required />
    <button type="submit">Connect</button>
  </form>
  <LiveItems v-if="token" :key="token" :token="token" />
</template>
```

Both integrations release the subscription when the component unmounts. After a sign-out or account switch, unmount the component and create a client for the new identity. A token provider should refresh its token before reconnecting. When using the local form, generate and submit a new token after expiration.

## 6. Queue and cancel an offline mutation

Save this as `offline-items.ts` beside the generated client. Instantiate it **in the browser**, after verifying the signed-in session while online. The queue uses IndexedDB and groups operations by API, project, environment, tenant and user. Pass a token function bound to that signed-in session. Dispose of the handle on sign-out before connecting another account.

```ts
import {
  createIndexedDbStore,
  OfflineQueue,
  ReactiveCoreError,
  type OfflineOperation,
} from 'reactivecore-client';
import { createClient } from './reactivecore-client';

type ItemArgs = { title: string };
type TokenProvider = () => string | Promise<string>;

export async function openItemQueue(
  origin: string,
  getToken: TokenProvider,
  render: (operations: OfflineOperation<ItemArgs>[]) => void,
  reportError: (error: unknown) => void,
) {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  async function readSession(token: string) {
    const response = await fetch(new URL('/api/v1/session', origin), {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new ReactiveCoreError(response.status);
    return response.json() as Promise<{ tenantId: string; userId: string }>;
  }

  const identity = await readSession(await getToken());
  const scope = JSON.stringify([
    new URL(origin).origin, 'my-project', 'local', identity.tenantId, identity.userId,
  ]);
  const queue = new OfflineQueue(createIndexedDbStore<ItemArgs>('reactivecore-items'), scope);

  let draining: Promise<void> | undefined;
  async function refresh() {
    const operations = await queue.list();
    if (!signal.aborted) render(operations);
  }

  async function drain() {
    if (signal.aborted || !navigator.onLine) return;
    const token = await getToken();
    const current = await readSession(token);
    if (current.tenantId !== identity.tenantId || current.userId !== identity.userId) {
      throw new Error('The session changed. Reopen the queue for the current account.');
    }
    const client = createClient(origin, () => token);
    await queue.sync(
      async (operation) => {
        try {
          const result = await client.mutate('items.create', operation.args, operation.key, signal);
          return { state: 'confirmed', commitSeq: result.commitSeq };
        } catch (error) {
          if (error instanceof ReactiveCoreError) {
            if (error.status === 409) return { state: 'conflict', message: error.message };
            if (error.status === 401) return { state: 'retry', message: 'Sign in again.' };
            if (error.status < 500 && error.status !== 429) {
              return { state: 'rejected', message: error.message };
            }
          }
          return { state: 'retry', message: 'Delivery could not be confirmed.' };
        }
      },
      () => !signal.aborted && navigator.onLine,
      () => { void refresh().catch(reportError); },
    );
    await refresh();
  }

  function sync() {
    if (!draining) {
      draining = drain().catch((error) => {
        if (!signal.aborted) reportError(error);
      }).finally(() => { draining = undefined; });
    }
    return draining;
  }

  await refresh();
  window.addEventListener('online', sync);
  const timer = window.setInterval(sync, 2000);
  return {
    async create(title: string) {
      const trimmed = title.trim();
      if (!trimmed) throw new Error('Enter an item title.');
      const operation = await queue.enqueue({ title: trimmed });
      await refresh();
      void sync();
      return operation.key;
    },
    async cancel(key: string) {
      const cancelled = await queue.cancel(key);
      await refresh();
      return cancelled;
    },
    dispose() {
      lifetime.abort();
      window.removeEventListener('online', sync);
      window.clearInterval(timer);
    },
  };
}
```

For React or Next.js, save this component as `OfflineItems.tsx` beside `offline-items.ts` and render `<OfflineItems token={token} />` after connecting in the live example. In Next.js, render it from the same Client Component so the token stays in browser memory.

```tsx
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { OfflineOperation } from 'reactivecore-client';
import { openItemQueue } from './offline-items';

type Handle = Awaited<ReturnType<typeof openItemQueue>>;

export default function OfflineItems({ token }: { token: string }) {
  const [operations, setOperations] = useState<OfflineOperation<{ title: string }>[]>([]);
  const [handle, setHandle] = useState<Handle>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let opened: Handle | undefined;
    setHandle(undefined);
    setOperations([]);
    setError('');
    const reportError = (cause: unknown) => {
      if (active) setError(String(cause));
    };

    void openItemQueue(
      'http://127.0.0.1:4000',
      () => token,
      (entries) => { if (active) setOperations(entries); },
      reportError,
    ).then((queue) => {
      if (!active) queue.dispose();
      else {
        opened = queue;
        setHandle(queue);
      }
    }, reportError);

    return () => {
      active = false;
      opened?.dispose();
    };
  }, [token]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('title') as HTMLInputElement;
    try {
      await handle?.create(input.value);
      input.value = '';
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <section>
      <form onSubmit={create}>
        <label htmlFor="offline-title">New item</label>
        <input id="offline-title" name="title" required />
        <button disabled={!handle}>Create</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {operations.map((entry) => (
          <li key={entry.key}>
            {entry.args.title} — {entry.state}
            {entry.state === 'pending' && (
              <button type="button" disabled={!handle} onClick={() => {
                void handle?.cancel(entry.key).then((cancelled) => {
                  if (!cancelled) setError('This item may already be sending.');
                }).catch((cause) => setError(String(cause)));
              }}>
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Add `import OfflineItems from './OfflineItems';` to `LiveItems.tsx` and render `{token && <OfflineItems key={token} token={token} />}` before the closing `</section>`. Keying by the local token makes the example remount when it changes. In your application, key the component by the verified account and tenant, and provide your session's token provider to the queue.

In Vue or Nuxt, open the same queue in `onMounted`, assign the displayed operations to a ref, call `handle.create(title)` and `handle.cancel(key)` from the form and buttons, and dispose of the queue in `onUnmounted`. If opening completes after the component unmounts, dispose of the returned handle immediately.

Verify the queue with the API, worker and frontend running.

1. Open the page online and connect so it can verify your identity. Wait for the **Create** button to become available.
2. In the Network tab of your browser's developer tools, select **Offline** for this tab. Create two items with distinct titles. The operation list should show both as `pending`.
3. Click **Cancel** on one. Its state should become `cancelled` while the other stays `pending`.
4. Return the browser tab online without closing it. The remaining operation should move to `confirmed` and appear once in the live list. The cancelled title should stay absent from the server list.

A network interruption during delivery triggers a retry with the original key. A backend response of `410` means the original response was compacted. Refresh the server state before deciding whether to submit another action.

| Queue state | What the UI can show |
| --- | --- |
| `pending` | Saved locally and eligible for cancellation before the first send. |
| `sending` or `retry` | Delivery is in progress or the result is still uncertain. |
| `confirmed` | The server returned a receipt. Use the server snapshot for the confirmed list. |
| `cancelled` | The pending operation was cancelled before delivery. |
| `conflict` or `rejected` | Display the error and let the user reconcile the operation. |

The interval and online listener run while the component is open. The example resumes delivery when the user returns online and opens the queue for the same account.

IndexedDB keeps the queued intent across reloads. This integration verifies the session online before opening the queue. To reload the entire UI offline and reopen its queue while disconnected, your app also needs a cached app shell and a locally remembered, previously verified identity. [Offline browser example and conflict handling](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#run-the-nextjs-offline-conflict-example)

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| npm returns `404` | Check `npm view reactivecore-client@next version`. Use the local archive until the public package exists. |
| TypeScript cannot resolve the SDK | Match the generated import to the package installed in the frontend. |
| `401` | Renew the token and verify it with the session request in step 3. |
| `403` | Check the verified session's scopes and the function's access policy. |
| Browser blocks the request with CORS | Match the exact browser origin in `RC_CORS_ORIGINS` and restart the API. |
| The first snapshot arrives but later changes do not | Run a one-off query and check the worker, Redis and that both clients use the same tenant. |
| IndexedDB is unavailable | Run the queue in a browser Client Component or mounted Vue component. Use HTTPS or localhost. |
