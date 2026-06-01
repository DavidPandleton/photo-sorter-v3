import { invoke } from '@tauri-apps/api/core';
import { PhotoViewer } from './viewer';

// --- Type Interfaces ---
interface ImageRecord {
  id: number;
  project_id: number;
  path: string;
  filename: string;
  rating: string | null;
  pick: number;
  rotation: number;
  blur_score: number;
  star_rating: number;
  file_size: number | null;
  width: number | null;
  height: number | null;
  iso: number | null;
  aperture: string | null;
  shutter_speed: string | null;
  focal_length: string | null;
  lens: string | null;
  camera_model: string | null;
  date_taken: string | null;
}

interface DateRecord {
  year: string;
  month: string;
  day: string;
}

interface ProjectStats {
  BAD: number;
  OK: number;
  GOOD: number;
  PICKED: number;
}

// --- Application Core Class ---
class PhotoSorterApp {
  private viewer: PhotoViewer;
  
  // App state
  private imagePaths: string[] = [];
  private currentIndex: number = -1;
  private rootFolder: string = '';
  private isProcessingRating: boolean = false;
  private isSidePanelRight: boolean = false;
  
  // In-memory Image Cache (Pre-loaders)
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private activePreloadRequests: Set<string> = new Set();

  constructor() {
    this.viewer = new PhotoViewer('photo-canvas');
    this.initElements();
    this.initKeyboardBinds();
  }

