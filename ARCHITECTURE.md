# war3 — Architecture & Module Contracts

TypeScript + Canvas 2D recreation of **Warcraft III: The Frozen Throne** mechanics.
Original assets are copyrighted and are **not** used; all art is procedurally drawn.
Gameplay *data* (unit stats, damage tables, costs, tech requirements) follows the
official TFT data tables.

## 1. Two worlds: sim vs view

Everything under `src/sim`, `src/map`, `src/ecs`, `src/core` is the **simulation**:

- deterministic: same seed + same command stream ⇒ identical state hash
- **no `Date.now()`, no `Math.random()`, no `requestAnimationFrame`, no DOM**
- all gameplay quantities are `Fixed` (16.16 fixed point, `src/core/fixed.ts`)

Everything under `src/render`, `src/ui`, `src/input`, `src/audio`, `src/app` is the
**presentation layer**. It may read sim state but must never mutate it except by
pushing a `Command` into `Sim.queueCommand()`.

```
input ──► Command[] ──► World.tick() ──► state ──► render / ui / audio
                             ▲                            │
                             └────── AI commands ─────────┘ (AI also only emits Commands)
```

## 2. Time

`TICK_RATE = 30` logic ticks/s. One `World.tick()` advances exactly one tick.
The renderer runs at display rate and interpolates between tick t-1 and t
(`SUBSTEP_INTERP`). Never advance the sim from a rAF delta directly — accumulate
fixed steps.

## 3. Space

1 game distance unit == 1 terrain tile == `ff(1)`. Positions are tile-centre
based: tile `(tx, ty)` has its centre at world position `ff(tx) + ff(0.5)`.
`TILE_SIZE_PX = 64` is render-only.

## 4. Determinism contract

Allowed in sim: integer arithmetic, `Fixed`, `Rng`, table lookups, sorting with a
total order that never ties on insertion order (tie-break on `eid`).
Forbidden: floating point on state, iteration over object key insertion order for
gameplay decisions (use sorted arrays), `Math.random`, `Map.forEach` feeding
damage order (iterate a sorted index array instead).

Every public sim entry point takes an explicit `tick` number.

## 5. Module ownership (parallel work — do not edit files outside your module)

| Module | Path | Owns |
|---|---|---|
| core | `src/core` | Fixed, Rng, EventBus, pools, hash, geom, constants (**frozen**) |
| data | `data/*.json`, `src/data/schema.ts` | all game data tables + validator |
| map | `src/map` | Terrain, pathable grid, A*/flow field, QuadTree, FogOfWar |
| sim | `src/sim` | World, ECS stores, orders, movement/collision, combat, economy, hero/items |
| render | `src/render` | sprite atlas (procedural), layers, particles, minimap pixels |
| ui | `src/ui` | HUD DOM overlay, command card, selection panel, tooltips |
| input | `src/input` | mouse/keyboard → Commands, control groups, hotkeys |
| ai | `src/ai` | opponent behaviour, emits Commands only |
| trigger | `src/trigger` | event/condition/action DSL, campaign scripting |
| app | `src/app` | bootstrap, main loop, wiring, save/load |

Cross-module calls go through the interfaces below only.

## 6. Canonical types (`src/sim/types.ts`)

```ts
type PlayerId = number;              // 0 none, 1..10 players, 11 NP, 12 NA
type Eid = number;                   // index<<20 | generation
interface Vec2F { x: Fixed; y: Fixed }
```

`World` surface (implemented in `src/sim/world.ts`, others code against it):

```ts
tick: number
queueCommand(cmd: Command): void
command(cmd: Command): Result          // immediate application (player-initiated)
entities(): Iterable<Eid>
pos(eid): Vec2F | undefined
owner(eid): PlayerId
unitData(eid): UnitDef | undefined
alive(eid): boolean
canSee(eid, viewer: PlayerId): boolean
terrain: Terrain
fog: FogOfWar
view: ViewState                        // camera/selection, written by UI only
```

## 7. Command stream (`src/sim/command.ts`)

All player and AI intent is a serialisable, JSON-safe `Command`:

```ts
type Command =
  | { k: 'move'; units: Eid[]; to: Vec2F; mode: 'move'|'attack'|'attackMove'|'patrol'|'follow'; queue: boolean }
  | { k: 'stop' | 'hold'; units: Eid[] }
  | { k: 'rightClick'; units: Eid[]; target: Eid | null; at: Vec2F }
  | { k: 'train'; building: Eid; unitId: string; pos?: number }
  | { k: 'build'; worker: Eid; buildingId: string; at: TilePos }
  | { k: 'harvest'; worker: Eid; target: Eid }        // mine / tree / gold
  | { k: 'return'; worker: Eid; to: Eid }             // drop off at which building
  | { k: 'research'; building: Eid; techId: string }
  | { k: 'upgradeUnit'; unit: Eid; toId: string }
  | { k: 'ability'; caster: Eid; abilityId: string; target: Eid | null; at?: Vec2F; itemSlot?: number }
  | { k: 'dropItem'; unit: Eid; slot: number; at: Vec2F }
  | { k: 'giveItem'; from: Eid; slot: number; to: Eid }
  | { k: 'townHall'; building: Eid; action: 'rally'|'toggle'|'convertWorker' }
  | { k: 'cancel'; entity: Eid; kind: 'train'|'build'|'research'; index: number }
  | { k: 'revive'; hero: Eid }
  | { k: 'setRally'; entity: Eid; at: Vec2F }
  | { k: 'declareUpkeep'; player: PlayerId; mode: 0|1|2 }
  | { k: 'sell'; building: Eid }
  | { k: 'trigger'; name: string; payload?: unknown };   // trigger/AI escape hatch
```

Replays are just `{ seed, mapHash, commands: [tick, Command][] }`.

## 8. Data tables (`data/*.json`)

Files: `units.json`, `buildings.json`, `abilities.json`, `tech.json`,
`items.json`, `race.json`, `loot.json`, `damage.json`, `maps/*.json`.
IDs are lower_snake, prefixed by type where ambiguous (`footman`, `barracks_al`,
`abl_hammer_of_the_king`, `itm_claymore`). Every numeric field is plain decimal
JSON; `src/data/load.ts` converts to `Fixed` once at boot (sim never parses JSON).

Authoritative tables live in `data/damage.json`:
`attackTypes[7] × armorTypes[8]` coefficient matrix plus per-armor-value curve
parameters. See `docs/DAMAGE.md` for the formulas.

## 9. Testing

- `npm test` — vitest unit + determinism tests (`tests/`)
- `tests/determinism.test.ts`: build a scripted skirmish, run 5000 ticks twice,
  assert equal `stateHash()`
- `tools/sim-run.ts --ticks N --seed S --ai` — headless match, prints resource /
  army timeline and a final balance report
- Playwright smoke script drives the real page and writes screenshots to
  `artifacts/`
