/** Persisted operation lifecycle. Only a pending operation can still be cancelled. */
export type OfflineState =
  | 'pending'
  | 'sending'
  | 'retry'
  | 'confirmed'
  | 'cancelled'
  | 'conflict'
  | 'rejected';

/** A scoped command. Its key and arguments must remain stable across delivery attempts. */
export interface OfflineOperation<Args> {
  key: string;
  scope: string;
  args: Args;
  createdAt: number;
  state: OfflineState;
  attempts: number;
  /** Earliest retry time or current send-lease expiry, in Unix milliseconds. */
  resumeAt: number;
  message?: string;
  commitSeq?: string;
}

/** Persistence contract for a queue shared by multiple browser tabs or processes. */
export interface OfflineStore<Args> {
  add(record: OfflineOperation<Args>): Promise<void>;
  list(scope: string): Promise<OfflineOperation<Args>[]>;
  /** Atomically reads, transitions, and writes the record. Returning undefined leaves it unchanged. */
  update(
    key: string,
    transition: (
      record: OfflineOperation<Args>,
    ) => OfflineOperation<Args> | undefined,
  ): Promise<OfflineOperation<Args> | undefined>;
}

/** The transport must distinguish definitive refusals from outcomes that require replay. */
export type OfflineResult =
  | { state: 'confirmed'; commitSeq?: string }
  | { state: 'conflict' | 'rejected' | 'retry'; message?: string };

/** Returns whether a command still needs delivery or confirmation. */
export function isOutstanding(state: OfflineState): boolean {
  return state === 'pending' || state === 'sending' || state === 'retry';
}

/**
 * Persistent mutation queue for one authenticated scope.
 * Include the project, environment, tenant, and user in the scope.
 */
export class OfflineQueue<Args> {
  constructor(
    private readonly store: OfflineStore<Args>,
    private readonly scope: string,
  ) {}

  /** Persists a command before it can be sent and assigns its idempotency key. */
  async enqueue(args: Args) {
    const entry: OfflineOperation<Args> = {
      key: crypto.randomUUID(),
      scope: this.scope,
      args,
      createdAt: Date.now(),
      state: 'pending',
      attempts: 0,
      resumeAt: 0,
    };
    await this.store.add(entry);
    return entry;
  }

  /** Lists retained operations in deterministic delivery order. */
  async list() {
    return (await this.store.list(this.scope)).sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.key.localeCompare(right.key),
    );
  }

  /** Cancels only if the command has not been claimed for its first send. */
  async cancel(key: string): Promise<boolean> {
    const changed = await this.store.update(key, (entry) =>
      entry.scope === this.scope &&
      entry.state === 'pending' &&
      entry.attempts === 0
        ? { ...entry, state: 'cancelled' }
        : undefined,
    );
    return Boolean(changed);
  }

  /**
   * Drains eligible commands in order. Expired leases allow recovery after interruption.
   * Delivery may be repeated, so the transport must send the original idempotency key.
   */
  async sync(
    send: (record: OfflineOperation<Args>) => Promise<OfflineResult>,
    canSend: () => boolean,
    notify: () => void,
  ) {
    for (const entry of await this.list()) {
      if (!canSend()) return;
      if (!isOutstanding(entry.state)) continue;
      const now = Date.now();
      const claimed = await this.store.update(entry.key, (current) =>
        current.scope === this.scope &&
        isOutstanding(current.state) &&
        current.resumeAt <= now
          ? {
              ...current,
              state: 'sending',
              attempts: current.attempts + 1,
              resumeAt: now + 30000,
            }
          : undefined,
      );
      if (!claimed) {
        // Preserve queue order while another process may hold the head lease.
        return;
      }
      notify();

      let result: OfflineResult;
      try {
        result = await send(claimed);
      } catch {
        result = {
          state: 'retry',
          message:
            'Delivery was not confirmed. The same command will be retried.',
        };
      }

      await this.store.update(entry.key, (current) => {
        if (
          current.state !== 'sending' ||
          current.attempts !== claimed.attempts
        )
          return;
        const resumeAt =
          result.state === 'retry'
            ? Date.now() +
              Math.min(30000, 1000 * 2 ** Math.min(5, claimed.attempts - 1))
            : 0;
        return {
          ...current,
          state: result.state,
          message: 'message' in result ? result.message : undefined,
          commitSeq:
            result.state === 'confirmed' ? result.commitSeq : undefined,
          resumeAt,
        };
      });
      notify();
      if (result.state === 'retry') return;
    }
  }
}