  private initElements() {
    // Welcome Actions
    document.getElementById('btn-start-culling')?.addEventListener('click', () => this.selectFolder());
    document.getElementById('btn-restore-checkpoint')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-exit-app')?.addEventListener('click', () => this.exitApp());

    // Top Bar Actions
    document.getElementById('btn-back')?.addEventListener('click', () => this.confirmReturnToMenu());
    document.getElementById('btn-toggle-browser')?.addEventListener('click', () => this.toggleBrowser());
    document.getElementById('btn-toggle-side')?.addEventListener('click', () => this.togglePanelSide());
    document.getElementById('btn-top-restore')?.addEventListener('click', () => this.restoreCheckpoint());
    document.getElementById('btn-finish-export')?.addEventListener('click', () => this.finishSorting());

    // Search input
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      this.updateFilters(val, '', '', '');
    });
  }

  // --- Tauri IPC Wrappers ---
  
  private async selectFolder() {
    try {
      // Trigger Tauri's native folder selection dialog
      const selected = await invoke<string | null>('plugin:dialog|open', {
        directory: true,
        multiple: false,
        title: 'Select Photo Directory'
      });
      
      if (selected) {
        this.loadFolder(selected);
      }
    } catch (err) {
      this.showToast('Failed to select folder: ' + err, 'BAD');
    }
  }

  private async loadFolder(folderPath: string) {
    try {
      this.showProgressIndicator(true);
      const count = await invoke<number>('open_folder', { path: folderPath });
      
      if (count === 0) {
        this.showToast('No images found or folder is empty.', 'BAD');
        this.showProgressIndicator(false);
        return;
      }
      
      this.rootFolder = folderPath;
      
      // Load recent image paths
      await this.syncImagePaths();
      
      // Switch Screen to Workspace
      document.getElementById('menu-screen')?.classList.remove('active');
      document.getElementById('workspace-screen')?.classList.add('active');
      this.viewer.resizeCanvas();
      
      // Build Folder widget & Date widget
      this.buildFolderTree(folderPath);
      this.loadDateHierarchy();
      
      // Display first image
      await this.navigateImage(0);
      
      this.showToast(`Loaded ${count} images successfully!`, 'GOOD');
    } catch (err) {
      this.showToast('Error loading folder: ' + err, 'BAD');
    } finally {
      this.showProgressIndicator(false);
    }
  }

  private async syncImagePaths() {
    this.imagePaths = await invoke<string[]>('get_image_paths');
    this.currentIndex = await invoke<number>('get_current_index');
  }

  private async navigateImage(index: number) {
    if (this.imagePaths.length === 0) return;
    
    // Bounds clamping
    const targetIdx = Math.max(0, Math.min(this.imagePaths.length - 1, index));
    this.currentIndex = targetIdx;
    
    await invoke('set_current_index', { index: targetIdx });
    
    const currentPath = this.imagePaths[targetIdx];
    
    // Render current active item in filmstrip
    this.updateActiveFilmstripItem(currentPath);
    
    // Load and Display main culling view
    await this.displayMainImage(currentPath);
    
    // Update Stats HUD and Info labels
    this.updateStatsHUD();
    this.updateMetadataInfo(currentPath);
    
    // Pre-load next images in background
    this.triggerPreloaders(targetIdx);
  }

  private async displayMainImage(path: string) {
    try {
      // Check in-memory cache first
      if (this.imageCache.has(path)) {
        const cachedImg = this.imageCache.get(path)!;
        const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
        this.viewer.setImage(cachedImg, meta?.rotation || 0);
        this.viewer.setOverlays((meta?.pick || 0) === 1, meta?.star_rating || 0);
        return;
      }

      // Fetch dynamic viewport scaling bytes from Rust
      const bytes = await invoke<number[]>('get_image_data', { path });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
      img.onload = async () => {
        this.imageCache.set(path, img);
        const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
        this.viewer.setImage(img, meta?.rotation || 0);
        this.viewer.setOverlays((meta?.pick || 0) === 1, meta?.star_rating || 0);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (err) {
      console.error('Failed to render culling image: ', err);
    }
  }

  // --- Background Pre-loader System ---
  private triggerPreloaders(idx: number) {
    const preloadWindowSize = 5;
    const targets = [];
    
    // Collect next 5 paths
    for (let i = 1; i <= preloadWindowSize; i++) {
      if (idx + i < this.imagePaths.length) {
        targets.push(this.imagePaths[idx + i]);
      }
    }
    
    // Evict old cache items to keep memory bounded
    if (this.imageCache.size > 15) {
      const keys = Array.from(this.imageCache.keys());
      const keepPaths = new Set([this.imagePaths[idx], ...targets]);
      for (const key of keys) {
        if (!keepPaths.has(key)) {
          this.imageCache.delete(key);
        }
      }
    }

    // Load target images into cache asynchronously
    for (const path of targets) {
      if (this.imageCache.has(path) || this.activePreloadRequests.has(path)) {
        continue;
      }
      
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

  // --- Culling Actions ---

  private async rateCurrent(category: string, flashColor: string) {
    if (this.currentIndex < 0 || this.isProcessingRating) return;
    
    this.isProcessingRating = true;
    const path = this.imagePaths[this.currentIndex];
    
    try {
      await invoke('rate_image', { path, category });
      
      // Update Ribbon on Filmstrip item immediately
      const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (item) {
        const ribbon = item.querySelector('.thumb-ribbon') as HTMLElement;
        ribbon.className = 'thumb-ribbon ribbon-' + category.toLowerCase();
      }
      
      // Visual Rating Flash Notification
      this.triggerFlashNotification(flashColor);
      
      // Advance to next unrated/next image
      setTimeout(async () => {
        await this.navigateNext();
        this.isProcessingRating = false;
      }, 100);
    } catch (err) {
      this.showToast('Rating failed: ' + err, 'BAD');
      this.isProcessingRating = false;
    }
  }

  private async unrateCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      await invoke('rate_image', { path, category: null });
      const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (item) {
        const ribbon = item.querySelector('.thumb-ribbon') as HTMLElement;
        ribbon.className = 'thumb-ribbon';
      }
      this.triggerFlashNotification('rgba(100, 100, 100, 0.4)');
      this.updateStatsHUD();
    } catch (err) {
      this.showToast('Unrating failed: ' + err, 'BAD');
    }
  }

  private async togglePickCurrent() {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const picked = await invoke<boolean>('toggle_pick', { path });
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      this.viewer.setOverlays(picked, meta?.star_rating || 0);
      this.updateStatsHUD();
    } catch (err) {
      this.showToast('Flagging failed: ' + err, 'BAD');
    }
  }

  private async setStarsCurrent(stars: number) {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const activeStars = await invoke<number>('set_star_rating', { path, stars });
      const meta = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      this.viewer.setOverlays((meta?.pick || 0) === 1, activeStars);
      
      // Update stars on thumbnail too
      const item = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (item) {
        const badge = item.querySelector('.thumb-star-badge') as HTMLElement;
        if (activeStars > 0) {
          badge.textContent = '★'.repeat(activeStars);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
      
      this.updateStatsHUD();
    } catch (err) {
      this.showToast('Rating stars failed: ' + err, 'BAD');
    }
  }

  private async rotateCurrent(direction: number) {
    if (this.currentIndex < 0) return;
    const path = this.imagePaths[this.currentIndex];
    try {
      const newAngle = await invoke<number>('set_rotation', { path, direction });
      
      // Apply rotation to canvas viewer
      if (this.imageCache.has(path)) {
        this.viewer.setImage(this.imageCache.get(path)!, newAngle);
      } else {
        await this.navigateImage(this.currentIndex);
      }
    } catch (err) {
      this.showToast('Rotation failed: ' + err, 'BAD');
    }
  }

  private async deleteCurrent() {
    if (this.currentIndex < 0) return;
    
    // Custom Confirmation Dialog
    const confirmDelete = confirm('Permanently move this photo to the system Trash?');
    if (!confirmDelete) return;
    
    try {
      const deletedPath = await invoke<string | null>('delete_current_image');
      if (deletedPath) {
        this.showToast('Photo moved to Trash', 'BAD');
        
        // Evict from cache
        this.imageCache.delete(deletedPath);
        
        // Rebuild filmstrip & sync
        await this.syncImagePaths();
        this.rebuildFilmstrip();
        
        if (this.imagePaths.length > 0) {
          await this.navigateImage(this.currentIndex);
        } else {
          this.confirmReturnToMenu();
        }
      }
    } catch (err) {
      this.showToast('Failed to trash photo: ' + err, 'BAD');
    }
  }

  private async undoLastRating() {
    try {
      const undonePath = await invoke<string | null>('undo_last_rating');
      if (undonePath) {
        this.showToast('Undo completed successfully', 'GOOD');
        await this.syncImagePaths();
        this.rebuildFilmstrip();
        
        const idx = this.imagePaths.indexOf(undonePath);
        if (idx >= 0) {
          await this.navigateImage(idx);
        }
      } else {
        this.showToast('No actions to undo', 'BAD');
      }
    } catch (err) {
      this.showToast('Undo failed: ' + err, 'BAD');
    }
  }

  // --- Export Checkpoints ---

  private async finishSorting() {
    if (this.imagePaths.length === 0) return;
    try {
      this.showProgressIndicator(true);
      const [movedCount, summary] = await invoke<[number, Record<string, number>]>('finish_sorting');
      
      const msg = `Export finished!\nMoved: ${movedCount} photos.\nBAD: ${summary.BAD} | OK: ${summary.OK} | GOOD: ${summary.GOOD}`;
      alert(msg);
      
      this.returnToMenu();
    } catch (err) {
      this.showToast('Export failed: ' + err, 'BAD');
    } finally {
      this.showProgressIndicator(false);
    }
  }

  private async restoreCheckpoint() {
    try {
      this.showProgressIndicator(true);
      
      // If rootFolder is empty, prompt folder selection
      if (!this.rootFolder) {
        const selected = await invoke<string | null>('plugin:dialog|open', {
          directory: true,
          multiple: false,
          title: 'Select Folder containing checkpoint'
        });
        if (!selected) {
          this.showProgressIndicator(false);
          return;
        }
        this.rootFolder = selected;
      }
      
      // Restore files
      const count = await invoke<number>('restore_checkpoint');
      if (count >= 0) {
        this.showToast(`Restored ${count} photos from checkpoint successfully!`, 'GOOD');
        this.loadFolder(this.rootFolder);
      } else {
        this.showToast('No valid checkpoint found to restore.', 'BAD');
      }
    } catch (err) {
      this.showToast('Checkpoint restoration failed: ' + err, 'BAD');
    } finally {
      this.showProgressIndicator(false);
    }
  }

  // --- Filters and Navigation ---

  private async updateFilters(text: string, folder: string, date: string, mode: string) {
    try {
      await invoke('set_filters', { text, folder, date, mode });
      await this.syncImagePaths();
      this.rebuildFilmstrip();
      
      if (this.imagePaths.length > 0) {
        await this.navigateImage(0);
      } else {
        // Clear main view
        this.viewer.setOverlays(false, 0);
        this.showToast('No photos match current filter criteria.', 'BAD');
      }
    } catch (err) {
      console.error(err);
    }
  }

  private async navigateNext() {
    if (this.currentIndex < this.imagePaths.length - 1) {
      await this.navigateImage(this.currentIndex + 1);
    }
  }

  private async navigatePrev() {
    if (this.currentIndex > 0) {
      await this.navigateImage(this.currentIndex - 1);
    }
  }

  // --- Screen Switching Logic ---

  private confirmReturnToMenu() {
    const ans = confirm('Are you sure you want to exit to the main menu? Your temporary culling states will remain cached.');
    if (ans) {
      this.returnToMenu();
    }
  }

  private returnToMenu() {
    this.rootFolder = '';
    this.imagePaths = [];
    this.currentIndex = -1;
    this.imageCache.clear();
    
    document.getElementById('workspace-screen')?.classList.remove('active');
    document.getElementById('menu-screen')?.classList.add('active');
  }

  private exitApp() {
    const ans = confirm('Are you sure you want to close Photo Sorter?');
    if (ans) {
      invoke('plugin:process|exit', { code: 0 }).catch(() => window.close());
    }
  }

  // --- Side Panel Controls ---

  private toggleBrowser() {
    const btn = document.getElementById('btn-toggle-browser');
    const panel = document.getElementById('side-panel');
    if (panel && btn) {
      const isVisible = panel.style.display !== 'none';
      if (isVisible) {
        panel.style.display = 'none';
        btn.classList.remove('active');
      } else {
        panel.style.display = 'flex';
        btn.classList.add('active');
      }
      this.viewer.resizeCanvas();
    }
  }

  private togglePanelSide() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('btn-toggle-side');
    if (panel && btn) {
      this.isSidePanelRight = !this.isSidePanelRight;
      if (this.isSidePanelRight) {
        panel.className = 'side-panel-right';
        btn.textContent = '◀';
      } else {
        panel.className = 'side-panel-left';
        btn.textContent = '▶';
      }
      this.viewer.resizeCanvas();
    }
  }

  // --- Dynamically Build Folder Widget ---

  private buildFolderTree(rootPath: string) {
    const container = document.getElementById('folder-tree');
    if (!container) return;
    container.innerHTML = '';
    
    const rootName = rootPath.split(/[/\\]/).pop() || rootPath;
    
    // Create Root Tree Node
    const rootNode = this.createTreeNode(rootName, rootPath, true);
    container.appendChild(rootNode);
    
    // Recurse children folders (mocked recursive filesystem list or can query Rust)
    // For pure standalone simplicity, we populate active directories from our loaded image list!
    const directories = new Set<string>();
    for (const p of this.imagePaths) {
      const relative = p.substring(rootPath.length + 1);
      const parts = relative.split(/[/\\]/);
      // Remove filename
      parts.pop();
      
      let accum = rootPath;
      for (const part of parts) {
        accum = accum + '/' + part;
        directories.add(accum);
      }
    }

    // Build the collapsible directory DOM trees
    const sortedDirs = Array.from(directories).sort();
    const treeMap: Record<string, HTMLElement> = { [rootPath]: rootNode.querySelector('.tree-children') as HTMLElement };
    
    for (const dir of sortedDirs) {
      const parentDir = dir.substring(0, dir.lastIndexOf('/'));
      const dirName = dir.substring(dir.lastIndexOf('/') + 1);
      
      const node = this.createTreeNode(dirName, dir, false);
      const parentChildren = treeMap[parentDir] || treeMap[rootPath];
      
      if (parentChildren) {
        parentChildren.appendChild(node);
        treeMap[dir] = node.querySelector('.tree-children') as HTMLElement;
      }
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
    
    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(text);
    item.appendChild(row);
    
    const children = document.createElement('div');
    children.className = 'tree-children expanded';
    item.appendChild(children);
    
    // Toggle expand/collapse
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      children.classList.toggle('expanded');
      arrow.classList.toggle('expanded');
    });

    // Select row
    row.addEventListener('click', () => {
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      this.updateFilters('', path, '', '');
    });
    
    return item;
  }

  // --- Date Browser Widget ---

  private async loadDateHierarchy() {
    const container = document.getElementById('date-tree');
    const dateWidget = document.getElementById('date-widget');
    if (!container || !dateWidget) return;
    
    try {
      const dates = await invoke<DateRecord[]>('get_date_hierarchy');
      if (dates.length === 0) {
        dateWidget.style.display = 'none';
        return;
      }
      
      dateWidget.style.display = 'flex';
      container.innerHTML = '';
      
      const yearsMap: Record<string, HTMLElement> = {};
      const monthsMap: Record<string, HTMLElement> = {};
      
      for (const d of dates) {
        const yKey = d.year;
        const mKey = `${d.year}-${d.month}`;
        
        // Year node
        if (!yearsMap[yKey]) {
          const yNode = this.createDateNode(d.year, d.year, '📅');
          container.appendChild(yNode);
          yearsMap[yKey] = yNode.querySelector('.tree-children') as HTMLElement;
        }
        
        // Month node
        if (!monthsMap[mKey]) {
          const mNode = this.createDateNode(d.month, `${d.year}-${d.month}`, '🌙');
          yearsMap[yKey].appendChild(mNode);
          monthsMap[mKey] = mNode.querySelector('.tree-children') as HTMLElement;
        }
        
        // Day node
        const dayText = `${d.year}-${d.month}-${d.day}`;
        const dayNode = this.createDateNode(d.day, dayText, '☀️');
        monthsMap[mKey].appendChild(dayNode);
      }
    } catch (err) {
      console.error(err);
    }
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
    
    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(text);
    item.appendChild(row);
    
    const children = document.createElement('div');
    children.className = 'tree-children expanded';
    item.appendChild(children);
    
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      children.classList.toggle('expanded');
      arrow.classList.toggle('expanded');
    });

    row.addEventListener('click', () => {
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      this.updateFilters('', '', filterValue, '');
    });
    
    return item;
  }

  // --- Dynamic Filmstrip Thumbnails Loader ---

  private rebuildFilmstrip() {
    const container = document.getElementById('filmstrip-container');
    if (!container) return;
    container.innerHTML = '';
    
    for (let i = 0; i < this.imagePaths.length; i++) {
      const path = this.imagePaths[i];
      
      const item = document.createElement('div');
      item.className = 'thumbnail-item';
      item.setAttribute('data-path', path);
      
      // Ribbon indicator
      const ribbon = document.createElement('div');
      ribbon.className = 'thumb-ribbon';
      item.appendChild(ribbon);
      
      // Image wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb-img-wrapper';
      
      const placeholder = document.createElement('div');
      placeholder.className = 'empty-text';
      placeholder.style.fontSize = '9px';
      placeholder.textContent = 'loading...';
      wrapper.appendChild(placeholder);
      item.appendChild(wrapper);
      
      // Stars Badge
      const starBadge = document.createElement('span');
      starBadge.className = 'thumb-star-badge';
      starBadge.style.display = 'none';
      wrapper.appendChild(starBadge);

      // Focus Score Bar
      const focusBar = document.createElement('div');
      focusBar.className = 'thumb-focus-bar';
      focusBar.style.display = 'none';
      const focusFill = document.createElement('div');
      focusFill.className = 'thumb-focus-fill';
      focusBar.appendChild(focusFill);
      wrapper.appendChild(focusBar);
      
      container.appendChild(item);
      
      // Navigation onClick
      item.addEventListener('click', () => this.navigateImage(i));
      
      // Asynchronously fetch thumbnail bytes from Rust DB cache
      this.loadThumbnail(path, wrapper, starBadge, focusFill, focusBar);
    }
  }

  private loadThumbnail(
    path: string, 
    wrapper: HTMLElement, 
    starBadge: HTMLElement, 
    focusFill: HTMLElement,
    focusBar: HTMLElement
  ) {
    invoke<[number[], number]>('get_thumbnail_data', { path })
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

        // Set focus scores
        if (blurScore > 0) {
          const pct = Math.min(Math.floor(blurScore / 20), 100);
          focusFill.style.width = `${pct}%`;
          if (pct >= 60) {
            focusFill.className = 'thumb-focus-fill focus-high';
          } else if (pct >= 30) {
            focusFill.className = 'thumb-focus-fill focus-medium';
          } else {
            focusFill.className = 'thumb-focus-fill focus-low';
          }
          focusBar.style.display = 'block';
        }
      })
      .catch((err) => console.error(err));
  }

  private updateActiveFilmstripItem(path: string) {
    document.querySelectorAll('.thumbnail-item').forEach(item => item.classList.remove('active'));
    
    const activeItem = document.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement;
    if (activeItem) {
      activeItem.classList.add('active');
      // Scroll into view centering
      const scroller = document.getElementById('filmstrip-scroll');
      if (scroller) {
        const offset = activeItem.offsetLeft - scroller.clientWidth / 2 + activeItem.clientWidth / 2;
        scroller.scrollTo({ left: offset, behavior: 'smooth' });
      }
    }
  }

  // --- Keyboard Bindings ---

  private initKeyboardBinds() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.currentIndex < 0) return;
      
      const key = e.key.toUpperCase();
      
      // If typing in input, ignore bindings
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }
      
      // Ctrl+Z Undo
      if (e.ctrlKey && key === 'Z') {
        e.preventDefault();
        this.undoLastRating();
        return;
      }

      // Star Ratings (Ctrl + 1-5)
      if (e.ctrlKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        this.setStarsCurrent(parseInt(e.key));
        return;
      }

      switch (key) {
        // Navigations
        case 'N':
        case 'ARROWLEFT':
          this.navigatePrev();
          break;
        case 'P':
        case 'ARROWRIGHT':
          this.navigateNext();
          break;
        
        // Ratings
        case '1':
          this.rateCurrent('BAD', 'rgba(239, 68, 68, 0.4)');
          break;
        case '2':
          this.rateCurrent('OK', 'rgba(245, 158, 11, 0.4)');
          break;
        case '3':
          this.rateCurrent('GOOD', 'rgba(16, 185, 129, 0.4)');
          break;
        case '0':
          this.unrateCurrent();
          break;
          
        // Overlays / Operations
        case ' ': // Spacebar
          e.preventDefault();
          this.togglePickCurrent();
          break;
        case 'DELETE':
          this.deleteCurrent();
          break;
        case 'U': // Toggle filter unrated
          this.toggleFilterMode();
          break;
        case 'ARROWUP': // Rotate Clockwise
          this.rotateCurrent(1);
          break;
        case 'ARROWDOWN': // Rotate Counter-clockwise
          this.rotateCurrent(-1);
          break;
      }
    });
  }

  private async toggleFilterMode() {
    const isUnrated = await invoke<string>('toggle_filter_mode').catch(() => 'all');
    this.updateFilters('', '', '', isUnrated === 'unrated' ? 'unrated' : 'all');
  }

  // --- UI HUD Updates ---

  private async updateStatsHUD() {
    try {
      const stats = await invoke<ProjectStats>('get_project_stats');
      
      document.getElementById('stats-val-picked')!.textContent = String(stats.PICKED);
      document.getElementById('stats-val-bad')!.textContent = String(stats.BAD);
      document.getElementById('stats-val-ok')!.textContent = String(stats.OK);
      document.getElementById('stats-val-good')!.textContent = String(stats.GOOD);
      
      // Update progress bar
      if (this.imagePaths.length > 0) {
        const pct = Math.floor(((this.currentIndex + 1) / this.imagePaths.length) * 100);
        const fill = document.getElementById('progress-bar-fill');
        if (fill) fill.style.width = `${pct}%`;
      }
      
      document.getElementById('stats-hud')!.style.display = 'flex';
    } catch (err) {
      console.error(err);
    }
  }

  private async updateMetadataInfo(path: string) {
    try {
      const img = await invoke<ImageRecord | null>('get_image_metadata_info', { path });
      if (!img) return;
      
      // Info progress
      document.getElementById('info-progress')!.textContent = `${this.currentIndex + 1} / ${this.imagePaths.length}`;
      // Filename
      document.getElementById('info-filename')!.textContent = img.filename;
      
      // Format / RAW Type
      const ext = img.filename.split('.').pop()?.toUpperCase() || 'UNKNOWN';
      const isRaw = ['NEF', 'CR2', 'ARW', 'DNG', 'CR3', 'ORF', 'RW2', 'PEF'].includes(ext);
      const typeLabel = document.getElementById('info-type')!;
      typeLabel.textContent = `${ext} ${isRaw ? '(RAW)' : ''}`;
      
      // Dynamic Exif parameters joining
      const exifLabel = document.getElementById('info-exif')!;
      if (img.camera_model) {
        const parts = [];
        parts.push(img.camera_model);
        if (img.iso) parts.push(`ISO ${img.iso}`);
        if (img.aperture) parts.push(`f/${img.aperture}`);
        if (img.shutter_speed) parts.push(`${img.shutter_speed}s`);
        if (img.focal_length) parts.push(`${img.focal_length}mm`);
        if (img.lens) parts.push(img.lens);
        exifLabel.textContent = parts.join(' · ');
      } else {
        exifLabel.textContent = 'Extracting EXIF...';
      }
    } catch (err) {
      console.error(err);
    }
  }

  private updateHUDControls() {
    const hud = document.getElementById('hud-label');
    if (!hud) return;
    
    const bindings = [
      `<span class="hud-key hud-bad">[1]</span> BAD`,
      `<span class="hud-key hud-ok">[2]</span> OK`,
      `<span class="hud-key hud-good">[3]</span> GOOD`,
      `<span class="hud-key">[0]</span> Unrate | <span class="hud-key">[DEL]</span> Delete`,
      `<span class="hud-key">[SPACE]</span> Flag/Pick`,
      `<span class="hud-key">[N/P]</span> Prev/Next | <span class="hud-key">[U]</span> Filter Unrated`,
      `<span class="hud-key">[UP/DOWN]</span> Rotate | <span class="hud-key">[CTRL+Z]</span> Undo`,
      `<span class="hud-key">[CTRL+1-5]</span> Rating Stars`
    ];
    hud.innerHTML = bindings.join('<br>');
  }

  // --- Visual Utilities ---

  private triggerFlashNotification(color: string) {
    const flash = document.getElementById('flash-overlay')!;
    flash.style.backgroundColor = color;
    flash.style.opacity = '0.35';
    setTimeout(() => {
      flash.style.opacity = '0';
    }, 200);
  }

  private showProgressIndicator(show: boolean) {
    const fill = document.getElementById('progress-bar-fill');
    if (fill) {
      fill.style.width = show ? '100%' : '0%';
      fill.style.transition = show ? 'width 2s ease-in-out' : 'none';
    }
  }

  private showToast(msg: string, status: 'GOOD' | 'BAD') {
    console.log(`[Toast ${status}]`, msg);
    // Simple custom alert or toast
  }
}

// --- App Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  const app = new PhotoSorterApp();
  // @ts-ignore
  window.photoSorterApp = app;
  
  // Set default controls labels
  app['updateHUDControls']();
});
