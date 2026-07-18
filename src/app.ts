import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhotoViewer } from './viewer';
import { ImageCacheManager } from './cache';
import { FilmstripBuilder } from './filmstrip';
import { GamepadHandler } from './gamepad';
import { COLOR_UNRATE_FLASH, RAW_EXTENSIONS } from './constants';

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

// ponytail: CategoryRecord/KeybindingRecord/HudItemRecord removed — settings UI was YAGNI
// ponytail: ACTION_DISPLAY_NAMES removed — keybinding remapper was YAGNI
// ponytail: fmtShortcut removed — kept inline in HUD

class PhotoSorterApp {
  private viewer: PhotoViewer;
  private cache: ImageCacheManager;
  private filmstrip: FilmstripBuilder;
  private gamepad: GamepadHandler;

  private imagePaths: string[] = [];
  private currentIndex: number = -1;
  private isProcessingRating: boolean = false;
  private isNavigating: boolean = false;
  private isSidePanelRight: boolean = false;
  private ratedPaths: Set<string> = new Set();
  private filterMode: string = 'all';

  // ponytail: categories/keybindings/hudItems/temp* fields removed — settings UI was YAGNI

  constructor() {
    this.viewer = new PhotoViewer('photo-canvas');
    this.cache = new ImageCacheManager();
    this.filmstrip = new FilmstripBuilder();
    this.gamepad = new GamepadHandler({
      rateGood: () => this.rateCurrent('good', 'rgba(16, 185, 129, 0.4)'),
      rateBad: () => this.rateCurrent('bad', 'rgba(239, 68, 68, 0.4)'),
      rateOk: () => this.rateCurrent('ok', 'rgba(245, 158, 11, 0.4)'),
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
    document.getElementById('btn-exit-app')?.addEventListener('click', () => this.exitApp());
    document.getElementById('btn-back')?.addEventListener('click', async () => { await this.confirmReturnToMenu(); });
    document.getElementById('btn-toggle-browser')?.addEventListener('click', () => this.toggleBrowser());
    document.getElementById('btn-toggle-side')?.addEventListener('click', () => this.togglePanelSide());
    document.getElementById('btn-finish-export')?.addEventListener('click', () => this.finishSorting());
    // ponytail: btn-export-xmp removed — feature cut
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.updateFilters((e.target as HTMLInputElement).value, '', '', '');
    });
  }

  // ponytail: menu parallax removed — was fluff
  private initCheatsheet() {
    document.getElementById('btn-cheatsheet-close')?.addEventListener('click', () => this.toggleCheatsheet());
    document.getElementById('cheatsheet-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.toggleCheatsheet();
    });
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
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
        const el = document.getElementById('cheatsheet-overlay');
        if (el) el.style.display = 'none';
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

