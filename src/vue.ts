import { onMounted, onUnmounted, shallowRef, watchEffect, type ShallowRef } from 'vue';
import { observe, type QueryState, type Subscribe } from './query.js';

export type { QueryState, Subscribe } from './query.js';

/** Observes a typed query in the browser. Read the query inputs synchronously in subscribe. */
export function useQuery<T>(subscribe: Subscribe<T>): Readonly<ShallowRef<QueryState<T>>> {
  const state = shallowRef<QueryState<T>>({ status: 'loading' });
  let stop: (() => void) | undefined;
  onMounted(() => {
    stop = watchEffect((onCleanup) => {
      state.value = { status: 'loading' };
      onCleanup(observe(subscribe, (next) => { state.value = next; }));
    });
  });
  onUnmounted(() => stop?.());
  return state;
}
