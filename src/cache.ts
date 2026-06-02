import { invoke } from '@tauri-apps/api/core';
import { PhotoViewer } from './viewer';

export class ImageCacheManager {
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private fullResCache: Map<string, HTMLImageElement> = new Map();
  private activePreloadRequests: Set<string> = new Set();

  getFromCache(path: string): HTMLImageElement | undefined {
    return this.imageCache.get(path);
  }

  getFromFullResCache(path: string): HTMLImageElement | undefined {
    return this.fullResCache.get(path);
  }

  addToCache(path: string, img: HTMLImageElement) {
    this.imageCache.set(path, img);
  }

  addToFullResCache(path: string, img: HTMLImageElement) {
    this.fullResCache.set(path, img);
  }

  clear() {
    this.imageCache.clear();
    this.fullResCache.clear();
  }

  evictIfNeeded(currentIdx: number, imagePaths: string[]) {
    const preloadWindowSize = 5;
    const targets = [];
    for (let i = 1; i <= preloadWindowSize; i++) {
      if (currentIdx + i < imagePaths.length) targets.push(imagePaths[currentIdx + i]);
    }
    if (this.imageCache.size > 15) {
      const keep = new Set([imagePaths[currentIdx], ...targets]);
      for (const key of this.imageCache.keys()) {
        if (!keep.has(key)) {
          this.imageCache.delete(key);
          this.fullResCache.delete(key);
        }
      }
    }
    if (this.fullResCache.size > 5) {
      const keep = new Set([imagePaths[currentIdx], ...targets]);
      for (const key of this.fullResCache.keys()) {
        if (!keep.has(key)) this.fullResCache.delete(key);
      }
    }
  }

  triggerPreloaders(idx: number, imagePaths: string[]) {
    const preloadWindowSize = 5;
    const targets = [];
    for (let i = 1; i <= preloadWindowSize; i++) {
      if (idx + i < imagePaths.length) targets.push(imagePaths[idx + i]);
    }
    this.evictIfNeeded(idx, imagePaths);

    for (const path of targets) {
      if (this.imageCache.has(path) || this.activePreloadRequests.has(path)) continue;
      this.activePreloadRequests.add(path);
      invoke<number[]>('get_image_data', { path })
        .then((bytes) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            this.imageCache.set(path, img);
            this.activePreloadRequests.delete(path);
            URL.revokeObjectURL(url);
          };
          img.src = url;
        })
        .catch(() => this.activePreloadRequests.delete(path));
    }
  }

  async loadFullResolution(path: string, viewer: PhotoViewer, currentIdx: number, imagePaths: string[]) {
    if (this.fullResCache.has(path)) return;
    try {
      const bytes = await invoke<number[]>('get_full_image_data', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        this.fullResCache.set(path, img);
        URL.revokeObjectURL(url);
        if (imagePaths[currentIdx] === path && viewer.getScale() > 1.5) {
          viewer.setImage(img);
        }
      };
      img.src = url;
    } catch (err) {
      console.error('Full resolution load failed:', err);
    }
  }
}
