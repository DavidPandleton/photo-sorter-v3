// Side browser panel: folder tree, date hierarchy tree, and panel toggles.
// Filter selection flows back to the app via onFilter; canvas re-fit via onResize.

import { invoke } from '@tauri-apps/api/core';
import type { DateRecord } from './types';

export interface BrowserHost {
  onFilter(text: string, folder: string, date: string, mode: string): Promise<void> | void;
  onResize(): void;
}

export class BrowserPanel {
  private host: BrowserHost;
  private isRight = false;

  constructor(host: BrowserHost) {
    this.host = host;
  }

  buildFolderTree(rootPath: string, imagePaths: string[]) {
    const container = document.getElementById('folder-tree');
    if (!container) return;
    container.innerHTML = '';
    const rootName = rootPath.split(/[/\\]/).pop() || rootPath;
    const rootNode = this.createTreeNode(rootName, rootPath, true);
    container.appendChild(rootNode);

    const directories = new Set<string>();
    for (const p of imagePaths) {
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
      this.host.onFilter('', path, '', '');
    });
    return item;
  }

  async loadDateHierarchy() {
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
      this.host.onFilter('', '', filterValue, '');
    });
    return item;
  }

  toggleBrowser() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('btn-toggle-browser');
    if (panel && btn) {
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'flex';
      btn.classList.toggle('active');
      this.host.onResize();
    }
  }

  togglePanelSide() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('btn-toggle-side');
    if (panel && btn) {
      this.isRight = !this.isRight;
      if (this.isRight) { panel.className = 'side-panel-right'; btn.textContent = '◀'; }
      else { panel.className = 'side-panel-left'; btn.textContent = '▶'; }
      this.host.onResize();
    }
  }
}
