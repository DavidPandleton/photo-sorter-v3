/**
 * PHOTO SORTER V3 — PhotoViewer
 * Coordinate-aware, high-performance HTML5 Canvas renderer
 * Handles zooming, panning, rotation, and split-screen compare modes.
 */

import { ZOOM_MIN, ZOOM_MAX, ZOOM_FACTOR } from './constants';

export class PhotoViewer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parentElement: HTMLElement;
  
  // Image states
  private currentImage: HTMLImageElement | null = null;
  private compareImage: HTMLImageElement | null = null;
  
  // Viewport transforms
  private scale: number = 1.0;
  private offsetX: number = 0.0;
  private offsetY: number = 0.0;
  private rotation: number = 0; // 0, 90, 180, 270 degrees
  private compareRotation: number = 0;
  
  // Flags
  private showingCompare: boolean = false;
  private isPanning: boolean = false;
  private startX: number = 0;
  private startY: number = 0;

  // Viewport borders / overlays
  private flagOverlay: boolean = false;
  private starsCount: number = 0;

  private onZoomCallback: (() => void) | null = null;

  public setOnZoom(callback: () => void) {
    this.onZoomCallback = callback;
  }

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.parentElement = this.canvas.parentElement!;
    
    this.setupListeners();
    this.resizeCanvas();
  }

  private setupListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Mouse panning
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.onMouseUp());
    
    // Mouse zoom (Anchored at mouse cursor!)
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    
    // Double click to reset
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

  public getCurrentImage(): HTMLImageElement | null {
    return this.currentImage;
  }

  public swapCurrentImage(img: HTMLImageElement) {
    this.currentImage = img;
    this.draw();
  }

  public getScale(): number {
    return this.scale;
  }

  public setCompareImage(img: HTMLImageElement | null, rotation: number = 0) {
    this.compareImage = img;
    this.compareRotation = rotation;
    this.draw();
  }

  public setOverlays(flag: boolean, stars: number) {
    this.flagOverlay = flag;
    this.starsCount = stars;
    this.draw();
  }

  public toggleCompare(show: boolean) {
    this.showingCompare = show;
    this.resetView();
  }

  public resetView() {
    if (!this.currentImage) return;
    
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    
    if (this.showingCompare && this.compareImage) {
      // Split Screen Fit
      this.scale = 1.0;
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      // Single Screen Fit
      let imgW = this.currentImage.width;
      let imgH = this.currentImage.height;
      
      // Swap dimensions if rotated 90 or 270 degrees
      if (this.rotation === 90 || this.rotation === 270) {
        imgW = this.currentImage.height;
        imgH = this.currentImage.width;
      }
      
      const fitScale = Math.min((cw - 20) / imgW, (ch - 20) / imgH);
      this.scale = fitScale;
      this.offsetX = cw / 2;
      this.offsetY = ch / 2;
    }
    
    this.draw();
  }

  public resetZoom() {
    this.resetView();
  }

  public zoomIn() {
    if (!this.currentImage) return;
    const factor = ZOOM_FACTOR;
    const nextScale = this.scale * factor;
    if (nextScale > ZOOM_MAX) return;

    let cx = this.canvas.width / 2;
    let cy = this.canvas.height / 2;

    if (this.showingCompare && this.compareImage) {
      cx = 0;
      cy = 0;
    }

    this.offsetX = cx - (cx - this.offsetX) * factor;
    this.offsetY = cy - (cy - this.offsetY) * factor;
    this.scale = nextScale;
    this.draw();
    this.onZoomCallback?.();
  }

  public zoomOut() {
    if (!this.currentImage) return;
    const factor = 1.0 / ZOOM_FACTOR;
    const nextScale = this.scale * factor;
    if (nextScale < ZOOM_MIN) return;

    let cx = this.canvas.width / 2;
    let cy = this.canvas.height / 2;

    if (this.showingCompare && this.compareImage) {
      cx = 0;
      cy = 0;
    }

    this.offsetX = cx - (cx - this.offsetX) * factor;
    this.offsetY = cy - (cy - this.offsetY) * factor;
    this.scale = nextScale;
    this.draw();
    this.onZoomCallback?.();
  }

  public panBy(dx: number, dy: number) {
    if (!this.currentImage) return;
    this.offsetX += dx;
    this.offsetY += dy;
    this.draw();
  }

  public zoomBy(factor: number) {
    if (!this.currentImage) return;
    const nextScale = this.scale * factor;
    if (nextScale < ZOOM_MIN || nextScale > ZOOM_MAX) return;

    let cx = this.canvas.width / 2;
    let cy = this.canvas.height / 2;

    if (this.showingCompare && this.compareImage) {
      cx = 0;
      cy = 0;
    }

    this.offsetX = cx - (cx - this.offsetX) * factor;
    this.offsetY = cy - (cy - this.offsetY) * factor;
    this.scale = nextScale;
    this.draw();
    this.onZoomCallback?.();
  }

  // --- Transform Helpers ---
  private onMouseDown(e: MouseEvent) {
    if (e.button === 0) { // Left click
      this.isPanning = true;
      this.startX = e.clientX - this.offsetX;
      this.startY = e.clientY - this.offsetY;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isPanning) {
      this.offsetX = e.clientX - this.startX;
      this.offsetY = e.clientY - this.startY;
      this.draw();
    }
  }

  private onMouseUp() {
    this.isPanning = false;
    this.canvas.style.cursor = 'grab';
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.currentImage) return;

    const zoomFactor = ZOOM_FACTOR;
    let factor = e.deltaY < 0 ? zoomFactor : 1.0 / zoomFactor;
    
    // Pinch-to-zoom support (e.ctrlKey is true when trackpad pinching)
    if (e.ctrlKey) {
      factor = 1.0 - e.deltaY * 0.01;
    }
    
    // Absolute zoom caps: ZOOM_MIN to ZOOM_MAX
    const nextScale = this.scale * factor;
    if (nextScale < ZOOM_MIN || nextScale > ZOOM_MAX) return;

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let anchorX = mouseX;
    let anchorY = mouseY;

    if (this.showingCompare && this.compareImage) {
      const halfW = this.canvas.width / 2;
      const centerH = this.canvas.height / 2;
      if (mouseX < halfW) {
        anchorX = mouseX - halfW / 2;
      } else {
        anchorX = mouseX - halfW * 1.5;
      }
      anchorY = mouseY - centerH;
    }

    // Zoom anchored under the cursor!
    this.offsetX = anchorX - (anchorX - this.offsetX) * factor;
    this.offsetY = anchorY - (anchorY - this.offsetY) * factor;
    this.scale = nextScale;
    
    this.draw();
    this.onZoomCallback?.();
  }

  // --- Rendering ---
  public draw() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    
    // Clear screen
    this.ctx.fillStyle = '#0e0e12';
    this.ctx.fillRect(0, 0, cw, ch);
    
    if (!this.currentImage) return;

    if (this.showingCompare && this.compareImage) {
      this.drawSplitScreen();
    } else {
      this.drawSingleScreen();
    }

    this.drawOverlays();
  }

  private drawSingleScreen() {
    const img = this.currentImage!;
    this.ctx.save();
    
    // Apply panning offsets
    this.ctx.translate(this.offsetX, this.offsetY);
    // Apply zoom scale
    this.ctx.scale(this.scale, this.scale);
    // Apply rotation
    this.ctx.rotate((this.rotation * Math.PI) / 180);
    
    // Draw image centered on coordinate system
    this.ctx.drawImage(img, -img.width / 2, -img.height / 2);
    
    this.ctx.restore();
  }

  private drawSplitScreen() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const halfW = cw / 2;
    
    const imgA = this.currentImage!;
    const imgB = this.compareImage!;

    // Draw Left Half (Image A)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, halfW - 2, ch);
    this.ctx.clip();
    
    // Fit Image A centered inside left half, respecting rotation
    let imgAW = imgA.width;
    let imgAH = imgA.height;
    if (this.rotation === 90 || this.rotation === 270) {
      imgAW = imgA.height;
      imgAH = imgA.width;
    }
    let scaleA = Math.min((halfW - 20) / imgAW, (ch - 20) / imgAH);
    this.ctx.translate(halfW / 2 + this.offsetX, ch / 2 + this.offsetY);
    this.ctx.scale(scaleA * this.scale, scaleA * this.scale);
    this.ctx.rotate((this.rotation * Math.PI) / 180);
    this.ctx.drawImage(imgA, -imgA.width / 2, -imgA.height / 2);
    this.ctx.restore();

    // Draw Right Half (Image B)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(halfW + 2, 0, halfW - 2, ch);
    this.ctx.clip();
    
    // Fit Image B centered inside right half, respecting rotation
    let imgBW = imgB.width;
    let imgBH = imgB.height;
    if (this.compareRotation === 90 || this.compareRotation === 270) {
      imgBW = imgB.height;
      imgBH = imgB.width;
    }
    let scaleB = Math.min((halfW - 20) / imgBW, (ch - 20) / imgBH);
    this.ctx.translate(halfW * 1.5 + this.offsetX, ch / 2 + this.offsetY);
    this.ctx.scale(scaleB * this.scale, scaleB * this.scale);
    this.ctx.rotate((this.compareRotation * Math.PI) / 180);
    this.ctx.drawImage(imgB, -imgB.width / 2, -imgB.height / 2);
    this.ctx.restore();

    // Draw Divider Line
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(halfW, 0);
    this.ctx.lineTo(halfW, ch);
    this.ctx.stroke();

    // Label sides — "CURRENT" (left) and "COMPARE" (right)
    this.ctx.font = '10px -apple-system, "Segoe UI", sans-serif';
    this.ctx.textBaseline = 'bottom';

    this.ctx.fillStyle = 'rgba(16, 185, 129, 0.5)';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('CURRENT', 10, ch - 10);

    this.ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';
    this.ctx.textAlign = 'right';
    this.ctx.fillText('COMPARE', cw - 10, ch - 10);
  }

  private drawOverlays() {
    const cw = this.canvas.width;
    
    // Draw PICKED gold flag on top right
    if (this.flagOverlay) {
      this.ctx.fillStyle = '#ffab40';
      this.ctx.font = 'bold 36px -apple-system, "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText('★', cw - 20, 15);
    }

    // Draw gold stars under flag if present
    if (this.starsCount > 0) {
      this.ctx.fillStyle = '#2dd4bf';
      this.ctx.font = '22px -apple-system, "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'top';
      const sy = this.flagOverlay ? 60 : 15;
      this.ctx.fillText('★'.repeat(this.starsCount), cw - 20, sy);
    }
  }
}
