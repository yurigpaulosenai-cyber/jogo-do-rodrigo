// ═══════════════════════════════════════════════════════════════════════════════
// main.js — Game Entry Point & Bootstrap (Phase 3: Pooling + Combat)
// ═══════════════════════════════════════════════════════════════════════════════
// Wires all core systems together:
//   Canvas → InputManager → PoolManager → SpatialGrid → EntityManager
//   → Player (BallisticWeapon) → CollisionResolver → Camera → GameLoop
//
// Phase 3 additions:
//   - PoolManager registered with 200 pre-allocated Projectile instances.
//   - Player weapon refs injected (poolManager + entityManager).
//   - Projectile–StaticProp collision: despawns projectiles on wall hit.
//   - Projectile range expiry: despawns expired projectiles.
//   - HUD expanded with pool utilization metrics.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { GameLoop }                from './core/GameLoop.js';
import { Camera }                  from './core/Camera.js';
import { InputManager }            from './core/InputManager.js';
import { SpatialGrid }             from './core/SpatialGrid.js';
import { EntityManager }           from './core/EntityManager.js';
import { PoolManager }             from './core/PoolManager.js';
import { resolvePlayerEnvironment, resolveEnemyCollisions } from './core/CollisionResolver.js';
import { Player }                  from './entities/Player.js';
import { StaticProp }              from './entities/StaticProp.js';
import { Projectile }              from './entities/Projectile.js';
import { Enemy }                   from './entities/Enemy.js';
import { randomRange, aabbOverlap } from './utils/MathUtils.js';

// ─── Canvas Setup ─────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('gameCanvas');

/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.resize(canvas.width, canvas.height);
}

// ─── Core System Instantiation ────────────────────────────────────────────────

const inputManager = new InputManager(canvas);
const camera      = new Camera(window.innerWidth, window.innerHeight);
const spatialGrid = new SpatialGrid(128);
const poolManager = new PoolManager();

// Wire InputManager ↔ Camera for screen→world mouse conversion.
inputManager.setCameraRef(camera);

// ─── Object Pool Registration ─────────────────────────────────────────────────

/**
 * Pre-allocate 200 Projectile instances.
 *
 * Memory budget: 200 × ~400 bytes ≈ 80 KB.
 * Peak usage estimate: 8 shots/sec × 0.75s flight time = ~6 active at once.
 * 200 is generous headroom for shotgun upgrades and burst fire.
 */
poolManager.register('projectile', Projectile, 200, 2.0);
poolManager.register('enemy', Enemy, 150, 2.0);

// ─── Player & EntityManager Instantiation ─────────────────────────────────────

const player = new Player('player1', 0, 0, inputManager);
const entityMgr = new EntityManager(spatialGrid, poolManager);

// Inject system references into the player's weapon.
player.weapon.poolManagerRef   = poolManager;
player.weapon.entityManagerRef = entityMgr;

entityMgr.addEntity(player);
camera.centerOn(player.x + player.width / 2, player.y + player.height / 2);

// ─── Static Props (Walls / Obstacles) ─────────────────────────────────────────

const PROP_COLORS = ['#3a3a5c', '#4a3a5c', '#3a4a5c', '#5c3a4a', '#3a5c4a'];

function spawnEnvironment() {
  const WALL_T = 24;
  const ARENA_W = 1200;
  const ARENA_H = 800;
  const HALF_W  = ARENA_W / 2;
  const HALF_H  = ARENA_H / 2;

  entityMgr.addEntity(new StaticProp('wall_top',    -HALF_W, -HALF_H,          ARENA_W, WALL_T, '#2a2a44'));
  entityMgr.addEntity(new StaticProp('wall_bottom', -HALF_W,  HALF_H - WALL_T, ARENA_W, WALL_T, '#2a2a44'));
  entityMgr.addEntity(new StaticProp('wall_left',   -HALF_W, -HALF_H,          WALL_T, ARENA_H, '#2a2a44'));
  entityMgr.addEntity(new StaticProp('wall_right',   HALF_W - WALL_T, -HALF_H, WALL_T, ARENA_H, '#2a2a44'));

  const EXCLUSION = 80;

  for (let i = 0; i < 16; i++) {
    let bx, by;
    const bw = 32 + Math.floor(Math.random() * 64);
    const bh = 32 + Math.floor(Math.random() * 64);

    do {
      bx = randomRange(-HALF_W + WALL_T + 8, HALF_W - WALL_T - bw - 8);
      by = randomRange(-HALF_H + WALL_T + 8, HALF_H - WALL_T - bh - 8);
    } while (
      Math.abs(bx + bw / 2) < EXCLUSION &&
      Math.abs(by + bh / 2) < EXCLUSION
    );

    entityMgr.addEntity(new StaticProp(`box_${i}`, bx, by, bw, bh, PROP_COLORS[i % PROP_COLORS.length]));
  }
}

