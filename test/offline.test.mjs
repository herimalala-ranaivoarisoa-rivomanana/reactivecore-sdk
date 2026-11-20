import assert from 'node:assert/strict';
import test from 'node:test';
import { ReactiveCoreClient } from '../dist/client.js';
import { OfflineQueue } from '../dist/offline.js';

function setup(scope = 'project:env:tenant:user') {
  const records = new Map();
  const store = {
    async add(entry) { records.set(entry.key, entry); },
    async list(scope) { return [...records.values()].filter((item) => item.scope === scope); },
    async update(key, transition) {
      if (!records.has(key)) return;
      const next = transition(records.get(key));
      if (next) records.set(key, next);
      return next;
    },
  };
  return { store, queue: new OfflineQueue(store, scope) };
}

test('cancel persists for a never-sent operation and prevents delivery', async () => {
  const { store, queue } = setup('tenant-a');
  const entry = await queue.enqueue({ quantity: 1 });
  assert.equal(await new OfflineQueue(store, 'tenant-b').cancel(entry.key), false);
  await queue.sync(() => assert.fail('offline delivery'), () => false, () => {});
  assert.equal(await queue.cancel(entry.key), true);
  const reopened = new OfflineQueue(store, 'tenant-a');
  await reopened.sync(() => assert.fail('cancelled delivery'), () => true, () => {});
  assert.equal((await reopened.list())[0].state, 'cancelled');
});

test('an in-flight operation cannot be cancelled and its result is persistent', async () => {
  const { queue } = setup();
  const entry = await queue.enqueue({});
  await queue.sync(async (record) => {
    assert.equal(record.state, 'sending');
    assert.equal(await queue.cancel(entry.key), false);
    return { state: 'confirmed' };
  }, () => true, () => {});
  assert.equal((await queue.list())[0].state, 'confirmed');
});

test('an uncertain send reuses the key and can finish in conflict', async () => {
  const { store, queue } = setup();
  const entry = await queue.enqueue({ quantity: 2 });
  await queue.sync(async () => { throw new Error('connection lost'); }, () => true, () => {});
  assert.equal((await queue.list())[0].state, 'retry');
  assert.equal(await queue.cancel(entry.key), false);
  await store.update(entry.key, (current) => ({ ...current, resumeAt: 0 }));
  await queue.sync(async (record) => {
    assert.equal(record.key, entry.key);
    assert.deepEqual(record.args, entry.args);
    return { state: 'conflict', message: 'Stock insuffisant' };
  }, () => true, () => {});
  assert.equal((await queue.list())[0].state, 'conflict');
});


test('a new SSE connection accepts a restored sequence and resumes increasing order', async (t) => {
  const responses = [['12'], ['4', '3', '5']];
  t.mock.method(globalThis, 'fetch', async () => new Response(
    responses.shift().map((seq) =>
      `event: snapshot\ndata: ${JSON.stringify({ seq, data: seq })}\n\n`,
    ).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  ));
  const controller = new AbortController();
  const client = new ReactiveCoreClient('http://localhost', () => 'test');
  const stream = client.subscribe('items.list', {}, controller.signal);
  try {
    assert.equal((await stream.next()).value.seq, '12');
    assert.equal((await stream.next()).value.seq, '4');
    assert.equal((await stream.next()).value.seq, '5');
  } finally {
    controller.abort();
    await stream.return();
  }
});


test('accepts a fresh snapshot with the same sequence after reconnecting', async (t) => {
  const responses = [['before restore'], ['restored snapshot']];
  t.mock.method(globalThis, 'fetch', async () => new Response(
    responses.shift().map((data) =>
      `event: snapshot\ndata: ${JSON.stringify({ seq: '7', data })}\n\n`,
    ).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  ));
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]);
  const client = new ReactiveCoreClient('http://localhost', () => 'test');
  const stream = client.subscribe('items.list', {}, signal);
  try {
    assert.deepEqual((await stream.next()).value, { seq: '7', data: 'before restore' });
    assert.deepEqual((await stream.next()).value, { seq: '7', data: 'restored snapshot' });
  } finally {
    controller.abort();
    await stream.return();
  }
});
