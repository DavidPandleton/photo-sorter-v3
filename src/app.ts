import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhotoViewer } from './viewer';
import { ImageCacheManager } from './cache';
import { FilmstripBuilder } from './filmstrip';
import { GamepadHandler } from './gamepad';
import { COLOR_UNRATE_FLASH } from './constants';

export interface ImageRecord {
  id: number; project_id: number; path: string; filename: string;
  rating: string | null; pick: number; rotation: number; blur_score: number;
  star_rating: number; file_size: number | null; width: number | null; height: number | null;
  iso: number | null; aperture: string | null; shutter_speed: string | null;
  focal_length: string | null; lens: string | null; camera_model: string | null;
  date_taken: string | null;
}

interface DateRecord { year: string; month: string; day: string; }
interface Project { id: number; name: string; root_path: string; created_at: string; updated_at: string; }
interface ProjectStats { [key: string]: number; PICKED: number; }

interface CategoryRecord {
  id: number;
  key_name: string;
  label: string;
  folder_name: string;
  shortcut_key: string | null;
  flash_color: string;
  sort_order: number;
}

interface KeybindingRecord {
  action_name: string;
  shortcut_key: string;
}

// --- Cross-platform helpers ---
const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function fmtShortcut(s: string): string {
  if (!IS_MAC) return s;
  return s.replace('Ctrl+', 'Cmd+');
}

interface HudItemRecord {
  action_name: string;
  visible: number;
  sort_order: number;
  group_name: string | null;
}

