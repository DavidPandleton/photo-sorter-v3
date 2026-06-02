import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhotoViewer } from './viewer';
import { ImageCacheManager } from './cache';
import { FilmstripBuilder } from './filmstrip';
import { GamepadHandler } from './gamepad';
import {
  CATEGORY_BAD, CATEGORY_OK, CATEGORY_GOOD,
  COLOR_BAD_FLASH, COLOR_OK_FLASH, COLOR_GOOD_FLASH, COLOR_UNRATE_FLASH,
  RAW_EXTENSIONS
} from './constants';

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
interface ProjectStats { BAD: number; OK: number; GOOD: number; PICKED: number; }

class PhotoSorterApp {
  private viewer: PhotoViewer;
  private cache: ImageCacheManager;
  private filmstrip: FilmstripBuilder;
  private gamepad: GamepadHandler;

  private imagePaths: string[] = [];
  private currentIndex: number = -1;
  private rootFolder: string = '';
  private isProcessingRating: boolean = false;
  private isSidePanelRight: boolean = false;
  private isCompareMode: boolean = false;
  private ratedPaths: Set<string> = new Set();
  private filterMode: string = 'all';
  private compareIndex: number = -1;

  constructor() {
    this.viewer = new PhotoViewer('photo-canvas');
    this.cache = new ImageCacheManager();
    this.filmstrip = new FilmstripBuilder();
    this.gamepad = new GamepadHandler({
      rateGood: () => this.rateCurrent(CATEGORY_GOOD, COLOR_GOOD_FLASH),
      rateBad: () => this.rateCurrent(CATEGORY_BAD, COLOR_BAD_FLASH),
      rateOk: () => this.rateCurrent(CATEGORY_OK, COLOR_OK_FLASH),
      navigateNext: () => this.navigateNext(),
      navigatePrev: () => this.navigatePrev(),
      rotateCW: () => this.rotateCurrent(1),
      rotateCCW: () => this.rotateCurrent(-1),
      resetZoom: () => this.viewer.resetZoom(),
      returnToMenu: () => this.confirmReturnToMenu(),
      finishSorting: () => this.finishSorting(),
      toggleHUD: () => this.toggleHUD(),
      selectFolder: () => this.selectFolder(),
      panBy: (dx, dy) => this.viewer.panBy(dx, dy),
      zoomBy: (f) => this.viewer.zoomBy(f),
      updateHUD: (m) => { this.gamepadActive = m; this.updateHUDControls(); },
      showToast: (m, s) => this.showToast(m, s),
    });
    this.gamepad.startLoop();
    this.initElements();
    this.initKeyboardBinds();
    this.loadRecentProjects();
    this.gamepad.init();
    this.initToastPosition();
    this.checkForStartupFolder();
    this.viewer.setOnZoom(() => this.handleZoomChanged());
  }

  private gamepadActive: boolean = false;

