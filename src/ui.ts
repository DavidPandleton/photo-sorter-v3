// Pure DOM/UI helpers extracted from the app god-class: feedback widgets (toast,
// flash, progress, dialog), HUD/stats/metadata rendering, and color utilities.
// No app state lives here — everything is passed in.

import { RAW_EXTENSIONS } from './constants';
import type { CategoryRecord, HudItemRecord, ImageRecord, ProjectStats } from './types';

// --- Cross-platform helpers ---
const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

export function fmtShortcut(s: string): string {
  if (!IS_MAC) return s;
  return s.replace('Ctrl+', 'Cmd+');
}

export const ACTION_DISPLAY_NAMES: Record<string, string> = {
  prev_image: 'Previous Image',
  next_image: 'Next Image',
  toggle_pick: 'Flag/Pick Image',
  undo: 'Undo Last Rating',
  unrate: 'Unrate Image',
  rot_cw: 'Rotate Clockwise',
  rot_ccw: 'Rotate Counter-Clockwise',
  compare: 'Compare Mode',
  fullscreen: 'Toggle Fullscreen',
  hud: 'Toggle HUD Overlay',
  info: 'Toggle Info Panel',
  toast: 'Toggle Toast Position',
  filter: 'Filter Unrated Only',
  home: 'Go to First Image',
  end: 'Go to Last Image',
  jump: 'Jump to Image Number',
  menu: 'Return to Main Menu',
  export: 'Finish & Export',
  delete: 'Delete Image',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function rgbaToHex(rgba: string): string {
  if (rgba.startsWith('#')) return rgba.substring(0, 7);
  const match = rgba.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!match) return '#ffffff';
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Feedback widgets ---

export function showToast(msg: string, status: 'GOOD' | 'BAD') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${status.toLowerCase()}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
}

export function triggerFlashNotification(color: string) {
  const flash = document.getElementById('flash-overlay')!;
  flash.style.backgroundColor = color;
  flash.style.opacity = '0.35';
  setTimeout(() => { flash.style.opacity = '0'; }, 200);
}

export function showProgressIndicator(show: boolean) {
  const fill = document.getElementById('progress-bar-fill');
  if (fill) {
    fill.style.width = show ? '100%' : '0%';
    fill.style.transition = show ? 'width 2s ease-in-out' : 'none';
  }
}

