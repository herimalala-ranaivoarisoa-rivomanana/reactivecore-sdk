'use client';

import { useEffect, useState } from 'react';
import { observe, type QueryState, type Subscribe } from './query.js';

export type { QueryState, Subscribe } from './query.js';

/** Observes a typed query in the browser. Memoize the callback with useCallback. */
export function useQuery<T>(subscribe: Subscribe<T> | null): QueryState<T> {
  const [result, setResult] = useState<{
    source: Subscribe<T>;
    state: QueryState<T>;
  }>();
  useEffect(() => {
    if (subscribe)
      return observe(subscribe, (state) => setResult({ source: subscribe, state }));
  }, [subscribe]);
  return subscribe && result?.source === subscribe ? result.state : { status: 'loading' };
}
