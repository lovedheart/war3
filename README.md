# Warcraft III: The Frozen Throne — Web Remake

> 基于 Web 技术复刻《魔兽争霸III：冰封王座》的完整 RTS 引擎——纯 TypeScript + Canvas 2D，
> 零依赖运行时，完全确定性模拟。美术为程序化占位图形，数据表为权威原创，不含任何暴雪资产。

A complete real-time-strategy engine recreating *Warcraft III: The Frozen Throne* on the open
web — pure TypeScript + Canvas 2D, zero runtime dependencies, fully deterministic simulation.
All art is procedural placeholder graphics and all data tables are authoritative original
work; no Blizzard assets are included.

---

## Highlights / 亮点

### Deterministic lockstep simulation / 确定性 lockstep 模拟
- **16.16 fixed-point math** (`Fixed`) — no floats in sim state, no `Math.random`, no `Date.now`.
  Identical replays on every machine, bit for bit.
  **16.16 定点数**——模拟状态无浮点、无随机源，任何机器逐位复现。
- **30 ticks/s** server-authoritative tick loop; every mutation is a serialisable JSON-safe
  `Command`, queued and applied at the start of the next tick.
  每秒 30 tick；一切变更都是可序列化的 JSON `Command`，排队后于下一 tick 生效。
- State hash (`stateHash()`) catches divergence instantly; CI locks it every commit.
  状态哈希可即时捕捉分叉，每次提交都有回归锁。

### Architecture / 架构
| Layer | Module | Notes |
|---|---|---|
| ECS | `src/ecs` | SoA component stores, ascending-eid iteration order |
| Sim | `src/sim` | movement (steer/retreat), combat, economy (harvest/upkeep), heroes, abilities, items, win/lose |
| Data | `data/*.json` | units / buildings / abilities / tech / items / heroes / loot — original tables mirroring TFT semantics |
| Map | `src/map` | deterministic mapgen (spawns/mines/trees), pathfinding grid, fog of war, quadtree |
| AI | `src/ai` | build-order planner, worker assignment with gold/wood split, wave attacks, 3 difficulties |
| Campaign | `src/campaign` | hand-authored levels with scripted triggers, win/lose conditions |
| Render | `src/render` | Canvas 2D procedural sprites, terrain, selection rings, minimap |
| UI | `src/ui` | HUD, command card, item tray, tooltips, ability aiming |
| App | `src/app` | frame loop, input, campaign wiring, replay player |

### Replay / 回放
Every queued command is recorded with its tick (`world.commandLog`). A replay is just
`{seed, players, commands}` — rebuilt from scratch and re-simulated to any tick.
每条命令按 tick 录制；回放 = seed + 命令流重建重演，支持 seek。

### Verification / 验证体系
- **269 tests** across sim / map / render / ui / input / data / trigger / app / ai / campaign
  （覆盖确定性、Command 纯度、合法性、无作弊、难度单调性、经济回归锁）
- Browser screenshot acceptance via Playwright (skirmish + campaign)
- `npx tsx tools/sim-run.ts --ticks 1800 --seed 7 --ai none --report` → stable hash `bbe1dee0`

## Quick start / 快速开始

```bash
npm install
npm run dev          # vite dev server → http://localhost:5173
npm run test         # vitest full suite
npm run typecheck    # tsc --noEmit
npm run sim -- --ticks 6000 --seed 7   # headless skirmish report
```

### URL parameters / URL 参数

| Param | Effect |
|---|---|
| `?seed=7` | map seed |
| `?size=96` | map size |
| `?race=orc` | pick race |
| `?campaign=human-01` | play a campaign level |
| `?debug=1` | render debug overlay |

## Status / 完成度

| Area | Status |
|---|---|
| Core sim (movement/combat/economy/heroes/items) | ✅ |
| Fog of war, pathfinding, quadtree | ✅ |
| Skirmish AI (3 difficulties, build orders, waves) | ✅ |
| Campaign (4 human levels, triggers, win/lose) | ✅ |
| HUD / command card / minimap / item tray | ✅ |
| Replay record & playback API | ✅ |
| Command-effect verification (blockedUntil backoff) | ✅ |
| Audio (SFX / music / unit voice) | ⬜ not started |
| Replay playback UI (timeline scrubber) | ⬜ not started |
| Undead / Night Elf content | ⬜ partial |

## License

Original work. No Blizzard Entertainment assets or data are used.