spawnEnvironment();

function spawnWave(count) {
  const ARENA_W = 1200;
  const ARENA_H = 800;
  const HALF_W  = ARENA_W / 2;
  const HALF_H  = ARENA_H / 2;
  const WALL_T  = 24;
  const PADDING = 40; // Margem de segurança (tamanho do inimigo + extra)

  const minX = -HALF_W + WALL_T + PADDING;
  const maxX =  HALF_W - WALL_T - PADDING;
  const minY = -HALF_H + WALL_T + PADDING;
  const maxY =  HALF_H - WALL_T - PADDING;

  for (let i = 0; i < count; i++) {
    let x, y;
    const edge = Math.floor(Math.random() * 4);
    
    if (edge === 0) { // Topo
      x = randomRange(minX, maxX);
      y = minY;
    } else if (edge === 1) { // Fundo
      x = randomRange(minX, maxX);
      y = maxY;
    } else if (edge === 2) { // Esquerda
      x = minX;
      y = randomRange(minY, maxY);
    } else { // Direita
      x = maxX;
      y = randomRange(minY, maxY);
    }

    const enemy = poolManager.acquire('enemy', { 
      x, 
      y, 
      speed: randomRange(40, 70), 
      health: 30, 
      target: player 
    });
    
    entityMgr.addEntity(enemy);
  }
}

// Chamar a função temporária
spawnWave(20);

// ─── Background Grid ──────────────────────────────────────────────────────────

const GRID = Object.freeze({
  CELL_SIZE: 64,
  LINE_COLOR: 'rgba(255, 255, 255, 0.06)',
  MAJOR_LINE_COLOR: 'rgba(255, 255, 255, 0.15)',
  MAJOR_INTERVAL: 4,
  BG_COLOR: '#0a0a1a',
});

// ─── Pre-allocated AABB buffers (reused every frame) ──────────────────────────

/** Viewport AABB for grid drawing and frustum culling. */
const viewportAABB = { x: 0, y: 0, width: 0, height: 0 };

/** Inflated player AABB for collision queries. */
const playerQueryAABB = { x: 0, y: 0, width: 0, height: 0 };
const QUERY_MARGIN = 8;

/** Projectile collision query AABB (reused per projectile). */
const projQueryAABB = { x: 0, y: 0, width: 0, height: 0 };
const PROJ_QUERY_MARGIN = 4;

/** Enemy collision query AABB (reused per enemy). */
const enemyQueryAABB = { x: 0, y: 0, width: 0, height: 0 };
const ENEMY_QUERY_MARGIN = 8;

// ─── Grid Drawing ─────────────────────────────────────────────────────────────

