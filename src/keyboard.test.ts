import { describe, it, expect } from 'vitest';
import { buildCombo, getActionFromCombo } from './keyboard';
import { escapeHtml, rgbaToHex, hexToRgba, fmtShortcut } from './ui';

function keyEvent(init: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): KeyboardEvent {
  // buildCombo only reads these fields; no DOM constructor needed.
  return { key: init.key, ctrlKey: !!init.ctrlKey, metaKey: !!init.metaKey, altKey: !!init.altKey, shiftKey: !!init.shiftKey } as KeyboardEvent;
}

describe('buildCombo', () => {
  it('normalizes plain keys to uppercase', () => {
    expect(buildCombo(keyEvent({ key: 'j' })).combo).toBe('J');
  });

  it('maps space to Space', () => {
    expect(buildCombo(keyEvent({ key: ' ' })).combo).toBe('Space');
  });

  it('prefixes ctrl/meta as Ctrl+', () => {
    expect(buildCombo(keyEvent({ key: ',', ctrlKey: true })).combo).toBe('Ctrl+,');
    expect(buildCombo(keyEvent({ key: ',', metaKey: true })).combo).toBe('Ctrl+,');
  });

  it('builds Meta+ alternate only for real modifier combos', () => {
    const mac = buildCombo(keyEvent({ key: 'z', metaKey: true }));
    expect(mac.combo).toBe('Ctrl+Z');
    expect(mac.comboAlt).toBe('Meta+Z');

    const plain = buildCombo(keyEvent({ key: 'z' }));
    expect(plain.comboAlt).toBeUndefined();
  });

  it('stacks modifiers in order', () => {
    expect(buildCombo(keyEvent({ key: 'x', ctrlKey: true, shiftKey: true, altKey: true })).combo)
      .toBe('Ctrl+Alt+Shift+X');
  });
});

describe('getActionFromCombo', () => {
  const binds = new Map([['next_image', 'Right'], ['undo', 'Ctrl+Z']]);

  it('matches case-insensitively', () => {
    expect(getActionFromCombo(binds, 'right')).toBe('next_image');
    expect(getActionFromCombo(binds, 'ctrl+z')).toBe('undo');
  });

  it('returns null for unbound combos', () => {
    expect(getActionFromCombo(binds, 'Q')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('neutralizes markup injection', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml('a"b&c')).toBe('a&quot;b&amp;c');
  });

  it('passes plain text through', () => {
    expect(escapeHtml('Holiday 2026')).toBe('Holiday 2026');
  });
});

describe('color helpers', () => {
  it('rgbaToHex converts and clamps', () => {
    expect(rgbaToHex('rgba(239, 68, 68, 0.4)')).toBe('#ef4444');
    expect(rgbaToHex('#abcdef')).toBe('#abcdef');
  });

  it('hexToRgba round-trips through rgbaToHex', () => {
    expect(rgbaToHex(hexToRgba('#2dd4bf', 0.4))).toBe('#2dd4bf');
  });
});

describe('fmtShortcut', () => {
  it('expands modifier abbreviations', () => {
    expect(fmtShortcut('Ctrl+Z')).toContain('Ctrl');
    expect(fmtShortcut('None')).toBe('None');
  });
});
