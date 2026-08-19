const M = "/root/fvtt14-data/Data/modules";
const TARGETS = ["jb2a_patreon","JB2A_DnD5e","jb2a-extras","eskie-effects","blfx-assets-pack01",
                 "boss-loot-assets-premium","boss-loot-assets-free","psfx-patreon","soundfxlibrary",
                 "animated-spell-effects-cartoon"];
import {readFileSync} from "node:fs";

for (const id of TARGETS) {
  const captured = []; const inits = [];
  const reg = (n,f)=>{ if(typeof f==="function") inits.push([n,f]); };
  globalThis.Hooks = { once:reg, on:reg, call:()=>true, callAll:()=>true, off:()=>{} };
  globalThis.Sequencer = { Database: { registerEntries:(ns,tree,opts)=>{ captured.push({ns,tree}); return true; },
                                       getPathsUnder:()=>[], getEntry:()=>null }, BaseEffectElement:class{}, };
  // 免费/付费互斥：提取某一版时，其对偶版必须视为未激活，否则注册守卫会跳过
  const RIVALS = { jb2a_patreon:"JB2A_DnD5e", "JB2A_DnD5e":"jb2a_patreon",
                   "boss-loot-assets-premium":"boss-loot-assets-free",
                   "boss-loot-assets-free":"boss-loot-assets-premium",
                   "psfx-patreon":"psfx", psfx:"psfx-patreon",
                   "eskie-effects":"eskie-effects-free", "eskie-effects-free":"eskie-effects" };
  const inactive = new Set([RIVALS[id]].filter(Boolean));
  const modReg = new Map();
  const fakeModules = { get(k){ if(!modReg.has(k)) modReg.set(k,{id:k, active:!inactive.has(k), version:"99.0.0", api:{}, flags:{}}); return modReg.get(k); },
                        has:()=>true, set:(k,v)=>modReg.set(k,v), [Symbol.iterator](){ return modReg[Symbol.iterator](); },
                        get size(){ return modReg.size; }, values:()=>modReg.values(), keys:()=>modReg.keys(), entries:()=>modReg.entries(), forEach:f=>modReg.forEach(f) };
  const settingDefs = new Map();
  const fakeSettings = {
    register:(ns,key,cfg)=>settingDefs.set(`${ns}.${key}`, cfg?.default),
    registerMenu:()=>{}, set:()=>{},
    get:(ns,key)=>{ const k=`${ns}.${key}`;
      if (settingDefs.has(k)) { const d = settingDefs.get(k); if (d !== undefined && d !== "") return d; }
      return /path|location/i.test(key) ? "modules" : undefined; } };
  globalThis.game = { settings:fakeSettings,
                      modules:fakeModules, packs:new Map(), i18n:{localize:s=>s, format:s=>s, has:()=>false},
                      user:{isGM:true}, users:{activeGM:null}, system:{id:"crucible"}, version:"14.366",
                      keybindings:{register:()=>{}}, socket:{on:()=>{},emit:()=>{}} };
  class _Stub { static registerSheet(){} constructor(){} render(){} close(){} static get defaultOptions(){return {};} }
  for (const g of ["FormApplication","Application","ApplicationV2","ChatMessage","Dialog","DialogV2","FilePicker",
                   "Actor","Item","Token","TokenDocument","Scene","Macro","Folder","Hooks_","SettingsConfig","JournalEntry"])
    if (!(g in globalThis)) globalThis[g] = _Stub;
  globalThis.ui = { notifications:{warn:()=>{},error:()=>{},info:()=>{}} };
  globalThis.CONFIG = {}; globalThis.CONST = { TEXT_ANCHOR_POINTS:{}, GRID_SNAPPING_MODES:{} };
  globalThis.Ray = class { constructor(a,b){ this.A=a; this.B=b; } };
  globalThis.PIXI = { Sprite:class{}, Container:class{}, Texture:{from:()=>({})}, filters:{}, Rectangle:class{} };
  globalThis.canvas = { grid:{size:100}, scene:null, tokens:{placeables:[]}, templates:{placeables:[]}, dimensions:{size:100,distancePixels:1} };
  globalThis.foundry = { utils:{ mergeObject:(a,b)=>Object.assign({},a,b), deepClone:o=>structuredClone(o),
                                 getProperty:()=>undefined, setProperty:()=>{}, isNewerVersion:(a,b)=>{ const p=v=>String(v??"0").split(".").map(n=>parseInt(n,10)||0);
                                                 const [x,y]=[p(a),p(b)]; for(let i=0;i<Math.max(x.length,y.length);i++){
                                                   const d=(x[i]||0)-(y[i]||0); if(d) return d>0; } return false; }, randomID:()=>"x" },
                         applications:{api:{ApplicationV2:class{},HandlebarsApplicationMixin:c=>c}} };
  let esm = [];
  try { const mj = JSON.parse(readFileSync(`${M}/${id}/module.json`,"utf8"));
        esm = [...(mj.esmodules ?? []), ...(mj.scripts ?? [])]; } catch {}
  let err = null;
  for (const e of esm) {
    try { await import(`${M}/${id}/${e.replace(/^\.\//,"")}`); } catch(x) { err = x.message.slice(0,70); }
  }
  const ORDER = ["init","i18nInit","setup","sequencerReady","sequencer.ready","ready","canvasReady"];
  const fired = new Set();
  const fire = async (n,f) => { try { await f(); } catch(x) { err ??= `${n}: ${x.message.slice(0,60)}`; } };
  for (const phase of ORDER) for (const e of inits) if (e[0] === phase) { fired.add(e); await fire(e[0], e[1]); }
  for (const e of inits) if (!fired.has(e)) await fire(e[0], e[1]);   // 兜底：触发剩余全部钩子
  const total = captured.reduce((a,c)=>{ let n=0; const w=o=>{for(const [k,v] of Object.entries(o)){ if(k.startsWith("_"))continue;
    if(typeof v==="string"||Array.isArray(v))n++; else if(v&&typeof v==="object")w(v);}}; w(c.tree); return a+n; },0);
  console.log(`${id.padEnd(32)} ns=${captured.map(c=>c.ns).join(",")||"-"} leaves=${total} ${err?"ERR:"+err:""}`);
}