const ACTION_DISPLAY_NAMES: Record<string, string> = {
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

class PhotoSorterApp {
  private viewer: PhotoViewer;
  private cache: ImageCacheManager;
  private filmstrip: FilmstripBuilder;
  private gamepad: GamepadHandler;

  private imagePaths: string[] = [];
  private currentIndex: number = -1;
  private rootFolder: string = '';
  private isProcessingRating: boolean = false;
  private isNavigating: boolean = false;
  private isSidePanelRight: boolean = false;
  private isCompareMode: boolean = false;
  private ratedPaths: Set<string> = new Set();
  private filterMode: string = 'all';
  private compareIndex: number = -1;

  private categories: CategoryRecord[] = [];
  private keybindings: Map<string, string> = new Map();
  private hudItems: HudItemRecord[] = [];
  private isRecordingAction: string | null = null;
  private tempCategories: CategoryRecord[] = [];
  private tempKeybindings: Map<string, string> = new Map();
  private tempHudItems: HudItemRecord[] = [];

  constructor() {
    this.viewer = new PhotoViewer('photo-canvas');
    this.cache = new ImageCacheManager();
    this.filmstrip = new FilmstripBuilder();
    this.gamepad = new GamepadHandler({
      rateGood: () => {
        const goodCat = this.categories.find(c => c.key_name === 'good');
        if (goodCat) this.rateCurrent(goodCat.key_name, goodCat.flash_color);
        else this.rateCurrent('good', 'rgba(16, 185, 129, 0.4)');
      },
      rateBad: () => {
        const badCat = this.categories.find(c => c.key_name === 'bad');
        if (badCat) this.rateCurrent(badCat.key_name, badCat.flash_color);
        else this.rateCurrent('bad', 'rgba(239, 68, 68, 0.4)');
      },
      rateOk: () => {
        const okCat = this.categories.find(c => c.key_name === 'ok');
        if (okCat) this.rateCurrent(okCat.key_name, okCat.flash_color);
        else this.rateCurrent('ok', 'rgba(245, 158, 11, 0.4)');
      },
      navigateNext: () => this.navigateNext(),
      navigatePrev: () => this.navigatePrev(),
      rotateCW: () => this.rotateCurrent(1),
      rotateCCW: () => this.rotateCurrent(-1),
      resetZoom: () => this.viewer.resetZoom(),
      returnToMenu: async () => { await this.confirmReturnToMenu(); },
      finishSorting: () => this.finishSorting(),
      toggleHUD: () => this.toggleHUD(),
      selectFolder: () => this.selectFolder(),
      panBy: (dx, dy) => this.viewer.panBy(dx, dy),
      zoomBy: (f) => this.viewer.zoomBy(f),
      updateHUD: (m) => { this.gamepadActive = m; this.updateHUDControls(); },
      showToast: (m, s) => this.showToast(m, s),
    });
    this.gamepad.startLoop();
    this.gamepad.init();
    this.init();
  }

  private gamepadActive: boolean = false;

  private initElements() {
    document.getElementById('btn-start-culling')?.addEventListener('click', () => this.selectFolder());
    document.getElementById('btn-restore-checkpoint')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-exit-app')?.addEventListener('click', () => this.exitApp());
    document.getElementById('btn-back')?.addEventListener('click', async () => { await this.confirmReturnToMenu(); });
    document.getElementById('btn-toggle-browser')?.addEventListener('click', () => this.toggleBrowser());
    document.getElementById('btn-toggle-side')?.addEventListener('click', () => this.togglePanelSide());
    document.getElementById('btn-top-restore')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-finish-export')?.addEventListener('click', () => this.finishSorting());
    document.getElementById('btn-export-xmp')?.addEventListener('click', () => this.exportXMP());
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.updateFilters((e.target as HTMLInputElement).value, '', '', '');
    });
  }

  private initMenuParallax() {
    const menuScreen = document.getElementById('menu-screen');
    if (!menuScreen) return;

    menuScreen.addEventListener('mousemove', (e: MouseEvent) => {
      const cards = document.querySelectorAll<HTMLElement>('.menu-card');
      if (!cards.length) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const px = (e.clientX - cx) / cx;
      const py = (e.clientY - cy) / cy;

      cards.forEach((card, i) => {
        const depth = 3 + i * 2;
        card.style.transform = `translate(${px * depth}px, ${py * depth}px)`;
      });
    });

    menuScreen.addEventListener('mouseleave', () => {
      document.querySelectorAll<HTMLElement>('.menu-card').forEach(card => {
        card.style.transform = '';
      });
    });
  }

  private initCheatsheet() {
    document.getElementById('btn-cheatsheet-close')?.addEventListener('click', () => this.toggleCheatsheet());
    document.getElementById('cheatsheet-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.toggleCheatsheet();
    });
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const overlay = document.getElementById('cheatsheet-overlay');
        if (overlay && overlay.style.display !== 'none') return;
        this.toggleCheatsheet();
        return;
      }
      if ((e.key === '/' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.toggleCheatsheet();
      }
      if (e.key === 'Escape') {
        document.getElementById('cheatsheet-overlay')!.style.display = 'none';
      }
    });
  }

  private toggleCheatsheet() {
    const overlay = document.getElementById('cheatsheet-overlay');
    if (!overlay) return;
    overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
  }

  private async loadRecentProjects() {
    const listContainer = document.getElementById('recent-projects-list');
    if (!listContainer) return;
    try {
      const projects = await invoke<Project[]>('get_recent_projects');
      if (projects.length === 0) { listContainer.innerHTML = '<p class="empty-text">No recent projects found.</p>'; return; }
      listContainer.innerHTML = '';
      for (const proj of projects.slice(0, 5)) {
        const btn = document.createElement('button');
        btn.className = 'recent-btn'; btn.textContent = `📁 ${proj.name}`; btn.title = proj.root_path;
        btn.addEventListener('click', () => this.loadFolder(proj.root_path));
        listContainer.appendChild(btn);
      }
    } catch (err) { console.error('Failed to load recent projects:', err); }
  }

  private initToastPosition() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const saved = localStorage.getItem('toast-position');
    if (saved === 'top') {
      container.classList.add('toast-top');
    }
  }

  private toggleToastPosition() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const isTop = container.classList.toggle('toast-top');
    localStorage.setItem('toast-position', isTop ? 'top' : 'bottom');
    this.showToast(isTop ? 'Toasts moved to TOP' : 'Toasts moved to BOTTOM', 'GOOD');
  }

  private async checkForStartupFolder() {
    try {
      const startupFolder = await invoke<string | null>('get_startup_folder');
      if (startupFolder) {
        console.log('CLI auto-load folder detected:', startupFolder);
        await this.loadFolder(startupFolder);
      }
    } catch (err) {
      console.error('Failed to get CLI startup folder:', err);
    }
  }

  private handleZoomChanged() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    if (this.viewer.getScale() > 1.5) {
      const fullResImg = this.cache.getFromFullResCache(path);
      if (fullResImg && this.viewer.getCurrentImage() !== fullResImg) {
        this.viewer.swapCurrentImage(fullResImg);
      }
    } else {
      const lowResImg = this.cache.getFromCache(path);
      if (lowResImg && this.viewer.getCurrentImage() !== lowResImg) {
        this.viewer.swapCurrentImage(lowResImg);
      }
    }
  }

  private async selectFolder() {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select Photo Directory' });
      if (selected) this.loadFolder(selected);
    } catch (err) { this.showToast('Error selecting folder: ' + err, 'BAD'); }
  }

  private async loadFolder(folderPath: string) {
    try {
      this.showProgressIndicator(true);
      const count = await invoke<number>('open_folder', { path: folderPath });
      if (count === 0) { this.showToast('No images found or folder is empty.', 'BAD'); this.showProgressIndicator(false); return; }
      this.rootFolder = folderPath;
      await this.syncImagePaths();
      document.getElementById('menu-screen')?.classList.remove('active');
      document.getElementById('workspace-screen')?.classList.add('active');
      this.viewer.resizeCanvas();
      this.buildFolderTree(folderPath);
      this.loadDateHierarchy();
      await this.navigateImage(0);
      this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
      this.showToast(`Loaded ${count} images successfully!`, 'GOOD');
    } catch (err) { this.showToast('Error loading folder: ' + err, 'BAD'); }
    finally { this.showProgressIndicator(false); }
  }

  private async syncImagePaths() {
    this.imagePaths = await invoke<string[]>('get_image_paths');
    this.currentIndex = await invoke<number>('get_current_index');
  }

  private async navigateImage(index: number) {
    if (this.imagePaths.length === 0) return;
    const targetIdx = Math.max(0, Math.min(this.imagePaths.length - 1, index));
    this.currentIndex = targetIdx;
    await invoke('set_current_index', { index: targetIdx });
    const currentPath = this.imagePaths[targetIdx];
    this.filmstrip.updateActiveItem(currentPath);
    await this.displayMainImage(currentPath);
    this.updateStatsHUD();
    this.updateMetadataInfo(currentPath);
    this.cache.triggerPreloaders(targetIdx, this.imagePaths);
  }

  private async displayMainImage(path: string) {
    try {
      const cached = this.cache.getFromCache(path);
      if (cached) {
        const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
        this.viewer.setImage(cached, meta?.rotation || 0);
        this.viewer.setOverlays((meta?.pick || 0) === 1, meta?.star_rating || 0);
        return;
      }
      const bytes = await invoke<number[]>('get_image_data', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = async () => {
        this.cache.addToCache(path, img);
        const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
        this.viewer.setImage(img, meta?.rotation || 0);
        this.viewer.setOverlays((meta?.pick || 0) === 1, meta?.star_rating || 0);
        URL.revokeObjectURL(url);
        this.cache.loadFullResolution(path, this.viewer, this.currentIndex, this.imagePaths);
      };
      img.src = url;
    } catch (err) { console.error('Failed to render image: ', err); }
  }

  private async rateCurrent(category: string, flashColor: string) {
    if (this.currentIndex < 0 || this.isProcessingRating) return;
    this.isProcessingRating = true;
    const path = this.imagePaths[this.currentIndex];
    try {
      await invoke('rate_image', { path, category });
      this.ratedPaths.add(path);
      this.filmstrip.updateRating(path, category);
      this.triggerFlashNotification(flashColor);
      setTimeout(async () => { await this.navigateNext(); this.isProcessingRating = false; }, 100);
    } catch (err) { this.showToast('Rating failed: ' + err, 'BAD'); this.isProcessingRating = false; }
  }

  private async unrateCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      await invoke('rate_image', { path, category: null });
      this.ratedPaths.delete(path);
      this.filmstrip.updateRating(path, null);
      this.triggerFlashNotification(COLOR_UNRATE_FLASH);
      this.updateStatsHUD();
    } catch (err) { this.showToast('Unrating failed: ' + err, 'BAD'); }
  }

  private async togglePickCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const picked = await invoke<boolean>('toggle_pick', { path });
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      this.viewer.setOverlays(picked, meta?.star_rating || 0);
      this.updateStatsHUD();
    } catch (err) { this.showToast('Flagging failed: ' + err, 'BAD'); }
  }

  private async setStarsCurrent(stars: number) {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const activeStars = await invoke<number>('set_star_rating', { path, stars });
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      this.viewer.setOverlays((meta?.pick || 0) === 1, activeStars);
      this.filmstrip.updateStars(path, activeStars);
      this.updateStatsHUD();
    } catch (err) { this.showToast('Rating stars failed: ' + err, 'BAD'); }
  }

  private async rotateCurrent(direction: number) {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const newAngle = await invoke<number>('set_rotation', { path, direction });
      const cached = this.cache.getFromCache(path);
      if (cached) this.viewer.setImage(cached, newAngle);
      else await this.navigateImage(this.currentIndex);
    } catch (err) { this.showToast('Rotation failed: ' + err, 'BAD'); }
  }

  private async deleteCurrent() {
    if (this.currentIndex < 0) return;
    const confirmDelete = await this.showCustomDialog('Move to Trash', 'Permanently move this photo to the system Trash?', true);
    if (!confirmDelete) return;
    try {
      const deletedPath = await invoke<string | null>('delete_current_image');
      if (deletedPath) {
        this.showToast('Photo moved to Trash', 'BAD');
        await this.syncImagePaths();
        this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
        if (this.imagePaths.length > 0) await this.navigateImage(this.currentIndex);
        else await this.confirmReturnToMenu();
      }
    } catch (err) { this.showToast('Failed to trash photo: ' + err, 'BAD'); }
  }

  private async undoLastRating() {
    try {
      const undonePath = await invoke<string | null>('undo_last_rating');
      if (undonePath) {
        this.showToast('Undo completed successfully', 'GOOD');
        await this.syncImagePaths();
        this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
        const idx = this.imagePaths.indexOf(undonePath);
        if (idx >= 0) await this.navigateImage(idx);
      } else { this.showToast('No actions to undo', 'BAD'); }
    } catch (err) { this.showToast('Undo failed: ' + err, 'BAD'); }
  }

  private async finishSorting() {
    if (this.imagePaths.length === 0) return;
    const confirmed = await this.showCustomDialog('Finish Sorting', 'Are you sure? This will move all rated photos to their category folders.', true);
    if (!confirmed) return;
    try {
      this.showProgressIndicator(true);
      const [movedCount, summary] = await invoke<[number, Record<string, number>]>('finish_sorting');
      const summaryParts = Object.entries(summary).map(([folder, count]) => `${folder}: ${count}`);
      const msg = `Export finished!\nMoved: ${movedCount} photos.\n\n${summaryParts.join(' | ')}`;
      await this.showCustomDialog('Export Complete', msg, false);
      this.showConfetti();
      this.returnToMenu();
    } catch (err) { this.showToast('Export failed: ' + err, 'BAD'); }
    finally { this.showProgressIndicator(false); }
  }

  private async exportXMP() {
    if (this.currentIndex < 0) {
      this.showToast('Open a folder first.', 'BAD');
      return;
    }
    try {
      this.showProgressIndicator(true);
      const count = await invoke<number>('export_xmp_sidecars');
      this.showToast(`Exported ${count} XMP sidecar files. Import into Lightroom/Darktable to see ratings.`, 'GOOD');
    } catch (err) {
      this.showToast('XMP export failed: ' + err, 'BAD');
    } finally {
      this.showProgressIndicator(false);
    }
  }

  private async restoreCheckpoint() {
    try {
      this.showProgressIndicator(true);
      let root = this.rootFolder;
      if (!root) {
        const selected = await open({ directory: true, multiple: false, title: 'Select Folder containing checkpoint' });
        if (!selected) { this.showProgressIndicator(false); return; }
        root = selected;
      }
      const count = await invoke<number>('restore_checkpoint', { root });
      if (count >= 0) {
        this.showToast(`Restored ${count} photos from checkpoint successfully!`, 'GOOD');
        this.rootFolder = root;
        await this.loadFolder(root);
      } else { this.showToast('No valid checkpoint found to restore.', 'BAD'); }
    } catch (err) { this.showToast('Checkpoint restoration failed: ' + err, 'BAD'); }
    finally { this.showProgressIndicator(false); }
  }

  private async updateFilters(text: string, folder: string, date: string, mode: string) {
    try {
      await invoke('set_filters', { text, folder, date, mode });
      await this.syncImagePaths();
      this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
      if (this.imagePaths.length > 0) await this.navigateImage(0);
      else { this.viewer.setOverlays(false, 0); this.showToast('No photos match current filter criteria.', 'BAD'); }
    } catch (err) { console.error(err); }
  }

  private async navigateNext() {
    if (this.isNavigating) return;
    if (this.isCompareMode) { await this.navigateCompare(1); return; }
    let idx = this.currentIndex + 1;
    while (idx < this.imagePaths.length) {
      if (this.filterMode === 'unrated' && this.ratedPaths.has(this.imagePaths[idx])) { idx++; continue; }
      this.isNavigating = true;
      try { await this.navigateImage(idx); } finally { this.isNavigating = false; }
      return;
    }
  }

  private async navigatePrev() {
    if (this.isNavigating) return;
    if (this.isCompareMode) { await this.navigateCompare(-1); return; }
    let idx = this.currentIndex - 1;
    while (idx >= 0) {
      if (this.filterMode === 'unrated' && this.ratedPaths.has(this.imagePaths[idx])) { idx--; continue; }
      this.isNavigating = true;
      try { await this.navigateImage(idx); } finally { this.isNavigating = false; }
      return;
    }
  }

  private async navigateCompare(direction: number) {
    const total = this.imagePaths.length;
    if (total <= 1) return;
    let targetIdx = this.compareIndex;
    if (targetIdx < 0) targetIdx = Math.max(0, this.currentIndex - 1);
    targetIdx = (targetIdx + direction + total) % total;
    if (targetIdx === this.currentIndex) targetIdx = (targetIdx + direction + total) % total;
    this.compareIndex = targetIdx;
    const path = this.imagePaths[targetIdx];
    try {
      const bytes = await invoke<number[]>('get_image_data', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      const rot = meta?.rotation || 0;
      img.onload = () => { this.viewer.setCompareImage(img, rot); URL.revokeObjectURL(url); };
      img.src = url;
    } catch (err) { console.error(err); }
  }

  private async toggleCompareMode() {
    if (this.isCompareMode) {
      this.isCompareMode = false; this.compareIndex = -1;
      this.viewer.toggleCompare(false);
    } else {
      this.isCompareMode = true;
      this.viewer.toggleCompare(true);
      await this.navigateCompare(1);
    }
  }

  private async jumpToImageNumber() {
    if (this.imagePaths.length === 0) return;
    const input = prompt(`Jump to image number (1 to ${this.imagePaths.length}):`);
    if (input) {
      const num = parseInt(input);
      if (!isNaN(num) && num >= 1 && num <= this.imagePaths.length) await this.navigateImage(num - 1);
      else await this.showCustomDialog('Invalid Number', `Please enter a number between 1 and ${this.imagePaths.length}.`, false);
    }
  }

  private async confirmReturnToMenu() {
    const confirmed = await this.showCustomDialog('Return to Menu', 'Exit to the main menu? All unsaved progress will be lost.', true);
    if (confirmed) this.returnToMenu();
  }

  private showConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    const colors = ['#2dd4bf', '#f59e0b', '#10b981', '#ef4444', '#ffab40', '#6366f1', '#ec4899'];
    const particles: {x:number;y:number;vx:number;vy:number;size:number;color:string;rotation:number;rotSpeed:number;opacity:number}[] = [];
    for (let i = 0; i < 200; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * -1,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 3 + 2,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        opacity: 1,
      });
    }
    let frame = 0;
    const anim = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        if (p.opacity <= 0) continue;
        p.x += p.vx;
        p.vy += 0.08;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        if (frame > 60) p.opacity -= 0.01;
        if (p.opacity <= 0) continue;
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive && frame < 240) requestAnimationFrame(anim);
      else { canvas.remove(); }
    };
    anim();
  }

  private returnToMenu() {
    this.rootFolder = ''; this.imagePaths = []; this.currentIndex = -1;
    this.cache.clear();
    document.getElementById('workspace-screen')?.classList.remove('active');
    document.getElementById('menu-screen')?.classList.add('active');
  }

  private exitApp() {
    getCurrentWindow().close().catch(() => window.close());
  }

  private toggleBrowser() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('btn-toggle-browser');
    if (panel && btn) {
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'flex';
      btn.classList.toggle('active');
      this.viewer.resizeCanvas();
    }
  }

  private togglePanelSide() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('btn-toggle-side');
    if (panel && btn) {
      this.isSidePanelRight = !this.isSidePanelRight;
      if (this.isSidePanelRight) { panel.className = 'side-panel-right'; btn.textContent = '◀'; }
      else { panel.className = 'side-panel-left'; btn.textContent = '▶'; }
      this.viewer.resizeCanvas();
    }
  }

  private buildFolderTree(rootPath: string) {
    const container = document.getElementById('folder-tree');
    if (!container) return;
    container.innerHTML = '';
    const rootName = rootPath.split(/[/\\]/).pop() || rootPath;
    const rootNode = this.createTreeNode(rootName, rootPath, true);
    container.appendChild(rootNode);

    const directories = new Set<string>();
    for (const p of this.imagePaths) {
      const relative = p.substring(rootPath.length + 1);
      const parts = relative.split(/[/\\]/); parts.pop();
      let accum = rootPath;
      for (const part of parts) { accum = accum + '/' + part; directories.add(accum); }
    }

    const sortedDirs = Array.from(directories).sort();
    const treeMap: Record<string, HTMLElement> = { [rootPath]: rootNode.querySelector('.tree-children') as HTMLElement };
    for (const dir of sortedDirs) {
      const parentDir = dir.substring(0, dir.lastIndexOf('/'));
      const dirName = dir.substring(dir.lastIndexOf('/') + 1);
      const node = this.createTreeNode(dirName, dir, false);
      const parentChildren = treeMap[parentDir] || treeMap[rootPath];
      if (parentChildren) { parentChildren.appendChild(node); treeMap[dir] = node.querySelector('.tree-children') as HTMLElement; }
    }
  }

  private createTreeNode(name: string, path: string, isRoot: boolean): HTMLElement {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.setAttribute('data-node-path', path);
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (isRoot) row.classList.add('selected');
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow expanded';
    arrow.textContent = '▶';
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = isRoot ? '💻' : '📁';
    const text = document.createElement('span');
    text.textContent = name;
    row.appendChild(arrow); row.appendChild(icon); row.appendChild(text);
    item.appendChild(row);
    const children = document.createElement('div');
    children.className = 'tree-children expanded';
    item.appendChild(children);
    arrow.addEventListener('click', (e) => { e.stopPropagation(); children.classList.toggle('expanded'); arrow.classList.toggle('expanded'); });
    row.addEventListener('click', () => {
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      this.updateFilters('', path, '', '');
    });
    return item;
  }

  private async loadDateHierarchy() {
    const container = document.getElementById('date-tree');
    const dateWidget = document.getElementById('date-widget');
    if (!container || !dateWidget) return;
    try {
      const dates = await invoke<DateRecord[]>('get_date_hierarchy');
      if (dates.length === 0) { dateWidget.style.display = 'none'; return; }
      dateWidget.style.display = 'flex';
      container.innerHTML = '';
      const yearsMap: Record<string, HTMLElement> = {};
      const monthsMap: Record<string, HTMLElement> = {};
      for (const d of dates) {
        const yKey = d.year; const mKey = `${d.year}-${d.month}`;
        if (!yearsMap[yKey]) { const yNode = this.createDateNode(d.year, d.year, '📅'); container.appendChild(yNode); yearsMap[yKey] = yNode.querySelector('.tree-children') as HTMLElement; }
        if (!monthsMap[mKey]) { const mNode = this.createDateNode(d.month, `${d.year}-${d.month}`, '🌙'); yearsMap[yKey].appendChild(mNode); monthsMap[mKey] = mNode.querySelector('.tree-children') as HTMLElement; }
        const dayText = `${d.year}-${d.month}-${d.day}`;
        const dayNode = this.createDateNode(d.day, dayText, '☀️');
        monthsMap[mKey].appendChild(dayNode);
      }
    } catch (err) { console.error(err); }
  }

  private createDateNode(name: string, filterValue: string, iconChar: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'tree-item';
    const row = document.createElement('div');
    row.className = 'tree-row';
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow expanded';
    arrow.textContent = '▶';
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = iconChar;
    const text = document.createElement('span');
    text.textContent = name;
    row.appendChild(arrow); row.appendChild(icon); row.appendChild(text);
    item.appendChild(row);
    const children = document.createElement('div');
    children.className = 'tree-children expanded';
    item.appendChild(children);
    arrow.addEventListener('click', (e) => { e.stopPropagation(); children.classList.toggle('expanded'); arrow.classList.toggle('expanded'); });
    row.addEventListener('click', () => {
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      this.updateFilters('', '', filterValue, '');
    });
    return item;
  }

  private initKeyboardBinds() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      
      let combo = '';
      if (e.ctrlKey || e.metaKey) combo += 'Ctrl+';
      if (e.altKey) combo += 'Alt+';
      if (e.shiftKey) combo += 'Shift+';
      
      let key = e.key;
      if (key === ' ') key = 'Space';
      if (key.length === 1) key = key.toUpperCase();
      combo += key;
      
      // If settings remapper is recording a key binding:
      if (this.isRecordingAction) {
        e.preventDefault();
        e.stopPropagation();
        this.recordKeybinding(this.isRecordingAction, combo);
        return;
      }

      // Check standard Ctrl/Cmd + , shortcut for Settings
      if (combo === 'Ctrl+,' || combo === 'Ctrl+<' || combo === 'Ctrl+m') {
        e.preventDefault();
        this.toggleSettingsModal();
        return;
      }

      // Standard Ctrl/Cmd + zoom shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.viewer.zoomIn(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); this.viewer.zoomOut(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); this.viewer.resetZoom(); return; }

      // Star rating binds (Ctrl/Cmd+1-5) are global and non-customizable
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        this.setStarsCurrent(parseInt(e.key));
        return;
      }
      
      // Build alternate combo (Meta+ variant for macOS)
      let comboAlt: string | undefined;
      if (e.ctrlKey || e.metaKey) {
        const mod = e.metaKey ? 'Meta+' : 'Ctrl+';
        if (combo.startsWith('Ctrl+')) {
          comboAlt = mod + combo.slice(5);
        }
      }

      // Check dynamic categories shortcut key bindings
      for (const cat of this.categories) {
        if (!cat.shortcut_key) continue;
        const s = cat.shortcut_key.toUpperCase();
        if (s === combo.toUpperCase() || (comboAlt && s === comboAlt.toUpperCase())) {
          e.preventDefault();
          this.rateCurrent(cat.key_name, cat.flash_color);
          return;
        }
      }
      
      // Lookup remapped actions in keybindings
      const action = this.getActionFromCombo(combo) || (comboAlt ? this.getActionFromCombo(comboAlt) : null);
      if (action) {
        if (action === 'toggle_pick') e.preventDefault(); // prevent scrolling spacebar
        this.executeAction(action);
      }
    });
  }

  private getActionFromCombo(combo: string): string | null {
    for (const [action, shortcut] of this.keybindings.entries()) {
      if (shortcut.toUpperCase() === combo.toUpperCase()) {
        return action;
      }
    }
    return null;
  }

  private executeAction(action: string) {
    switch (action) {
      case 'prev_image': this.navigatePrev(); break;
      case 'next_image': this.navigateNext(); break;
      case 'toggle_pick': this.togglePickCurrent(); break;
      case 'undo': this.undoLastRating(); break;
      case 'unrate': this.unrateCurrent(); break;
      case 'rot_cw': this.rotateCurrent(1); break;
      case 'rot_ccw': this.rotateCurrent(-1); break;
      case 'compare': this.toggleCompareMode(); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'hud': this.toggleHUD(); break;
      case 'info': this.toggleInfoPanel(); break;
      case 'toast': this.toggleToastPosition(); break;
      case 'filter': this.toggleFilterMode(); break;
      case 'home': this.navigateImage(0); break;
      case 'end': this.navigateImage(this.imagePaths.length - 1); break;
      case 'jump': this.jumpToImageNumber(); break;
      case 'menu': void this.confirmReturnToMenu(); break;
      case 'export': this.finishSorting(); break;
      case 'delete': this.deleteCurrent(); break;
    }
  }

  private toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  private toggleHUD() {
    const hud = document.getElementById('hud-container');
    if (hud) hud.style.display = hud.style.display === 'none' ? 'flex' : 'none';
  }

  private toggleInfoPanel() {
    const info = document.getElementById('info-hud');
    if (info) info.style.display = info.style.display === 'none' ? 'flex' : 'none';
  }

  private async toggleFilterMode() {
    const isUnrated = await invoke<string>('toggle_filter_mode').catch(() => 'all');
    this.filterMode = isUnrated === 'unrated' ? 'unrated' : 'all';
    this.updateFilters('', '', '', this.filterMode);
    this.showToast(this.filterMode === 'unrated' ? 'Unrated filter ON' : 'Showing all images', 'GOOD');
  }

  private updateHUDControls() {
    const hud = document.getElementById('hud-label');
    if (!hud) return;
    
    const sortedHUD = [...this.hudItems].sort((a, b) => a.sort_order - b.sort_order);
    
    if (this.gamepadActive) {
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
        const shortcut = this.keybindings.get(h.action_name) || 'None';
          rows.push(`<span class="hud-key">[${fmtShortcut(shortcut)}]</span> ${actionLabel}`);
      });
      
      this.categories.forEach(cat => {
        if (cat.shortcut_key) {
          const color = cat.flash_color.replace('0.4', '1.0');
          rows.push(`<span class="hud-key" style="color: ${color}">[${cat.shortcut_key}]</span> Rate ${cat.label}`);
        }
      });
      
      hud.innerHTML = rows.join('<br>');
    }
  }

  private async updateStatsHUD() {
    try {
      const stats = await invoke<ProjectStats>('get_project_stats');
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
      
      this.categories.forEach((cat) => {
        const count = stats[cat.key_name] || 0;
        const color = cat.flash_color.replace('0.4', '1.0');
        html += `
          <div class="stats-row">
            <span class="stats-dot" style="color: ${color}">●</span>
            <span class="stats-value">${count}</span>
            <span class="stats-label">${cat.label.toUpperCase()}</span>
          </div>
        `;
      });
      
      container.innerHTML = html;
      container.style.display = 'flex';
      
      if (this.imagePaths.length > 0) {
        const pct = Math.floor(((this.currentIndex + 1) / this.imagePaths.length) * 100);
        const fill = document.getElementById('progress-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      }
    } catch (err) { console.error(err); }
  }

  private async updateMetadataInfo(path: string) {
    try {
      const img = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      if (!img) return;
      document.getElementById('info-progress')!.textContent = `${this.currentIndex + 1} / ${this.imagePaths.length}`;
      document.getElementById('info-filename')!.textContent = img.filename;
      const ext = img.filename.split('.').pop()?.toUpperCase() || 'UNKNOWN';
      const isRaw = (['NEF', 'CR2', 'ARW', 'DNG', 'CR3', 'ORF', 'RW2', 'PEF'] as string[]).includes(ext);
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
    } catch (err) { console.error(err); }
  }

  private triggerFlashNotification(color: string) {
    const flash = document.getElementById('flash-overlay')!;
    flash.style.backgroundColor = color;
    flash.style.opacity = '0.35';
    setTimeout(() => { flash.style.opacity = '0'; }, 200);
  }

  private showProgressIndicator(show: boolean) {
    const fill = document.getElementById('progress-bar-fill');
    if (fill) {
      fill.style.width = show ? '100%' : '0%';
      fill.style.transition = show ? 'width 2s ease-in-out' : 'none';
    }
  }

  private showToast(msg: string, status: 'GOOD' | 'BAD') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${status.toLowerCase()}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
  }

  private showCustomDialog(title: string, message: string, showCancel = false): Promise<boolean> {
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

  public async init() {
    this.initElements();
    this.initMenuParallax();
    this.initCheatsheet();
    await this.loadConfigFromDB();
    this.initKeyboardBinds();
    this.initSettingsUI();
    await this.loadRecentProjects();
    this.initToastPosition();
    await this.checkForStartupFolder();
    this.viewer.setOnZoom(() => this.handleZoomChanged());
    this.updateHUDControls();
  }

  private async loadConfigFromDB() {
    try {
      this.categories = await invoke<CategoryRecord[]>('get_categories');
      const binds = await invoke<KeybindingRecord[]>('get_keybindings');
      this.keybindings = new Map(binds.map(b => [b.action_name, b.shortcut_key]));
      this.hudItems = await invoke<HudItemRecord[]>('get_hud_items');
    } catch (err) {
      console.error('Failed to load configuration from DB:', err);
    }
  }

  private initSettingsUI() {
    document.getElementById('btn-settings-menu')?.addEventListener('click', () => this.toggleSettingsModal());
    document.getElementById('btn-settings-workspace')?.addEventListener('click', () => this.toggleSettingsModal());
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.toggleSettingsModal());
    
    document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.toggleSettingsModal();
      }
    });
    
    const tabBtns = document.querySelectorAll('.settings-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.tab-pane').forEach(pane => {
          if (pane.id === targetTab) {
            pane.classList.add('active');
          } else {
            pane.classList.remove('active');
          }
        });
      });
    });
    
    document.getElementById('btn-add-category')?.addEventListener('click', () => {
      const usedShortcuts = new Set(this.tempCategories.map(c => c.shortcut_key?.toUpperCase()).filter(Boolean));
      let nextShortcut = '';
      for (let i = 4; i <= 9; i++) {
        if (!usedShortcuts.has(String(i))) {
          nextShortcut = String(i);
          break;
        }
      }
      
      const newCat: CategoryRecord = {
        id: 0,
        key_name: 'newcategory',
        label: 'New Category',
        folder_name: 'NEW_CATEGORY',
        shortcut_key: nextShortcut || null,
        flash_color: 'rgba(45, 212, 191, 0.4)',
        sort_order: this.tempCategories.length + 1
      };
      
      this.tempCategories.push(newCat);
      this.renderSettingsCategories();
    });
    
    document.getElementById('btn-settings-save')?.addEventListener('click', () => this.saveSettings());
    
    document.getElementById('btn-reset-keybindings')?.addEventListener('click', async () => {
      const confirmed = await this.showCustomDialog('Reset Keybindings', 'Reset all keyboard shortcuts to factory defaults? All custom binds will be lost.', true);
      if (!confirmed) return;
        try {
          this.showProgressIndicator(true);
          const defaultBinds = await invoke<KeybindingRecord[]>('reset_keybindings');
          this.keybindings = new Map(defaultBinds.map(b => [b.action_name, b.shortcut_key]));
          this.tempKeybindings = new Map(this.keybindings);
          
          this.renderSettingsKeybindings();
          this.updateHUDControls();
          
          this.showToast('Keybindings restored to defaults!', 'GOOD');
        } catch (err) {
          this.showToast('Failed to reset keybindings: ' + err, 'BAD');
        } finally {
          this.showProgressIndicator(false);
        }
    });
  }

  private toggleSettingsModal() {
    const modal = document.getElementById('settings-overlay');
    if (!modal) return;
    if (modal.style.display === 'none') {
      this.tempCategories = JSON.parse(JSON.stringify(this.categories));
      this.tempKeybindings = new Map(this.keybindings);
      this.tempHudItems = JSON.parse(JSON.stringify(this.hudItems));
      
      this.isRecordingAction = null;
      
      document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === 'categories-tab') btn.classList.add('active');
        else btn.classList.remove('active');
      });
      document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === 'categories-tab') pane.classList.add('active');
        else pane.classList.remove('active');
      });
      
      this.renderSettingsCategories();
      this.renderSettingsKeybindings();
      this.renderSettingsHUD();
      
      modal.style.display = 'flex';
    } else {
      modal.style.display = 'none';
      this.isRecordingAction = null;
    }
  }

  private renderSettingsCategories() {
    const container = document.getElementById('categories-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    this.tempCategories.forEach((cat, index) => {
      const row = document.createElement('div');
      row.className = 'category-row';
      row.innerHTML = `
        <input type="text" class="cat-label" value="${cat.label}" placeholder="Category Name">
        <input type="text" class="cat-folder" value="${cat.folder_name}" placeholder="Folder Name">
        <button class="keybinding-btn cat-shortcut">${cat.shortcut_key || 'None'}</button>
        <input type="color" class="cat-color" value="${this.rgbaToHex(cat.flash_color)}">
        <button class="btn-delete-cat" title="Delete Category">&times;</button>
      `;
      
      const labelInput = row.querySelector('.cat-label') as HTMLInputElement;
      labelInput.addEventListener('input', (e) => {
        this.tempCategories[index].label = (e.target as HTMLInputElement).value;
        if (!this.tempCategories[index].id) {
          this.tempCategories[index].key_name = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9]/g, '');
        }
      });
      
      const folderInput = row.querySelector('.cat-folder') as HTMLInputElement;
      folderInput.addEventListener('input', (e) => {
        this.tempCategories[index].folder_name = (e.target as HTMLInputElement).value;
      });
      
      const shortcutBtn = row.querySelector('.cat-shortcut') as HTMLButtonElement;
      shortcutBtn.addEventListener('click', () => {
        document.querySelectorAll('.keybinding-btn').forEach(btn => btn.classList.remove('recording'));
        shortcutBtn.classList.add('recording');
        this.isRecordingAction = `category:${index}`;
      });
      
      const colorInput = row.querySelector('.cat-color') as HTMLInputElement;
      colorInput.addEventListener('input', (e) => {
        const hex = (e.target as HTMLInputElement).value;
        this.tempCategories[index].flash_color = this.hexToRgba(hex, 0.4);
      });
      
      const deleteBtn = row.querySelector('.btn-delete-cat') as HTMLButtonElement;
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await this.showCustomDialog('Delete Category', `Delete category "${cat.label}"? All images rated with this category will be reset to unrated.`, true);
        if (!confirmed) return;
        this.tempCategories.splice(index, 1);
        this.renderSettingsCategories();
      });
      
      container.appendChild(row);
    });
  }

  private renderSettingsKeybindings() {
    const container = document.getElementById('keybindings-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    for (const actionName of Object.keys(ACTION_DISPLAY_NAMES)) {
      const row = document.createElement('div');
      row.className = 'keybinding-row';
      const label = ACTION_DISPLAY_NAMES[actionName] || actionName;
      const shortcut = this.tempKeybindings.get(actionName) || 'None';
      
      row.innerHTML = `
        <span class="keybinding-label">${label}</span>
        <button class="keybinding-btn bind-btn" data-action="${actionName}">${fmtShortcut(shortcut)}</button>
      `;
      
      const bindBtn = row.querySelector('.bind-btn') as HTMLButtonElement;
      bindBtn.addEventListener('click', () => {
        document.querySelectorAll('.keybinding-btn').forEach(btn => btn.classList.remove('recording'));
        bindBtn.classList.add('recording');
        this.isRecordingAction = actionName;
      });
      
      container.appendChild(row);
    }
  }

  private renderSettingsHUD() {
    const container = document.getElementById('hud-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    const sorted = [...this.tempHudItems].sort((a, b) => a.sort_order - b.sort_order);
    
    sorted.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'hud-item';
      
      const actionLabel = ACTION_DISPLAY_NAMES[item.action_name] || item.action_name;
      const checked = item.visible === 1 ? 'checked' : '';
      const groupText = item.group_name ? `<span class="hud-item-group">${item.group_name}</span>` : '';
      
      row.innerHTML = `
        <input type="checkbox" class="hud-item-checkbox" ${checked}>
        <span class="hud-item-label">${actionLabel}</span>
        ${groupText}
      `;
      
      const checkbox = row.querySelector('.hud-item-checkbox') as HTMLInputElement;
      checkbox.addEventListener('change', (e) => {
        const idx = this.tempHudItems.indexOf(item);
        if (idx >= 0) {
          this.tempHudItems[idx].visible = (e.target as HTMLInputElement).checked ? 1 : 0;
        }
      });
      
      container.appendChild(row);
    });
  }

  private recordKeybinding(actionSpec: string, combo: string) {
    if (actionSpec.startsWith('category:')) {
      const idx = parseInt(actionSpec.substring(9));
      if (!isNaN(idx) && this.tempCategories[idx]) {
        this.tempCategories[idx].shortcut_key = combo;
      }
      this.isRecordingAction = null;
      this.renderSettingsCategories();
    } else {
      this.tempKeybindings.set(actionSpec, combo);
      this.isRecordingAction = null;
      this.renderSettingsKeybindings();
    }
  }

  private async saveSettings() {
    try {
      this.showProgressIndicator(true);
      
      const originalKeys = new Set(this.categories.map(c => c.key_name));
      const tempKeys = new Set(this.tempCategories.map(c => c.key_name));
      
      const deletedKeys: string[] = [];
      for (const k of originalKeys) {
        if (!tempKeys.has(k)) {
          deletedKeys.push(k);
        }
      }
      
      for (const k of deletedKeys) {
        await invoke('delete_category', { keyName: k });
      }
      
      this.tempCategories.forEach((cat, idx) => {
        cat.sort_order = idx + 1;
      });
      for (const cat of this.tempCategories) {
        await invoke('save_category', { cat });
      }
      
      for (const [actionName, shortcut] of this.tempKeybindings.entries()) {
        await invoke('save_keybinding', { bind: { action_name: actionName, shortcut_key: shortcut } });
      }
      
      await invoke('save_hud_items', { items: this.tempHudItems });
      
      await this.loadConfigFromDB();
      await this.syncImagePaths();
      this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
      
      if (this.currentIndex >= 0) {
        await this.navigateImage(this.currentIndex);
      }
      
      this.updateStatsHUD();
      this.updateHUDControls();
      
      this.toggleSettingsModal();
      this.showToast('Settings saved successfully!', 'GOOD');
      
    } catch (err) {
      this.showToast('Failed to save settings: ' + err, 'BAD');
    } finally {
      this.showProgressIndicator(false);
    }
  }

  private rgbaToHex(rgba: string): string {
    if (rgba.startsWith('#')) return rgba.substring(0, 7);
    const match = rgba.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!match) return '#ffffff';
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    const app = new PhotoSorterApp();
    (window as any).photoSorterApp = app;
    console.log('Photo Sorter v3 initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Photo Sorter:', err);
  }
});

window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message);
});
