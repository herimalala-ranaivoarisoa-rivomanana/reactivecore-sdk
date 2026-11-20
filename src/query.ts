import type { Snapshot } from './client.js';

export type Subscribe<T> = (signal: AbortSignal) => AsyncIterable<Snapshot<T>>;

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: Snapshot<T> }
  | { status: 'error'; error: unknown };

/** Starts a subscription and returns its cancellation function. */
export function observe<T>(
  subscribe: Subscribe<T>,
  update: (state: QueryState<T>) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  async function consume() {
    try {
      for await (const snapshot of subscribe(signal)) {
        if (signal.aborted) break;
        update({ status: 'ready', snapshot });
      }
    } catch (error) {
      if (!signal.aborted) update({ status: 'error', error });
    }
  }
  void consume();
  return () => controller.abort();
}
