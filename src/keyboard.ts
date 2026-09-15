// Pure keyboard combo parsing, shared by the app's keydown handler.

export interface Combo {
  combo: string;
  comboAlt?: string;
}

// Build a normalized combo string (Ctrl+/Alt+/Shift+ modifiers + key) from a
// keydown event, plus a macOS Meta+ alternate for cross-mod matching.
export function buildCombo(e: KeyboardEvent): Combo {
  let combo = '';
  if (e.ctrlKey || e.metaKey) combo += 'Ctrl+';
  if (e.altKey) combo += 'Alt+';
  if (e.shiftKey) combo += 'Shift+';

  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  combo += key;

  let comboAlt: string | undefined;
  if (e.ctrlKey || e.metaKey) {
    const mod = e.metaKey ? 'Meta+' : 'Ctrl+';
    if (combo.startsWith('Ctrl+')) {
      comboAlt = mod + combo.slice(5);
    }
  }
  return { combo, comboAlt };
}

export function getActionFromCombo(keybindings: Map<string, string>, combo: string): string | null {
  for (const [action, shortcut] of keybindings.entries()) {
    if (shortcut.toUpperCase() === combo.toUpperCase()) {
      return action;
    }
  }
  return null;
}
