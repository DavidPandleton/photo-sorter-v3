// ponytail: remove compare mode — YAGNI, was 88 lines of split-screen rendering
import { ZOOM_MIN, ZOOM_MAX, ZOOM_FACTOR } from './constants';

export class PhotoViewer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parentElement: HTMLElement;
  private currentImage: HTMLImageElement | null = null;
  private scale: number = 1.0;
  private offsetX: number = 0.0;
  private offsetY: number = 0.0;
  private rotation: number = 0;
  private isPanning: boolean = false;
  private startX: number = 0;
  private startY: number = 0;
  private flagOverlay: boolean = false;
  private starsCount: number = 0;
  private onZoomCallback: (() => void) | null = null;

  public setOnZoom(callback: () => void) { this.onZoomCallback = callback; }

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.parentElement = this.canvas.parentElement!;
    this.setupListeners();
    this.resizeCanvas();
  }

  private setupListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetView());
  }

  public resizeCanvas() {
    const w = this.parentElement.clientWidth;
    const h = this.parentElement.clientHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.draw();
  }

  public setImage(img: HTMLImageElement, rotation: number = 0) {
    this.currentImage = img;
    this.rotation = rotation;
    this.resetView();
  }

  public getCurrentImage(): HTMLImageElement | null { return this.currentImage; }

  public swapCurrentImage(img: HTMLImageElement) { this.currentImage = img; this.draw(); }

  public getScale(): number { return this.scale; }

  public setOverlays(flag: boolean, stars: number) { this.flagOverlay = flag; this.starsCount = stars; this.draw(); }

  public resetView() {
    if (!this.currentImage) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    let imgW = this.currentImage.width;
    let imgH = this.currentImage.height;
    if (this.rotation === 90 || this.rotation === 270) { imgW = this.currentImage.height; imgH = this.currentImage.width; }
    this.scale = Math.min((cw - 20) / imgW, (ch - 20) / imgH);
    this.offsetX = cw / 2;
    this.offsetY = ch / 2;
    this.draw();
  }

  public resetZoom() { this.resetView(); }

  public zoomIn() { this.zoomAt(ZOOM_FACTOR, this.canvas.width / 2, this.canvas.height / 2); }
  public zoomOut() { this.zoomAt(1.0 / ZOOM_FACTOR, this.canvas.width / 2, this.canvas.height / 2); }

  public panBy(dx: number, dy: number) { if (!this.currentImage) return; this.offsetX += dx; this.offsetY += dy; this.draw(); }

  public zoomBy(factor: number) {
    if (!this.currentImage) return;
    const nextScale = this.scale * factor;
    if (nextScale < ZOOM_MIN || nextScale > ZOOM_MAX) return;
    this.zoomAt(factor, this.canvas.width / 2, this.canvas.height / 2);
  }

  // ponytail: zoomIn/Out/By unified — zoomAt handles cursor-anchored zoom for wheel, simple center for buttons
  private zoomAt(factor: number, anchorX: number, anchorY: number) {
    const nextScale = this.scale * factor;
    if (nextScale < ZOOM_MIN || nextScale > ZOOM_MAX) return;
    this.offsetX = anchorX - (anchorX - this.offsetX) * factor;
    this.offsetY = anchorY - (anchorY - this.offsetY) * factor;
    this.scale = nextScale;
    this.draw();
    this.onZoomCallback?.();
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button === 0) { this.isPanning = true; this.startX = e.clientX - this.offsetX; this.startY = e.clientY - this.offsetY; this.canvas.style.cursor = 'grabbing'; }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isPanning) { this.offsetX = e.clientX - this.startX; this.offsetY = e.clientY - this.startY; this.draw(); }
  }

  private onMouseUp() { this.isPanning = false; this.canvas.style.cursor = 'grab'; }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.currentImage) return;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1.0 / ZOOM_FACTOR;
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  public draw() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.ctx.fillStyle = '#0e0e12';
    this.ctx.fillRect(0, 0, cw, ch);
    if (!this.currentImage) return;
    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);
    this.ctx.rotate((this.rotation * Math.PI) / 180);
    this.ctx.drawImage(this.currentImage, -this.currentImage.width / 2, -this.currentImage.height / 2);
    this.ctx.restore();
    if (this.flagOverlay) {
      this.ctx.fillStyle = '#ffab40';
      this.ctx.font = 'bold 36px -apple-system, "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'top';
      this.ctx.fillText('\u2605', cw - 20, 15);
    }
    if (this.starsCount > 0) {
      this.ctx.fillStyle = '#2dd4bf';
      this.ctx.font = '22px -apple-system, "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'top';
      this.ctx.fillText('\u2605'.repeat(this.starsCount), cw - 20, this.flagOverlay ? 60 : 15);
    }
  }
}
