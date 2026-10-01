// ═══════════════════════════════════════════════════════════════════════════════
// Camera.js — 2D Viewport Controller with Lerp Follow & Screen Shake
// ═══════════════════════════════════════════════════════════════════════════════

import { lerp, clamp, randomRange } from '../utils/MathUtils.js';

export class Camera {

  constructor(viewportWidth, viewportHeight) {
    // ─── Position (CENTER of the camera in world space) ───────────────────
    this.x = 0;
    this.y = 0;

    // ─── Viewport Dimensions ──────────────────────────────────────────────
    this.width = viewportWidth;
    this.height = viewportHeight;

    this.halfWidth = viewportWidth / 2;
    this.halfHeight = viewportHeight / 2;

    // ─── Zoom ─────────────────────────────────────────────────────────────
    this.zoomLevels = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
    this.zoomIndex = 2; // Default to 1.0x
    this.targetZoom = this.zoomLevels[this.zoomIndex];
    this.zoom = this.targetZoom;

    // ─── Lerp Follow ─────────────────────────────────────────────────────
    this.lerpSpeed = 5.0;

    // ─── Screen Shake ─────────────────────────────────────────────────────
    this._shakeTimer = 0;
    this._shakeIntensity = 0;

    // ─── World Bounds (optional clamping) ─────────────────────────────────
    this.worldBounds = null;
  }

  // ─── Follow ─────────────────────────────────────────────────────────────────

  follow(target, dt) {
    const factor = 1 - Math.exp(-this.lerpSpeed * dt);

    this.x = lerp(this.x, target.x, factor);
    this.y = lerp(this.y, target.y, factor);

    if (this.worldBounds !== null) {
      const wb = this.worldBounds;
      const viewW = this.width / this.zoom;
      const viewH = this.height / this.zoom;

      this.x = clamp(this.x, wb.minX + viewW / 2, wb.maxX - viewW / 2);
      this.y = clamp(this.y, wb.minY + viewH / 2, wb.maxY - viewH / 2);
    }
  }

  centerOn(worldX, worldY) {
    this.x = worldX;
    this.y = worldY;
  }

  // ─── Screen Shake ───────────────────────────────────────────────────────────

  addShake(duration, intensity) {
    this._shakeTimer = duration;
    this._shakeIntensity = intensity;
  }

  update(dt) {
    if (this._shakeTimer > 0) {
      this._shakeTimer -= dt;
    }
    
    // Smooth discrete zoom transition
    if (Math.abs(this.zoom - this.targetZoom) > 0.001) {
      this.zoom = lerp(this.zoom, this.targetZoom, 10 * dt);
    } else {
      this.zoom = this.targetZoom; // snap when close enough
    }
  }

  // ─── Canvas Transform Pipeline ─────────────────────────────────────────────

  apply(ctx) {
    ctx.save();

    // 1. Mova a origem do canvas para o centro da tela (Pivô do Zoom)
    ctx.translate(this.halfWidth, this.halfHeight);

    // 2. Aplique o Zoom
    ctx.scale(this.zoom, this.zoom);

    // 3. Aplique o Screen Shake
    if (this._shakeTimer > 0) {
      const offsetX = randomRange(-this._shakeIntensity, this._shakeIntensity);
      const offsetY = randomRange(-this._shakeIntensity, this._shakeIntensity);
      ctx.translate(offsetX, offsetY);
    }

    // 4. Mova o mundo na direção oposta da câmera
    ctx.translate(-this.x, -this.y);
  }

  restore(ctx) {
    ctx.restore();
  }

  // ─── Coordinate Conversion ──────────────────────────────────────────────────

  screenToWorld(screenX, screenY, out) {
    out.x = (screenX - this.halfWidth) / this.zoom + this.x;
    out.y = (screenY - this.halfHeight) / this.zoom + this.y;
    return out;
  }

  worldToScreen(worldX, worldY, out) {
    out.x = (worldX - this.x) * this.zoom + this.halfWidth;
    out.y = (worldY - this.y) * this.zoom + this.halfHeight;
    return out;
  }

  getWorldViewport(out) {
    const scaledWidth = this.width / this.zoom;
    const scaledHeight = this.height / this.zoom;
    
    out.x = this.x - scaledWidth / 2;
    out.y = this.y - scaledHeight / 2;
    out.width = scaledWidth;
    out.height = scaledHeight;
    
    return out;
  }

  // ─── Zoom Control ───────────────────────────────────────────────────────────

  zoomStep(direction) {
    this.zoomIndex = clamp(this.zoomIndex + direction, 0, this.zoomLevels.length - 1);
    this.targetZoom = this.zoomLevels[this.zoomIndex];
  }

  // ─── Viewport Resize ───────────────────────────────────────────────────────

  resize(newWidth, newHeight) {
    this.width = newWidth;
    this.height = newHeight;
    this.halfWidth = newWidth / 2;
    this.halfHeight = newHeight / 2;
  }
}
