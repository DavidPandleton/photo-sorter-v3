import { invoke } from '@tauri-apps/api/core';
import type { ImageRecord } from './app';

export class FilmstripBuilder {
  private queue: Array<() => Promise<void>> = [];
  private activeWorkers = 0;
  private maxWorkers = 3;

  private pushQueue(task: () => Promise<void>) {
    this.queue.push(task);
    this.processQueue();
  }

  private processQueue() {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.activeWorkers++;
        task().finally(() => {
          this.activeWorkers--;
          this.processQueue();
        });
      }
    }
  }

  rebuild(imagePaths: string[], onNavigate: (idx: number) => void) {
    const container = document.getElementById('filmstrip-container');
    if (!container) return;
    container.innerHTML = '';
    
    // Clear any pending queue tasks
    this.queue = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const path = imagePaths[i];
      const item = document.createElement('div');
      item.className = 'thumbnail-item';
      item.setAttribute('data-path', path);

      const ribbon = document.createElement('div');
      ribbon.className = 'thumb-ribbon';
      item.appendChild(ribbon);

      const wrapper = document.createElement('div');
      wrapper.className = 'thumb-img-wrapper';
      const placeholder = document.createElement('div');
      placeholder.className = 'empty-text';
      placeholder.style.fontSize = '9px';
      placeholder.textContent = 'loading...';
      wrapper.appendChild(placeholder);

      const starBadge = document.createElement('span');
      starBadge.className = 'thumb-star-badge';
      starBadge.style.display = 'none';
      wrapper.appendChild(starBadge);

      const focusBar = document.createElement('div');
      focusBar.className = 'thumb-focus-bar';
      focusBar.style.display = 'none';
      const focusFill = document.createElement('div');
      focusFill.className = 'thumb-focus-fill';
      focusBar.appendChild(focusFill);
      wrapper.appendChild(focusBar);
      item.appendChild(wrapper);

      const pickBadge = document.createElement('span');
      pickBadge.className = 'thumb-pick-badge';
      pickBadge.style.display = 'none';
      pickBadge.textContent = '★';
      item.appendChild(pickBadge);

      container.appendChild(item);
      item.addEventListener('click', () => onNavigate(i));
      
      this.pushQueue(() => {
        return this.loadThumbnail(path, wrapper, starBadge, focusFill, focusBar, pickBadge, item);
      });
    }
  }

  private loadThumbnail(
    path: string, wrapper: HTMLElement, starBadge: HTMLElement,
    focusFill: HTMLElement, focusBar: HTMLElement,
    pickBadge: HTMLElement, thumbItem: HTMLElement
  ): Promise<void> {
    const p1 = invoke<[number[], number]>('get_thumbnail_data', { path })
      .then(([bytes, blurScore]) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.onload = () => {
          wrapper.innerHTML = '';
          wrapper.appendChild(img);
          wrapper.appendChild(starBadge);
          wrapper.appendChild(focusBar);
          URL.revokeObjectURL(url);
        };
        img.src = url;

        if (blurScore > 0) {
          const pct = Math.min(Math.floor(blurScore / 20), 100);
          focusFill.style.width = `${pct}%`;
          if (pct >= 60) focusFill.className = 'thumb-focus-fill focus-high';
          else if (pct >= 30) focusFill.className = 'thumb-focus-fill focus-medium';
          else focusFill.className = 'thumb-focus-fill focus-low';
          focusBar.style.display = 'block';
        }
      })
      .catch((err) => console.error(err));

    const p2 = invoke<ImageRecord | null>('get_image_metadata_info', { path })
      .then((meta) => {
        if (!meta) return;
        if (meta.pick === 1) {
          pickBadge.style.display = 'block';
          thumbItem.classList.add('thumb-picked');
        }
        if (meta.star_rating > 0) {
          starBadge.textContent = '★'.repeat(meta.star_rating);
          starBadge.style.display = 'block';
        }
        if (meta.rating) {
          const ribbon = thumbItem.querySelector('.thumb-ribbon') as HTMLElement;
          if (ribbon) ribbon.className = `thumb-ribbon ribbon-${meta.rating.toLowerCase()}`;
        }
      })
      .catch(() => {});

    return Promise.all([p1, p2]).then(() => {});
  }

  updateActiveItem(path: string) {
    document.querySelectorAll('.thumbnail-item').forEach(item => item.classList.remove('active'));
    const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement;
    if (item) {
      item.classList.add('active');
      const scroller = document.getElementById('filmstrip-scroll');
      if (scroller) {
        const offset = item.offsetLeft - scroller.clientWidth / 2 + item.clientWidth / 2;
        scroller.scrollTo({ left: offset, behavior: 'smooth' });
      }
    }
  }

  updateRating(path: string, category: string | null) {
    const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (!item) return;
    const ribbon = item.querySelector('.thumb-ribbon') as HTMLElement;
    if (ribbon) ribbon.className = category ? `thumb-ribbon ribbon-${category.toLowerCase()}` : 'thumb-ribbon';
  }

  updateStars(path: string, count: number) {
    const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (!item) return;
    const badge = item.querySelector('.thumb-star-badge') as HTMLElement;
    if (!badge) return;
    if (count > 0) { badge.textContent = '★'.repeat(count); badge.style.display = 'block'; }
    else { badge.style.display = 'none'; }
  }
}