export function showCustomDialog(title: string, message: string, showCancel = false): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const msgEl = document.getElementById('dialog-message');
    const okBtn = document.getElementById('btn-dialog-ok');
    const cancelBtn = document.getElementById('btn-dialog-cancel');
    if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) {
      console.error('[Dialog] DOM elements missing, using console fallback');
      console.log(`[Dialog] ${title}: ${message}`);
      resolve(true); return;
    }
    titleEl.textContent = title;
    msgEl.innerHTML = message.replace(/\n/g, '<br>');
    cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
    overlay.classList.add('active');
    const cleanUp = (result: boolean) => {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    function onOk() { cleanUp(true); }
    function onCancel() { cleanUp(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// --- HUD / stats / metadata rendering ---

export interface HudContext {
  gamepadActive: boolean;
  hudItems: HudItemRecord[];
  keybindings: Map<string, string>;
  categories: CategoryRecord[];
}

export function toggleFullscreen(): void {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
}

export function toggleHUD(): void {
  const hud = document.getElementById('hud-container');
  if (hud) hud.style.display = hud.style.display === 'none' ? 'flex' : 'none';
}

export function toggleInfoPanel(): void {
  const info = document.getElementById('info-hud');
  if (info) info.style.display = info.style.display === 'none' ? 'flex' : 'none';
}

export function renderHUDControls(ctx: HudContext) {
  const hud = document.getElementById('hud-label');
  if (!hud) return;

  const sortedHUD = [...ctx.hudItems].sort((a, b) => a.sort_order - b.sort_order);

  if (ctx.gamepadActive) {
    hud.innerHTML = [
      '<span class="hud-key hud-good">[A]</span> GOOD',
      '<span class="hud-key hud-bad">[B]</span> BAD',
      '<span class="hud-key hud-ok">[X]</span> OK',
      '<span class="hud-key">[LB/RB]</span> Prev/Next',
      '<span class="hud-key">[LT/RT]</span> Rotate',
      '<span class="hud-key">[L-STICK]</span> Pan | <span class="hud-key">[R-STICK]</span> Zoom',
      '<span class="hud-key">[START]</span> Export | <span class="hud-key">[SELECT]</span> Menu',
      '<span class="hud-key">[Y]</span> Reset Zoom'
    ].join('<br>');
  } else {
    const rows: string[] = [];

    const activeHUD = sortedHUD.filter(h => h.visible === 1);

    activeHUD.forEach(h => {
      const actionLabel = ACTION_DISPLAY_NAMES[h.action_name] || h.action_name;
      const shortcut = ctx.keybindings.get(h.action_name) || 'None';
        rows.push(`<span class="hud-key">[${escapeHtml(fmtShortcut(shortcut))}]</span> ${escapeHtml(actionLabel)}`);
    });

    ctx.categories.forEach(cat => {
      if (cat.shortcut_key) {
        const color = cat.flash_color.replace('0.4', '1.0');
        rows.push(`<span class="hud-key" style="color: ${color}">[${escapeHtml(cat.shortcut_key)}]</span> Rate ${escapeHtml(cat.label)}`);
      }
    });

    hud.innerHTML = rows.join('<br>');
  }
}

export interface StatsContext {
  categories: CategoryRecord[];
  currentIndex: number;
  totalImages: number;
}

export function renderStatsHUD(stats: ProjectStats, ctx: StatsContext) {
  const container = document.getElementById('stats-hud');
  if (!container) return;

  let html = `
    <div class="stats-row highlight">
      <span class="stats-star">★</span>
      <span class="stats-value" id="stats-val-picked">${stats.PICKED || 0}</span>
      <span class="stats-label">PICKED</span>
    </div>
    <div class="stats-divider"></div>
  `;

  ctx.categories.forEach((cat) => {
    const count = stats[cat.key_name] || 0;
    const color = cat.flash_color.replace('0.4', '1.0');
    html += `
      <div class="stats-row">
        <span class="stats-dot" style="color: ${color}">●</span>
        <span class="stats-value">${count}</span>
        <span class="stats-label">${escapeHtml(cat.label.toUpperCase())}</span>
      </div>
    `;
  });

  container.innerHTML = html;
  container.style.display = 'flex';

  if (ctx.totalImages > 0) {
    const pct = Math.floor(((ctx.currentIndex + 1) / ctx.totalImages) * 100);
    const fill = document.getElementById('progress-bar-fill');
    if (fill) fill.style.width = `${pct}%`;
  }
}

export interface MetadataContext {
  currentIndex: number;
  totalImages: number;
}

export function renderMetadataInfo(img: ImageRecord, ctx: MetadataContext) {
  document.getElementById('info-progress')!.textContent = `${ctx.currentIndex + 1} / ${ctx.totalImages}`;
  document.getElementById('info-filename')!.textContent = img.filename;
  const ext = img.filename.split('.').pop()?.toUpperCase() || 'UNKNOWN';
  const isRaw = RAW_EXTENSIONS.includes(ext);
  document.getElementById('info-type')!.textContent = `${ext} ${isRaw ? '(RAW)' : ''}`;
  const exifLabel = document.getElementById('info-exif')!;
  if (img.camera_model) {
    const parts: string[] = [img.camera_model];
    if (img.iso) parts.push(`ISO ${img.iso}`);
    if (img.aperture) parts.push(`f/${img.aperture}`);
    if (img.shutter_speed) parts.push(`${img.shutter_speed}s`);
    if (img.focal_length) parts.push(`${img.focal_length}mm`);
    if (img.lens) parts.push(img.lens);
    exifLabel.textContent = parts.join(' · ');
  } else { exifLabel.textContent = 'Extracting EXIF...'; }
}
