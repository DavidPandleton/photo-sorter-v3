/**
 * PHOTO SORTER V3 — PhotoViewer
 * Coordinate-aware, high-performance HTML5 Canvas renderer
 * Handles zooming, panning, rotation, and split-screen compare modes.
 */

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
  
  // Flags
  private showingCompare: boolean = false;
  private isPanning: boolean = false;
  private startX: number = 0;
  private startY: number = 0;

  // Viewport borders / overlays
  private flagOverlay: boolean = false;
  private starsCount: number = 0;

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

  public setCompareImage(img: HTMLImageElement | null) {
    this.compareImage = img;
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
    if (!this.currentImage || this.showingCompare) return;

    const zoomFactor = 1.1;
    let factor = e.deltaY < 0 ? zoomFactor : 1.0 / zoomFactor;
    
    // Absolute zoom caps: 10% to 2000%
    const nextScale = this.scale * factor;
    if (nextScale < 0.05 || nextScale > 25.0) return;

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom anchored under the cursor!
    this.offsetX = mouseX - (mouseX - this.offsetX) * factor;
    this.offsetY = mouseY - (mouseY - this.offsetY) * factor;
    this.scale = nextScale;
    
    this.draw();
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
    
    // Fit Image A centered inside left half
    let scaleA = Math.min((halfW - 20) / imgA.width, (ch - 20) / imgA.height);
    this.ctx.translate(halfW / 2 + this.offsetX, ch / 2 + this.offsetY);
    this.ctx.scale(scaleA * this.scale, scaleA * this.scale);
    this.ctx.drawImage(imgA, -imgA.width / 2, -imgA.height / 2);
    this.ctx.restore();

    // Draw Right Half (Image B)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(halfW + 2, 0, halfW - 2, ch);
    this.ctx.clip();
    
    // Fit Image B centered inside right half
    let scaleB = Math.min((halfW - 20) / imgB.width, (ch - 20) / imgB.height);
    this.ctx.translate(halfW * 1.5 + this.offsetX, ch / 2 + this.offsetY);
    this.ctx.scale(scaleB * this.scale, scaleB * this.scale);
    this.ctx.drawImage(imgB, -imgB.width / 2, -imgB.height / 2);
    this.ctx.restore();

    // Draw Divider Line
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(halfW, 0);
    this.ctx.lineTo(halfW, ch);
    this.ctx.stroke();
  }

  private drawOverlays() {
    const cw = this.canvas.width;
    
    // Draw PICKED gold flag on top right
    if (this.flagOverlay) {
      this.ctx.fillStyle = '#ffab40';
      this.ctx.font = 'bold 36px "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText('★', cw - 20, 15);
    }

    // Draw gold stars under flag if present
    if (this.starsCount > 0) {
      this.ctx.fillStyle = '#ffab40';
      this.ctx.font = '22px "Segoe UI", sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'top';
      const sy = this.flagOverlay ? 60 : 15;
      this.ctx.fillText('★'.repeat(this.starsCount), cw - 20, sy);
    }
  }
}