  private initElements() {
    document.getElementById('btn-start-culling')?.addEventListener('click', () => this.selectFolder());
    document.getElementById('btn-restore-checkpoint')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-exit-app')?.addEventListener('click', () => this.exitApp());
    document.getElementById('btn-back')?.addEventListener('click', () => this.confirmReturnToMenu());
    document.getElementById('btn-toggle-browser')?.addEventListener('click', () => this.toggleBrowser());
    document.getElementById('btn-toggle-side')?.addEventListener('click', () => this.togglePanelSide());
    document.getElementById('btn-top-restore')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-finish-export')?.addEventListener('click', () => this.finishSorting());
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.updateFilters((e.target as HTMLInputElement).value, '', '', '');
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
    } catch (err) { this.showToast('Rating failed: ' + err, CATEGORY_BAD); this.isProcessingRating = false; }
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
    } catch (err) { this.showToast('Unrating failed: ' + err, CATEGORY_BAD); }
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
        else this.confirmReturnToMenu();
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
    try {
      this.showProgressIndicator(true);
      const [movedCount, summary] = await invoke<[number, Record<string, number>]>('finish_sorting');
      const msg = `Export finished!\nMoved: ${movedCount} photos.\nBAD: ${summary.BAD} | OK: ${summary.OK} | GOOD: ${summary.GOOD}`;
      await this.showCustomDialog('Export Complete', msg, false);
      this.returnToMenu();
    } catch (err) { this.showToast('Export failed: ' + err, 'BAD'); }
    finally { this.showProgressIndicator(false); }
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
    if (this.isCompareMode) { await this.navigateCompare(1); return; }
    let idx = this.currentIndex + 1;
    while (idx < this.imagePaths.length) {
      if (this.filterMode === 'unrated' && this.ratedPaths.has(this.imagePaths[idx])) { idx++; continue; }
      await this.navigateImage(idx); return;
    }
  }

  private async navigatePrev() {
    if (this.isCompareMode) { await this.navigateCompare(-1); return; }
    let idx = this.currentIndex - 1;
    while (idx >= 0) {
      if (this.filterMode === 'unrated' && this.ratedPaths.has(this.imagePaths[idx])) { idx--; continue; }
      await this.navigateImage(idx); return;
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
      if (this.currentIndex < 0) return;
      const key = e.key.toUpperCase();
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.ctrlKey && key === 'Z') { e.preventDefault(); this.undoLastRating(); return; }
      if (e.ctrlKey && ['1','2','3','4','5'].includes(e.key)) { e.preventDefault(); this.setStarsCurrent(parseInt(e.key)); return; }
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.viewer.zoomIn(); return; }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); this.viewer.zoomOut(); return; }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); this.viewer.resetZoom(); return; }
      if (e.ctrlKey && key === 'G') { e.preventDefault(); this.jumpToImageNumber(); return; }
      switch (key) {
        case 'N': case 'ARROWRIGHT': this.navigateNext(); break;
        case 'P': case 'ARROWLEFT': this.navigatePrev(); break;
        case 'HOME': this.navigateImage(0); break;
        case 'END': this.navigateImage(this.imagePaths.length - 1); break;
        case 'ESCAPE': this.confirmReturnToMenu(); break;
        case 'ENTER': this.finishSorting(); break;
        case '1': this.rateCurrent(CATEGORY_BAD, COLOR_BAD_FLASH); break;
        case '2': this.rateCurrent(CATEGORY_OK, COLOR_OK_FLASH); break;
        case '3': this.rateCurrent(CATEGORY_GOOD, COLOR_GOOD_FLASH); break;
        case '0': this.unrateCurrent(); break;
        case ' ': e.preventDefault(); this.togglePickCurrent(); break;
        case 'DELETE': this.deleteCurrent(); break;
        case 'C': this.toggleCompareMode(); break;
        case 'F': this.toggleFullscreen(); break;
        case 'H': this.toggleHUD(); break;
        case 'I': this.toggleInfoPanel(); break;
        case 'T': this.toggleToastPosition(); break;
        case 'U': this.toggleFilterMode(); break;
        case 'ARROWUP': this.rotateCurrent(1); break;
        case 'ARROWDOWN': this.rotateCurrent(-1); break;
      }
    });
  }

  private toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  private toggleHUD() {
    const hud = document.getElementById('hud-container');
    if (hud) hud.style.display = hud.style.display === 'none' ? '' : 'none';
  }

  private toggleInfoPanel() {
    const info = document.querySelector('.info-widget') as HTMLElement;
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
      hud.innerHTML = [
        '<span class="hud-key hud-bad">[1]</span> BAD',
        '<span class="hud-key hud-ok">[2]</span> OK',
        '<span class="hud-key hud-good">[3]</span> GOOD',
        '<span class="hud-key">[0]</span> Unrate | <span class="hud-key">[DEL]</span> Delete',
        '<span class="hud-key">[SPACE]</span> Flag/Pick',
        '<span class="hud-key">[N/P]</span> Prev/Next | <span class="hud-key">[U]</span> Filter Unrated',
        '<span class="hud-key">[UP/DOWN]</span> Rotate | <span class="hud-key">[CTRL+Z]</span> Undo',
        '<span class="hud-key">[CTRL+1-5]</span> Rating Stars'
      ].join('<br>');
    }
  }

  private async updateStatsHUD() {
    try {
      const stats = await invoke<ProjectStats>('get_project_stats');
      document.getElementById('stats-val-picked')!.textContent = String(stats.PICKED);
      document.getElementById('stats-val-bad')!.textContent = String(stats.BAD);
      document.getElementById('stats-val-ok')!.textContent = String(stats.OK);
      document.getElementById('stats-val-good')!.textContent = String(stats.GOOD);
      if (this.imagePaths.length > 0) {
        const pct = Math.floor(((this.currentIndex + 1) / this.imagePaths.length) * 100);
        const fill = document.getElementById('progress-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      }
      document.getElementById('stats-hud')!.style.display = 'flex';
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
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    const app = new PhotoSorterApp();
    (window as any).photoSorterApp = app;
    app['updateHUDControls']();
    console.log('Photo Sorter v3 initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Photo Sorter:', err);
  }
});

window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message);
});
