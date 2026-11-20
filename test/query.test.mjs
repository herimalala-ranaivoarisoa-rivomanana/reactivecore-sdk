import assert from 'node:assert/strict';
import test from 'node:test';
import { observe } from '../dist/query.js';

test('a stopped subscription cannot deliver late snapshots', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const states = [];
  let signal;
  const stop = observe(async function* (active) {
    signal = active;
    try {
      await pending;
      yield { seq: '1', data: [] };
    } finally {
      finish();
    }
  }, (state) => states.push(state));
  stop();
  release();
  await finished;
  assert.ok(signal.aborted);
  assert.deepEqual(states, []);
});

test('delivers a snapshot before reporting a subscription error', async () => {
  const error = new Error('offline');
  const states = [];
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const stop = observe(async function* () {
    yield { seq: '1', data: ['item'] };
    throw error;
  }, (state) => {
    states.push(state);
    if (state.status === 'error') finish();
  });
  await finished;
  stop();
  assert.deepEqual(states, [
    { status: 'ready', snapshot: { seq: '1', data: ['item'] } },
    { status: 'error', error },
  ]);
});
