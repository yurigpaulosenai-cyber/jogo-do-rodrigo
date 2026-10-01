# 🏗️ Game Architecture & State Document
**Project:** Sandbox Roguelike 2D (HTML5 / Vanilla JS)
**Phase Status:** Phase 1, 2, and 3 Concluídas. Iniciando Fase 4 (Hordas e IA).

---

## 🤖 Diretrizes para a IA de Código (Cloud Code / LLM)
Ao ler este documento antes de gerar código, você DEVE atuar como um **Programador Sênior e Arquiteto Técnico de Jogos Web (HTML5/JS/Canvas API)**. 
- **Tradução Técnica:** Converta as instruções do prompt em conceitos matemáticos e físicos aplicáveis (ex: interpolação linear, MTV, particionamento espacial).
- **Foco Arquitetural:** Mantenha a arquitetura limpa, otimização visual para Canvas e siga estritamente as regras de performance abaixo. NUNCA quebre as restrições arquiteturais para criar atalhos fáceis.

---

## 📌 Regras de Ouro (STRICT COMPLIANCE REQUIRED)

1. **Zero Allocations in Loops (Anti-GC Stalls):** 
   - É ESTRITAMENTE PROIBIDO usar a palavra-chave `new`, `Array.map()`, `Array.filter()`, ou desestruturação de objetos (`{...}`) dentro de qualquer método `update(dt)` ou `draw(ctx)`. 
   - Toda entidade nova (tiros, partículas, inimigos) DEVE nascer via `PoolManager.acquire()` e morrer via `PoolManager.release()`.
2. **Delta Time Physics:** Todo movimento, timer ou vetor deve ser multiplicado por `dt` (Delta Time em segundos).
3. **Decoupling (Logic vs. Render):** 
   - `update(dt)` lida APENAS com matemática, vetores, colisões e estados.
   - `draw(ctx)` lida APENAS com a Canvas API.
4. **Isolamento de Matrizes (Screen Space vs. World Space):** 
   - Ao renderizar, o método `Camera.apply(ctx)` DEVE utilizar `ctx.save()`. 
   - Ao finalizar o desenho do mundo (entidades/grid) e ANTES de desenhar o HUD/UI, chame obrigatoriamente `Camera.restore(ctx)`. Isso impede que o Screen Shake e o Zoom afetem a interface.
5. **Tratamento Visual:** O jogo utiliza Pixel Art. CSS do Canvas exige `image-rendering: pixelated` e no JS `ctx.imageSmoothingEnabled = false`.

---

## 📂 Módulos do Sistema e Padrões de Projeto

### 1. Core Engine
- **`GameLoop.js`:** Gerencia `requestAnimationFrame`. Clampa o `dt` em no máximo `0.1s` para evitar tunneling.
- **`Camera.js`:** Segue o jogador suavemente usando Lerp. Possui `Screen Shake` (deslocamento caótico randômico no `apply`) e sistema de `Zoom Discreto` por steps.
- **`InputManager.js`:** Converte DOM events para estado semântico. Autoridade total sobre vetores de movimento (`vx`, `vy`) via WASD. Normaliza diagonais (`Math.hypot`).

### 2. Física e Otimização Espacial
- **`EntityManager.js`:** Padrão Mediator. Atualiza e desenha entidades usando *Frustum Culling* (intersectando a AABB com a Viewport). Usa uma `_deferredQueue` para gerenciar spawns/despawns, nunca alterando arrays durante a iteração.
- **`SpatialGrid.js`:** Particionamento espacial infinito via Hash Grid. Usa `_inverseCellSize` (multiplicação) ao invés de divisão para performance máxima no V8.
- **`CollisionResolver.js`:** Resolve colisões AABB na Narrow-phase.
  - *Parede:* Usa MTV (Minimum Translation Vector) para fazer entidades deslizarem.
  - *Guarda:* Ignora colisões entre a entidade e seu `owner` (ex: jogador e sua própria bala).

### 3. Sistema de Combate e Entidades
- **`WeaponSystem.js`:** Padrão Template Method + Strategy. Armas balísticas calculam `Spread` (dispersão angular randômica em radianos) antes do spawn. O tiro gera *Screen Shake* mas NUNCA aplica *knockback* físico (vetorial) no jogador.
- **`Enemy.js` (IA Básica):** Usa comportamentos de *Steering* (Seek) calculando vetores normalizados até o jogador, respeitando as regras de *Separation* (Soft Collision) do CollisionResolver.
- **`FactoryTickEngine.js`:** Motor rodando a 4Hz (250ms) via `setInterval` para automação de base (desacoplado do render loop).