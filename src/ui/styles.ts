/**
 * HUD stylesheet. Injected once as a <style> tag rather than shipped as a .css
 * file so the UI layer stays dependency-free and needs no Vite CSS pipeline —
 * the string is inlined into the bundle and `injectStyles()` is idempotent.
 */

export const STYLE_ID = 'war3-hud-styles';

export const CSS = `
.w3-hud { position: absolute; inset: 0; pointer-events: none; font-family: "Segoe UI", Tahoma, sans-serif; color: #e8e2d2; font-size: 12px; user-select: none; }
.w3-hud * { box-sizing: border-box; }
.w3-hud .pe { pointer-events: auto; }

/* ---- panels ---------------------------------------------------------- */
.w3-panel { position: absolute; background: linear-gradient(#2a2620, #17140f); border: 1px solid #4b4131; border-radius: 3px; box-shadow: 0 2px 10px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06); }

/* ---- top resource bar ------------------------------------------------ */
.w3-resbar { top: 4px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: center; padding: 4px 12px; height: 26px; }
.w3-res { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.w3-res b { font-weight: 600; min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; transition: color .25s; }
.w3-res b.bump { color: #ffe98a; text-shadow: 0 0 6px rgba(255,220,120,.8); }
.w3-glyph { width: 13px; height: 13px; border-radius: 50%; display: inline-block; border: 1px solid rgba(0,0,0,.6); }
.w3-glyph.gold { background: radial-gradient(circle at 35% 30%, #fff2ab, #e6b422 55%, #8a6410); }
.w3-glyph.lumber { background: radial-gradient(circle at 35% 30%, #d9b483, #9c6b32 60%, #5d3d1b); border-radius: 2px; }
.w3-pop.ok b { color: #dfe8cf; }
.w3-pop.low b { color: #ffd257; }
.w3-pop.high b { color: #ff6a5e; }
.w3-upkeep { font-weight: 700; letter-spacing: .5px; }
.w3-upkeep.up-low { color: #ffd257; }
.w3-upkeep.up-high { color: #ff6a5e; animation: w3-blink 1.1s steps(2, start) infinite; }
@keyframes w3-blink { 50% { opacity: .35; } }

/* ---- minimap panel (bottom-left) ------------------------------------- */
.w3-minimap { left: 6px; bottom: 6px; width: 164px; height: 164px; padding: 6px; }
.w3-minimap canvas { display: block; width: 152px; height: 152px; background: #0a0d12; border: 1px solid #000; cursor: crosshair; }

/* ---- info + command panel (bottom-right) ----------------------------- */
.w3-right { right: 6px; bottom: 6px; width: 420px; height: 164px; display: flex; }
.w3-info { flex: 0 0 172px; padding: 6px; display: flex; flex-direction: column; gap: 4px; border-right: 1px solid #3b3325; }
.w3-cmd { flex: 1 1 auto; padding: 6px; position: relative; }

.w3-portrait { position: relative; width: 62px; height: 62px; border: 2px solid #6b5f45; border-radius: 3px; background: #12100c; overflow: hidden; }
.w3-portrait.hero { border-color: #ffd45e; box-shadow: 0 0 8px rgba(255,212,94,.45); }
.w3-portrait canvas { width: 100%; height: 100%; display: block; }
.w3-lvl { position: absolute; right: 1px; bottom: 1px; background: rgba(0,0,0,.72); color: #ffe9a8; font-size: 10px; line-height: 12px; padding: 0 3px; border-radius: 2px; }

.w3-name { font-weight: 600; font-size: 12px; color: #fff3d6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.w3-sub { font-size: 10px; color: #a99f88; }
.w3-bar { position: relative; height: 9px; background: #160d0d; border: 1px solid #000; border-radius: 2px; overflow: hidden; }
.w3-bar i { position: absolute; inset: 0 auto 0 0; display: block; width: 100%; }
.w3-bar.hp i { background: linear-gradient(#7de07d, #2f9e2f); }
.w3-bar.hp.mid i { background: linear-gradient(#ffd45e, #d19b16); }
.w3-bar.hp.low i { background: linear-gradient(#ff7a6e, #cc2b1f); }
.w3-bar.mp i { background: linear-gradient(#7ec6ff, #2b7fd4); }
.w3-bar.xp { height: 5px; }
.w3-bar.xp i { background: linear-gradient(#efe07a, #a89421); }
.w3-stats { font-size: 10px; color: #cbc3ae; line-height: 1.35; }
.w3-stats span { color: #8f876f; }

/* item tray */
.w3-items { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; margin-top: auto; }
.w3-slot { position: relative; width: 27px; height: 27px; background: #14120d; border: 1px solid #4b4131; border-radius: 2px; cursor: pointer; overflow: hidden; }
.w3-slot.empty { cursor: default; opacity: .55; }
.w3-slot canvas { width: 100%; height: 100%; display: block; }
.w3-slot em { position: absolute; right: 0; bottom: 0; font-style: normal; font-size: 9px; background: rgba(0,0,0,.7); padding: 0 2px; }

/* command card */
.w3-card { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.w3-btn { position: relative; height: 33px; background: linear-gradient(#3a3325, #211d15); border: 1px solid #5a4d35; border-radius: 2px; color: #efe6cf; font-size: 10px; cursor: pointer; overflow: hidden; padding: 0; }
.w3-btn:hover { border-color: #ffe9a8; background: linear-gradient(#4a402d, #2a2419); }
.w3-btn.off { filter: grayscale(.85) brightness(.6); cursor: not-allowed; }
.w3-btn.armed { border-color: #5beb78; box-shadow: 0 0 7px rgba(90,235,120,.6); }
.w3-btn > canvas { position: absolute; left: 2px; top: 2px; width: 29px; height: 29px; }
.w3-btn > s { position: absolute; left: 2px; top: 2px; right: 2px; bottom: 0; text-decoration: none; background: rgba(6,8,12,.62); display: block; }
.w3-btn > u { position: absolute; left: 0; bottom: 0; height: 3px; background: #6ee06e; text-decoration: none; display: block; }
.w3-btn label { position: absolute; right: 2px; top: 1px; font-size: 9px; color: #cfc39f; }
.w3-btn span.txt { position: absolute; left: 33px; top: 50%; transform: translateY(-50%); font-size: 9px; line-height: 1.1; max-width: 62px; overflow: hidden; }
.w3-hot { position: absolute; right: 2px; bottom: 1px; font-size: 9px; color: #8f876f; }

/* training bubbles */
.w3-queue { position: absolute; left: 6px; top: 6px; display: flex; flex-direction: column; gap: 3px; }
.w3-bubble { position: relative; width: 30px; height: 30px; border-radius: 50%; background: #14120d; border: 1px solid #5a4d35; cursor: pointer; overflow: hidden; }
.w3-bubble canvas { width: 100%; height: 100%; }
.w3-bubble em { position: absolute; inset: 0; font-style: normal; font-size: 9px; text-align: center; line-height: 30px; color: #fff; text-shadow: 0 0 3px #000; }

/* tooltip + alerts */
.w3-tip { position: absolute; max-width: 250px; padding: 5px 7px; background: rgba(10,9,7,.96); border: 1px solid #5a4d35; border-radius: 3px; font-size: 11px; line-height: 1.4; display: none; z-index: 10; box-shadow: 0 3px 12px rgba(0,0,0,.7); }
.w3-tip .t-name { font-weight: 700; color: #ffe9a8; }
.w3-tip .t-desc { color: #b9b099; }
.w3-tip .t-cost { color: #d8cfae; }
.w3-tip .t-miss { color: #ff6a5e; font-weight: 600; }
.w3-tip .t-key { color: #8f876f; }

.w3-alerts { left: 50%; bottom: 190px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; box-shadow: none; }
.w3-alert { padding: 3px 10px; background: rgba(12,10,8,.88); border: 1px solid #6b4a3a; border-radius: 2px; color: #ffcf9a; font-size: 11px; animation: w3-fade 2.2s forwards; }
.w3-alert.err { border-color: #8a3a30; color: #ff9a8e; }
@keyframes w3-fade { 0%,70% { opacity: 1; } 100% { opacity: 0; } }
`;

let injectedIn: Document | null = null;

/** Attach the stylesheet to `doc` exactly once (per document). */
export function injectStyles(doc: Document): void {
  if (injectedIn === doc) return;
  if (doc.getElementById?.(STYLE_ID)) {
    injectedIn = doc;
    return;
  }
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(el);
  injectedIn = doc;
}
