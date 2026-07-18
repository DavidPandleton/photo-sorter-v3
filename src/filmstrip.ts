import { invoke } from '@tauri-apps/api/core';
import type { ImageRecord } from './app';

export class FilmstripBuilder {
  private queue: Array<() => Promise<void>> = [];
  private activeWorkers = 0;
  private maxWorkers = 8;
  private allPaths: string[] = [];
  private container: HTMLElement | null = null;
  private scrollContainer: HTMLElement | null = null;
  private onNavigate: ((idx: number) => void) | null = null;
  private loadedIndices: Set<number> = new Set();
  private scrollHandler: (() => void) | null = null;

  private pushQueue(task: () => Promise<void>) { this.queue.push(task); this.processQueue(); }

  private processQueue() {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) { this.activeWorkers++; task().finally(() => { this.activeWorkers--; this.processQueue(); }); }
    }
  }

  rebuild(imagePaths: string[], onNavigate: (idx: number) => void) {
    const container = document.getElementById('filmstrip-container');
    if (!container) return;
    container.innerHTML = '';
    this.container = container;
    this.allPaths = imagePaths;
    this.onNavigate = onNavigate;
    this.loadedIndices.clear();
    this.queue = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const item = document.createElement('div');
      item.className = 'thumbnail-item';
      item.setAttribute('data-idx', String(i));
      const ribbon = document.createElement('div'); ribbon.className = 'thumb-ribbon'; item.appendChild(ribbon);
      const wrapper = document.createElement('div'); wrapper.className = 'thumb-img-wrapper';
      const placeholder = document.createElement('div'); placeholder.className = 'empty-text'; placeholder.style.fontSize = '9px'; placeholder.textContent = 'loading...';
      wrapper.appendChild(placeholder);
      const starBadge = document.createElement('span'); starBadge.className = 'thumb-star-badge'; starBadge.style.display = 'none'; wrapper.appendChild(starBadge);
      item.appendChild(wrapper);
      const pickBadge = document.createElement('span'); pickBadge.className = 'thumb-pick-badge'; pickBadge.style.display = 'none'; pickBadge.textContent = '\u2605'; item.appendChild(pickBadge);
      item.addEventListener('click', () => { if (this.onNavigate) this.onNavigate(i); });
      item.addEventListener('dblclick', () => { if (this.onNavigate) this.onNavigate(i); });
      container.appendChild(item);
    }
    // ponytail: focus bar removed — blur detection was broken
    const scrollContainer = document.getElementById('filmstrip-scroll');
    if (this.scrollHandler && this.scrollContainer) { this.scrollContainer.removeEventListener('scroll', this.scrollHandler); }
    this.scrollContainer = scrollContainer;
    this.scrollHandler = () => this.loadVisibleThumbnails();
    if (scrollContainer) { scrollContainer.addEventListener('scroll', this.scrollHandler); }
    this.loadVisibleThumbnails();
  }

  private loadVisibleThumbnails() {
    if (!this.scrollContainer || !this.container) return;
    const itemWidth = 162; const buffer = 4;
    const scrollLeft = this.scrollContainer.scrollLeft;
    const viewW = this.scrollContainer.clientWidth;
    const startIdx = Math.max(0, Math.floor(scrollLeft / itemWidth) - buffer);
    const endIdx = Math.min(this.allPaths.length, Math.ceil((scrollLeft + viewW) / itemWidth) + buffer);
    for (let i = startIdx; i < endIdx; i++) {
      if (this.loadedIndices.has(i)) continue;
      this.loadedIndices.add(i);
      const item = this.container.children[i] as HTMLElement;
      if (!item) continue;
      this.pushQueue(() => this.loadThumbnail(this.allPaths[i], item));
    }
  }

  // ponytail: thumbnail now returns Vec<u8> directly, not [bytes, blur_score]
  private async loadThumbnail(path: string, thumbItem: HTMLElement): Promise<void> {
    try {
      const bytes = await invoke<number[]>('get_thumbnail_data', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.onload = () => {
        const wrapper = thumbItem.querySelector('.thumb-img-wrapper') as HTMLElement;
        if (!wrapper) return;
        const starBadge = wrapper.querySelector('.thumb-star-badge') as HTMLElement;
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        if (starBadge) wrapper.appendChild(starBadge);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (err) { console.error('Thumbnail load failed:', err); }

    try {
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      if (!meta) return;
      if (meta.pick === 1) {
        const badge = thumbItem.querySelector('.thumb-pick-badge') as HTMLElement;
        if (badge) badge.style.display = 'block';
        thumbItem.classList.add('thumb-picked');
      }
      if (meta.star_rating > 0) {
        const badge = thumbItem.querySelector('.thumb-star-badge') as HTMLElement;
        if (badge) { badge.textContent = '\u2605'.repeat(meta.star_rating); badge.style.display = 'block'; }
      }
      if (meta.rating) {
        const ribbon = thumbItem.querySelector('.thumb-ribbon') as HTMLElement;
        if (ribbon) ribbon.className = `thumb-ribbon ribbon-${meta.rating.toLowerCase()}`;
      }
    } catch { /* metadata fetch failed, ignore */ }
  }

  updateActiveItem(path: string) {
    document.querySelectorAll('.thumbnail-item').forEach(item => item.classList.remove('active'));
    const idx = this.allPaths.indexOf(path);
    if (idx < 0) return;
    const item = this.container?.children[idx] as HTMLElement;
    if (!item) return;
    item.classList.add('active');
    if (this.scrollContainer) {
      const offset = item.offsetLeft - this.scrollContainer.clientWidth / 2 + item.clientWidth / 2;
      this.scrollContainer.scrollTo({ left: offset, behavior: 'smooth' });
    }
  }

  updateRating(path: string, category: string | null) {
    if (!this.container) return;
    const idx = this.allPaths.indexOf(path);
    if (idx < 0) return;
    const item = this.container.children[idx] as HTMLElement;
    if (!item) return;
    const ribbon = item.querySelector('.thumb-ribbon') as HTMLElement;
    if (ribbon) ribbon.className = category ? `thumb-ribbon ribbon-${category.toLowerCase()}` : 'thumb-ribbon';
  }

  updateStars(path: string, count: number) {
    if (!this.container) return;
    const idx = this.allPaths.indexOf(path);
    if (idx < 0) return;
    const item = this.container.children[idx] as HTMLElement;
    if (!item) return;
    const badge = item.querySelector('.thumb-star-badge') as HTMLElement;
    if (!badge) return;
    if (count > 0) { badge.textContent = '\u2605'.repeat(count); badge.style.display = 'block'; }
    else { badge.style.display = 'none'; }
  }
}
