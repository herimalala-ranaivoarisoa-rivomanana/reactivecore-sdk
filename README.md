# ReactiveCore SDK

Use an existing [ReactiveCore backend](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb) from React, Next.js, Vue or Nuxt. This package provides the TypeScript HTTP/SSE client, browser persistence for offline mutations, and client-side query subscriptions. The API, outbox worker and databases run separately.

## 1. Install the package in your existing app

Build the archive from a checkout of this repository with Node.js 24 or later.

```sh
npm ci
npm test
npm pack
```

From your existing frontend root, install the archive. Replace the path with the location printed by `npm pack`.

```sh
npm install /path/to/reactivecore-client-0.2.0-alpha.5.tgz
```

Install the React or Vue runtime through your app as usual. The optional peer dependencies allow the core SDK to work in plain TypeScript.

## 2. Connect your frontend to the API

In your backend workspace, run its `npm run project -- codegen /path/to/backend-project reactivecore-client` command. For an older backend CLI that only accepts the project path, regenerate normally and update the generated import to `reactivecore-client` after each generation. Copy the generated `client.ts` to your frontend as `reactivecore-client.ts`. The generated functions use the names, arguments and results declared by your project.

Create the client with your API origin and a function that retrieves the current access token from your authentication layer. Match your backend's allowed frontend origin. For a local backend walkthrough, follow the JWT steps in the backend README. [Backend setup and development token](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#6-sign-a-local-development-token-and-query-the-api)

## 3. Subscribe from React or Next.js

Mount this component after sign-in. Pass a client created with the generated `createClient` function. Remount it with a different React `key` when the authenticated tenant or user changes.

```tsx
'use client';

import { useCallback } from 'react';
import { useQuery } from 'reactivecore-client/react';
import type { createClient } from './reactivecore-client';

export function LiveItems({ client }: { client: ReturnType<typeof createClient> }) {
  const subscribe = useCallback(
    (signal: AbortSignal) => client.subscribe('items.list', {}, signal),
    [client],
  );
  const state = useQuery(subscribe);
  if (state.status === 'loading') return <p>Loading items…</p>;
  if (state.status === 'error') return <p>Could not load items.</p>;
  return <ul>{state.snapshot.data.map((item) => <li key={item.id}>{item.title}</li>)}</ul>;
}
```

In Next.js, create and pass the client within the same client-side tree. Keep the token retrieval function in browser code.

## 4. Subscribe from Vue or Nuxt

Mount the component after sign-in. In Nuxt, create the client inside the browser and mount the component under `<ClientOnly>`. Key the component by the authenticated tenant and user.

```vue
<script setup lang="ts">
import { useQuery } from 'reactivecore-client/vue';
import type { createClient } from './reactivecore-client';

const props = defineProps<{ client: ReturnType<typeof createClient> }>();
const state = useQuery((signal) => props.client.subscribe('items.list', {}, signal));
</script>

<template>
  <p v-if="state.status === 'loading'">Loading items…</p>
  <p v-else-if="state.status === 'error'">Could not load items.</p>
  <ul v-else>
    <li v-for="item in state.snapshot.data" :key="item.id">{{ item.title }}</li>
  </ul>
</template>
```

## Send mutations and enable offline writes

Call the generated client's `mutate(name, args, key)` to send an online mutation. Generate the key once and reuse it if the result is uncertain. For offline writes, use `OfflineQueue` and the IndexedDB store from `reactivecore-client`. Scope persistence by project, environment, tenant and user, then connect the queue's pending, confirmed and conflict states to your interface. [Offline mutation walkthrough](https://github.com/herimalala-ranaivoarisoa-rivomanana/reactivecore-multidb#add-offline-writes-to-a-frontend)

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
