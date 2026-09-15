import { describe, it, expect } from 'vitest';
import { visibleRange } from './filmstrip';

describe('visibleRange (filmstrip virtual scroll)', () => {
  it('at scroll 0 starts at 0 with buffer clamped', () => {
    const [s, e] = visibleRange(0, 1000, 100);
    expect(s).toBe(0);
    // 1000px view / 162px items = ~6.2 -> ceil 7 + buffer 4 = 11
    expect(e).toBe(11);
  });

  it('mid-scroll includes buffer on both sides', () => {
    const [s, e] = visibleRange(1620, 1000, 100); // scrolled to item 10
    expect(s).toBe(6);   // 10 - buffer
    expect(e).toBe(10 + 7 + 4); // 21
  });

  it('clamps end to total', () => {
    const [s, e] = visibleRange(15000, 1000, 100);
    expect(e).toBe(100);
    expect(s).toBeLessThan(e);
  });

  it('empty list yields empty range', () => {
    expect(visibleRange(0, 1000, 0)).toEqual([0, 0]);
  });

  it('respects custom itemWidth and buffer', () => {
    const [s, e] = visibleRange(200, 100, 50, 100, 1);
    expect(s).toBe(1);   // floor(200/100) - 1
    expect(e).toBe(4);   // ceil(300/100) + 1
  });
});