  // ponytail: handleZoomChanged removed — full-res cache was YAGNI
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
        // ponytail: no full-res lazy load — passthrough bytes are always full quality
        const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
        this.viewer.setImage(img, meta?.rotation || 0);
        this.viewer.setOverlays((meta?.pick || 0) === 1, meta?.star_rating || 0);
        URL.revokeObjectURL(url);
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
      this.returnToMenu();
    } catch (err) { this.showToast('Export failed: ' + err, 'BAD'); }
    finally { this.showProgressIndicator(false); }
  }

  // ponytail: exportXMP removed — button cut from HTML, xmp.rs deleted
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
    let idx = this.currentIndex - 1;
    while (idx >= 0) {
      if (this.filterMode === 'unrated' && this.ratedPaths.has(this.imagePaths[idx])) { idx--; continue; }
      this.isNavigating = true;
      try { await this.navigateImage(idx); } finally { this.isNavigating = false; }
      return;
    }
  }

  private async confirmReturnToMenu() {
    const confirmed = await this.showCustomDialog('Return to Menu', 'Exit to the main menu? All unsaved progress will be lost.', true);
    if (confirmed) this.returnToMenu();
  }

  private returnToMenu() {
    this.imagePaths = []; this.currentIndex = -1;
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

  // ponytail: hardcoded keybinds — no DB-backed remapper (was YAGNI)
  private keyActions: Record<string, () => void> = {
    'P': () => this.navigatePrev(), 'N': () => this.navigateNext(),
    'SPACE': () => this.togglePickCurrent(),
    'Z': () => this.undoLastRating(), '0': () => this.unrateCurrent(),
    'ARROWUP': () => this.rotateCurrent(1), 'ARROWDOWN': () => this.rotateCurrent(-1),
    'C': () => {}, 'F': () => this.toggleFullscreen(),
    'H': () => this.toggleHUD(), 'I': () => this.toggleInfoPanel(),
    'T': () => this.toggleToastPosition(), 'U': () => this.toggleFilterMode(),
    'HOME': () => this.navigateImage(0), 'END': () => this.navigateImage(this.imagePaths.length - 1),
    'ESCAPE': () => void this.confirmReturnToMenu(),
    'DELETE': () => this.deleteCurrent(),
    '1': () => this.setStarsCurrent(1), '2': () => this.setStarsCurrent(2),
    '3': () => this.setStarsCurrent(3), '4': () => this.setStarsCurrent(4),
    '5': () => this.setStarsCurrent(5),
  };

  private initKeyboardBinds() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.viewer.zoomIn(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); this.viewer.zoomOut(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); this.viewer.resetZoom(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Z') { e.preventDefault(); this.undoLastRating(); return; }
      let key = e.key === ' ' ? 'SPACE' : e.key.toUpperCase();
      const fn = this.keyActions[key];
      if (fn) { e.preventDefault(); fn(); }
    });
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

  // ponytail: hardcoded HUD — no DB-backed items/categories
  private updateHUDControls() {
    const hud = document.getElementById('hud-label');
    if (!hud) return;
    if (this.gamepadActive) {
      hud.innerHTML = `
<span class="hud-key hud-good">[A]</span> GOOD
<span class="hud-key hud-bad">[B]</span> BAD
<span class="hud-key hud-ok">[X]</span> OK
<span class="hud-key">[LB/RB]</span> Prev/Next
<span class="hud-key">[LT/RT]</span> Rotate
<span class="hud-key">[L-STICK]</span> Pan | <span class="hud-key">[R-STICK]</span> Zoom
<span class="hud-key">[START]</span> Export | <span class="hud-key">[SELECT]</span> Menu
<span class="hud-key">[Y]</span> Reset Zoom`.trim();
    } else {
      hud.innerHTML = `
<span class="hud-key">[N]</span> Next <span class="hud-key">[P]</span> Prev
<span class="hud-key">[SPACE]</span> Pick <span class="hud-key">[DEL]</span> Delete
<span class="hud-key hud-good">[1]</span> Good <span class="hud-key hud-ok">[2]</span> Ok <span class="hud-key hud-bad">[3]</span> Bad
<span class="hud-key">[Z]</span> Undo <span class="hud-key">[U]</span> Filter <span class="hud-key">[C]</span> Compare
<span class="hud-key">[F]</span> Fullscreen <span class="hud-key">[H]</span> HUD <span class="hud-key">[I]</span> Info`.trim();
    }
  }

  private async updateStatsHUD() {
    try {
      const stats = await invoke<ProjectStats>('get_project_stats');
      const container = document.getElementById('stats-hud');
      if (!container) return;
      container.innerHTML = `
<div class="stats-row highlight"><span class="stats-star">★</span><span class="stats-value" id="stats-val-picked">${stats.PICKED || 0}</span><span class="stats-label">PICKED</span></div>
<div class="stats-divider"></div>
<div class="stats-row"><span class="stats-dot" style="color:#10b981">●</span><span class="stats-value">${stats.good || 0}</span><span class="stats-label">GOOD</span></div>
<div class="stats-row"><span class="stats-dot" style="color:#f59e0b">●</span><span class="stats-value">${stats.ok || 0}</span><span class="stats-label">OK</span></div>
<div class="stats-row"><span class="stats-dot" style="color:#ef4444">●</span><span class="stats-value">${stats.bad || 0}</span><span class="stats-label">BAD</span></div>`.trim();
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
    this.initCheatsheet();
    this.initKeyboardBinds();
    await this.loadRecentProjects();
    this.initToastPosition();
    await this.checkForStartupFolder();
    this.updateHUDControls();
  }
}
// ponytail: initSettingsUI (was ~100 lines) removed along with settings modal — YAGNI
// ponytail: toggleSettingsModal / renderSettings* / saveSettings removed — categories/keybinds/HUD CRUD was YAGNI

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
