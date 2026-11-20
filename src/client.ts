/** A complete query result and its PostgreSQL commit-clock sequence as a decimal string. */
export interface Snapshot<T> {
  seq: string;
  data: T;
}

/** A committed mutation result. Replays return the original data and commit sequence. */
export interface MutationResult<T> {
  commitSeq: string;
  replayed: boolean;
  data: T;
}

/** An HTTP error from ReactiveCore. Transport and cancellation errors retain their original types. */
export class ReactiveCoreError extends Error {
  constructor(readonly status: number) {
    super(`ReactiveCore request failed (HTTP ${status})`);
  }
}

async function* snapshots<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Snapshot<T>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = '';
  let data: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      pending += decoder.decode(chunk.value, { stream: true });
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''));
        else if (line === '') {
          const value =
            event === 'snapshot' && data.length
              ? (JSON.parse(data.join('\n')) as Snapshot<T>)
              : undefined;
          event = '';
          data = [];
          if (
            value &&
            typeof value.seq === 'string' &&
            /^\d{1,19}$/.test(value.seq)
          )
            yield value;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/** HTTP/SSE client that obtains a bearer token for each request and reconnect. */
export class ReactiveCoreClient {
  constructor(
    private readonly origin: string,
    private readonly token: () => string | Promise<string>,
  ) {}

  private async request(
    operation: string,
    name: string,
    args: unknown,
    signal?: AbortSignal,
    key?: string,
  ) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await this.token()}`,
    });
    if (key) headers.set('Idempotency-Key', key);
    const response = await fetch(new URL(`/api/v1/${operation}`, this.origin), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, args }),
      signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ReactiveCoreError(response.status);
    }
    return response;
  }

  /** Executes a registered query once and returns a consistent snapshot. */
  async query<T>(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<Snapshot<T>> {
    return (await this.request('query', name, args, signal)).json();
  }

  /**
   * Executes a mutation once. If the outcome is unknown, retry with the same key and arguments.
   * The server scopes keys by tenant, principal, and mutation name.
   */
  async mutate<T>(
    name: string,
    args: unknown,
    key: string,
    signal?: AbortSignal,
  ): Promise<MutationResult<T>> {
    return (await this.request('mutation', name, args, signal, key)).json();
  }

  /**
   * Yields the first snapshot on each connection and newer snapshots on that stream.
   * Reconnects after transient failures and propagates permanent HTTP errors.
   * Abort the signal when the consumer no longer needs updates.
   */
  async *subscribe<T>(
    name: string,
    args: unknown,
    signal: AbortSignal,
    onConnection?: (state: 'live' | 'reconnecting') => void,
  ): AsyncGenerator<Snapshot<T>> {
    let seq: bigint | undefined;
    let delay = 250;
    while (!signal.aborted) {
      try {
        const response = await this.request('subscribe', name, args, signal);
        if (
          !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')
        ) {
          await response.body?.cancel();
          throw new ReactiveCoreError(502);
        }
        let announced = false;
        for await (const snapshot of snapshots<T>(response.body)) {
          if (signal.aborted) return;
          const first = !announced;
          if (first) onConnection?.('live');
          announced = true;
          delay = 250;
          const next = BigInt(snapshot.seq);
          if (first || seq === undefined || next > seq) {
            seq = next;
            yield snapshot;
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        if (
          error instanceof ReactiveCoreError &&
          error.status < 500 &&
          error.status !== 429
        )
          throw error;
      }
      if (!signal.aborted) onConnection?.('reconnecting');
      await pause(delay * (0.5 + Math.random() * 0.5), signal);
      delay = Math.min(delay * 2, 5000);
    }
  }
}
