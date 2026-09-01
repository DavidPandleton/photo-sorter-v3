import { describe, it, expect } from 'vitest';
import { ImageCacheManager } from './cache';

// HTMLImageElement is only used as an opaque value here; eviction logic works
// on the Map keys. Cast a placeholder so tests run without a DOM.
const fakeImg = () => ({}) as HTMLImageElement;

function paths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/photos/img${i}.jpg`);
}

describe('ImageCacheManager.evictIfNeeded', () => {
  it('keeps current + preload window, drops the rest when over limit', () => {
    const c = new ImageCacheManager();
    const ps = paths(30);
    // Fill preview cache beyond CACHE_LIMIT_PREVIEW (15)
    for (const p of ps) c.addToCache(p, fakeImg());
    expect(c.getFromCache(ps[0])).toBeDefined();

    c.evictIfNeeded(20, ps);

    // current (20) + next 5 (21..25) must survive
    for (const i of [20, 21, 22, 23, 24, 25]) {
      expect(c.getFromCache(ps[i])).toBeDefined();
    }
    // far-past entries must be gone
    expect(c.getFromCache(ps[0])).toBeUndefined();
    expect(c.getFromCache(ps[10])).toBeUndefined();
  });

  it('does nothing under the limit', () => {
    const c = new ImageCacheManager();
    const ps = paths(5);
    for (const p of ps) c.addToCache(p, fakeImg());
    c.evictIfNeeded(0, ps);
    for (const p of ps) expect(c.getFromCache(p)).toBeDefined();
  });

  it('evicts full-res alongside preview for dropped keys', () => {
    const c = new ImageCacheManager();
    const ps = paths(30);
    for (const p of ps) {
      c.addToCache(p, fakeImg());
      c.addToFullResCache(p, fakeImg());
    }
    c.evictIfNeeded(20, ps);
    expect(c.getFromFullResCache(ps[0])).toBeUndefined();
    expect(c.getFromFullResCache(ps[20])).toBeDefined();
  });

  it('clear() empties both layers', () => {
    const c = new ImageCacheManager();
    const ps = paths(3);
    for (const p of ps) {
      c.addToCache(p, fakeImg());
      c.addToFullResCache(p, fakeImg());
    }
    c.clear();
    expect(c.getFromCache(ps[0])).toBeUndefined();
    expect(c.getFromFullResCache(ps[0])).toBeUndefined();
  });
});
