import { describe, expect, it, vi } from 'vitest';
import { closeAll } from '../src/shutdown.js';

describe('closeAll', () => {
  it('closes everything in order and returns 0 when all succeed', async () => {
    const order: string[] = [];
    const code = await closeAll([async () => void order.push('app'), async () => void order.push('renderer')], vi.fn());
    expect(code).toBe(0);
    expect(order).toEqual(['app', 'renderer']);
  });

  it('keeps closing after a failure (async or sync throw) and returns 1', async () => {
    const log = vi.fn();
    const renderer = vi.fn(async () => {});
    const code = await closeAll(
      [
        async () => {
          throw new Error('app close failed');
        },
        renderer,
        () => {
          throw new Error('sync boom');
        },
      ],
      log,
    );
    expect(code).toBe(1);
    expect(renderer).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual([['shutdown: app close failed'], ['shutdown: sync boom']]);
  });
});
