import { describe, expect, it } from 'vitest';
import { BRING_API_KEY, BRING_BASE, BringClient } from '../src/sources/bring/client.js';
import { fakeFetch, jsonResponse, type RecordedCall, testClock, textResponse } from './helpers.js';

const login = { uuid: 'u-1', publicUuid: 'p-1', access_token: 'at-1', refresh_token: 'rt-1', expires_in: 604799 };
const urgent = { type: 'PURCHASE_CONDITIONS', content: { urgent: true, convenient: false, discounted: true } };
const listBody = {
  uuid: 'l-1',
  status: 'SHARED',
  items: {
    purchase: [
      { uuid: 'i1', itemId: 'Milch', specification: '2 l', attributes: [] },
      { uuid: 'i3', itemId: 'WC-Papier', specification: '', attributes: [{ type: 'OTHER', content: {} }, urgent] },
    ],
    recently: [{ uuid: 'i2', itemId: 'Frankfurter', specification: '' }],
  },
};
const none = { urgent: false, convenient: false, discounted: false };

function server(overrides: Partial<Record<string, (c: RecordedCall) => Response>> = {}) {
  return fakeFetch((c) => {
    const path = c.url.slice(BRING_BASE.length);
    const handler = overrides[`${c.method} ${path}`];
    if (handler) return handler(c);
    if (c.method === 'POST' && path === 'v2/bringauth') return jsonResponse(login);
    if (c.method === 'POST' && path === 'v2/bringauth/token') return jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 604799 });
    if (c.method === 'GET' && path === 'bringusers/u-1/lists') return jsonResponse({ lists: [{ listUuid: 'l-1', name: 'Zuhause', theme: 'x' }] });
    if (c.method === 'GET' && path === 'v2/bringlists/l-1') return jsonResponse(listBody);
    if (c.method === 'PUT' && path === 'v2/bringlists/l-1/items') return new Response(null, { status: 204 });
    return textResponse('not found', 404);
  });
}

const creds = { email: 'a@b.ch', password: 'pä&ss' };
const noSleep = async () => {};

