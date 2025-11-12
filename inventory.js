// inventory.js — MV3-safe overlay injected via chrome.scripting.executeScript
(() => {
  const ROOT_ID = 'gx-inventory-overlay-root';
  if (window.__GX_INVENTORY_BOOTSTRAPPED__) {
    const root = document.getElementById(ROOT_ID);
    if (root) root.style.display = (root.style.display === 'none' ? 'block' : 'none');
    return;
  }
  window.__GX_INVENTORY_BOOTSTRAPPED__ = true;

  /* ---------------- Utils ---------------- */
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const getChatIdFromUrl=()=>{try{const m=location.pathname.match(/\/chats\/(\d+)/);return m?m[1]:null;}catch{return null;}};
  const CHAT_KEY=getChatIdFromUrl();
  const STORAGE_KEY=`gx_inventory_state::${location.host}::${CHAT_KEY||'global'}`;
  const loadState=()=>{try{const s=localStorage.getItem(STORAGE_KEY);return s?JSON.parse(s):null;}catch{return null;}};
  const saveState=(st)=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(st));}catch{}};
  const deepClone = (o)=> JSON.parse(JSON.stringify(o));

  // Normalize
  const norm=(s)=>(s||'')
    .toLowerCase()
    .replace(/[`’‘“”"']/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,'_')
    .replace(/^_+|_+$/g,'');

  // Strip parentheses for canonical comparisons (keep for UI)
  const stripParens=(s)=> (s||'').replace(/\([^()]*\)/g,'').replace(/\s{2,}/g,' ').trim();

  const onlyDigits=(s)=> (s||'').replace(/\D+/g,'');
  const splitTokens=(s)=> norm(s).split('_').filter(Boolean);

  /* ---------- UK/US + Morphology (plural & singular both ways) ---------- */

  const UK_US_MAP = new Map([
    ['colour','color'], ['colours','colors'],
    ['armour','armor'], ['armours','armors'],
    ['honour','honor'], ['honours','honors'],
    ['favour','favor'], ['favours','favors'],
    ['rumour','rumor'], ['rumours','rumors'],
    ['neighbour','neighbor'], ['neighbours','neighbors'],
    ['behaviour','behavior'], ['behaviours','behaviors'],
    ['harbour','harbor'], ['harbours','harbors'],
    ['odour','odor'], ['odours','odors'],
    ['labour','labor'], ['labours','labors'],
    ['saviour','savior'], ['saviours','saviors'],
    ['valour','valor'], ['valours','valors'],
    ['vapour','vapor'], ['vapours','vapors'],
    ['centre','center'], ['centres','centers'],
    ['metre','meter'], ['metres','meters'],
    ['litre','liter'], ['litres','liters'],
    ['theatre','theater'], ['theatres','theaters'],
    ['fibre','fiber'], ['fibres','fibers'],
    ['sabre','saber'], ['sabres','sabers'],
    ['defence','defense'], ['licence','license'], ['offence','offense'], ['pretence','pretense'],
    ['catalogue','catalog'], ['dialogue','dialog'],
    ['analyse','analyze'], ['organise','organize'], ['recognise','recognize'], ['paralyse','paralyze']
  ]);

  function spellingVariants(t){
    const out = new Set([t]);
    const m = UK_US_MAP.get(t);
    if (m) out.add(m);

    if (t.endsWith('ise')) out.add(t.slice(0,-3)+'ize');
    if (t.endsWith('yse')) out.add(t.slice(0,-3)+'yze');
    if (t.endsWith('re') && t.length>3) out.add(t.slice(0,-2)+'er');

    if (t.includes('ae')) out.add(t.replace(/ae/g,'e'));
    if (t.includes('oe')) out.add(t.replace(/oe/g,'e'));
    return out;
  }

  // robust singulars (keeps original token too)
  function singularVariants(t){
    const out = new Set([t]);

    if (t.endsWith('ves') && t.length>3){
      out.add(t.slice(0,-3)+'f');
      out.add(t.slice(0,-3)+'fe');
    }
    if (t.endsWith('oes') && t.length>3){
      out.add(t.slice(0,-3)+'o');
    }
    if (t.endsWith('ies') && t.length>3){
      out.add(t.slice(0,-3)+'y');
    }
    if (/(ches|shes|xes|zes|sses|ses|ces)$/.test(t)){
      out.add(t.slice(0,-2));
    }
    if (t.endsWith('s') && !t.endsWith('ss')){
      out.add(t.slice(0,-1));
    }
    return out;
  }

  function pluralVariants(t){
    const out = new Set([t]);
    if (/[bcdfghjklmnpqrstvwxyz]y$/.test(t)){
      out.add(t.slice(0,-1)+'ies');
    }
    if (/[aeiou]o$/.test(t) || /[^aeiou]o$/.test(t)){
      out.add(t+'es');
    }
    if (/(ch|sh|x|z|s)$/.test(t)){
      out.add(t+'es');
    }
    out.add(t+'s');
    return out;
  }

  function expandToken(t){
    const set = new Set();
    for (const v of spellingVariants(t)) {
      for (const s of singularVariants(v)) {
        set.add(s);
        for (const p of pluralVariants(s)) set.add(p);
      }
      for (const p of pluralVariants(v)) set.add(p);
    }
    return set;
  }

  const STOP_TOKENS = new Set(['model','old','new','entry','the','of','and']);
  function expandedComparableTokens(s){
    const base = splitTokens(s);
    const out = new Set();
    for (const t of base){
      if (STOP_TOKENS.has(t)) continue;
      for (const v of expandToken(t)) if (v && !STOP_TOKENS.has(v)) out.add(v);
    }
    return [...out];
  }

  function extractCalibers(text){
    const out=new Set(); const t=(text||'');
    const multi=[...t.matchAll(/\.(\d{2,3})[ \-_–—]?(?:x|by)?[ \-_–—]?(\d{1,2})/gi)];
    for(const m of multi){ out.add(`${m[1]}_${m[2]}`); }
    const single=[...t.matchAll(/\.(\d{2,3})/g)];
    for(const m of single){ out.add(m[1]); }
    const paren=[...t.matchAll(/\(([^)]*)\)/g)];
    for(const m of paren){
      [...m[1].matchAll(/\.(\d{2,3})/g)].forEach(x=>out.add(x[1]));
      const hy=[...m[1].matchAll(/(\d{2,3})[ \-_–—]+(\d{1,2})/g)];
      for(const x of hy){ out.add(`${x[1]}_${x[2]}`); }
    }
    return out;
  }

  const levenshtein=(a,b)=>{
    a=a||''; b=b||'';
    const m=a.length,n=b.length;
    if(!m) return n; if(!n) return m;
    const dp=new Array((m+1)*(n+1));
    const at=(i,j)=>i*(n+1)+j;
    for(let i=0;i<=m;i++) dp[at(i,0)]=i;
    for(let j=0;j<=n;j++) dp[at(0,j)]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const c=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
        dp[at(i,j)]=Math.min(dp[at(i-1,j)]+1, dp[at(i,j-1)]+1, dp[at(i-1,j-1)]+c);
      }
    }
    return dp[at(m,n)];
  };
  const baseSimilarity=(A,B)=>{
    const a=norm(A), b=norm(B);
    if(!a && !b) return 1;
    if(!a || !b) return 0;
    const d=levenshtein(a,b);
    return 1 - d / Math.max(a.length,b.length);
  };
  function jaccardExpanded(A,B){
    const a=new Set(expandedComparableTokens(A)), b=new Set(expandedComparableTokens(B));
    if(!a.size && !b.size) return 1;
    const inter=[...a].filter(x=>b.has(x)).length;
    const uni=new Set([...a,...b]).size;
    return inter/uni;
  }
  function char3grams(s){
    const t=norm(s); const arr=[]; for(let i=0;i<t.length-2;i++) arr.push(t.slice(i,i+3));
    return new Set(arr);
  }
  function gramsOverlap(A,B){
    const a=char3grams(A), b=char3grams(B);
    if(!a.size && !b.size) return 1;
    const inter=[...a].filter(x=>b.has(x)).length;
    const uni=new Set([...a,...b]).size;
    return inter/uni;
  }
  function tokenCoverageExpanded(name, candBase){
    const nameT = new Set(expandedComparableTokens(name));
    if (!nameT.size) return 0;
    const candT = new Set(expandedComparableTokens(candBase));
    let hit=0; for(const t of nameT){ if(candT.has(t)) hit++; }
    return hit / nameT.size;
  }
  function isPluralish(text){
    const toks = splitTokens(text);
    let s=0, n=0;
    for(const t of toks){ n++; if(t.endsWith('s') && !t.endsWith('ss')) s++; }
    return n>0 && s>=Math.ceil(n/2);
  }

  /* ---------------- Image index & matching ---------------- */
  let imageIndex=[];
  async function loadImageIndex(){
    try{
      const url=chrome?.runtime?.getURL?chrome.runtime.getURL('inventory/index.json'):'inventory/index.json';
      const res=await fetch(url); if(!res.ok) throw 0;
      const arr=await res.json();
      if(Array.isArray(arr)){
        imageIndex = arr
          .filter(s=>typeof s==='string')
          .map(file=>{
            const base=file.replace(/\.[^.]+$/,'');
            return {
              file,
              baseNorm: norm(base),
              tokens: splitTokens(base),
              morph: expandedComparableTokens(base),
              digits: onlyDigits(base),
              calibers: extractCalibers(base),
              pluralish: isPluralish(base)
            };
          });
      }
    }catch{ imageIndex=[]; }
  }

const fallbackWords = {
  /* =========================
     FIREARMS — HANDGUNS (specific first)
     ========================= */
  colt_peacemaker: ['colt_single_action_army','colt_peacemaker','colt_saa','peacemaker','saa','colt_1873'],
  colt_paterson: ['colt_paterson','paterson'],
  colt_walker: ['colt_walker','walker_colt'],
  remington_1875: ['remington_1875','remington_model_1875'],
  s_w_schofield: ['schofield','s&w_schofield','smith_wesson_schofield'],
  s_w_model_1: ['s&w_model_1','smith_wesson_model_1','model_1'],
  s_w_model_2: ['s&w_model_2','smith_wesson_model_2','model_2'],
  colt_python: ['colt_python','python_revolver'],
  derringer: ['derringer','palm_pistol','vest_pocket_pistol'],
  pepperbox: ['pepperbox','pepper_box'],
  dueling_pistol: ['dueling_pistol','duelling_pistol'],
  flare_pistol: ['flare_pistol'],
  signal_pistol: ['signal_pistol'],
  revolver: ['revolver','six_shooter','sixgun','wheelgun'],
  pistol: ['pistol','handgun','sidearm','auto_pistol','automatic_pistol','semi_auto_pistol'],
  deagle: ['deagle','desert_eagle','desert-eagle'],

  /* =========================
     FIREARMS — LONG GUNS (specific before generic)
     ========================= */
  winchester_1873: ['winchester_model_1873','winchester_1873','winchester_73','winchester_‘73','winchester_73'],
  winchester_1892: ['winchester_model_1892','winchester_1892'],
  henry_44_rifle: ['henry_rifle','henry_.44','henry'],
  sharps_rifle: ['sharps_rifle','sharps'],
  spencer_rifle: ['spencer_rifle','spencer'],
  springfield_58_rifle: ['springfield_58','springfield_.58','springfield_musket'],
  enfield_musket: ['enfield_musket','enfield'],
  brown_bess_musket: ['brown_bess','brown_bess_musket'],
  m1_rifle: ['m1_rifle','m1_garand'],
  m16: ['m16','m16a1','ar15_m16'],
  m16_a2: ['m16a2'],
  m4a1: ['m4a1','m4'],
  ka_74: ['ka_74','ak74','ak_74'],
  ka_m: ['ka_m','akm','ak_m'],
  ka_101: ['ka_101','ak101','ak_101'],
  pk_mg: ['pkm','pk_mg'],
  fn_scar: ['fn_scar','scar'],
  hunting_rifle: ['hunting_rifle','bolt_action','long_gun'],
  winchester_lever_action: ['lever_action','lever_action_rifle','lever-gun'],
  battle_rifle: ['battle_rifle'],
  sniper_rifle: ['sniper_rifle','sniper','marksman_rifle','dmr'],
  shotgun: ['shotgun'],
  rifle: ['rifle','long_rifle'],

  /* =========================
     SMGs / PISTOL-CALIBER
     ========================= */
  mini_uzi: ['mini_uzi','mini_uzi_smg'],
  uzi: ['uzi','uzi_smg'],
  sg5_k: ['sg5_k','mp5k','mp5_k'],
  smg: ['smg','submachine_gun'],

  /* =========================
     SCI-FI / ENERGY WEAPONS
     ========================= */
  gauss_rifle: ['gauss_rifle','coilgun'],
  railgun: ['railgun'],
  laser_pistol: ['laser_pistol','beam_pistol'],
  laser_rifle: ['laser_rifle','beam_rifle'],
  plasma_pistol: ['plasma_pistol'],
  plasma_rifle: ['plasma_rifle'],
  ion_blaster: ['ion_blaster','ion_pistol'],
  energy_cell: ['energy_cell','microfusion_cell','power_cell'],

  /* =========================
     SHOTGUNS (specific first)
     ========================= */
  coach_gun: ['coach_gun','coachgun','double_barrel','double_barreled','side_by_side'],
  double_barrel_shotgun: ['double_barrel_shotgun','double_shotgun'],
  pump_shotgun_icon: ['pump_shotgun','pump_action'],
  folding_shotgun: ['folding_shotgun'],
  single_barrel_shotgun: ['single_barrel_shotgun'],
  sawed_off_shotgun: ['sawed_off_shotgun','sawn_off_shotgun','sawed_off'],

  /* =========================
     BOWS / CROSSBOWS & THROWN
     ========================= */
  toy_crossbow: ['toy_crossbow'],
  crossbow: ['crossbow','xbow'],
  composite_longbow: ['composite_longbow','composite_long bow'],
  composite_bow: ['composite_bow'],
  recurve_bow: ['recurve_bow','recurve'],
  longbow: ['longbow','long bow'],
  shortbow: ['short bow','shortbow'],
  bow: ['bow'],
  arrow: ['arrow','arrows'],
  fire_arrow: ['fire_arrow','flame_arrow'],
  poison_arrow: ['poison_arrow','venom_arrow'],
  lightning_arrow: ['lightning_arrow','shock_arrow'],
  quiver: ['quiver'],
  arrows_quiver: ['arrows_quiver','arrow_quiver'],
  bolts_quiver: ['bolts_quiver','bolt_quiver'],

  throwing_hatchet: ['throwing_hatchet','throwing_axe'],
  throwing_knives: ['throwing_knives','throwing_knife','throwers'],
  shuriken: ['shuriken','throwing_star','throwing_stars'],
  kunai: ['kunai'],
  bolas: ['bolas'],
  net: ['net','throwing_net','cast_net','snare_net'],

  bo_staff: ['bo_staff','bo'],
  three_section_staff: ['three_section_staff','three_section','san_set_kon'],
  nunchaku: ['nunchaku','nunchucks','nunchuks'],
  sai: ['sai'],
  tonfa: ['tonfa'],
  kama: ['kama'],
  chain_whip: ['chain_whip'],
  meteor_hammer: ['meteor_hammer'],

  /* =========================
     BLADES / BLUNT / POLEARMS
     ========================= */
  bowie_knife: ['bowie_knife','bowie'],
  machete: ['machete'],
  kitchen_knife: ['kitchen_knife','chef_knife','cook_knife'],
  hunting_knife: ['hunting_knife','sheath_knife','field_knife','skin_knife','skinning_knife'],
  pocket_knife: ['pocket_knife','folding_knife','folder'],
  steak_knife: ['steak_knife'],
  dagger: ['dagger','dirk','main_gauche'],
  stiletto: ['stiletto'],
  switchblade: ['switchblade','automatic_knife','auto_knife'],
  cleaver: ['cleaver','butchers_cleaver'],
  kukri: ['kukri'],
  kris: ['kris','keris'],

  club: ['club','cudgel'],
  baton: ['baton','truncheon'],
  sledgehammer: ['sledgehammer','sledge_hammer','sledge'],
  war_hammer: ['war_hammer','warhammer'],
  mace: ['mace','morning_star'],
  flail: ['flail'],

  tomahawk: ['tomahawk'],
  hatchet: ['hatchet','camp_hatchet','hand_axe'],
  small_axe: ['small_axe','small_ax'],
  battle_axe: ['battle_axe','battleaxe'],
  great_axe: ['great_axe','greataxe'],

  spear: ['spear'],
  pike: ['pike'],
  halberd: ['halberd'],
  glaive: ['glaive'],
  naginata: ['naginata'],
  lance: ['lance'],
  trident: ['trident'],
  scythe: ['scythe'],

  rapier: ['rapier'],
  saber: ['saber'],
  sabre: ['sabre'],
  katana: ['katana'],
  wakizashi: ['wakizashi'],
  cutlass: ['cutlass'],
  scimitar: ['scimitar'],
  claymore: ['claymore'],
  zweihander: ['zweihander'],
  broadsword: ['broadsword'],
  longsword: ['longsword'],
  greatsword: ['greatsword'],
  short_sword: ['short_sword','shortsword'],
  sword_cane: ['sword_cane','cane_sword','shikomizue'],
  sword: ['sword'],
  weapon: ['weapon','armament'],

  /* =========================
     AMMO / MAGS / LOADERS
     ========================= */
  ammunition: ['ammo','ammunition','rounds','bullets','cartridges','shells'],
  shotgun_ammo: ['shotgun_ammo','shotshells','buckshot_shells','slug_shells'],
  clip: ['clip','stripper_clip','en_bloc'],
  speedloader: ['speedloader'],
  snaploader: ['snaploader'],
  magazine: ['magazine','mag','box_mag','detachable_mag'],
  drum_mag: ['drum_mag','drum'],
  coupled_mag: ['coupled_mag','coupled_mags'],
  beta_c_mag: ['beta_c_mag','c_mag'],

  cal_22_lr: ['.22lr','.22_lr','22lr','22_long_rifle'],
  cal_22_wmr: ['.22_wmr','22_wmr','22_magnum'],
  cal_25_acp: ['.25_acp','25_acp'],
  cal_32_acp: ['.32_acp','32_acp'],
  cal_357_magnum: ['.357','.357_magnum','357_magnum'],
  cal_357_sig: ['.357_sig','357_sig'],
  cal_38_special: ['.38_special','38_special'],
  cal_380_acp: ['.380_acp','380_acp','.380','.380'],
  cal_40_s_w: ['.40_s&w','.40_sw','40_s&w','40sw'],
  cal_44_magnum: ['.44_mag','.44_magnum','44_magnum'],
  cal_45_acp: ['.45_acp','45_acp'],
  cal_45_colt: ['.45_colt','45_colt','.45_long_colt','45_long_colt'],
  cal_308_win: ['.308','.308_win','308_win','7.62x51','7.62x51mm','7.62_nato'],
  cal_30_06: ['.30_06','30_06','30-06'],
  cal_300_winmag: ['.300_win_mag','300_win_mag','300wm'],
  cal_338_lapua: ['.338_lapua','338_lapua','338_lm'],
  cal_50_bmg: ['.50_bmg','50_bmg'],
  cal_556: ['5.56','5.56mm','5.56x45','5.56x45mm'],
  cal_545: ['5.45','5.45mm','5.45x39','5.45x39mm'],
  cal_762x39: ['7.62x39','7.62x39mm'],
  cal_762x54r: ['7.62x54r','7.62x54mmr'],
  cal_762_generic: ['7.62mm','7.62'],
  cal_9mm: ['9mm','9x19','9x19mm','parabellum'],
  cal_9x39: ['9x39','9x39mm'],
  cal_10mm: ['10mm'],
  cal_12g: ['12g','12_gauge','12ga','12_ga'],

  /* =========================
     EXPLOSIVES & ORDNANCE
     ========================= */
  grenade: ['grenade','frag_grenade','explosive_grenade'],
  smoke_grenade_white: ['smoke_grenade','smoke_canister'],
  flashbang: ['flashbang','flash_bang','stun_grenade'],
  tear_gas: ['tear_gas','gas_grenade'],
  dynamite: ['dynamite','dynamite_stick','dynamite_bundle'],
  land_mine: ['land_mine','mine'],
  claymore_mine: ['claymore_mine'],
  c_4: ['c4','c_4','plastic_explosive'],
  satchel_charge: ['satchel_charge','demo_charge'],
  molotov_cocktail: ['molotov','molotov_cocktail'],
  grenade_40mm: ['40mm_grenade','gp25_grenade','m203_grenade'],
  rpg_7: ['rpg_7','rpg','rocket_launcher'],

  /* =========================
     GUN ACCESSORIES / OPTICS
     ========================= */
  scope: ['scope','optic','rifle_scope'],
  marksman_scope: ['marksman_scope'],
  handgun_scope: ['handgun_scope','pistol_scope'],
  retractable_scope: ['retractable_scope'],
  red_dot: ['red_dot','reflex_sight'],
  holo_sight: ['holo_sight','holographic_sight'],
  backup_iron_sights: ['backup_iron_sights','bis'],
  silencer: ['silencer','suppressor'],
  laser_sight: ['laser_sight','laser'],
  bipod: ['bipod'],
  sling: ['sling'],

  /* =========================
     TOOLS (CORE)
     ========================= */
  adjustable_wrench: ['adjustable_wrench','crescent_wrench','monkey_wrench'],
  pipe_wrench: ['pipe_wrench','stilson'],
  wrench: ['wrench','spanner'],
  screwdriver: ['screwdriver','driver'],
  crowbar: ['crowbar','prybar','wrecking_bar'],
  hammer: ['hammer','claw_hammer'],
  mallet: ['mallet'],
  pickaxe: ['pickaxe','pick_ax'],
  mining_pick: ['mining_pick','miners_pick'],
  ice_axe: ['ice_axe'],
  shovel: ['shovel','spade'],
  field_shovel: ['field_shovel','entrenching_tool','e_tool'],
  trowel: ['trowel','garden_trowel'],
  hoe: ['hoe','farming_hoe'],
  rake: ['rake','garden_rake'],
  saw: ['saw','handsaw'],
  hacksaw: ['hacksaw'],
  drill: ['drill','hand_drill','power_drill'],
  auger: ['auger'],
  chisel: ['chisel','cold_chisel'],
  file: ['file'],
  rasp: ['rasp'],
  pliers: ['pliers','linemans_pliers','needle_nose'],
  wire_cutter: ['wire_cutter','wire_cutters'],
  bolt_cutters: ['bolt_cutters','bolt_cutter'],
  tongs: ['tongs'],
  vise: ['vise','bench_vise'],
  anvil: ['anvil'],
  bellows: ['bellows'],
  crucible: ['crucible'],
  whetstone: ['whetstone','sharpening_stone','hone'],
  multitool: ['multitool','multi_tool','leatherman'],
  measuring_tape: ['measuring_tape','tape_measure','measuring_tape'],
  level_tool: ['level','spirit_level'],

  /* =========================
     CLIMB / RIG / LIFT
     ========================= */
  block_and_tackle: ['block_and_tackle','pulley_system','tackle_block'],
  winch: ['winch','hand_winch','come_along','hoist_winch'],
  pulley: ['pulley','sheave','snatch_block','pulley_wheel'],
  swivel: ['swivel','swivel_hook'],
  grappling_gun: ['grappling_gun','grapple_gun','launcher_grapple'],
  grappling_hook: ['grappling_hook','grapple_hook','grapnel'],
  carabiner: ['carabiner','karabiner','snap_hook','snaplink'],
  piton: ['piton','pitons'],
  rope: ['rope','hemp_rope','climbing_rope','rope_coil'],
  lasso: ['lasso','riata','reata'],

  /* =========================
     LIGHT / FIRE / SIGNALS & NAV
     ========================= */
  flashlight: ['flashlight','flash_light','electric_torch','torchlight'],
  lantern: ['lantern','bullseye_lantern'],
  oil_lamps: ['oil_lamp','oil_lamps'],
  kerosene_lamp: ['kerosene_lamp','paraffin_lamp'],
  lamp_oil: ['lamp_oil'],
  candle: ['candle','wax_candle'],
  flint_and_steel: ['flint_and_steel','flint_steel'],
  tinderbox: ['tinderbox','firestarter'],
  matchbox: ['matchbox'],
  matches: ['matches'],
  match: ['match'],
  road_flare: ['road_flare','signal_flare','signal_flair'],
  smoke_bomb: ['smoke_bomb'],
  fireworks: ['fireworks'],

  telegraph_key: ['telegraph_key','morse_key','straight_key'],
  sextant: ['sextant','mariner_sextant'],
  sundial: ['sundial','sun_dial'],
  barometer: ['barometer'],
  thermometer: ['thermometer'],
  anemometer: ['anemometer'],
  geiger_counter: ['geiger_counter'],
  compass: ['compass','magnetic_compass','hand_compass'],
  drafting_compass: ['drafting_compass','pair_of_compasses','divider_compass'],
  map: ['map','map_of'],
  chart: ['chart','nautical_chart'],
  atlas: ['atlas'],
  terrain_maps: ['terrain_map','terrain_maps'],
  magnifying_glass: ['magnifying_glass','hand_lens','magnifier','magnifying_lens'],
  spyglass: ['spyglass','spy_glass'],
  spyglass_alt: ['spyglass_scope'],
  binoculars: ['binoculars','field_glasses','binocs','binos'],
  telescope: ['telescope'],
  signal_mirror: ['signal_mirror','heliograph'],

  /* =========================
     ELECTRONICS / COMMUNICATION / COMPUTING
     ========================= */
  radio: ['radio'],
  walkie_talkie: ['walkie_talkie','handheld_radio','two_way_radio'],
  transceiver: ['transceiver'],
  headset: ['headset','headphones_mic'],
  headphones: ['headphones','earbuds'],
  microphone: ['microphone','mic'],
  camera: ['camera'],
  video_camera: ['video_camera','camcorder'],
  gps: ['gps','gps_receiver'],
  smartphone: ['smartphone','cellphone','mobile_phone'],
  tablet: ['tablet'],
  laptop: ['laptop','notebook_pc'],
  console: ['game_console','console'],
  controller: ['game_controller','controller'],
  vr_headset: ['vr_headset'],
  usb_drive: ['usb_drive','flash_drive','thumb_drive','usb_stick'],
  memory_card: ['memory_card','sd_card','micro_sd'],
  hard_drive: ['hard_drive','external_drive','hdd','ssd'],
  microchip: ['microchip','chip','integrated_circuit'],
  battery_aa: ['aa_battery','battery_aa'],
  battery_aaa: ['aaa_battery','battery_aaa'],
  battery_9v: ['9v_battery','battery_9v'],
  flashlight_battery: ['batteries','battery_pack'],
  power_generator: ['generator','power_generator'],

  /* =========================
     CARRY / CONTAINERS
     ========================= */
  backpack: ['backpack','rucksack','pack'],
  satchel: ['satchel','shoulder_bag','messenger_bag'],
  duffel_bag: ['duffel_bag','duffle_bag'],
  waist_bag: ['waist_bag','belt_bag','fanny_pack'],
  hip_pack: ['hip_pack'],
  sling_bag: ['sling_bag'],
  pouch: ['pouch'],
  pouches: ['pouches'],
  holster: ['holster'],
  chest_holster: ['chest_holster'],
  saddlebag: ['saddlebag','saddlebags'],
  ammo_box: ['ammo_box','box_of_ammo','cartridge_box'],
  briefcase: ['briefcase','case'],
  lockbox: ['lockbox','strongbox'],
  safe: ['safe'],
  box: ['box','crate'],
  chest: ['chest','treasure_chest'],
  canteen: ['canteen'],
  waterskin: ['waterskin','water_skin'],
  flask: ['flask'],
  bottle: ['bottle','water_bottle'],
  jar: ['jar'],
  vial: ['vial'],
  jug: ['jug'],
  barrel: ['barrel','cask'],
  sack: ['sack','bag'],
  coin_purse: ['coin_purse','purse'],
  toolbox: ['toolbox','tool_box'],

  /* =========================
     CAMP / FOOD / WATER / COOK
     ========================= */
  bedroll: ['bedroll','bed_roll'],
  sleeping_bag: ['sleeping_bag'],
  tent: ['tent'],
  blanket: ['blanket'],
  frying_pan: ['frying_pan','fry_pan','skillet'],
  cooking_pot: ['cooking_pot','cook_pot','cauldron'],
  kettle: ['kettle','tea_kettle'],
  ladle: ['ladle'],
  spatula: ['spatula'],
  fork_utensil: ['fork','table_fork'],
  spoon: ['spoon','table_spoon'],
  knife_table: ['table_knife','dinner_knife'],
  plate: ['plate'],
  bowl: ['bowl'],
  mug: ['mug','cup'],
  coffee_pot: ['coffee_pot','percolator'],
  coffee_beans: ['coffee_beans','bag_of_coffee_beans'],
  tea: ['tea','tea_leaves'],
  rations: ['rations','ration'],
  hardtack: ['hardtack','hardtack_biscuit'],
  salt_pork: ['salt_pork'],
  jerky: ['jerky','meat_jerky'],
  sardines: ['sardines','sardines_tin','tinned_sardines'],
  oysters_tin: ['oysters_tin','tinned_oysters'],
  water_filter: ['water_filter','filter_straw'],
  water_purifier: ['water_purifier'],
  water_purification_tablets: ['water_purification_tablets','purification_tablets'],
  filtering_bottle: ['filtering_bottle'],
  can_opener: ['can_opener','tin_opener'],
  food: ['food','provisions','rations_food'],
  drink: ['drink','beverage'],
  bread: ['bread','loaf'],
  cheese: ['cheese','cheese_wheel'],
  meat: ['meat','raw_meat'],
  fish: ['fish'],
  fruit: ['fruit'],
  vegetable: ['vegetable','veggies'],
  candy: ['candy','sweets'],
  chocolate: ['chocolate','chocolate_bar'],
  beer: ['beer','lager','ale','stout'],
  wine: ['wine'],
  whiskey: ['whiskey','whisky'],
  rum: ['rum'],
  vodka: ['vodka'],
  gin: ['gin'],
  tequila: ['tequila'],
  coffee: ['coffee'],

  /* =========================
     MEDICAL / ALCHEMY
     ========================= */
  bandage: ['bandage','bandages'],
  selfmade_bandage: ['field_bandage','improvised_bandage'],
  medkit: ['medkit','medical_kit','first_aid_kit'],
  doctors_bag: ['doctors_bag','doctor_bag'],
  first_aid_pouch: ['first_aid_pouch','aid_pouch'],
  antiseptic: ['antiseptic'],
  disinfectant_spray: ['disinfectant_spray','disinfectant'],
  iodine_tincture: ['iodine_tincture'],
  painkiller: ['painkiller','pain_killers','analgesic'],
  morphine: ['morphine','morphine_syringe'],
  stimpak: ['stimpak','stimpack'],
  epinephrine_auto_injector: ['epinephrine','epi_pen','auto_injector'],
  tourniquet: ['tourniquet'],
  suture_kit: ['suture_kit','sutures'],
  syringe: ['syringe'],
  scalpel: ['scalpel','surgical_scalpel'],
  surgical_tools: ['surgical_tools','surgery_tools'],
  gauze_mask: ['gauze_mask','face_mask'],
  gas_mask: ['gas_mask'],
  respirator: ['respirator'],
  gas_mask_filter: ['gas_mask_filter'],
  laudanum: ['laudanum'],
  quinine: ['quinine'],
  ipecac: ['ipecac'],
  strychnine: ['strychnine'],
  arsenic: ['arsenic'],
  tetracycline: ['tetracycline','tetracycline_pills'],
  antidote: ['antidote','antivenom'],
  tonic: ['tonic','elixir','draught'],
  potion: ['potion'],
  elixir: ['elixir'],
  salve: ['salve','ointment','balm'],
  poultice: ['poultice'],
  herbs: ['herbs','medicinal_herbs'],
  bandage_scissors: ['bandage_scissors','trauma_shears'],

  /* =========================
     BLACK POWDER / MAINTENANCE
     ========================= */
  powder_horn: ['powder_horn','priming_horn'],
  gunpowder: ['gunpowder','black_powder','smokepowder'],
  bullet_mold: ['bullet_mold'],
  gun_cleaning_kit: ['gun_cleaning_kit','weapon_cleaning_kit','cleaning_kit'],
  gun_oil: ['gun_oil','weapon_oil'],
  solvent: ['solvent','cleaning_solvent'],

  /* =========================
     OCCULT / RELICS / JEWELRY
     ========================= */
  tarot_deck: ['tarot_deck','tarot'],
  ouija_board: ['ouija_board','spirit_board'],
  crystal_ball: ['crystal_ball'],
  rune_stones: ['rune_stones','rune_stone'],
  voodoo_doll: ['voodoo_doll'],
  talisman: ['talisman'],
  amulet: ['amulet'],
  charm: ['charm'],
  relic: ['relic','artifact'],
  idol: ['idol','statuette'],
  effigy: ['effigy'],
  mask: ['mask'],
  rosary: ['rosary'],
  holy_symbol: ['holy_symbol'],
  holy_water: ['holy_water'],
  silver_cross: ['silver_cross','cross_necklace'],
  ring: ['ring','signet_ring'],
  bracelet: ['bracelet','bangle'],
  necklace: ['necklace','pendant','locket'],
  earrings: ['earrings','earring'],
  circlet: ['circlet','diadem'],
  brooch: ['brooch','pin_brooch'],

  /* =========================
     DOCUMENTS / CURRENCY
     ========================= */
  bible: ['bible','holy_bible'],
  book: ['book','tome','grimoire','codex'],
  scroll: ['scroll','parchment_scroll'],
  almanac: ['almanac'],
  dictionary: ['dictionary'],
  law_book: ['law_book'],
  wanted_poster: ['wanted_poster','wanted_notice','wanted'],
  birth_certificate: ['birth_certificate'],
  death_certificate: ['death_certificate'],
  passport: ['passport'],
  visa: ['visa'],
  letter_of_credit: ['letter_of_credit'],
  deed: ['deed','land_deed'],
  map_case: ['map_case'],
  ledger: ['ledger','account_book'],
  journal: ['journal','diary','logbook'],
  note: ['note','letter'],
  blueprint: ['blueprint','schematic','plan','plans'],
  certificate: ['certificate'],
  id_card: ['id_card','identification_card','identity_card'],
  bank_note: ['bank_note','banknote','bill'],
  coin: ['coin','coins','gold_coin','gold_coins'],
  casino_chip: ['casino_chip','poker_chip','chip'],
  money_clip: ['money_clip'],
  credit_card: ['credit_card','debit_card'],
  travel_permit: ['travel_permit'],

  /* =========================
     CLOTHING / ARMOR (HEAD–TO–TOE)
     ========================= */
  cowboy_hat: ['cowboy_hat','stetson','ten_gallon_hat'],
  bowler_hat: ['bowler_hat'],
  top_hat: ['top_hat'],
  bonnet_hat: ['bonnet','bonnet_hat'],
  bandana: ['bandana'],
  balaclava: ['balaclava'],
  helmet: ['helmet','helm'],
  combat_helmet: ['combat_helmet'],
  welding_mask: ['welding_mask','welding_helmet'],
  hockey_mask: ['hockey_mask'],
  hood: ['hood'],
  cap: ['cap','flat_cap'],
  goggles: ['goggles','tactical_goggles'],
  eyewear: ['glasses','spectacles','eyeglasses','sunglasses'],

  cloak: ['cloak','cape'],
  robe: ['robe'],
  coat: ['coat','overcoat','trenchcoat','duster'],
  jacket: ['jacket'],
  shirt: ['shirt','tunic'],
  pants: ['pants','trousers','slacks'],
  skirt: ['skirt'],
  dress: ['dress'],
  belt: ['belt','girdle','sash'],
  gloves: ['gloves','gauntlets'],
  bracers: ['bracers','vambraces'],
  boots: ['boots'],
  shoes: ['shoes','footwear'],
  sandals: ['sandals'],
  slippers: ['slippers'],

  buckler: ['buckler'],
  shield: ['shield','kite_shield','tower_shield','heater_shield','round_shield'],
  riot_shield: ['riot_shield'],
  armor: ['armor','armour'],
  leather_armor: ['leather_armor','studded_leather'],
  hide_armor: ['hide_armor'],
  chainmail: ['chainmail','chain_mail','mail'],
  scale_mail: ['scale_mail','scale_armor'],
  splint_armor: ['splint_armor','splint_mail'],
  breastplate: ['breastplate','cuirass'],
  plate_armor: ['plate_armor','full_plate'],
  ballistic_vest: ['ballistic_vest','body_armor'],

  /* =========================
     ANIMALS / RANCH
     ========================= */
  horse: ['horse'],
  saddle: ['saddle'],
  horseshoe: ['horseshoes','horse_shoes','horse_shoe'],
  bridle: ['bridle','reins','bit'],

  /* =========================
     MUSICAL INSTRUMENTS
     ========================= */
  harmonica: ['harmonica','mouth_harp'],
  acoustic_guitar: ['guitar','acoustic_guitar'],
  banjo: ['banjo'],
  violin: ['violin','fiddle'],
  trumpet: ['trumpet'],
  accordion: ['accordion'],
  flute: ['flute'],
  drum: ['drum','hand_drum'],

  /* =========================
     LAB / FORGE / SCIENCE
     ========================= */
  alembic: ['alembic'],
  retort: ['retort'],
  beaker: ['beaker'],
  test_tube: ['test_tube','tube'],
  bunsen_burner: ['bunsen_burner'],
  mortar_pestle: ['mortar_and_pestle','mortar_pestle'],
  microscope: ['microscope'],
  condenser: ['condenser'],
  crucible_lab: ['crucible'],
  distillation_apparatus: ['distillation_apparatus'],
  tongs_lab: ['tongs'],
  pipette: ['pipette','dropper'],

  /* =========================
     CRAFTING MATERIALS / COMPONENTS
     ========================= */
  wood: ['wood','lumber','timber'],
  log: ['log','wood_log'],
  plank: ['plank','board'],
  stone: ['stone','rock'],
  brick: ['brick'],
  clay: ['clay'],
  sand: ['sand'],
  gravel: ['gravel'],
  glass: ['glass'],
  coal: ['coal'],
  charcoal: ['charcoal'],
  resin: ['resin','sap'],
  tar: ['tar','bitumen','pitch'],
  wax: ['wax','beeswax'],
  leather: ['leather','hide'],
  pelt: ['pelt','fur_pelt','animal_pelt'],
  fur: ['fur','furs'],
  bone_material: ['bone','bones'],
  horn: ['horn','antler'],
  feather: ['feather','feathers'],
  wool: ['wool'],
  cotton: ['cotton'],
  silk: ['silk'],
  hemp: ['hemp'],
  thread: ['thread'],
  yarn: ['yarn'],
  cloth: ['cloth','fabric','textile'],
  rope_material: ['rope','cordage','line'],
  dye: ['dye','pigment'],
  paint: ['paint'],
  glue: ['glue','adhesive','epoxy'],
  oil: ['oil','lubricant'],
  grease: ['grease'],
  rubber: ['rubber'],
  plastic: ['plastic','plastics','polymer'],
  paper: ['paper','parchment','vellum'],

  ore: ['ore','raw_ore'],
  ingot: ['ingot','bar'],
  scrap_metal: ['scrap_metal','metal_scrap'],
  nails: ['nails','nail'],
  screws: ['screws','screw'],
  bolts: ['bolts','bolt_fastener'],
  nuts: ['nuts','nut_fastener'],
  rivet: ['rivet','rivets'],
  wire: ['wire'],
  chain: ['chain'],
  spring: ['spring','coil_spring'],
  gear: ['gear','cog'],
  hinge: ['hinge'],
  buckle: ['buckle'],
  magnet: ['magnet'],

  gold_ingot: ['gold_ingot','gold_bar'],
  silver_ingot: ['silver_ingot','silver_bar'],
  copper_ingot: ['copper_ingot','copper_bar'],
  iron_ingot: ['iron_ingot','iron_bar'],
  steel_ingot: ['steel_ingot','steel_bar'],

  gemstone: ['gemstone','gem','precious_stone'],
  diamond: ['diamond'],
  ruby: ['ruby'],
  sapphire: ['sapphire'],
  emerald: ['emerald'],
  amethyst: ['amethyst'],
  topaz: ['topaz'],
  opal: ['opal'],
  quartz: ['quartz','rock_crystal'],

  /* =========================
     HUNT / FISH / NATURE
     ========================= */
  fishing_rod: ['fishing_rod','rod'],
  fishing_hook: ['fishing_hook','fish_hook'],
  fishing_net: ['fishing_net','net'],
  fish_hook_set: ['fishing_hooks','hooks'],
  trap_snare: ['snare','snare_trap'],
  bear_trap: ['bear_trap'],
  tripwire: ['tripwire'],
  bait: ['bait','lure'],
  antler_trophy: ['antler','trophy_antler'],

  /* =========================
     TRAPS / DEFENSE
     ========================= */
  caltrops: ['caltrops'],
  booby_trap: ['booby_trap','improvised_trap'],
  spike_plank: ['spiked_plank','spike_plank'],
  barricade: ['barricade','makeshift_barrier'],

  /* =========================
     WRITING / STATIONERY
     ========================= */
  quill: ['quill','feather_quill'],
  ink: ['ink'],
  inkwell: ['inkwell','ink_well'],
  pen: ['pen','fountain_pen'],
  pencil: ['pencil'],
  eraser: ['eraser'],
  chalk: ['chalk','white_chalk'],
  ruler: ['ruler','yardstick'],
  compass_drafting: ['drafting_compass','divider_compass'],
  notebook: ['notebook'],
  sketchbook: ['sketchbook'],
  envelope: ['envelope'],
  stamp: ['stamp'],

  /* =========================
     HOUSEHOLD / FURNISHINGS (carryable)
     ========================= */
  candle_holder: ['candlestick','candle_holder'],
  mirror: ['mirror'],
  picture_frame: ['picture_frame','photo_frame'],
  clock: ['clock','alarm_clock'],
  watch: ['watch','wristwatch'],
  pocket_watch: ['pocket_watch'],
  umbrella: ['umbrella'],
  sewing_kit: ['sewing_kit','needle_and_thread'],
  thimble: ['thimble'],
  scissors: ['scissors','shears'],
  comb: ['comb'],
  brush: ['brush','hairbrush'],
  soap: ['soap'],
  towel: ['towel'],
  bucket: ['bucket','pail'],
  broom: ['broom'],
  mop: ['mop'],
  key: ['key','skeleton_key'],
  keycard: ['keycard','key_card'],
  padlock: ['padlock'],
  combination_lock: ['combination_lock'],
  lockpick: ['lockpick','lock_picks','lockpicks','pick_set'],

  /* =========================
     VEHICLE PARTS (CARRYABLE)
     ========================= */
  wheel: ['wheel'],
  tire: ['tire','tyre'],
  axle: ['axle'],
  spark_plug: ['spark_plug'],
  fuel_can: ['fuel_can','jerry_can'],
  motor_oil: ['motor_oil'],
  car_battery: ['car_battery'],

  /* =========================
     FANTASY / MAGIC ARCHETYPES
     ========================= */
  wand: ['wand','magic_wand'],
  staff: ['staff','wizard_staff'],
  rod: ['rod','scepter','sceptre'],
  grimoire: ['grimoire','spellbook','spell_book'],
  scroll_spell: ['spell_scroll','scroll_of'],
  rune: ['rune','runestone'],
  talismanic_focus: ['focus','arcane_focus'],
  totem_spirit: ['totem','spirit_totem'],
  charm_luck: ['charm_luck','good_luck_charm'],
  wardstone: ['wardstone','keystone'],

  /* =========================
     SCI-FI / SPACE GEAR
     ========================= */
  datapad: ['datapad','data_pad','tablet_terminal'],
  holotape: ['holotape','data_tape'],
  communicator: ['communicator','commlink','comm_link'],
  med_hypo: ['hypo_spray','hypospray'],
  stim_injector: ['stim_injector','stim'],
  exosuit: ['exosuit','powered_armor'],
  spacesuit: ['spacesuit','space_suit'],
  oxygen_tank: ['oxygen_tank','o2_tank'],
  radiation_meter: ['dosimeter','radiation_meter'],

  /* =========================
     MISC HIGH-CONFIDENCE (kept & expanded)
     ========================= */
  whistle: ['whistle'],
  tripod: ['tripod'],
  rock_hammer: ['rock_hammer','geologist_hammer'],
  magnifier: ['magnifier'],
  pocket_watch_keep: ['pocket_watch'],
  ghost_rock: ['ghost rock'],

  /* =========================
     ULTRA-GENERIC LAST-RESORT (use sparingly)
     ========================= */
  tool: ['tool','hand_tool'],
  container: ['container','receptacle'],
  clothing: ['clothing','garment'],
  footwear: ['footwear'],
  headwear: ['headwear'],
  jewelry: ['jewelry','jewellery'],
  material: ['material','resource'],
  consumable: ['consumable'],
  ingredient: ['ingredient','component'],
  document: ['document','paperwork'],
  currency: ['currency','money'],
  food_generic: ['food'],
  drink_generic: ['drink','beverage'],
  armor_generic: ['armor','armour'],
  weapon_generic: ['weapon','armament']
};
  const BOOST_TOKENS = new Set([
    'colt','peacemaker','dragoon','paterson','thunderer','lightning','navy','army','buntline',
    'winchester','spencer','sharps','sharp_s','springfield','starr','lemat','pepperbox','derringer',
    'revolving','shotgun','musket','revolver','sporter','carbine','lever','action'
  ]);
  function prefixPenalty(nameTokens, candTokens){
    for(const nt of nameTokens){
      for(const ct of candTokens){
        if(nt!==ct && (nt.startsWith(ct) || ct.startsWith(nt))){
          return 0.88;
        }
      }
    }
    return 1;
  }

  function scoreCandidate(itemDisplayName, cand, caliberCtx=''){
    const bareName = stripParens(itemDisplayName);
    const nameTokens = splitTokens(bareName);

    const sBase     = baseSimilarity(bareName, cand.baseNorm);
    const sJaccard  = jaccardExpanded(bareName, cand.baseNorm);
    const s3g       = gramsOverlap(bareName, cand.baseNorm);
    const cov       = tokenCoverageExpanded(bareName, cand.baseNorm);

    const fullCtx = (caliberCtx ? (itemDisplayName + ' ' + caliberCtx) : itemDisplayName);
    const nameCal = extractCalibers(fullCtx);
    let calibScore=0;
    if (nameCal.size) {
      let hits=0; for(const c of nameCal){ if(cand.calibers.has(c) || cand.baseNorm.includes(c)) hits++; }
      calibScore = Math.min(1, hits / Math.max(1,nameCal.size));
    } else {
      const nDigits = onlyDigits(fullCtx);
      calibScore = (nDigits && cand.digits) ? (nDigits===cand.digits ? 1 : (cand.digits.includes(nDigits)||nDigits.includes(cand.digits) ? 0.65 : 0)) : 0;
    }

    let boost=0, boostedAny=false;
    for(const nt of nameTokens){
      if(BOOST_TOKENS.has(nt) && cand.tokens.includes(nt)){ boost += 0.05; boostedAny=true; }
    }
    if(!boostedAny){
      if(/\b(revolver|pistol|shotgun|rifle|carbine|musket|derringer|pepperbox)\b/.test(bareName.replace(/_/g,' '))){
        const any = cand.tokens.some(t=>/revolver|pistol|shotgun|rifle|carbine|musket|derringer|pepperbox/.test(t));
        if (any) boost += 0.04;
      }
    }

    const itemPluralish = isPluralish(bareName);
    const pluralBonus = (itemPluralish === cand.pluralish) ? 0.02 : 0;

    let score = (0.32*sBase) + (0.24*sJaccard) + (0.12*s3g) + (0.16*calibScore) + (0.14*cov) + (0.02*boost) + pluralBonus;

    score *= prefixPenalty(nameTokens, cand.tokens);

    if (sBase >= 0.93) score += 0.03;
    if (sJaccard >= 0.55 && calibScore >= 0.58) score += 0.03;
    if (cov >= 0.80) score += 0.03;

    return Math.max(0, Math.min(1, score));
  }

  function findBestImageCandidate(itemDisplayName, descHint=''){
    if (!imageIndex.length) return null;
    let best=null, bestScore=0;
    for (const it of imageIndex) {
      const sc = scoreCandidate(itemDisplayName, it, descHint);
      if (sc > bestScore) { bestScore = sc; best = it; }
      if (sc >= 0.999) break;
    }
    if (!best) return null;

    const bareName = stripParens(itemDisplayName);
    const sBase = baseSimilarity(bareName, best.baseNorm);
    const sJac  = jaccardExpanded(bareName, best.baseNorm);
    const cov   = tokenCoverageExpanded(bareName, best.baseNorm);

    const fullCtx = itemDisplayName + (descHint ? (' ' + descHint) : '');
    const nameCal = extractCalibers(fullCtx);
    let calAlign = 0;
    if (nameCal.size) {
      let hit=0; for(const c of nameCal){ if(best.calibers.has(c) || best.baseNorm.includes(c)) hit++; }
      calAlign = Math.min(1, hit / Math.max(1,nameCal.size));
    } else {
      const nDigits = onlyDigits(fullCtx);
      calAlign = (nDigits && best.digits) ? (nDigits===best.digits ? 1 : (best.digits.includes(nDigits)||nDigits.includes(best.digits) ? 0.65 : 0)) : 0;
    }

    const accept = (
      (sBase >= 0.76 && cov >= 0.42) ||
      (bestScore >= 0.64) ||
      (sJac >= 0.45 && calAlign >= 0.55) ||
      (cov >= 0.73) ||
      (sJac >= 0.95) || (cov >= 0.95)
    );

    if (accept) {
      const path = 'inventory/' + best.file;
      return chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path;
    }
    return null;
  }

  function searchImagesByQuery(query, limit=5){
    if(!query) return [];
    if(!imageIndex.length) return [];
    const scored = imageIndex.map(c => ({ cand:c, score: scoreCandidate(stripParens(query), c, query) }));
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0,limit).filter(x=>x.score>=0.45).map(x=>x.cand);
  }

  /* ---------------- STRICT TOKEN MATCHING FOR FALLBACK (no substrings) ---------------- */
  const _fbTokenRxCache = new Map();
  function _hasWholeUnderscoreToken(base, seq){
    if (!seq) return false;
    const s = norm(seq);
    let rx = _fbTokenRxCache.get(s);
    if (!rx){
      rx = new RegExp(`(?:^|_)${s}(?:_|$)`);
      _fbTokenRxCache.set(s, rx);
    }
    return rx.test(base);
  }

  function fallbackImageByKeyword(keyword){
    if (!keyword || !imageIndex.length) return null;
    const base = norm(stripParens(keyword));
    for (const [generic, list] of Object.entries(fallbackWords)) {
      if (list.some(w => _hasWholeUnderscoreToken(base, w))) {
        const hit = imageIndex.find(x => x.baseNorm === generic);
        if (hit) {
          const p = 'inventory/' + hit.file;
          return chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : p;
        }
      }
    }
    return null;
  }

  /* ---------------- Claim Ticket helpers ---------------- */
  const CLAIM_REGEX = /(^|[^a-z])claim\s+ticket(s)?([^a-z]|$)/i;
  const CLAIM_IMG_1 = 'inventory/claim ticket.webp';
  const CLAIM_IMG_2 = 'inventory/claim_ticket.webp';
  const TICKET_PALETTE = [
    '#ff5a5f','#ff9500','#ffcc00','#34c759','#64d2ff','#007aff','#5856d6','#ff2d55',
    '#30b0c7','#a2845e','#ff7eb6','#8e8e93','#ffd60a','#0a84ff'
  ];
  function isClaimTicketName(name){
    const s = stripParens(name).toLowerCase();
    return CLAIM_REGEX.test(' '+s+' ');
  }
  function nextTicketColor(){
    const used = new Set();
    for(const it of Object.values(state.items)) if(it.ticket && it.ticketColor) used.add(it.ticketColor);
    for(const c of TICKET_PALETTE) if(!used.has(c)) return c;
    const idx = used.size;
    const hue = (idx*47)%360;
    return `hsl(${hue}deg 80% 60%)`;
  }
  function createTicketItem(displayName, desc=''){
    const key = 'ticket_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
    const color = nextTicketColor();
    const now = Date.now();
    state.items[key] = {
      key, name: displayName, desc: desc||'',
      count: 1, category: 'Other', type: 'Other',
      ticket: true, ticketColor: color,
      emoji: null,
      img: 'claim ticket.webp',
      appearanceLabel: 'claim ticket.webp',
      textAppearance: '', forceTextAppearance: false,
      createdAt: now, updatedAt: now
    };
    return key;
  }
  function removeOneTicket(){
    const keys = Object.keys(state.items).filter(k=>state.items[k].ticket);
    if(!keys.length) return false;
    const del = keys.sort((a,b)=>a.localeCompare(b)).pop();
    delete state.items[del];
    return true;
  }

  /* ---------------- Overlay shell ---------------- */
  const overlay=document.createElement('div');
  overlay.id=ROOT_ID; overlay.style.cssText='position:fixed;right:20px;bottom:20px;width:560px;height:640px;z-index:2147483647;display:flex;flex-direction:column;pointer-events:none';
  document.documentElement.appendChild(overlay);

  const shell=document.createElement('div');
  shell.style.cssText='position:absolute;inset:0;pointer-events:auto;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.65);border-radius:0;overflow:hidden;background:transparent;box-shadow:0 10px 24px rgba(0,0,0,.35)';
  overlay.appendChild(shell);

  const topBar=document.createElement('div');
  topBar.style.cssText='height:36px;background:rgba(18,18,18,.9);color:#fff;display:flex;align-items:center;gap:8px;padding:0 10px;cursor:move;user-select:none';
  topBar.innerHTML=`
    <div style="font-weight:700;">Inventory</div>
    <div style="margin-left:auto; display:flex; gap:8px; align-items:center">
      <button id="gx-inv-panel-btn" title="Toggle Panel" style="background:#333;border:1px solid #444;color:#fff;padding:4px 8px;cursor:pointer;">Panel</button>
      <button id="gx-inv-min" title="Minimize" style="background:#333;border:1px solid #444;color:#fff;padding:4px 8px;cursor:pointer;">–</button>
      <button id="gx-inv-close" title="Close" style="background:#333;border:1px solid #444;color:#fff;padding:4px 8px;cursor:pointer;">✕</button>
    </div>`;
  shell.appendChild(topBar);

  const resizer=document.createElement('div');
  resizer.style.cssText='position:absolute;width:16px;height:16px;right:2px;bottom:2px;cursor:nwse-resize;background:linear-gradient(135deg, transparent 50%, rgba(255,255,255,.6) 50%);pointer-events:auto';
  shell.appendChild(resizer);

  const frame=document.createElement('iframe');
  frame.title='Inventory'; frame.style.cssText='flex:1 1 auto;width:100%;height:100%;border:0;background:transparent';
  shell.appendChild(frame);

  // Drag window
  (()=>{let drag=false,sx=0,sy=0,sl=0,st=0;
    const down=(e)=>{ if(e.target.closest('#gx-inv-min,#gx-inv-close,#gx-inv-panel-btn')) return;
      drag=true;sx=e.clientX;sy=e.clientY;const r=overlay.getBoundingClientRect();sl=r.left;st=r.top;
      document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);e.preventDefault();};
    const move=(e)=>{ if(!drag) return; const dx=e.clientX-sx,dy=e.clientY-sy;
      overlay.style.left=clamp(sl+dx,0,window.innerWidth-overlay.offsetWidth)+'px';
      overlay.style.top =clamp(st+dy,0,window.innerHeight-overlay.offsetHeight)+'px';
      overlay.style.right='auto';overlay.style.bottom='auto';};
    const up=()=>{drag=false;document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);};
    topBar.addEventListener('mousedown',down);
  })();

  // Resize window
  (()=>{let resizing=false,sx=0,sy=0,sw=0,sh=0;
    resizer.addEventListener('mousedown',(e)=>{resizing=true;sx=e.clientX;sy=e.clientY;sw=overlay.offsetWidth;sh=overlay.offsetHeight;
      document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);e.preventDefault();});
    const move=(e)=>{ if(!resizing) return; overlay.style.width=Math.max(360,sw+(e.clientX-sx))+'px'; overlay.style.height=Math.max(360,sh+(e.clientY-sy))+'px'; };
    const up=()=>{resizing=false;document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);};
  })();

  const btnPanel=topBar.querySelector('#gx-inv-panel-btn');
  const btnMin=topBar.querySelector('#gx-inv-min');
  const btnClose=topBar.querySelector('#gx-inv-close');

  btnMin.addEventListener('click',()=>{shell.style.height=shell.style.height==='36px'?'100%':'36px';});
  btnClose.addEventListener('click',()=>{overlay.remove();window.__GX_INVENTORY_BOOTSTRAPPED__=false;});
  document.addEventListener('keydown',(e)=>{if(e.ctrlKey&&e.key==='['){e.preventDefault();topBar.style.display=(topBar.style.display==='none'?'flex':'none');}},true);

  function flashPanelButton(color){
    const c=color==='red'?'rgba(220,30,30,.55)':'rgba(30,200,90,.55)';
    const old=btnPanel.style.background;
    btnPanel.style.background=c;
    setTimeout(()=>{btnPanel.style.background=old||'#333';},700);
  }

  /* ---------------- State ---------------- */
  const DEFAULT_CATS=['All','Weapons','Ammo','Other'];
  let state=loadState()||{
    categories:[...DEFAULT_CATS],
    activeCategory:'All',
    items:{},
    pending:{adds:[],removes:[],guns:[]},
    errors:[],
    undoStack:[],
    panelHidden:false,
    autoImageMatchEnabled: true,
    sortMode: 'alpha',          // 'alpha' | 'recent' | 'custom'
    customOrder: {},            // per-category array of item keys
    searchQuery: ''             // live search filter
  };
  // fill missing (for older saved states)
  if (!state.sortMode) state.sortMode='alpha';
  if (!state.customOrder) state.customOrder={};
  if (typeof state.searchQuery !== 'string') state.searchQuery = '';

  const persist=()=>saveState(state);

  /* ---------------- Iframe DOM ---------------- */
  function buildIframe(){
    const idoc=frame.contentDocument; idoc.open(); idoc.write(`
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
:root{
  --bg-brown:#5b4636;
  --brown-dark:#3b2b20;
  --grid-gap:8px;--cell-size:96px;--panel-w:300px;--border-subtle:rgba(255,255,255,.18)
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:transparent;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial;
  scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.25) transparent;}
*::-webkit-scrollbar{width:8px;height:8px} *::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:6px} *::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.35)}

