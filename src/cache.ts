import { invoke } from '@tauri-apps/api/core';
import { PRELOAD_WINDOW_SIZE } from './constants';

// ponytail: no full-res cache (zoom swap was YAGNI) — just a simple LRU preloader
export class ImageCacheManager {
  private cache: Map<string, HTMLImageElement> = new Map();
  private loading: Set<string> = new Set();

  getFromCache(path: string): HTMLImageElement | undefined { return this.cache.get(path); }
  addToCache(path: string, img: HTMLImageElement) { this.cache.set(path, img); }
  clear() { this.cache.clear(); }

  triggerPreloaders(idx: number, paths: string[]) {
    for (let i = 1; i <= PRELOAD_WINDOW_SIZE; i++) {
      if (idx + i >= paths.length) break;
      const p = paths[idx + i];
      if (this.cache.has(p) || this.loading.has(p)) continue;
      this.loading.add(p);
      invoke<number[]>('get_image_data', { path: p })
        .then(b => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(b)], { type: 'image/jpeg' }));
          const img = new Image();
          img.onload = () => { this.cache.set(p, img); this.loading.delete(p); URL.revokeObjectURL(url); };
          img.src = url;
        })
        .catch(() => this.loading.delete(p));
    }
    if (this.cache.size > PRELOAD_WINDOW_SIZE * 3) {
      const keep = new Set(paths.slice(Math.max(0, idx - PRELOAD_WINDOW_SIZE), idx + PRELOAD_WINDOW_SIZE + 1));
      for (const k of this.cache.keys()) { if (!keep.has(k)) this.cache.delete(k); }
    }
  }
}
