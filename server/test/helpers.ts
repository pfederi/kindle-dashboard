import type { Clock } from '../src/clock.js';
import type { FetchFn } from '../src/http.js';

export interface TestClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function testClock(iso: string): TestClock {
  let now = new Date(iso).getTime();
  const clock = (() => new Date(now)) as TestClock;
  clock.set = (next: string) => {
    now = new Date(next).getTime();
  };
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type FakeFetch = FetchFn & { calls: RecordedCall[] };

export function fakeFetch(handler: (call: RecordedCall) => Response | Promise<Response>): FakeFetch {
  const calls: RecordedCall[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    const call: RecordedCall = {
      url: input,
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
