import { listen } from '@tauri-apps/api/event';
import { GAMEPAD_DEADZONE, GAMEPAD_PAN_SPEED, GAMEPAD_ZOOM_SPEED } from './constants';

export interface GamepadActions {
  rateGood: () => void;
  rateBad: () => void;
  rateOk: () => void;
  navigateNext: () => void;
  navigatePrev: () => void;
  rotateCW: () => void;
  rotateCCW: () => void;
  resetZoom: () => void;
  returnToMenu: () => void;
  finishSorting: () => void;
  toggleHUD: () => void;
  selectFolder: () => void;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (factor: number) => void;
  updateHUD: (gamepadMode: boolean) => void;
  showToast: (msg: string, status: 'GOOD' | 'BAD') => void;
}

export class GamepadHandler {
  private actions: GamepadActions;
  private deadzone = GAMEPAD_DEADZONE;
  private panSpeed = GAMEPAD_PAN_SPEED;
  private zoomSpeed = GAMEPAD_ZOOM_SPEED;
  private _active = false;
  private prevButtons: Map<number, boolean> = new Map();
  private inactivityFrames = 0;
  private readonly INACTIVITY_TIMEOUT = 300;

  get active() { return this._active; }

  constructor(actions: GamepadActions) {
    this.actions = actions;
  }

  async init() {
    try {
      await listen<boolean>('gamepad-connection', (event) => {
        if (!event.payload && this._active) {
          this._active = false;
          this.actions.updateHUD(false);
          this.actions.showToast('Gamepad disconnected. HUD reverted to keyboard.', 'BAD');
        } else if (event.payload) {
          this.actions.showToast('Gamepad connected.', 'GOOD');
        }
      });
      await listen<string>('gamepad-device', (event) => {
        this.actions.showToast(`Gamepad Connected: ${event.payload}`, 'GOOD');
      });
    } catch (err) {
      console.error('Failed to subscribe to gamepad events:', err);
    }
  }

  startLoop() {
    const tick = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let activePad: Gamepad | null = null;

      for (const pad of gamepads) {
        if (pad && pad.connected) {
          activePad = pad;
          break;
        }
      }

      if (activePad) {
        this.inactivityFrames = 0;

        if (!this._active) {
          this._active = true;
          this.actions.updateHUD(true);
          this.actions.showToast(`Gamepad: ${activePad.id}`, 'GOOD');
        }

        for (let i = 0; i < activePad.buttons.length; i++) {
          const pressed = activePad.buttons[i].pressed || activePad.buttons[i].value > 0.5;
          const wasPressed = this.prevButtons.get(i) ?? false;

          if (pressed && !wasPressed) {
            const code = this.mapWebButton(i, activePad);
            if (code) this.handleInput(code, true);
          }
          this.prevButtons.set(i, pressed);
        }

        const lx = activePad.axes[0] ?? 0;
        const ly = activePad.axes[1] ?? 0;
        const ry = activePad.axes[3] ?? 0;

        let dx = 0, dy = 0;
        if (Math.abs(lx) > this.deadzone) dx = -lx * this.panSpeed;
        if (Math.abs(ly) > this.deadzone) dy = -ly * this.panSpeed;
        if (dx !== 0 || dy !== 0) this.actions.panBy(dx, dy);
        if (Math.abs(ry) > this.deadzone) {
          this.actions.zoomBy(1.0 - ry * this.zoomSpeed);
        }
      } else if (this._active) {
        this.inactivityFrames++;
        if (this.inactivityFrames > this.INACTIVITY_TIMEOUT) {
          this._active = false;
          this.actions.updateHUD(false);
          this.prevButtons.clear();
        }
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private mapWebButton(index: number, pad: Gamepad): string | null {
    if (pad.mapping === 'standard') {
      switch (index) {
        case 0: return 'BTN_A';
        case 1: return 'BTN_B';
        case 2: return 'BTN_X';
        case 3: return 'BTN_Y';
        case 4: return 'BTN_TL';
        case 5: return 'BTN_TR';
        case 6: return 'BTN_TL2';
        case 7: return 'BTN_TR2';
        case 8: return 'BTN_SELECT';
        case 9: return 'BTN_START';
        case 10: return 'BTN_THUMBL';
        case 11: return 'BTN_THUMBR';
        case 12: return 'DPAD_UP';
        case 13: return 'DPAD_DOWN';
        case 14: return 'DPAD_LEFT';
        case 15: return 'DPAD_RIGHT';
      }
    } else {
      switch (index) {
        case 0: return 'BTN_A';
        case 1: return 'BTN_B';
        case 2: return 'BTN_X';
        case 3: return 'BTN_Y';
        case 4: return 'BTN_TL';
        case 5: return 'BTN_TR';
        case 6: return 'BTN_TL2';
        case 7: return 'BTN_TR2';
        case 8: return 'BTN_SELECT';
        case 9: return 'BTN_START';
        case 10: return 'BTN_THUMBL';
        case 11: return 'BTN_THUMBR';
        case 12: return 'DPAD_UP';
        case 13: return 'DPAD_DOWN';
        case 14: return 'DPAD_LEFT';
        case 15: return 'DPAD_RIGHT';
      }
    }
    return null;
  }

  private handleInput(code: string, state: boolean) {
    if (!state) return;
    const isConfirm = ['BTN_A', 'BTN_SOUTH'].includes(code);
    const isBack = ['BTN_B', 'BTN_EAST'].includes(code);
    const isOk = ['BTN_X', 'BTN_WEST'].includes(code);
    const isReset = ['BTN_Y', 'BTN_NORTH'].includes(code);

    const overlay = document.getElementById('dialog-overlay');
    if (overlay && overlay.classList.contains('active')) {
      if (isConfirm) { (document.getElementById('btn-dialog-ok') as HTMLElement)?.click(); }
      else if (isBack) { (document.getElementById('btn-dialog-cancel') as HTMLElement)?.click(); }
      return;
    }

    const isWorkspace = document.getElementById('workspace-screen')?.classList.contains('active');
    if (!isWorkspace) {
      if (isConfirm) this.actions.selectFolder();
      return;
    }

    if (isConfirm) this.actions.rateGood();
    else if (isBack) this.actions.rateBad();
    else if (isOk) this.actions.rateOk();
    else if (code === 'DPAD_RIGHT' || code === 'BTN_TR') this.actions.navigateNext();
    else if (code === 'DPAD_LEFT' || code === 'BTN_TL') this.actions.navigatePrev();
    else if (code === 'TRIGGER_LEFT' || code === 'BTN_TL2') this.actions.rotateCCW();
    else if (code === 'TRIGGER_RIGHT' || code === 'BTN_TR2') this.actions.rotateCW();
    else if (isReset) this.actions.resetZoom();
    else if (code === 'BTN_SELECT') this.actions.returnToMenu();
    else if (code === 'BTN_START') this.actions.finishSorting();
    else if (code === 'BTN_THUMBR') this.actions.toggleHUD();
  }
}