function drawGrid(ctx) {
  camera.getWorldViewport(viewportAABB);

  const cs = GRID.CELL_SIZE;
  const vx = viewportAABB.x;
  const vy = viewportAABB.y;
  const vw = viewportAABB.width;
  const vh = viewportAABB.height;

  const startX = Math.floor(vx / cs) * cs;
  const startY = Math.floor(vy / cs) * cs;
  const endX   = vx + vw;
  const endY   = vy + vh;

  ctx.lineWidth = 1;

  for (let x = startX; x <= endX; x += cs) {
    const ci = Math.round(x / cs);
    ctx.strokeStyle = ci % GRID.MAJOR_INTERVAL === 0 ? GRID.MAJOR_LINE_COLOR : GRID.LINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(x, vy);
    ctx.lineTo(x, vy + vh);
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += cs) {
    const ci = Math.round(y / cs);
    ctx.strokeStyle = ci % GRID.MAJOR_INTERVAL === 0 ? GRID.MAJOR_LINE_COLOR : GRID.LINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.lineTo(vx + vw, y);
    ctx.stroke();
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function drawHUD(ctx) {
  const loopStats   = loop.getStats();
  const entityStats = entityMgr.getStats();
  const poolStats   = poolManager.getAllStats();
  const projPool    = poolStats['projectile'] || { active: 0, total: 0, free: 0 };

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(8, 8, 320, 138);

  ctx.font = '13px monospace';
  ctx.fillStyle = '#53d8fb';

  let y = 26;
  ctx.fillText(`FPS: ${loopStats.fps}  |  Frame: ${loopStats.frameTimeMs.toFixed(1)}ms`, 16, y); y += 18;
  ctx.fillText(`Player: (${player.x.toFixed(0)}, ${player.y.toFixed(0)})`, 16, y); y += 18;
  ctx.fillText(`Camera: (${camera.x.toFixed(0)}, ${camera.y.toFixed(0)})  Zoom: ${camera.zoom.toFixed(2)}x`, 16, y); y += 18;
  ctx.fillText(`Entities: ${entityStats.total} total, ${entityStats.active} active`, 16, y); y += 18;

  // Pool utilization bar.
  ctx.fillStyle = '#f5a623';
  ctx.fillText(`Projectiles: ${projPool.active}/${projPool.total} active  (${projPool.free} free)`, 16, y); y += 18;

  ctx.fillStyle = '#888';
  ctx.fillText('LMB = Shoot | WASD = Move | Scroll = Zoom', 16, y);
}

// ─── Game Loop Callbacks ──────────────────────────────────────────────────────

/**
 * Projectiles pending release this frame.
 * Collected during the projectile collision scan, then batch-released
 * after iteration to avoid modifying the active set while iterating.
 * @type {Projectile[]}
 */
const _projReleaseQueue = [];

/**
 * Enemies pending release this frame.
 * @type {Enemy[]}
 */
const _enemyReleaseQueue = [];

/**
 * UPDATE callback.
 *
 * Pipeline:
 *   1. Update world mouse coordinates (screen → world).
 *   2. EntityManager.update(dt) — moves all entities, player fires weapon.
 *   3. Player–environment collision (MTV).
 *   4. Projectile–environment collision (despawn on hit).
 *   5. Projectile range expiry (despawn expired).
 *   6. Camera follow.
 *
 * @param {number} dt
 */
function onUpdate(dt) {
  // 1. Convert mouse screen→world BEFORE player reads input.
  inputManager.updateWorldMouse();

  // 1.5. Consume camera zoom input
  if (inputManager.scrollDelta !== 0) {
    camera.zoomStep(inputManager.scrollDelta);
    inputManager.scrollDelta = 0;
  }

  // 2. Update all entities (player movement + weapon fire, projectile flight, enemy steering).
  entityMgr.update(dt, player);

  // 3. Player–environment collision (MTV push).
  playerQueryAABB.x      = player.x - QUERY_MARGIN;
  playerQueryAABB.y      = player.y - QUERY_MARGIN;
  playerQueryAABB.width  = player.width  + QUERY_MARGIN * 2;
  playerQueryAABB.height = player.height + QUERY_MARGIN * 2;

  const playerNearby = spatialGrid.query(playerQueryAABB);
  resolvePlayerEnvironment(player, playerNearby);
  spatialGrid.update(player);

  // 4–5. Projectile collision + range expiry scan.
  //      Iterate the pool's active set directly — zero-allocation.
  const projPool = poolManager.getPool('projectile');
  if (projPool) {
    const activeProjs = projPool.getActiveSet();

    // Clear the release queue from the previous frame.
    _projReleaseQueue.length = 0;

    for (const proj of activeProjs) {
      // Skip already-deactivated projectiles (range expired in update).
      if (!proj.active) {
        _projReleaseQueue.push(proj);
        continue;
      }

      // Build an inflated query AABB around the projectile.
      projQueryAABB.x      = proj.aabb.x - PROJ_QUERY_MARGIN;
      projQueryAABB.y      = proj.aabb.y - PROJ_QUERY_MARGIN;
      projQueryAABB.width  = proj.aabb.width  + PROJ_QUERY_MARGIN * 2;
      projQueryAABB.height = proj.aabb.height + PROJ_QUERY_MARGIN * 2;

      const nearby = spatialGrid.query(projQueryAABB);

      let hitSomething = false;

      for (let i = 0; i < nearby.length; i++) {
        const entity = nearby[i];

        // Skip self, skip player (don't shoot yourself), skip other projectiles.
        if (entity === proj) continue;
        if (entity === player) continue;
        if (entity instanceof Projectile) continue;

        // AABB overlap test (narrow-phase).
        if (aabbOverlap(
          proj.aabb.x, proj.aabb.y, proj.aabb.width, proj.aabb.height,
          entity.aabb.x, entity.aabb.y, entity.aabb.width, entity.aabb.height
        )) {
          hitSomething = true;
          break; // One hit is enough to despawn.
        }
      }

      if (hitSomething) {
        proj.active = false;
        _projReleaseQueue.push(proj);
      }
    }

    // Batch-release all despawned projectiles.
    for (let i = 0; i < _projReleaseQueue.length; i++) {
      const p = _projReleaseQueue[i];
      entityMgr.removeEntity(p.id);
      spatialGrid.remove(p);
      projPool.release(p);
    }
  }

  // 5.5 Enemy collision scan
  const enemyPool = poolManager.getPool('enemy');
  if (enemyPool) {
    const activeEnemies = enemyPool.getActiveSet();
    _enemyReleaseQueue.length = 0;

    for (const enemy of activeEnemies) {
      if (!enemy.active) {
        _enemyReleaseQueue.push(enemy);
        continue;
      }

      const nearby = spatialGrid.query(enemy.aabb);
      resolveEnemyCollisions(enemy, nearby);
      spatialGrid.update(enemy);

      if (!enemy.active) {
        _enemyReleaseQueue.push(enemy);
      }
    }

    for (let i = 0; i < _enemyReleaseQueue.length; i++) {
      const e = _enemyReleaseQueue[i];
      entityMgr.removeEntity(e.id);
      spatialGrid.remove(e);
      enemyPool.release(e);
    }
  }

  // 6. Camera follows corrected player position.
  camera.follow(
    { x: player.x + player.width / 2, y: player.y + player.height / 2 },
    dt
  );

  // 7. Update camera temporal logic (Screen Shake decay).
  camera.update(dt);
}

/**
 * DRAW callback.
 * @param {number} dt
 */
function onDraw(dt) {
  // 1. Limpar a tela (World Matrix identity)
  ctx.fillStyle = GRID.BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Aplicar Câmera (Salva matriz e aplica translações de zoom/shake)
  camera.apply(ctx);
  camera.getWorldViewport(viewportAABB);

  // 3. Desenhar World/Grade
  drawGrid(ctx);

  // 4. Desenhar Entidades
  entityMgr.draw(ctx, viewportAABB);

  // 5. Restaura matriz CRÍTICO (remove o shake para o UI)
  camera.restore(ctx);

  // 6. Desenhar HUD (Screen Space)
  drawHUD(ctx);
}

// ─── Game Loop Instantiation & Start ──────────────────────────────────────────

const loop = new GameLoop({ onUpdate, onDraw });

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// 🚀 Start the engine.
loop.start();

// ─── Dev Console API ──────────────────────────────────────────────────────────
window.game = Object.freeze({
  loop, camera, inputManager, player,
  spatialGrid, entityMgr, poolManager,
});

console.log(
  '%c🎮 Sandbox Roguelike Engine — Phase 3 Running',
  'color: #53d8fb; font-size: 14px; font-weight: bold;'
);
console.log('  → LMB to shoot | WASD to move | Scroll to zoom');
console.log('  → game.poolManager.getAllStats() for pool metrics');
