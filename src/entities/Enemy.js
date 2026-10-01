import { RenderLayer } from '../core/EntityManager.js';

let _nextEnemyId = 0;

export class Enemy {
  constructor() {
    this.id = `enemy_${_nextEnemyId++}`;
    this.active = false;
    this.layer = RenderLayer.ENTITIES;
    
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    
    this.width = 32;
    this.height = 32;
    this.aabb = { x: 0, y: 0, width: 32, height: 32 };
    
    this.speed = 0;
    this.health = 0;
    this.damage = 0;
  }

  reset(props = {}) {
    this.x = props.x || 0;
    this.y = props.y || 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = props.speed || 50;
    this.health = props.health || 30;
    this.damage = props.damage || 10;
    
    this.aabb.x = this.x;
    this.aabb.y = this.y;
    
    this.active = true;
  }

  update(dt, player) {
    if (!this.active || !player) return;

    // Matemática de Seek
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist > 0) {
      const dirX = dx / dist;
      const dirY = dy / dist;

      this.vx = dirX * this.speed;
      this.vy = dirY * this.speed;
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.aabb.x = this.x;
    this.aabb.y = this.y;
  }

  draw(ctx) {
    if (!this.active) return;
    ctx.fillStyle = '#b30000'; // Vermelho escuro conforme especificado
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
