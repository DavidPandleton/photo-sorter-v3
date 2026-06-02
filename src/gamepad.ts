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
  private axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
  private deadzone = GAMEPAD_DEADZONE;
  private panSpeed = GAMEPAD_PAN_SPEED;
  private zoomSpeed = GAMEPAD_ZOOM_SPEED;
  private _active = false;

  get active() { return this._active; }

  constructor(actions: GamepadActions) {
    this.actions = actions;
  }

  async init() {
    try {
      await listen<{ code: string; state: boolean }>('gamepad-button', (event) => {
        if (!this._active) {
          this._active = true;
          this.actions.updateHUD(true);
        }
        this.handleInput(event.payload.code, event.payload.state);
      });
      await listen<{ axis: string; value: number }>('gamepad-axis', (event) => {
        if (!this._active) {
          this._active = true;
          this.actions.updateHUD(true);
        }
        const { axis, value } = event.payload;
        if (axis === 'ABS_X') this.axes.lx = value;
        else if (axis === 'ABS_Y') this.axes.ly = value;
        else if (axis === 'ABS_RX') this.axes.rx = value;
        else if (axis === 'ABS_RY') this.axes.ry = value;
      });
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
      if (this._active) {
        let dx = 0, dy = 0;
        if (Math.abs(this.axes.lx) > this.deadzone) dx = -this.axes.lx * this.panSpeed;
        if (Math.abs(this.axes.ly) > this.deadzone) dy = this.axes.ly * this.panSpeed;
        if (dx !== 0 || dy !== 0) this.actions.panBy(dx, dy);
        if (Math.abs(this.axes.ry) > this.deadzone) {
          this.actions.zoomBy(1.0 + this.axes.ry * this.zoomSpeed);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