.app{height:100%;display:grid;grid-template-columns:1fr var(--panel-w)}
.left{display:flex;flex-direction:column;background:var(--bg-brown);overflow:hidden}

/* Tabs */
.tabs{display:flex;gap:0;padding:0;border-bottom:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.15);
      overflow-x:auto;white-space:nowrap;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.tab{padding:8px 10px;border-right:1px solid var(--border-subtle);background:rgba(0,0,0,.22);font-size:11px;cursor:pointer;user-select:none}
.tab:first-child{border-left:1px solid var(--border-subtle)} .tab.active{background:rgba(255,255,255,.10)} .tab:hover{background:rgba(255,255,255,.06)}

/* Toolbar */
.toolbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.12);font-size:12px}
.toolbar label{font-size:11px;opacity:.9}
.toolbar select{background:var(--brown-dark);border:1px solid #2a1f17;color:#fff;border-radius:0;padding:2px 6px;font-size:11px}
.toolbar .icon-btn{background:var(--brown-dark);border:1px solid #2a1f17;color:#fff;padding:2px 6px;cursor:pointer;border-radius:0}
.toolbar .search-input{background:var(--brown-dark);border:1px solid #2a1f17;color:#fff;border-radius:0;padding:2px 6px;font-size:11px;min-width:140px}

.grid-wrap{position:relative;flex:1 1 auto;padding:10px;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.panel{background:rgba(18,18,18,.92);border-left:1px solid rgba(255,255,255,.15);padding:8px;display:grid;grid-auto-rows:min-content;gap:10px;overflow:auto;
       scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}

.grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cell-size),1fr));grid-auto-rows:1fr;gap:var(--grid-gap);align-content:start}
.cell{position:relative;width:100%;aspect-ratio:1/1;border:1px solid rgba(255,255,255,.9);background:rgba(0,0,0,.6);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;user-select:none}
.cell.empty{opacity:.35;border-style:dashed}
.cell .img{max-width:90%;max-height:90%;object-fit:contain;image-rendering:-webkit-optimize-contrast;pointer-events:none}
.cell .emoji{font-size:calc(var(--cell-size)*.42);pointer-events:none}
.cell .bigtext{font-size:calc(var(--cell-size)*.18);line-height:1.05;text-align:center;padding:0 6px;pointer-events:none;word-break:break-word}
.cell .label{position:absolute;left:6px;right:6px;bottom:4px;font-size:10px;line-height:1.1;text-align:center;opacity:.9;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.7)}
/* count top-left */
.cell .count{position:absolute;top:3px;left:5px;background:rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.7);font-size:11px;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}
/* ammo overlay (guns) — right center */
.cell .ammoR{position:absolute;top:50%;right:5px;transform:translateY(-50%);background:rgba(0,0,0,.75);border:1px solid rgba(255,255,255,.7);font-size:11px;padding:1px 6px;border-radius:10px;min-width:26px;text-align:center}