describe('BringClient', () => {
  it('logs in with a form body and sends the Bring headers afterwards', async () => {
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    expect(await client.lists()).toEqual([{ listUuid: 'l-1', name: 'Zuhause' }]);
    const [loginCall, listsCall] = fetchFn.calls;
    expect(loginCall?.url).toBe(`${BRING_BASE}v2/bringauth`);
    expect(loginCall?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(loginCall?.body).get('password')).toBe('pä&ss');
    expect(loginCall?.headers['X-BRING-API-KEY']).toBeUndefined();
    expect(listsCall?.headers).toMatchObject({
      Authorization: 'Bearer at-1',
      'X-BRING-API-KEY': BRING_API_KEY,
      'X-BRING-CLIENT': 'android',
      'X-BRING-APPLICATION': 'bring',
      'X-BRING-COUNTRY': 'CH',
      'X-BRING-USER-UUID': 'u-1',
      'X-BRING-PUBLIC-USER-UUID': 'p-1',
    });
  });

  it('reads purchase and recently items with their purchase conditions («Dringend»)', async () => {
    const client = new BringClient(creds, server(), testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    expect(await client.items('l-1')).toEqual({
      purchase: [
        { uuid: 'i1', itemId: 'Milch', specification: '2 l', conditions: none },
        { uuid: 'i3', itemId: 'WC-Papier', specification: '', conditions: { urgent: true, convenient: false, discounted: true } },
      ],
      recently: [{ uuid: 'i2', itemId: 'Frankfurter', specification: '', conditions: none }],
    });
  });

  it('sets purchase conditions with an attribute update of the entry, as the app does', async () => {
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    await client.setConditions('l-1', 'Milch', '2 l', 'i1', { urgent: true, convenient: false, discounted: true });
    expect(JSON.parse(fetchFn.calls.at(-1)?.body ?? '')).toEqual({
      changes: [
        {
          accuracy: '0.0',
          altitude: '0.0',
          latitude: '0.0',
          longitude: '0.0',
          itemId: 'Milch',
          spec: '2 l',
          uuid: 'i1',
          operation: 'ATTRIBUTE_UPDATE',
          attribute: { type: 'PURCHASE_CONDITIONS', content: { urgent: true, convenient: false, discounted: true } },
        },
      ],
      sender: '',
    });
  });

  it('adds an item with the batch endpoint', async () => {
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { newUuid: () => 'new-uuid', sleep: noSleep });
    await client.add('l-1', 'Frankfurter');
    const put = fetchFn.calls.at(-1);
    expect(put?.method).toBe('PUT');
    expect(put?.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(put?.body ?? '')).toEqual({
      changes: [{ accuracy: '0.0', altitude: '0.0', latitude: '0.0', longitude: '0.0', itemId: 'Frankfurter', spec: '', uuid: 'new-uuid', operation: 'TO_PURCHASE' }],
      sender: '',
    });
  });

  it('ticks an item off by moving its own entry (uuid) to recently, keeping its specification', async () => {
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { newUuid: () => 'new-uuid', sleep: noSleep });
    await client.complete('l-1', 'Milch', '2 l', 'i1');
    const put = fetchFn.calls.at(-1);
    expect(put?.method).toBe('PUT');
    expect(put?.url).toBe(`${BRING_BASE}v2/bringlists/l-1/items`);
    expect(JSON.parse(put?.body ?? '')).toEqual({
      changes: [{ accuracy: '0.0', altitude: '0.0', latitude: '0.0', longitude: '0.0', itemId: 'Milch', spec: '2 l', uuid: 'i1', operation: 'TO_RECENTLY' }],
      sender: '',
    });
  });

  it('leaves the uuid out when an entry has none, rather than inventing one', async () => {
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { newUuid: () => 'new-uuid', sleep: noSleep });
    await client.complete('l-1', 'Milch', '', '');
    expect(JSON.parse(fetchFn.calls.at(-1)?.body ?? '').changes[0]).not.toHaveProperty('uuid');
  });

  it('refreshes the token proactively before it expires', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    const fetchFn = server();
    const client = new BringClient(creds, fetchFn, clock, { sleep: noSleep });
    await client.lists();
    clock.advance(6.96 * 24 * 3600_000);
    await client.lists();
    const paths = fetchFn.calls.map((c) => `${c.method} ${c.url.slice(BRING_BASE.length)}`);
    expect(paths).toEqual(['POST v2/bringauth', 'GET bringusers/u-1/lists', 'POST v2/bringauth/token', 'GET bringusers/u-1/lists']);
    expect(new URLSearchParams(fetchFn.calls[2]?.body).get('refresh_token')).toBe('rt-1');
    expect(fetchFn.calls[3]?.headers.Authorization).toBe('Bearer at-2');
  });

  it('retries once after a 401 by refreshing', async () => {
    let first = true;
    const fetchFn = server({
      'GET bringusers/u-1/lists': (c) => {
        if (first) {
          first = false;
          return textResponse('expired', 401);
        }
        expect(c.headers.Authorization).toBe('Bearer at-2');
        return jsonResponse({ lists: [] });
      },
    });
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    expect(await client.lists()).toEqual([]);
  });

  it('falls back to login when refresh is rejected', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    const fetchFn = server({ 'POST v2/bringauth/token': () => textResponse('invalid', 401) });
    const client = new BringClient(creds, fetchFn, clock, { sleep: noSleep });
    await client.lists();
    clock.advance(8 * 24 * 3600_000);
    await client.lists();
    const paths = fetchFn.calls.map((c) => `${c.method} ${c.url.slice(BRING_BASE.length)}`);
    expect(paths).toEqual(['POST v2/bringauth', 'GET bringusers/u-1/lists', 'POST v2/bringauth/token', 'POST v2/bringauth', 'GET bringusers/u-1/lists']);
  });

  it('falls back to login when refresh fails with another 4xx (e.g. 400 invalid_grant)', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    const fetchFn = server({ 'POST v2/bringauth/token': () => jsonResponse({ error: 'invalid_grant' }, 400) });
    const client = new BringClient(creds, fetchFn, clock, { sleep: noSleep });
    await client.lists();
    clock.advance(8 * 24 * 3600_000);
    expect(await client.lists()).toEqual([{ listUuid: 'l-1', name: 'Zuhause' }]);
    const paths = fetchFn.calls.map((c) => `${c.method} ${c.url.slice(BRING_BASE.length)}`);
    expect(paths).toEqual(['POST v2/bringauth', 'GET bringusers/u-1/lists', 'POST v2/bringauth/token', 'POST v2/bringauth', 'GET bringusers/u-1/lists']);
  });

  it('still throws when refresh fails with a server error', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    const fetchFn = server({ 'POST v2/bringauth/token': () => textResponse('boom', 500) });
    const client = new BringClient(creds, fetchFn, clock, { sleep: noSleep });
    await client.lists();
    clock.advance(8 * 24 * 3600_000);
    await expect(client.lists()).rejects.toThrow(/^bring refresh HTTP 500$/);
  });

  it('retries once on 503 and reports errors without ids', async () => {
    let calls = 0;
    const flaky = server({ 'GET v2/bringlists/l-1': () => (++calls === 1 ? textResponse('busy', 503) : jsonResponse(listBody)) });
    const client = new BringClient(creds, flaky, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    expect((await client.items('l-1')).purchase).toHaveLength(2);

    const broken = server({ 'GET v2/bringlists/l-1': () => textResponse('boom', 500) });
    const c2 = new BringClient(creds, broken, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    await expect(c2.items('l-1')).rejects.toThrow(/^bring GET HTTP 500$/);
  });

  it('fails login with a plain-text error body', async () => {
    const fetchFn = server({ 'POST v2/bringauth': () => textResponse('Invalid Email.', 400) });
    const client = new BringClient(creds, fetchFn, testClock('2026-11-03T07:00:00+01:00'), { sleep: noSleep });
    await expect(client.lists()).rejects.toThrow(/^bring login HTTP 400$/);
  });
});
