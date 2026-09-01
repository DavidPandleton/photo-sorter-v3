import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invokeImageData } from './ipc';
import { PhotoViewer } from './viewer';
import { ImageCacheManager } from './cache';
import { FilmstripBuilder } from './filmstrip';
import { GamepadHandler } from './gamepad';
import { BrowserPanel } from './browser';
import { SettingsModal } from './settings';
import { COLOR_UNRATE_FLASH } from './constants';
import type {
  CategoryRecord, HudItemRecord, ImageRecord,
  KeybindingRecord, Project, ProjectStats,
} from './types';
import {
  renderHUDControls, renderMetadataInfo, renderStatsHUD,
  showCustomDialog, showProgressIndicator, showToast, triggerFlashNotification,
  toggleFullscreen, toggleHUD, toggleInfoPanel,
} from './ui';
import { buildCombo, getActionFromCombo } from './keyboard';

export type { ImageRecord } from './types';

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
  private isCompareMode: boolean = false;
  private ratedPaths: Set<string> = new Set();
  private filterMode: string = 'all';
  private compareIndex: number = -1;

  private categories: CategoryRecord[] = [];
  private keybindings: Map<string, string> = new Map();
  private hudItems: HudItemRecord[] = [];
  private settings: SettingsModal;
  private browser: BrowserPanel;

  constructor() {
    this.viewer = new PhotoViewer('photo-canvas');
    this.cache = new ImageCacheManager();
    this.filmstrip = new FilmstripBuilder();
    this.settings = new SettingsModal({
      getCategories: () => this.categories,
      getHudItems: () => this.hudItems,
      getKeybindings: () => this.keybindings,
      setKeybindings: (b) => { this.keybindings = b; },
      afterConfigChanged: async () => {
        await this.loadConfigFromDB();
        await this.syncImagePaths();
        this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
        if (this.currentIndex >= 0) {
          await this.navigateImage(this.currentIndex);
        }
        this.updateStatsHUD();
        this.updateHUDControls();
      },
      refreshHUD: () => this.updateHUDControls(),
    });
    this.browser = new BrowserPanel({
      onFilter: (t, f, d, m) => this.updateFilters(t, f, d, m),
      onResize: () => this.viewer.resizeCanvas(),
    });
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
      returnToMenu: () => this.confirmReturnToMenu(),
      finishSorting: () => this.finishSorting(),
      toggleHUD: () => toggleHUD(),
      selectFolder: () => this.selectFolder(),
      panBy: (dx, dy) => this.viewer.panBy(dx, dy),
      zoomBy: (f) => this.viewer.zoomBy(f),
      updateHUD: (m) => { this.gamepadActive = m; this.updateHUDControls(); },
      showToast: (m, s) => showToast(m, s),
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
    document.getElementById('btn-back')?.addEventListener('click', () => this.confirmReturnToMenu());
    document.getElementById('btn-toggle-browser')?.addEventListener('click', () => this.browser.toggleBrowser());
    document.getElementById('btn-toggle-side')?.addEventListener('click', () => this.browser.togglePanelSide());
    document.getElementById('btn-top-restore')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-finish-export')?.addEventListener('click', () => this.finishSorting());
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    let searchTimer: number | undefined;
    searchInput?.addEventListener('input', (e) => {
      // Debounce: each keystroke otherwise triggers a full DB reload +
      // filmstrip rebuild + navigate(0) (bug #18).
      const value = (e.target as HTMLInputElement).value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        this.updateFilters(value, '', '', '');
      }, 250);
    });
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
    showToast(isTop ? 'Toasts moved to TOP' : 'Toasts moved to BOTTOM', 'GOOD');
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
    } catch (err) { showToast('Error selecting folder: ' + err, 'BAD'); }
  }

  private async loadFolder(folderPath: string) {
    try {
      showProgressIndicator(true);
      const count = await invoke<number>('open_folder', { path: folderPath });
      if (count === 0) { showToast('No images found or folder is empty.', 'BAD'); showProgressIndicator(false); return; }
      this.rootFolder = folderPath;
      await this.syncImagePaths();
      document.getElementById('menu-screen')?.classList.remove('active');
      document.getElementById('workspace-screen')?.classList.add('active');
      this.viewer.resizeCanvas();
      this.browser.buildFolderTree(folderPath, this.imagePaths);
      this.browser.loadDateHierarchy();
      await this.navigateImage(0);
      this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
      showToast(`Loaded ${count} images successfully!`, 'GOOD');
    } catch (err) { showToast('Error loading folder: ' + err, 'BAD'); }
    finally { showProgressIndicator(false); }
  }

  private async syncImagePaths() {
    this.imagePaths = await invoke<string[]>('get_image_paths');
    this.currentIndex = await invoke<number>('get_current_index');
    // Hydrate ratedPaths from SQLite (bug #5): fresh sessions used to skip
    // already-rated photos wrongly in unrated-mode navigation.
    const ratings = await invoke<Record<string, string>>('get_ratings');
    this.ratedPaths = new Set(Object.keys(ratings));
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
      const blob = await invokeImageData(path, 'get_image_data');
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
      triggerFlashNotification(flashColor);
      setTimeout(async () => { await this.navigateNext(); this.isProcessingRating = false; }, 100);
    } catch (err) { showToast('Rating failed: ' + err, 'BAD'); this.isProcessingRating = false; }
  }

  private async unrateCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      await invoke('rate_image', { path, category: null });
      this.ratedPaths.delete(path);
      this.filmstrip.updateRating(path, null);
      triggerFlashNotification(COLOR_UNRATE_FLASH);
      this.updateStatsHUD();
    } catch (err) { showToast('Unrating failed: ' + err, 'BAD'); }
  }

  private async togglePickCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const picked = await invoke<boolean>('toggle_pick', { path });
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      this.viewer.setOverlays(picked, meta?.star_rating || 0);
      this.updateStatsHUD();
    } catch (err) { showToast('Flagging failed: ' + err, 'BAD'); }
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
    } catch (err) { showToast('Rating stars failed: ' + err, 'BAD'); }
  }

  private async rotateCurrent(direction: number) {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const newAngle = await invoke<number>('set_rotation', { path, direction });
      const cached = this.cache.getFromCache(path);
      if (cached) this.viewer.setImage(cached, newAngle);
      else await this.navigateImage(this.currentIndex);
    } catch (err) { showToast('Rotation failed: ' + err, 'BAD'); }
  }

  private async deleteCurrent() {
    if (this.currentIndex < 0) return;
    const confirmDelete = await showCustomDialog('Move to Trash', 'Permanently move this photo to the system Trash?', true);
    if (!confirmDelete) return;
    try {
      const deletedPath = await invoke<string | null>('delete_current_image');
      if (deletedPath) {
        showToast('Photo moved to Trash', 'BAD');
        await this.syncImagePaths();
        this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
        if (this.imagePaths.length > 0) await this.navigateImage(this.currentIndex);
        else this.confirmReturnToMenu();
      }
    } catch (err) { showToast('Failed to trash photo: ' + err, 'BAD'); }
  }

  private async undoLastRating() {
    try {
      const undonePath = await invoke<string | null>('undo_last_rating');
      if (undonePath) {
        showToast('Undo completed successfully', 'GOOD');
        await this.syncImagePaths();
        this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
        const idx = this.imagePaths.indexOf(undonePath);
        if (idx >= 0) await this.navigateImage(idx);
      } else { showToast('No actions to undo', 'BAD'); }
    } catch (err) { showToast('Undo failed: ' + err, 'BAD'); }
  }

  private async finishSorting() {
    if (this.imagePaths.length === 0) return;
    if (!confirm('Are you sure you want to finish sorting? This will move all rated photos to their category folders.')) return;
    try {
      showProgressIndicator(true);
      const [movedCount, summary] = await invoke<[number, Record<string, number>]>('finish_sorting');
      const summaryParts = Object.entries(summary).map(([folder, count]) => `${folder}: ${count}`);
      const msg = `Export finished!\nMoved: ${movedCount} photos.\n\n${summaryParts.join(' | ')}`;
      await showCustomDialog('Export Complete', msg, false);
      this.returnToMenu();
    } catch (err) { showToast('Export failed: ' + err, 'BAD'); }
    finally { showProgressIndicator(false); }
  }

  private async restoreCheckpoint() {
    try {
      showProgressIndicator(true);
      let root = this.rootFolder;
      if (!root) {
        const selected = await open({ directory: true, multiple: false, title: 'Select Folder containing checkpoint' });
        if (!selected) { showProgressIndicator(false); return; }
        root = selected;
      }
      const count = await invoke<number>('restore_checkpoint', { root });
      if (count >= 0) {
        showToast(`Restored ${count} photos from checkpoint successfully!`, 'GOOD');
        this.rootFolder = root;
        await this.loadFolder(root);
      } else { showToast('No valid checkpoint found to restore.', 'BAD'); }
    } catch (err) { showToast('Checkpoint restoration failed: ' + err, 'BAD'); }
    finally { showProgressIndicator(false); }
  }

  private async updateFilters(text: string, folder: string, date: string, mode: string) {
    try {
      await invoke('set_filters', { text, folder, date, mode });
      await this.syncImagePaths();
      this.filmstrip.rebuild(this.imagePaths, (i) => this.navigateImage(i));
      if (this.imagePaths.length > 0) await this.navigateImage(0);
      else { this.viewer.setOverlays(false, 0); showToast('No photos match current filter criteria.', 'BAD'); }
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
      const blob = await invokeImageData(path, 'get_image_data');
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
      else await showCustomDialog('Invalid Number', `Please enter a number between 1 and ${this.imagePaths.length}.`, false);
    }
  }

  private confirmReturnToMenu() {
    const ans = confirm('Are you sure you want to exit to the main menu?');
    if (ans) this.returnToMenu();
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

  private initKeyboardBinds() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const { combo, comboAlt } = buildCombo(e);

      // If settings remapper is recording a key binding:
      if (this.settings.isRecording) {
        e.preventDefault();
        e.stopPropagation();
        this.settings.recordKeybinding(this.settings.isRecording, combo);
        return;
      }

      // Check standard Ctrl/Cmd + , shortcut for Settings
      if (combo === 'Ctrl+,' || combo === 'Ctrl+<' || combo === 'Ctrl+m') {
        e.preventDefault();
        this.settings.toggle();
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
      const action = getActionFromCombo(this.keybindings, combo) || (comboAlt ? getActionFromCombo(this.keybindings, comboAlt) : null);
      if (action) {
        if (action === 'toggle_pick') e.preventDefault(); // prevent scrolling spacebar
        this.executeAction(action);
      }
    });
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
      case 'fullscreen': toggleFullscreen(); break;
      case 'hud': toggleHUD(); break;
      case 'info': toggleInfoPanel(); break;
      case 'toast': this.toggleToastPosition(); break;
      case 'filter': this.toggleFilterMode(); break;
      case 'home': this.navigateImage(0); break;
      case 'end': this.navigateImage(this.imagePaths.length - 1); break;
      case 'jump': this.jumpToImageNumber(); break;
      case 'menu': this.confirmReturnToMenu(); break;
      case 'export': this.finishSorting(); break;
      case 'delete': this.deleteCurrent(); break;
    }
  }

  private async toggleFilterMode() {
    const isUnrated = await invoke<string>('toggle_filter_mode').catch(() => 'all');
    this.filterMode = isUnrated === 'unrated' ? 'unrated' : 'all';
    this.updateFilters('', '', '', this.filterMode);
    showToast(this.filterMode === 'unrated' ? 'Unrated filter ON' : 'Showing all images', 'GOOD');
  }

  private updateHUDControls() {
    renderHUDControls({
      gamepadActive: this.gamepadActive,
      hudItems: this.hudItems,
      keybindings: this.keybindings,
      categories: this.categories,
    });
  }

  private async updateStatsHUD() {
    try {
      const stats = await invoke<ProjectStats>('get_project_stats');
      renderStatsHUD(stats, {
        categories: this.categories,
        currentIndex: this.currentIndex,
        totalImages: this.imagePaths.length,
      });
    } catch (err) { console.error(err); }
  }

  private async updateMetadataInfo(path: string) {
    try {
      const img = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      if (!img) return;
      renderMetadataInfo(img, {
        currentIndex: this.currentIndex,
        totalImages: this.imagePaths.length,
      });
    } catch (err) { console.error(err); }
  }

  public async init() {
    this.initElements();
    await this.loadConfigFromDB();
    this.initKeyboardBinds();
    this.settings.init();
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