/* dragging */
.cell.dragging{opacity:.6;outline:2px dashed rgba(255,255,255,.6)}
.cell.drop-target{box-shadow:inset 0 0 0 2px rgba(255,255,255,.9)}
/* insertion cues */
.cell.drop-before{box-shadow:inset 0 4px 0 0 rgba(255,255,255,.95)}
.cell.drop-after{box-shadow:inset 0 -4px 0 0 rgba(255,255,255,.95)}

.section h3{font-size:12px;text-transform:uppercase;opacity:.8;margin:6px 0}
.list{display:grid;gap:6px}
.row{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;font-size:12px}
.row .pill{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);padding:4px 6px;border-radius:6px}
.row button{background:#2e2e2e;border:1px solid #444;color:#fff;padding:4px 6px;border-radius:6px;cursor:pointer}
.btn-row{display:flex;gap:8px;flex-wrap:wrap}
.btn{background:#3a3a3a;border:1px solid #555;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer}
.sep{height:1px;background:rgba(255,255,255,.15);margin:4px 0}
.muted{opacity:.7;font-size:12px}
.textarea{width:100%;min-height:68px;background:#1f1f1f;border:1px solid #444;color:#fff;padding:8px;border-radius:6px}
.tooltip{position:absolute;padding:6px 8px;background:rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.2);font-size:12px;border-radius:6px;pointer-events:none;white-space:pre-wrap;max-width:280px;display:none}
.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center}
.modal{width:460px;background:#121212;border:1px solid #444;border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.modal label{display:block;font-size:12px;opacity:.85;margin:6px 0 2px}
.modal input,.modal select{width:100%;padding:6px 8px;background:#1f1f1f;border:1px solid #444;color:#fff;border-radius:6px}
.modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.modal .row2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.modal .searchRow{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}
.modal .results{margin-top:8px;display:grid;gap:6px}
.modal .result-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;background:#171717;border:1px solid #333;padding:6px;border-radius:6px;font-size:12px}
.modal .thumb{width:48px;height:48px;object-fit:contain;background:rgba(255,255,255,.06);border:1px solid #333;border-radius:6px}
.hidden{display:none !important}
.small{font-size:11px;opacity:.85}
</style></head>
<body>
  <div class="app">
    <div class="left">
      <div class="tabs" id="tabs"></div>
      <div class="toolbar">
        <label for="sortMode">Sort:</label>
        <select id="sortMode">
          <option value="alpha">Alphabetical</option>
          <option value="recent">Most Recent (Old→New)</option>
          <option value="custom">Custom (Drag)</option>
        </select>
        <div class="small muted" id="dragHint" style="margin-left:8px;"></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
          <button id="searchToggle" class="icon-btn" title="Search">🔍</button>
          <input id="searchInput" class="search-input hidden" placeholder="Search items…" />
        </div>
      </div>
      <div class="grid-wrap">
        <div class="grid" id="grid"></div>
        <div class="tooltip" id="tt"></div>
      </div>
    </div>
    <aside class="panel" id="panel">
      <div class="section">
        <h3>Change Review</h3>
        <div class="list" id="pending"></div>
        <div class="btn-row">
          <button class="btn" id="scanNow">Scan Now</button>
          <button class="btn" id="approve">Approve</button>
          <button class="btn" id="reject">Reject</button>
          <button class="btn" id="undo" title="Undo last approval">Undo</button>
        </div>
      </div>

      <div class="sep"></div>

      <div class="section">
        <h3>Errors & Mismatches</h3>
        <div class="list" id="errors"></div>
        <div class="btn-row">
          <button class="btn" id="dismissAllErrors">Dismiss All</button>
        </div>
      </div>

      <div class="sep"></div>

      <div class="section">
        <h3>Manual Add</h3>
        <label for="manName">Name</label>
        <input id="manName" placeholder="e.g., .45 ammo or Claim Ticket" />
        <label for="manDesc">Description (optional)</label>
        <input id="manDesc" placeholder="e.g., blue ink, shelf 3" />
        <div class="row2">
          <div>
            <label for="manCount">Count</label>
            <input id="manCount" type="number" min="1" step="1" value="1" />
          </div>
          <div style="grid-column: span 2;">
            <label for="manCat">Category</label>
            <select id="manCat"></select>
          </div>
        </div>
        <div class="btn-row" style="margin-top:6px;">
          <button class="btn" id="manAdd">Add Item(s)</button>
        </div>
      </div>

      <div class="sep"></div>

      <div class="section">
        <h3>Copy Panel</h3>
        <textarea id="base" class="textarea" placeholder="Optional base text..."></textarea>
        <div class="btn-row">
          <button class="btn" id="copy">Copy</button>
          <button class="btn" id="copyBase">Copy with Base</button>
          <button class="btn" id="toggleImport">Import</button>
        </div>
        <div id="importWrap" class="hidden">
          <textarea id="importText" class="textarea" placeholder="Paste list (Inventory/Weapons/Ammo/Items)…"></textarea>
          <div class="btn-row" style="margin-top:6px;">
            <button class="btn" id="importRun">Add to Inventory</button>
            <button class="btn" id="importClose">Close</button>
          </div>
          <div class="muted">Understands backticked names and descriptions in <code>*( ... )*</code> or trailing <code>( ... )</code>. Duplicates are grouped. <b>Claim Ticket</b> items never stack.</div>
        </div>
      </div>

      <div class="sep"></div>

      <div class="section">
        <h3>Images</h3>
        <div class="list">
          <label class="small"><input type="checkbox" id="imagesAuto"> Auto-match images (preview only; does not overwrite your manual choice)</label>
          <div class="btn-row">
            <button class="btn" id="imagesRematch">Rematch</button>
          </div>
          <div class="muted small">“Rematch” assigns best images permanently to items that don’t already have a custom appearance.</div>
        </div>
      </div>
    </aside>
  </div>

  <div class="modal-backdrop" id="assetModal">
    <div class="modal">
      <div style="font-weight:700; margin-bottom:6px;">Item Editor</div>
      <div class="muted">Appearance can be an emoji, an image filename (e.g. <code>pistol.png</code>), or a <b>text label</b> (e.g. <code>horsefeed</code>). Text label shows on the tile; hover still shows the original name.</div>

      <label for="assetInput">Appearance</label>
      <input id="assetInput" placeholder="🔫  or  pistol.png  or  horsefeed" />

      <label for="assetCategory">Category</label>
      <select id="assetCategory"></select>

      <div class="searchRow">
        <input id="assetSearch" placeholder="Find images by name/synonym (shows top 5)…" />
        <button class="btn" id="assetSearchBtn">Search</button>
      </div>
      <div class="results" id="assetResults"></div>

      <div class="btn-row" style="margin-top:8px;">
        <button class="btn" id="assetFindBest">Find Best Match</button>
        <button class="btn" id="plusOne">+1</button>
        <button class="btn" id="minusOne">–1</button>
        <button class="btn" id="deleteItem">Delete</button>
      </div>
      <div class="actions">
        <button class="btn" id="assetCancel">Close</button>
        <button class="btn" id="assetSave">Save</button>
      </div>
    </div>
  </div>
</body></html>`); idoc.close();
  }
  buildIframe();

  const idoc=frame.contentDocument, $=(id)=>idoc.getElementById(id);
  const UI={
    tabs:$('tabs'), gridWrap:idoc.querySelector('.grid-wrap'), grid:$('grid'), tooltip:$('tt'), panel:$('panel'),
    pending:$('pending'), errors:$('errors'), base:$('base'),
    approve:$('approve'), reject:$('reject'), scanNow:$('scanNow'), undo:$('undo'), dismissAllErrors:$('dismissAllErrors'),
    manName:$('manName'), manDesc:$('manDesc'), manCount:$('manCount'), manCat:$('manCat'), manAdd:$('manAdd'),
    toggleImport:$('toggleImport'), importWrap:$('importWrap'), importText:$('importText'), importRun:$('importRun'), importClose:$('importClose'),
    imagesAuto:$('imagesAuto'), imagesRematch:$('imagesRematch'),
    assetModal:$('assetModal'), assetInput:$('assetInput'), assetCategory:$('assetCategory'), assetCancel:$('assetCancel'), assetSave:$('assetSave'),
    assetFindBest:$('assetFindBest'), plusOne:$('plusOne'), minusOne:$('minusOne'), deleteItem:$('deleteItem'),
    assetSearch:$('assetSearch'), assetSearchBtn:$('assetSearchBtn'), assetResults:$('assetResults'),
    sortModeSelect:$('sortMode'), dragHint:$('dragHint'),
    searchToggle:$('searchToggle'), searchInput:$('searchInput'),
  };

  /* ---------------- Tabs ---------------- */
  function renderTabs(){
    UI.tabs.innerHTML='';
    for(const cat of state.categories){
      const t=idoc.createElement('div');
      t.className='tab'+(cat===state.activeCategory?' active':''); t.textContent=cat;
      if(!['All','Weapons','Ammo','Other'].includes(cat)) t.title='Double-click to rename';
      t.addEventListener('click',()=>{state.activeCategory=cat;renderGrid();renderTabs();persist();});
      if(!['All','Weapons','Ammo','Other'].includes(cat)){
        t.addEventListener('dblclick',()=>{const name=prompt('Rename category:',cat); if(!name)return;
          const i=state.categories.indexOf(cat); if(i>=0){state.categories[i]=name; if(state.activeCategory===cat)state.activeCategory=name;
            for(const k in state.items) if(state.items[k].category===cat) state.items[k].category=name; renderTabs();renderGrid();persist();}
        });
      }
      UI.tabs.appendChild(t);
    }
    const plus=idoc.createElement('div'); plus.className='tab'; plus.textContent='+'; plus.addEventListener('click',()=>{
      let base='New Category', name=base, n=2; while(state.categories.includes(name)) name=base+' '+(n++);
      state.categories.push(name); state.activeCategory=name; renderTabs(); renderGrid(); rebuildManualCat(); persist();
    });
    UI.tabs.appendChild(plus);
  }

  /* ---------------- Manual Add ---------------- */
  function rebuildManualCat(){ UI.manCat.innerHTML=''; for(const c of state.categories){ if(c==='All') continue; const o=idoc.createElement('option'); o.value=c;o.textContent=c; if(c==='Other')o.selected=true; UI.manCat.appendChild(o);} }
  UI.manAdd.addEventListener('click',()=>{const name=(UI.manName.value||'').trim(); if(!name) return alert('Enter a name.');
    const desc=(UI.manDesc.value||'').trim(); let count=Math.max(1,parseInt(UI.manCount.value,10)||1); const cat=UI.manCat.value||'Other';

    if (isClaimTicketName(name)) {
      for(let i=0;i<count;i++) createTicketItem(name, desc);
      persist(); renderGrid();
      UI.manName.value='';UI.manDesc.value='';UI.manCount.value='1';
      return;
    }

    const key=ensureItem(name,desc,cat);
    const it=state.items[key];
    it.count=(it.count||0)+count;
    it.updatedAt=Date.now();
    persist(); renderGrid(); UI.manName.value='';UI.manDesc.value='';UI.manCount.value='1';
  });

  /* ---------------- Item identity ---------------- */
  function keyFromNameExact(name){ return 'k_'+norm(name); }
  function isVeryCloseName(a,b){
    const A = stripParens(a), B = stripParens(b);
    const bs=baseSimilarity(A,B); const jac=jaccardExpanded(A,B);
    return (bs>=0.92 && jac>=0.62);
  }
  function findExistingKeyFor(name){
    const exact=keyFromNameExact(name);
    if (state.items[exact] && stripParens(state.items[exact].name)===stripParens(name)) return exact;

    for (const [k,v] of Object.entries(state.items)){
      if ((v.aliases||[]).some(alias=>stripParens(alias)===stripParens(name))) return k;
    }
    for (const [k,v] of Object.entries(state.items)){
      if (isVeryCloseName(v.name,name)) return k;
    }
    return null;
  }

  /* ---------------- Sort helpers, search, and drag reorder ---------------- */
  function ensureCustomOrder(cat, keys){
    const cur = state.customOrder[cat] || [];
    const set = new Set(cur);
    const out = cur.filter(k=>keys.includes(k)); // keep existing order that still exists
    for(const k of keys){ if(!set.has(k)) out.push(k); }
    state.customOrder[cat] = out;
  }
  function filteredItemsKeys(cat){
    const arr=Object.values(state.items).filter(it => (cat==='All' ? true : (it.category||it.type||'Other')===cat));
    return arr.map(it=>it.key);
  }
  function moveBeforeAfterInCategory(cat, fromKey, toKey, place/* 'before'|'after' */){
    const itemsKeys = filteredItemsKeys(cat);
    ensureCustomOrder(cat, itemsKeys);
    const arr = state.customOrder[cat].slice();
    const fi = arr.indexOf(fromKey);
    let ti = arr.indexOf(toKey);
    if (fi===-1 || ti===-1) return;
    // remove first
    arr.splice(fi,1);
    // re-locate target after removal
    ti = arr.indexOf(toKey);
    if (place==='after') ti = ti + 1;
    arr.splice(ti,0,fromKey);
    state.customOrder[cat] = arr;
    state.sortMode = 'custom';
    persist();
    renderGrid();
    flashPanelButton('green');
  }
  function swapInCategory(cat, aKey, bKey){
    const itemsKeys = filteredItemsKeys(cat);
    ensureCustomOrder(cat, itemsKeys);
    const arr = state.customOrder[cat].slice();
    const ia = arr.indexOf(aKey), ib = arr.indexOf(bKey);
    if (ia===-1 || ib===-1 || ia===ib) return;
    const tmp = arr[ia]; arr[ia]=arr[ib]; arr[ib]=tmp;
    state.customOrder[cat] = arr;
    state.sortMode = 'custom';
    persist();
    renderGrid();
    flashPanelButton('green');
  }
  function filteredItems(){
    // Filter by category
    let arr = Object.values(state.items).filter(it => (state.activeCategory==='All' ? true : (it.category||it.type||'Other')===state.activeCategory));
    // Apply live search (compact, token-based, insensitive)
    const q = (state.searchQuery||'').trim();
    if (!q) return arr;
    const toks = norm(q).split('_').filter(Boolean);
    if (!toks.length) return arr;
    return arr.filter(it=>{
      const hay = norm(((it.name)||'') + ' ' + ((it.desc)||'') + ' ' + ((it.appearanceLabel)||''));
      return toks.every(t => hay.includes(t));
    });
  }

  /* ---------------- Grid ---------------- */
  const MIN_CELL=56, MAX_CELL=128;
  function computeCellSize(n){const W=Math.max(240,UI.gridWrap.clientWidth-2), H=Math.max(240,UI.gridWrap.clientHeight-2), slots=Math.max(n,35);
    let best={size:64}; for(let cols=3;cols<=24;cols++){const rows=Math.ceil(slots/cols); let s=Math.floor(Math.min((W-(cols-1)*8)/cols,(H-(rows-1)*8)/Math.max(1,rows))); s=clamp(s,MIN_CELL,MAX_CELL); if(s>best.size) best={size:s};}
    UI.grid.style.setProperty('--cell-size',best.size+'px');
  }

  function attachTooltip(el,it){
    const show=()=>{const parts=[`Name: ${it.name}${it.count>1?` (Count: ${it.count})`:''}`]; if(it.desc)parts.push(`Desc: ${it.desc}`);
      if(it.appearanceLabel)parts.push(`Appearance: ${it.appearanceLabel}`); if(it.gun)parts.push(`Gun: ${it.gun.loaded}/${it.gun.cap}${it.gun.ammoType?`, ${it.gun.ammoType}`:''}`);
      UI.tooltip.textContent=parts.join('\n'); UI.tooltip.style.display='block';
      const r=el.getBoundingClientRect(), b=UI.gridWrap.getBoundingClientRect();
      const left = UI.gridWrap.scrollLeft + (r.left - b.left) + r.width/2;
      const top  = UI.gridWrap.scrollTop  + (r.top  - b.top)  - 12;
      const minY = UI.gridWrap.scrollTop + 6;
      const maxY = UI.gridWrap.scrollTop + UI.gridWrap.clientHeight - 6;
      UI.tooltip.style.left = clamp(left, 8, UI.gridWrap.scrollLeft + UI.gridWrap.clientWidth - 8) + 'px';
      UI.tooltip.style.top  = clamp(top,  minY, maxY) + 'px';
    };
    const hide=()=>{UI.tooltip.style.display='none';};
    el.addEventListener('mouseenter',show);
    el.addEventListener('mouseleave',hide);
    el.addEventListener('mousemove',show);
  }

  let assetTargetKey=null;
  function openAssetModal(key){assetTargetKey=key; UI.assetInput.value=state.items[key]?.appearanceLabel||''; UI.assetCategory.innerHTML='';
    for(const c of state.categories){ if(c==='All') continue; const o=idoc.createElement('option'); o.value=c;o.textContent=c; if(state.items[key]?.category===c)o.selected=true; UI.assetCategory.appendChild(o); }
    UI.assetResults.innerHTML='';
    UI.assetSearch.value='';
    UI.assetModal.style.display='flex';
  }
  function closeAssetModal(){assetTargetKey=null; UI.assetModal.style.display='none';}
  UI.assetCancel.addEventListener('click',closeAssetModal);

  function renderSearchResults(list){
    UI.assetResults.innerHTML='';
    if(!list.length){
      const d=idoc.createElement('div'); d.className='muted small'; d.textContent='No matches.'; UI.assetResults.appendChild(d); return;
    }
    for(const cand of list){
      const row=idoc.createElement('div'); row.className='result-item';
      const img=idoc.createElement('img');
      img.className='thumb';
      img.src = (chrome?.runtime?.getURL ? chrome.runtime.getURL('inventory/'+cand.file) : ('inventory/'+cand.file));
      img.alt = cand.file;
      const leftLabel=idoc.createElement('div'); leftLabel.textContent=cand.file;
      const btn=idoc.createElement('button'); btn.className='btn'; btn.textContent='Use';
      btn.addEventListener('click',()=>{
        if(!assetTargetKey) return;
        const it=state.items[assetTargetKey];
        const fileOnly=cand.file;
        it.img = fileOnly;
        it.emoji = null;
        it.forceTextAppearance = false;
        it.textAppearance = '';
        it.appearanceLabel = fileOnly;
        it.updatedAt=Date.now();
        persist(); renderGrid();
        alert(`Assigned "${fileOnly}" to "${it.name}".`);
      });
      row.appendChild(img);
      row.appendChild(leftLabel);
      row.appendChild(btn);
      UI.assetResults.appendChild(row);
    }
  }
  let searchTimer=null;
  UI.assetSearch.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      const q=UI.assetSearch.value.trim();
      const results = searchImagesByQuery(q,5);
      renderSearchResults(results);
    },150);
  });
  UI.assetSearchBtn.addEventListener('click',()=>{
    const q=UI.assetSearch.value.trim();
    const results = searchImagesByQuery(q,5);
    renderSearchResults(results);
  });

  UI.assetFindBest.addEventListener('click',()=>{
    if(!assetTargetKey) return;
    const it=state.items[assetTargetKey];
    const candidate = isClaimTicketName(it.name)
      ? (chrome?.runtime?.getURL ? chrome.runtime.getURL(CLAIM_IMG_1) : CLAIM_IMG_1)
      : (findBestImageCandidate(it.name, it.desc) || fallbackImageByKeyword(it.name));
    if(!candidate){ alert('No suitable image found in inventory/. Ensure inventory/index.json lists your files.'); return; }
    const fileOnly = candidate.replace(/^.*inventory\//,'');
    it.img = fileOnly;
    it.emoji = null;
    it.forceTextAppearance = false;
    it.textAppearance = '';
    it.appearanceLabel = fileOnly;
    it.updatedAt=Date.now();
    persist(); renderGrid();
    alert(`Matched "${it.name}" to "${fileOnly}".`);
  });

  UI.assetSave.addEventListener('click',()=>{const k=assetTargetKey; if(!k) return closeAssetModal(); const v=UI.assetInput.value.trim();
    if(v){const looksEmoji=/\p{Extended_Pictographic}/u.test(v);
      if(looksEmoji){state.items[k].emoji=v;state.items[k].img=null;state.items[k].appearanceLabel=v;state.items[k].forceTextAppearance=false;state.items[k].textAppearance='';}
      else if(/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(v)){state.items[k].img=v;state.items[k].emoji=null;state.items[k].appearanceLabel=v;state.items[k].forceTextAppearance=false;state.items[k].textAppearance='';}
      else {state.items[k].textAppearance=v;state.items[k].appearanceLabel=v;state.items[k].forceTextAppearance=true;state.items[k].emoji=null;}
    }
    if(UI.assetCategory.value){state.items[k].category=UI.assetCategory.value;state.items[k].type=UI.assetCategory.value;}
    state.items[k].updatedAt=Date.now();
    persist();renderGrid();closeAssetModal();
  });
  UI.plusOne.addEventListener('click',()=>{if(!assetTargetKey)return; const it=state.items[assetTargetKey]; it.count=(it.count||0)+1; it.updatedAt=Date.now(); persist(); renderGrid();});
  UI.minusOne.addEventListener('click',()=>{if(!assetTargetKey)return; const it=state.items[assetTargetKey]; it.count=Math.max(0,(it.count||0)-1); it.updatedAt=Date.now(); if(it.count===0) delete state.items[assetTargetKey]; persist(); renderGrid();});
  UI.deleteItem.addEventListener('click',()=>{if(!assetTargetKey)return; if(confirm(`Delete "${state.items[assetTargetKey]?.name}"?`)){delete state.items[assetTargetKey]; persist(); renderGrid(); closeAssetModal();}});

  function resolveImageFor(it){
    if (it.forceTextAppearance) return null;
    if (it.emoji) return null;

    if (it.ticket) {
      const p1 = chrome?.runtime?.getURL ? chrome.runtime.getURL(CLAIM_IMG_1) : CLAIM_IMG_1;
      const p2 = chrome?.runtime?.getURL ? chrome.runtime.getURL(CLAIM_IMG_2) : CLAIM_IMG_2;
      if (it.img && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(it.img)) {
        const base=it.img.replace(/^\.?\/?inventory\//,'');
        return chrome?.runtime?.getURL ? chrome.runtime.getURL('inventory/'+base) : ('inventory/'+base);
      }
      return p1 || p2;
    }

    if (it.img && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(it.img)) {
      const base=it.img.replace(/^\.?\/?inventory\//,'');
      const p='inventory/'+base;
      return chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : p;
    }

    if (state.autoImageMatchEnabled) {
      const specific = findBestImageCandidate(it.name, it.desc);
      if (specific) return specific;
      const fb2 = fallbackImageByKeyword(it.name);
      if (fb2) return fb2;
    }
    return null;
  }

  // sort + render
  function sortItemsForActiveCategory(items){
    const mode = state.sortMode || 'alpha';
    const cat = state.activeCategory;
    if (mode==='alpha'){
      return items.slice().sort((a,b)=>stripParens(a.name).localeCompare(stripParens(b.name)));
    } else if (mode==='recent'){
      return items.slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)); // Old → New
    } else { // custom
      const keys = items.map(i=>i.key);
      ensureCustomOrder(cat, keys);
      const order = state.customOrder[cat] || [];
      const idx = new Map(order.map((k,i)=>[k,i]));
      return items.slice().sort((a,b)=>{
        const ia = idx.has(a.key)?idx.get(a.key):Number.MAX_SAFE_INTEGER;
        const ib = idx.has(b.key)?idx.get(b.key):Number.MAX_SAFE_INTEGER;
        if (ia!==ib) return ia-ib;
        return stripParens(a.name).localeCompare(stripParens(b.name));
      });
    }
  }

  function renderGrid(){
    UI.grid.innerHTML='';

    // drag hint
    const searching = !!(state.searchQuery && state.searchQuery.trim());
    UI.dragHint.textContent = (state.sortMode==='custom')
      ? (searching ? 'Drag disabled while searching' : ' ')
      : '';

    let items=filteredItems();
    items = sortItemsForActiveCategory(items);

    const layoutCount=Math.max(items.length,35);
    computeCellSize(layoutCount);

    const allowDrag = state.sortMode==='custom' && !searching;
    const cat = state.activeCategory;

    for(const it of items){
      const imgResolved=resolveImageFor(it);
      const cell=idoc.createElement('div'); cell.className='cell'; cell.tabIndex=0;

      if (allowDrag){
        cell.draggable = true;
        cell.addEventListener('dragstart', (e)=>{ cell.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', it.key); });
        cell.addEventListener('dragend', ()=>{ cell.classList.remove('dragging'); UI.grid.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target','drop-before','drop-after')); });
        cell.addEventListener('dragover', (e)=>{
          e.preventDefault();
          e.dataTransfer.dropEffect='move';
          const r=cell.getBoundingClientRect();
          const before = (e.clientY - r.top) < (r.height/2);
          cell.classList.add('drop-target');
          cell.classList.toggle('drop-before', before);
          cell.classList.toggle('drop-after', !before);
        });
        cell.addEventListener('dragleave', ()=>{
          cell.classList.remove('drop-target','drop-before','drop-after');
        });
        cell.addEventListener('drop', (e)=>{
          e.preventDefault();
          const fromKey = e.dataTransfer.getData('text/plain');
          const toKey = it.key;
          const r = cell.getBoundingClientRect();
          const before = (e.clientY - r.top) < (r.height/2);
          UI.grid.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target','drop-before','drop-after'));
          if (fromKey && toKey && fromKey!==toKey){
            if (e.altKey) {
              swapInCategory(cat, fromKey, toKey);
            } else {
              moveBeforeAfterInCategory(cat, fromKey, toKey, before ? 'before' : 'after');
            }
          }
        });
      }

      if (it.ticket && it.ticketColor) {
        cell.style.border = `2px solid ${it.ticketColor}`;
        cell.style.boxShadow = `0 0 0 1px rgba(0,0,0,.6) inset`;
      }

      if(it.emoji){
        const em=idoc.createElement('div'); em.className='emoji'; em.textContent=it.emoji; cell.appendChild(em);
      } else if(it.forceTextAppearance && it.textAppearance){
        const bt=idoc.createElement('div'); bt.className='bigtext'; bt.textContent=it.textAppearance; cell.appendChild(bt);
      } else if(imgResolved){
        const img=idoc.createElement('img'); img.className='img'; img.src=imgResolved; img.alt=it.name; cell.appendChild(img);
      } else {
        const bt=idoc.createElement('div'); bt.className='bigtext'; bt.textContent=stripParens(it.name) || it.name; cell.appendChild(bt);
      }

      const label=idoc.createElement('div'); label.className='label'; label.textContent=it.name; cell.appendChild(label);
      const cnt=idoc.createElement('div'); cnt.className='count'; cnt.textContent=String(it.count??0); cell.appendChild(cnt);

      if (it.gun && Number.isFinite(it.gun.loaded) && Number.isFinite(it.gun.cap)) {
        const ammo=idoc.createElement('div'); ammo.className='ammoR'; ammo.textContent=`${it.gun.loaded}/${it.gun.cap}`; cell.appendChild(ammo);
      }

      attachTooltip(cell,it);

      const openEditor=(ev)=>{ev.preventDefault?.(); openAssetModal(it.key);};
      cell.addEventListener('click',(e)=>{if(e.shiftKey)openEditor(e);});
      cell.addEventListener('contextmenu',openEditor);

      UI.grid.appendChild(cell);
    }
    for(let i=Math.max(items.length,0);i<layoutCount;i++){const cell=idoc.createElement('div'); cell.className='cell empty'; UI.grid.appendChild(cell);}
  }
  new ResizeObserver(()=>computeCellSize(Math.max(filteredItems().length,35))).observe(UI.gridWrap);

  // sort selector behavior
  UI.sortModeSelect.value = state.sortMode || 'alpha';
  UI.sortModeSelect.addEventListener('change', ()=>{
    state.sortMode = UI.sortModeSelect.value;
    persist();
    renderGrid();
  });

  // search toggle + input
  UI.searchToggle.addEventListener('click', ()=>{
    UI.searchInput.classList.toggle('hidden');
    if (!UI.searchInput.classList.contains('hidden')) {
      UI.searchInput.focus();
      UI.searchInput.select();
    }
  });
  UI.searchInput.addEventListener('input', ()=>{
    state.searchQuery = UI.searchInput.value || '';
    persist();
    renderGrid();
  });
  UI.searchInput.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') {
      UI.searchInput.value = '';
      state.searchQuery = '';
      persist();
      UI.searchInput.classList.add('hidden');
      renderGrid();
    }
  });

  /* ---------------- Panel toggle ---------------- */
  function applyPanelVisibility(){UI.panel.style.display=state.panelHidden?'none':'grid'; idoc.querySelector('.app').style.gridTemplateColumns=state.panelHidden?'1fr 0px':'1fr var(--panel-w)';}
  topBar.querySelector('#gx-inv-panel-btn').addEventListener('click',()=>{state.panelHidden=!state.panelHidden; persist(); applyPanelVisibility();});

  /* ---------------- Pending & Errors ---------------- */
  function renderPending(){
    UI.pending.innerHTML=''; const nA=state.pending.adds.length,nR=state.pending.removes.length,nG=state.pending.guns.length;
    if(!(nA||nR||nG)){const m=idoc.createElement('div'); m.className='muted'; m.textContent='No pending changes.'; UI.pending.appendChild(m); return;}
    const addH=idoc.createElement('div'); addH.className='muted'; addH.textContent='Additions:'; UI.pending.appendChild(addH);
    state.pending.adds.forEach((p,i)=>{const row=idoc.createElement('div'); row.className='row'; const pill=idoc.createElement('div'); pill.className='pill';
      pill.textContent=p.name+(p.desc?` — ${p.desc}`:'')+(p.count&&p.count>1?` (Count: ${p.count})`:''); const x=idoc.createElement('button'); x.textContent='✕';
      x.addEventListener('click',()=>{state.pending.adds.splice(i,1); renderPending(); persist();}); row.appendChild(pill); row.appendChild(x); UI.pending.appendChild(row);});
    const remH=idoc.createElement('div'); remH.className='muted'; remH.style.marginTop='4px'; remH.textContent='Removals:'; UI.pending.appendChild(remH);
    state.pending.removes.forEach((p,i)=>{const row=idoc.createElement('div'); row.className='row'; const pill=idoc.createElement('div'); pill.className='pill';
      pill.textContent=p.name+(p.desc?` — ${p.desc}`:'')+(p.count&&p.count>1?` (Count: ${p.count})`:''); const x=idoc.createElement('button'); x.textContent='✕';
      x.addEventListener('click',()=>{state.pending.removes.splice(i,1); renderPending(); persist();}); row.appendChild(pill); row.appendChild(x); UI.pending.appendChild(row);});
    const gunH=idoc.createElement('div'); gunH.className='muted'; gunH.style.marginTop='4px'; gunH.textContent='Gun Changes:'; UI.pending.appendChild(gunH);
    state.pending.guns.forEach((g,i)=>{const row=idoc.createElement('div'); row.className='row'; const pill=idoc.createElement('div'); pill.className='pill';
      pill.textContent=`${g.name} → ${g.loaded}/${g.cap}`+(g.ammoType?` (${g.ammoType})`:''); const x=idoc.createElement('button'); x.textContent='✕';
      x.addEventListener('click',()=>{state.pending.guns.splice(i,1); renderPending(); persist();}); row.appendChild(pill); row.appendChild(x); UI.pending.appendChild(row);});
  }
  function renderErrors(){
    UI.errors.innerHTML=''; if(!state.errors.length){const m=idoc.createElement('div'); m.className='muted'; m.textContent='No errors.'; UI.errors.appendChild(m); return;}
    state.errors.forEach((err,idx)=>{ if(err.type==='gun-mismatch'){const row=idoc.createElement('div'); row.className='row';
      const sel=idoc.createElement('select'); const none=idoc.createElement('option'); none.value=''; none.textContent=`Match "${err.from}"…`; sel.appendChild(none);
      err.options.forEach(opt=>{const o=idoc.createElement('option'); o.value=opt.key; o.textContent=opt.name; sel.appendChild(o);});
      const btn=idoc.createElement('button'); btn.textContent='Match'; btn.addEventListener('click',()=>{const key=sel.value;if(!key)return; const tgt=state.items[key]; if(tgt) tgt.aliases=Array.from(new Set([...(tgt.aliases||[]), err.from])); state.errors.splice(idx,1); persist(); renderErrors();});
      row.appendChild(sel); row.appendChild(btn); UI.errors.appendChild(row); }});
  }
  UI.dismissAllErrors.addEventListener('click',()=>{state.errors=[]; persist(); renderErrors();});

  /* ---------------- Approve / Reject / Undo ---------------- */
  function ensureItem(name,desc,typeHint){
    let key = findExistingKeyFor(name);
    const now = Date.now();
    if (!key) key = keyFromNameExact(name);

    if(!state.items[key]){
      state.items[key]={key,name,count:0,desc:desc||'',category:typeHint||'Other',type:typeHint||'Other',
        emoji:null,img:null,appearanceLabel:'',textAppearance:'',forceTextAppearance:false,
        createdAt: now, updatedAt: now};
    } else {
      if(desc && !state.items[key].desc) state.items[key].desc=desc;
      state.items[key].updatedAt = now;
    }
    return key;
  }
  function guessType(name){
    const s=(stripParens(name)||'').toLowerCase();
    if(/\b(ammo|rounds|shells|bullets)\b/.test(s))return'Ammo';
    if(/\b(colt|pistol|handgun|revolver|shotgun|rifle|bow|carbine|musket|bowie|knife|sword|dagger|pepperbox|derringer)\b/.test(s))return'Weapons';
    return'Other';
  }
  function findClosestItemKey(name){
    const A = stripParens(name);
    let bestKey=null,best=-1;
    for(const k in state.items){
      const it=state.items[k];
      const B = stripParens(it.name);
      const bs=baseSimilarity(B,A);
      const jc=jaccardExpanded(B,A);
      const cov=tokenCoverageExpanded(B,A);
      const score = 0.50*bs + 0.32*jc + 0.18*cov;
      if(score>best){best=score;bestKey=k;}
    }
    return (best>=0.74) ? bestKey : null;
  }

  function applyPending(){
    const touched=new Set(); const snapshot={};
    const snapIfNeeded=(k)=>{ if(!touched.has(k)){ snapshot[k] = state.items[k] ? deepClone(state.items[k]) : null; touched.add(k);} };

    for(const a of state.pending.adds){
      if (isClaimTicketName(a.name)) continue;
      const type=a.type||guessType(a.name); const key=ensureItem(a.name,a.desc,type); snapIfNeeded(key);
    }
    for(const r of state.pending.removes){
      if (isClaimTicketName(r.name)) continue;
      const key=findClosestItemKey(r.name); if(key) snapIfNeeded(key);
    }
    for(const g of state.pending.guns){ let key=findClosestItemKey(g.name); if(!key){ key=ensureItem(g.name,'','Weapons'); } snapIfNeeded(key); }

    for(const a of state.pending.adds){
      const type=a.type||guessType(a.name);
      if (isClaimTicketName(a.name)) {
        const n = Math.max(1,parseInt(a.count,10)||1);
        for(let i=0;i<n;i++) createTicketItem(a.name, a.desc||'');
        continue;
      }
      const key=ensureItem(a.name,a.desc,type);
      const it=state.items[key];
      const inc=Math.max(1,parseInt(a.count,10)||1);
      it.count=(it.count||0)+inc;
      it.updatedAt=Date.now();
    }
    for(const r of state.pending.removes){
      const dec=Math.max(1,parseInt(r.count,10)||1);
      if (isClaimTicketName(r.name)) {
        for(let i=0;i<dec;i++) removeOneTicket();
        continue;
      }
      const key=findClosestItemKey(r.name);
      if(key&&state.items[key]){
        const it=state.items[key];
        it.count=Math.max(0,(it.count||0)-dec);
        it.updatedAt=Date.now();
        if(it.count===0) delete state.items[key];
      }
    }
    for(const g of state.pending.guns){
      let key=findClosestItemKey(g.name);
      if(!key){ key=ensureItem(g.name,'','Weapons'); state.items[key].count = state.items[key].count||1; }
      const it=state.items[key];
      it.type='Weapons'; it.category='Weapons';
      it.gun={loaded:g.loaded,cap:g.cap,ammoType:g.ammoType||it?.gun?.ammoType||''};
      it.updatedAt=Date.now();
    }

    state.undoStack.push({ snapshot });
    if (state.undoStack.length > 25) state.undoStack.shift();

    state.pending.adds.length=0; state.pending.removes.length=0; state.pending.guns.length=0;
    persist(); renderPending(); renderGrid(); renderErrors();
  }
  function rejectPending(){state.pending.adds=[];state.pending.removes=[];state.pending.guns=[];persist();renderPending();}
  function undoLast(){
    const rec = state.undoStack.pop();
    if (!rec || !rec.snapshot) return;
    const prev = rec.snapshot;
    for (const [k,prevVal] of Object.entries(prev)){
      if (prevVal === null) delete state.items[k];
      else state.items[k] = prevVal;
    }
    persist(); renderGrid(); renderPending(); renderErrors();
    flashPanelButton('green');
  }
  UI.approve.addEventListener('click',applyPending);
  UI.reject.addEventListener('click',rejectPending);
  UI.undo.addEventListener('click',undoLast);

  /* ---------------- Copy + Import ---------------- */
  function formatInventory(){
    const vals=Object.values(state.items);
    const money=vals.filter(x=>x.name&&(/^\$/.test(x.name)||/^¢/.test(x.name)));
    const weapons=vals.filter(x=>(x.type||x.category)==='Weapons');
    const ammo=vals.filter(x=>(x.type||x.category)==='Ammo');
    const others=vals.filter(x=>(x.type||x.category)!=='Weapons'&&(x.type||x.category)!=='Ammo'&&!(x.name&&(/^\$/.test(x.name)||/^¢/.test(x.name))));
    const lines=[];
    lines.push('Inventory:'); if(money.length) lines.push(money.map(m=>m.name).join(', '));
    lines.push('Weapons:');
    weapons.forEach(w=>{
      if(w.gun){
        lines.push(`${w.name} *(${w.desc?w.desc+', ':''}${w.gun.loaded}/${w.gun.cap} rounds loaded${w.gun.ammoType?', Ammo Type: '+w.gun.ammoType:''}${w.count>1?`, Count: ${w.count}`:''})*`);
      } else {
        lines.push(`${w.name}${w.desc?` *(${w.desc})*`:''}${w.count>1?` *(Count: ${w.count})*`:''}`);
      }
    });
    lines.push('Ammo:');
    ammo.forEach(a=>lines.push(`${a.name}${a.desc?` *(${a.desc})*`:''}${a.count>1?` *(Count: ${a.count})*`:''}`));
    lines.push('Items:');
    others.forEach(o=>lines.push(`${o.name}${o.desc?` *(${o.desc})*`:''}${o.count>1?` *(Count: ${o.count})*`:''}`));
    return lines.join('\n');
  }
  function copyToClipboard(text){(navigator.clipboard?.writeText(text)).catch(()=>{const ta=idoc.createElement('textarea'); ta.value=text; idoc.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch{} ta.remove();});}
  idoc.getElementById('copy').addEventListener('click',()=>copyToClipboard(`<inventory>\n${formatInventory()}\n</inventory>`));
  idoc.getElementById('copyBase').addEventListener('click',()=>copyToClipboard((UI.base.value||'')+`\n<inventory>\n${formatInventory()}\n</inventory>`));

  // Import UI
  UI.toggleImport.addEventListener('click',()=>{UI.importWrap.classList.toggle('hidden');});
  UI.importClose.addEventListener('click',()=>UI.importWrap.classList.add('hidden'));

  function splitOutsideParens(text){
    const out=[]; let cur='', depth=0;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='(') { depth++; cur+=ch; continue; }
      if(ch===')' && depth>0) { depth--; cur+=ch; continue; }
      if((ch===',' || ch===';' || ch==='•') && depth===0){
        if(cur.trim()) out.push(cur.trim());
        cur='';
        continue;
      }
      cur+=ch;
    }
    if(cur.trim()) out.push(cur.trim());
    return out;
  }

  function parsePayloadText(t){
    const txt=(t||'').trim(); const out={};
    const mCount=txt.match(/\bcount\s*:\s*(\d+)\b/i)||txt.match(/\b[x×]\s*(\d+)\b/i)||txt.match(/^\s*(\d+)\s*$/);
    if(mCount) out.count=parseInt(mCount[1],10);
    const parts=splitOutsideParens(txt).map(s=>s.trim()).filter(Boolean);
    for(const part of parts){const m=part.match(/\bcount\s*:\s*(\d+)\b/i); if(m) out.count=parseInt(m[1],10);}
    const desc=parts.filter(p=>!/\bcount\s*:/.test(p)&&!/^[x×]?\s*\d+$/.test(p)).join(', ').trim();
    if(desc) out.desc=desc;
    return out;
  }
  function parseLineNameAndDesc(line){
    const bt=line.match(/`([^`]+)`/); let name=null, rest=line;
    if(bt){name=bt[1].trim(); rest=line.replace(bt[0],'').trim();}
    if(!name){
      const idxA=rest.indexOf('*('), idxB=rest.lastIndexOf('(');
      if(idxA>0) name=rest.slice(0,idxA).trim();
      else if(idxB>0 && /\)\s*$/ .test(rest)) name=rest.slice(0,idxB).trim();
      else name=rest.trim();
    }
    let desc=''; let count=null;
    const mStar=rest.match(/\*\((.+?)\)\*/);
    const mPar =!mStar && rest.match(/\(([^()]*)\)\s*$/);
    const payload=mStar?parsePayloadText(mStar[1]):(mPar?parsePayloadText(mPar[1]):{});
    if(payload.desc) desc=payload.desc; if(payload.count) count=payload.count;
    name=name.replace(/^[•\-\s]+/,'').replace(/\s+[,;:]?\s*$/,'');
    return {name,desc,count};
  }

  function parseImport(text){
    const out=[]; let section='Other';
    (text||'').split(/\r?\n/).forEach(raw=>{
      const line=raw.trim(); if(!line) return;
      if(/^Inventory\s*:/i.test(line)) return;
      if(/^Weapons\s*:/i.test(line)){section='Weapons'; return;}
      if(/^Ammo\s*:/i.test(line)){section='Ammo'; return;}
      if(/^Items\s*:/i.test(line)){section='Other'; return;}
      if(/^\*{2}.+:\*{2}$/.test(line)) return;
      const {name,desc,count}=parseLineNameAndDesc(line);
      if(!name) return;
      const type=section==='Other'?'Other':section;
      out.push({name,desc,count:count||1,type});
    });

    const grouped=new Map();
    for(const it of out){
      if (isClaimTicketName(it.name)) {
        const key='__ticket__'+Math.random();
        grouped.set(key,{...it});
        continue;
      }
      const key=norm(stripParens(it.name))+'|'+it.type;
      const cur=grouped.get(key)||{...it,count:0};
      cur.count+=Math.max(1,parseInt(it.count,10)||1);
      if(it.desc && (!cur.desc || it.desc.length>cur.desc.length)) cur.desc=it.desc;
      grouped.set(key,cur);
    }
    return [...grouped.values()];
  }
  UI.importRun.addEventListener('click',()=>{
    const text=UI.importText.value||'';
    const items=parseImport(text);
    if(!items.length){alert('Nothing to import.'); return;}
    const now = Date.now();
    for(const a of items){
      if (isClaimTicketName(a.name)) {
        const n = Math.max(1,parseInt(a.count,10)||1);
        for(let i=0;i<n;i++) createTicketItem(a.name, a.desc||'');
        continue;
      }
      const key=ensureItem(a.name,a.desc,a.type);
      const it=state.items[key];
      it.count=(it.count||0)+(a.count||1);
      it.updatedAt=now;
      if(a.type==='Weapons' && a.desc){
        const m=a.desc.match(/\bShots?\s*:\s*(\d+)/i);
        if(m){ const cap=parseInt(m[1],10); it.gun={loaded:cap,cap,ammoType:it?.gun?.ammoType||''}; }
      }
    }
    persist(); renderGrid();
    UI.importText.value='';
    flashPanelButton('green');
  });

  /* ---------------- Images: toggle + rematch ---------------- */
  UI.imagesAuto.checked = !!state.autoImageMatchEnabled;
  UI.imagesAuto.addEventListener('change',()=>{
    state.autoImageMatchEnabled = !!UI.imagesAuto.checked;
    persist();
    renderGrid();
  });
  UI.imagesRematch.addEventListener('click',()=>{
    if (!imageIndex.length) { alert('No image index found. Place inventory/index.json listing image files.'); return; }
    let changed=0, skipped=0;
    for (const it of Object.values(state.items)) {
      if (it.ticket) continue;
      if (it.emoji || it.forceTextAppearance || (it.img && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(it.img))) { skipped++; continue; }
      const candidate = findBestImageCandidate(it.name, it.desc) || fallbackImageByKeyword(it.name);
      if (candidate) {
        const fileOnly = candidate.replace(/^.*inventory\//,'');
        it.img = fileOnly;
        it.appearanceLabel = fileOnly;
        it.forceTextAppearance = false;
        it.textAppearance = '';
        it.emoji = null;
        it.updatedAt=Date.now();
        changed++;
      } else {
        skipped++;
      }
    }
    persist();
    renderGrid();
    alert(`Rematch complete. Assigned images: ${changed}. Skipped: ${skipped}.`);
  });

  /* ---------------- Matrix parser (END marker + fixed splitting) ---------------- */
  const SCAN_MS=3000; let lastSignature='';
  const textOf=(el)=>(el?.innerText||el?.textContent||'').trim();

  const NOT_GUN_TERMS = [
    'wind','grit','head','gut','left arm','right arm','left leg','right leg','deftness','nimbleness','quickness',
    'strength','vigor','mental','corpoeal','corporeal','cognition','knowledge','mien','smarts','spirit','posse'
  ];
  function isNotGunLineStart(line){
    const s=(line||'').trim().toLowerCase();
    const head = s.split(':')[0].trim();
    return NOT_GUN_TERMS.some(t=> head===t);
  }

  function findLatestMatrixLines(){
    const ps=Array.from(document.querySelectorAll('p')); let last=-1;
    for(let i=0;i<ps.length;i++){ if(/Inventory Matrix:/i.test(textOf(ps[i]))) last=i; }
    if(last===-1) return null;
    const lines=[];
    for(let i=last;i<ps.length && lines.length<600;i++){
      const v=textOf(ps[i]); if(v) {
        lines.push(v);
        if(/^Inventory Matrix End\b/i.test(v)) break;
      }
      if(i>last && /Inventory Matrix:/i.test(v)) break;
    }
    return lines;
  }
  const isOnlyParenLine=(s)=>/^\*?\(.*\)\*?$/.test((s||'').trim());

  function parsePayloadTextForMatrix(t){ return parsePayloadText(t); }
  function parseItemLine(line){
    const raw=line; let name=line,desc='',count=null;
    let m=line.match(/\*(.*?)\*/); if(m){const p=parsePayloadTextForMatrix(m[1]); if(p.count)count=p.count; if(p.desc)desc=p.desc; name=line.replace(m[0],'').trim();}
    else{const pm=line.match(/\(([^()]*)\)\s*$/); if(pm){const p=parsePayloadTextForMatrix(pm[1]); if(p.count)count=p.count; if(p.desc)desc=p.desc; name=line.replace(pm[0],'').trim();}}
    const xm=name.match(/\b[x×]\s*(\d+)\s*$/i); if(xm){count=parseInt(xm[1],10); name=name.replace(xm[0],'').trim();}
    name=name.replace(/^\-+\s*/,'').replace(/^\*|\*$/g,'').trim(); if(!name||isOnlyParenLine(name)) return null; return {raw,name,desc,count};
  }
  function parseItemTextToArray(inline){
    if(!inline) return [];
    const parts = splitOutsideParens(inline);
    return parts.map(s=>s.trim()).filter(Boolean).map(parseItemLine).filter(Boolean);
  }
  function parseGunLine(line){
    if (isNotGunLineStart(line)) return null;
    const m=line.match(/^(.+?):\s*(\d+)\s*\/\s*(\d+)\s*(?:ammo)?/i);
    if(!m) return null;
    if (isNotGunLineStart(m[1])) return null;
    return {name:m[1].trim(),loaded:parseInt(m[2],10),cap:parseInt(m[3],10)};
  }
  function parseMatrix(lines){
    const res={adds:[],removes:[],guns:[]}; let section=''; let gunsStop=false;
    for(let i=0;i<lines.length;i++){
      const L=lines[i].trim(); let m;
      if(/^Inventory Matrix End\b/i.test(L)) break;

      if((m=L.match(/^Inventory Matrix:\s*(.*)$/i))){section='root';gunsStop=false;continue;}
      if((m=L.match(/^Added:\s*(.*)$/i))){section='added';const inline=(m[1]||'').trim(); if(inline) res.adds.push(...parseItemTextToArray(inline)); continue;}
      if((m=L.match(/^Removed:\s*(.*)$/i))){section='removed';const inline=(m[1]||'').trim(); if(inline) res.removes.push(...parseItemTextToArray(inline)); continue;}
      if((m=L.match(/^Guns:\s*(.*)$/i))){section='guns';gunsStop=false; const inline=(m[1]||'').trim();
        if(inline){
          const toks=splitOutsideParens(inline).map(s=>s.trim()).filter(Boolean);
          for(const tok of toks){
            if (isNotGunLineStart(tok)) { if(/^wind\b/i.test(tok)) gunsStop=true; continue; }
            const g=parseGunLine(tok); if(g) res.guns.push(g);
          }
        }
        continue;
      }
      if(/^--+$/.test(L)) break;

      if(section==='added'){ res.adds.push(...parseItemTextToArray(L)); }
      if(section==='removed'){ res.removes.push(...parseItemTextToArray(L)); }
      if(section==='guns'){
        if (gunsStop || isNotGunLineStart(L)) { if(/^wind\b/i.test(L)) gunsStop=true; continue; }
        const g=parseGunLine(L); if(g) res.guns.push(g);
      }
    }
    if(res.adds.length===1 && isOnlyParenLine(res.adds[0].raw)) res.adds=[];
    if(res.removes.length===1 && isOnlyParenLine(res.removes[0].raw)) res.removes=[];
    return res;
  }

  function findClosestWeaponKey(name){
    const A = stripParens(name);
    let best=null,score=0;
    for(const [k,v] of Object.entries(state.items)){
      if((v.type||v.category)!=='Weapons') continue;
      const B = stripParens(v.name);
      const sc=0.50*baseSimilarity(B,A)+0.32*jaccardExpanded(B,A)+0.18*tokenCoverageExpanded(B,A);
      if(sc>score){score=sc;best=k;}
      if((v.aliases||[]).some(a=>baseSimilarity(stripParens(a),A)>0.94)) return k;
    }
    return score>0.74?best:null;
  }
  function buildBatch(parsed){
    const batch={adds:[],removes:[],guns:[]};
    const newErrors=[];
    parsed.adds.forEach(a=>batch.adds.push({name:a.name,desc:a.desc||'',count:a.count||1}));
    parsed.removes.forEach(r=>batch.removes.push({name:r.name,desc:r.desc||'',count:r.count||1}));
    for(const g of parsed.guns){
      const key=findClosestWeaponKey(g.name);
      if(!key){
        const opts=Object.values(state.items).filter(x=>(x.type||x.category)==='Weapons');
        newErrors.push({type:'gun-mismatch',from:g.name,options:opts});
        batch.guns.push({name:g.name,loaded:g.loaded,cap:g.cap,ammoType:''});
      } else {
        const it=state.items[key];
        batch.guns.push({name:it.name,loaded:g.loaded,cap:g.cap,ammoType:it?.gun?.ammoType||''});
      }
    }
    return {batch,newErrors};
  }
  const batchSignature=(b)=>JSON.stringify({
    adds:b.adds.map(a=>stripParens(a.name)+'|'+(a.desc||'')+'|'+(a.count||1)),
    removes:b.removes.map(r=>stripParens(r.name)+'|'+(r.desc||'')+'|'+(r.count||1)),
    guns:b.guns.map(g=>stripParens(g.name)+'|'+g.loaded+'/'+g.cap)
  });

  async function isStillGenerating(prevJoined){
    await sleep(1000);
    const newer = findLatestMatrixLines();
    if(!newer) return false;
    const nj = newer.join('\n');
    return (nj.length > prevJoined.length) && nj.includes(prevJoined);
  }

  async function scanOnce(){
    const lines=findLatestMatrixLines(); if(!lines) return;
    const joined = lines.join('\n');
    if (await isStillGenerating(joined)) return;

    const parsed=parseMatrix(lines); if(!(parsed.adds.length||parsed.removes.length||parsed.guns.length)) return;
    const {batch,newErrors}=buildBatch(parsed);
    if(!(batch.adds.length||batch.removes.length||batch.guns.length) && !newErrors.length) return;

    const sig=batchSignature(batch);
    if(sig===lastSignature) return;
    lastSignature=sig;

    if(batch.adds.length||batch.removes.length||batch.guns.length){
      state.pending.adds.push(...batch.adds);
      state.pending.removes.push(...batch.removes);
      state.pending.guns.push(...batch.guns);
      flashPanelButton('green');
      renderPending();
    }
    if(newErrors.length){
      state.errors.push(...newErrors);
      flashPanelButton('red');
      renderErrors();
    }
    persist();
  }

  setInterval(()=>{ scanOnce(); },SCAN_MS);
  UI.scanNow.addEventListener('click',()=>{ scanOnce(); });

  /* ---------------- Boot ---------------- */
  function applyPanelVisibility(){UI.panel.style.display=state.panelHidden?'none':'grid'; idoc.querySelector('.app').style.gridTemplateColumns=state.panelHidden?'1fr 0px':'1fr var(--panel-w)';}
  function renderAll(){
    renderTabs();
    rebuildManualCat();
    UI.sortModeSelect.value = state.sortMode || 'alpha';
    // reflect search on load
    if (state.searchQuery) {
      UI.searchInput.value = state.searchQuery;
      UI.searchInput.classList.remove('hidden');
    } else {
      UI.searchInput.value = '';
      UI.searchInput.classList.add('hidden');
    }
    renderGrid();
    renderPending();
    renderErrors();
    applyPanelVisibility();
  }
  (async()=>{await loadImageIndex(); renderAll();})();
})();
