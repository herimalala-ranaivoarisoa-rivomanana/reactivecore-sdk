# ReactiveCore SDK

Add live queries and offline mutations to an existing React, Next.js, Vue or Nuxt app. The SDK connects to a running ReactiveCore API. The backend still runs its own database, Redis and worker.

## 1. Prepare the backend

To run this walkthrough, follow steps 1–7 of the MultiDB guide. They create a tenant and register `items.list` and `items.create`. Keep the API and worker running. You can use PostgreSQL or the MySQL preview. [Backend walkthrough](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#1-install-the-prerequisites)

In the API terminal, set `RC_CORS_ORIGINS` to your frontend's exact browser origin before starting the API. Common local origins include `http://localhost:3000` for Next.js and Nuxt, and `http://localhost:5173` for Vite. Restart the API after changing this setting.

From a backend terminal, check that this returns `{"status":"ready"}`.

```sh
curl -fsS http://127.0.0.1:4000/api/health/ready
```

## 2. Install in your existing frontend

The unscoped package is prepared for npm. Until `npm view reactivecore-client@next version` returns a version, install from the local archive.

```sh
git clone https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-sdk.git
cd reactivecore-sdk
npm ci
npm test
npm pack
```

From your frontend root, use the absolute path to the file printed by `npm pack`.

```sh
npm install /absolute/path/to/reactivecore-sdk/reactivecore-client-0.2.0-alpha.5.tgz
```

Once published, install it with `npm install reactivecore-client@next`, `pnpm add reactivecore-client@next` or `yarn add reactivecore-client@next`. React and Vue are optional peers, supplied by the frontend that uses them.

## 3. Generate the typed client and get a token

From the ReactiveCore backend repository root, generate the client for the installed package.

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

To verify the queue, start online so the example can verify the identity. In browser DevTools, go offline, create two items and cancel one. Go online again without closing the page. The retained operation should become `confirmed` and appear in your live list. The cancelled operation should produce no row. A network interruption during delivery triggers a retry with the original key. A backend response of `410` means the original response was compacted. Refresh the server state before deciding whether to submit another action.

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

## Publish an alpha to npm

The npm package name is `reactivecore-client`. Publish the first version from a workstation authenticated with npm. The package uses an unscoped name, so its import path contains only the product name.

```sh
npm ci
npm test
npm login --registry=https://registry.npmjs.org/
npm publish --access public --tag next
```

For later alphas, configure a Trusted Publisher in the package's npm settings with the following values.

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `herimalala-ranaivoarisoa-rivomanana` |
| Repository | `reactivecore-sdk` |
| Workflow filename | `publish.yml` |
| Environment | Leave blank |

Bump the version and update the lockfile before committing. Then push a tag that matches the new version, such as `v0.2.0-alpha.6`. The workflow tests the SDK and publishes the tag version to npm's `next` channel using GitHub's identity. Use a newer version than the one you published manually for the first automated publication. [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

Once the package is published, install the alpha with `npm install reactivecore-client@next`, `pnpm add reactivecore-client@next`, or `yarn add reactivecore-client@next`.
