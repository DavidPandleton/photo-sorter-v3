// Settings modal: categories, keybindings, HUD visibility. Owns its temp state
// (draft copies of app config) and talks back to the app via SettingsHost.

import { invoke } from '@tauri-apps/api/core';
import type { CategoryRecord, HudItemRecord, KeybindingRecord } from './types';
import {
  ACTION_DISPLAY_NAMES, fmtShortcut, hexToRgba, rgbaToHex,
  showProgressIndicator, showToast,
} from './ui';

export interface SettingsHost {
  getCategories(): CategoryRecord[];
  getHudItems(): HudItemRecord[];
  getKeybindings(): Map<string, string>;
  setKeybindings(binds: Map<string, string>): void;
  // Config persisted: reload app state, rebuild filmstrip, refresh HUD/stats.
  afterConfigChanged(): Promise<void>;
  refreshHUD(): void;
}

export class SettingsModal {
  private host: SettingsHost;
  private tempCategories: CategoryRecord[] = [];
  private tempKeybindings: Map<string, string> = new Map();
  private tempHudItems: HudItemRecord[] = [];
  private isRecordingAction: string | null = null;

  constructor(host: SettingsHost) {
    this.host = host;
  }

  get isRecording(): string | null { return this.isRecordingAction; }

  init() {
    document.getElementById('btn-settings-menu')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-settings-workspace')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.toggle());

    document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.toggle();
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
      this.renderCategories();
    });

    document.getElementById('btn-settings-save')?.addEventListener('click', () => this.save());

    document.getElementById('btn-reset-keybindings')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all keyboard shortcuts to the system factory defaults? All your custom binds will be lost.')) {
        try {
          showProgressIndicator(true);
          const defaultBinds = await invoke<KeybindingRecord[]>('reset_keybindings');
          const binds = new Map(defaultBinds.map(b => [b.action_name, b.shortcut_key]));
          this.host.setKeybindings(binds);
          this.tempKeybindings = new Map(binds);

          this.renderKeybindings();
          this.host.refreshHUD();

          showToast('Keybindings restored to defaults!', 'GOOD');
        } catch (err) {
          showToast('Failed to reset keybindings: ' + err, 'BAD');
        } finally {
          showProgressIndicator(false);
        }
      }
    });
  }

  toggle() {
    const modal = document.getElementById('settings-overlay');
    if (!modal) return;
    if (modal.style.display === 'none') {
      this.tempCategories = JSON.parse(JSON.stringify(this.host.getCategories()));
      this.tempKeybindings = new Map(this.host.getKeybindings());
      this.tempHudItems = JSON.parse(JSON.stringify(this.host.getHudItems()));

      this.isRecordingAction = null;

      document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === 'categories-tab') btn.classList.add('active');
        else btn.classList.remove('active');
      });
      document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === 'categories-tab') pane.classList.add('active');
        else pane.classList.remove('active');
      });

      this.renderCategories();
      this.renderKeybindings();
      this.renderHUD();

      modal.style.display = 'flex';
    } else {
      modal.style.display = 'none';
      this.isRecordingAction = null;
    }
  }

  recordKeybinding(actionSpec: string, combo: string) {
    if (actionSpec.startsWith('category:')) {
      const idx = parseInt(actionSpec.substring(9));
      if (!isNaN(idx) && this.tempCategories[idx]) {
        this.tempCategories[idx].shortcut_key = combo;
      }
      this.isRecordingAction = null;
      this.renderCategories();
    } else {
      this.tempKeybindings.set(actionSpec, combo);
      this.isRecordingAction = null;
      this.renderKeybindings();
    }
  }

  private renderCategories() {
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
        <input type="color" class="cat-color" value="${rgbaToHex(cat.flash_color)}">
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
        this.tempCategories[index].flash_color = hexToRgba(hex, 0.4);
      });

      const deleteBtn = row.querySelector('.btn-delete-cat') as HTMLButtonElement;
      deleteBtn.addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete category "${cat.label}"? All images rated with this category will be reset to unrated.`)) {
          this.tempCategories.splice(index, 1);
          this.renderCategories();
        }
      });

      container.appendChild(row);
    });
  }

  private renderKeybindings() {
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

  private renderHUD() {
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

  private async save() {
    try {
      showProgressIndicator(true);

      const originalKeys = new Set(this.host.getCategories().map(c => c.key_name));
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

      await this.host.afterConfigChanged();

      this.toggle();
      showToast('Settings saved successfully!', 'GOOD');

    } catch (err) {
      showToast('Failed to save settings: ' + err, 'BAD');
    } finally {
      showProgressIndicator(false);
    }
  }
}
