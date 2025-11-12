// GX Parsables overlay (MV3) — content.js
// - Inject via your popup (not auto). Once injected, a small "GX" button
//   remains top-left so you can reopen after closing the overlay.
// - Responds to GX_TOGGLE_UI from popup.
// - Scans page every 3s; only keeps parsables present in the latest scan.
// - Quickness Draws: hand is ignored; Actions=N only. Enemy auto-plays.
// - Dice: exploding chain, animation, highest-only, raise tracking.
// - NEW: Roll Type: Combat → exploding + random hit location (no d20 shown).
// - Card styles: Standard / Balatro / Vintage. No rounded corners.

(() => {
  "use strict";

  if (window.__GX_BOOTSTRAPPED) return;
  window.__GX_BOOTSTRAPPED = true;

  // ---------- lazy import deck.js ----------
  let DM = null;
  import(chrome.runtime.getURL("deck.js")).then(mod => {
    DM = mod;
    loadSettings();
    ensureOpenToggleButton();   // persistent top-left "GX" button
    startScanning();
  });

  // ---------- state ----------
  const STATE = {
    items: [],            // newest-first
    curIndex: 0,
    currentKey: null,

    lastSummary: "",
    copyBucket: [],

    deckState: null,
    diceState: null,

    qstore: new Map(),    // quickness rolls: key -> {subject, cards, ...}
    hstore: new Map(),    // hex rolls

    settings: { cardStyle: "standard" } // "standard" | "balatro" | "vintage"
  };

  const JOKER_SKIN = new WeakMap();
  const GX_ID = "gx-overlay-root";
  const OPEN_BTN_ID = "gx-open-button"; // persistent open button id

  // ---------- message from popup ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "GX_TOGGLE_UI") {
      if (isOpen()) closeOverlay(); else openOverlay();
    }
  });

  // ---------- persistent open button ----------
  function ensureOpenToggleButton() {
    if (document.getElementById(OPEN_BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = OPEN_BTN_ID;
    btn.textContent = "GX";
    Object.assign(btn.style, {
      position: "fixed",
      top: "10px",
      left: "10px",
      zIndex: "2147483000",
      background: "#000",
      color: "#fff",
      border: "1px solid #fff",
      padding: "6px 10px",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      cursor: "pointer",
      borderRadius: "0",
      userSelect: "none"
    });
    btn.addEventListener("click", () => {
      if (isOpen()) return; // overlay already open
      openOverlay();
    });
    document.documentElement.appendChild(btn);
  }

  // ---------- ephemeral scanning (every 3s) ----------
  let scanTimer = null;
  function startScanning() {
    scanNow();
    scanTimer = setInterval(scanNow, 3000);
  }

  function scanNow() {
    if (!DM) return;
    const text = document.body?.innerText || "";
    const parsed = DM.parseParsablesFromText(text) || [];

    const seen = new Set();
    const fresh = [];
    for (const it of parsed) {
      if (seen.has(it.raw)) continue;
      seen.add(it.raw);

      // Normalize actor
      if (typeof it.forWho === "string") {
        it.actor = /^user$/i.test(it.forWho.trim()) ? "User" : "NonUser";
      }

      // NEW: mark Combat rolls (based on raw text), and force exploding for Combat
      if (it.type === "roll" && /(^|\|)\s*Type\s*:\s*Combat\b/i.test(it.raw)) {
        it.combat = true;
        it.exploding = true; // Combat is exploding
      }

      fresh.push(it);
    }

    // newest-first (assume last on page is newest)
    fresh.reverse();

    const oldKey = STATE.currentKey;
    STATE.items = fresh;

    if (isOpen()) {
      const idx = oldKey ? STATE.items.findIndex(x => x.raw === oldKey) : -1;
      if (idx >= 0) {
        STATE.curIndex = idx;
      } else {
        const sidx = STATE.items.findIndex(x => x.starred);
        STATE.curIndex = (sidx >= 0) ? sidx : 0;
        STATE.currentKey = STATE.items[STATE.curIndex]?.raw || null;
        resetWorkingStateForCurrent();
        renderCurrent();
      }
      renderHeaderOnly();
    }
  }

  // ---------- settings ----------
  function loadSettings(){
    try {
      chrome.storage?.local?.get(["cardStyle","useBalatroCards"], (res)=>{
        if (typeof res?.cardStyle === "string") STATE.settings.cardStyle = res.cardStyle;
        else if (typeof res?.useBalatroCards === "boolean") STATE.settings.cardStyle = res.useBalatroCards ? "balatro" : "standard";
      });
    } catch {}
  }
  function saveSettings(){ try { chrome.storage?.local?.set({ cardStyle: STATE.settings.cardStyle }); } catch {} }

  // ---------- overlay open/close ----------
  const isOpen = ()=> !!document.getElementById(GX_ID);

  function openOverlay(){
    if (isOpen()) return;

    // initial item: most recent ⭐ if present, else most recent
    const sidx = STATE.items.findIndex(x => x.starred);
    STATE.curIndex = (sidx >= 0) ? sidx : 0;
    STATE.currentKey = STATE.items[STATE.curIndex]?.raw || null;

    const root = document.createElement("div");
    root.id = GX_ID;
    Object.assign(root.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.88)", color:"#fff",
      zIndex:"2147483647", display:"flex", flexDirection:"column",
      fontFamily:"system-ui, sans-serif", overflow:"hidden"
    });

    // header
    const top = mkDiv(null, { position:"relative", padding:"16px 48px 8px 48px", borderBottom:"1px solid #555" });
    const title = mkDiv("gx-title", { textAlign:"center", fontSize:"20px", fontWeight:"700", marginBottom:"6px" });
    const sub   = mkDiv("gx-sub",   { textAlign:"center", fontSize:"13px", color:"#bbb" });

    // left column: copy + quickness + hex
    const leftCol = mkDiv(null, { position:"absolute", left:"8px", top:"8px", display:"flex", flexDirection:"column", gap:"8px", width:"280px" });

    // copy pad
    const pad = mkDiv(null, { display:"flex", flexDirection:"column", gap:"6px" });
    const rowBtns = mkDiv(null, { display:"flex", gap:"6px", flexWrap:"wrap" });
    rowBtns.append(
      smallBtn("Copy Latest", onCopyLatest),
      smallBtn("Add to Copy", onAddToCopy),
      smallBtn("Copy All", onCopyAll),
      smallBtn("Clear List", onClearCopyList)
    );
    const list = mkDiv("gx-copy-list", { border:"1px solid #fff", padding:"6px 8px", maxHeight:"120px", overflowY:"auto", minWidth:"240px", fontSize:"12px" });
    pad.append(rowBtns, list);

    // quickness store
    const qPanel = mkDiv(null, { border:"1px solid #fff", padding:"6px 8px", maxHeight:"160px", overflowY:"auto", minWidth:"240px", fontSize:"12px" });
    qPanel.append(mkDiv(null,{fontWeight:"700",marginBottom:"4px"},"Quickness Saved"), mkDiv("gx-qstore",{}));

    // hex store
    const hPanel = mkDiv(null, { border:"1px solid #fff", padding:"6px 8px", maxHeight:"160px", overflowY:"auto", minWidth:"240px", fontSize:"12px" });
    hPanel.append(mkDiv(null,{fontWeight:"700",marginBottom:"4px"},"Hex Saved"), mkDiv("gx-hstore",{}));

    leftCol.append(pad, qPanel, hPanel);

    // close
    const close = bigBtn("Close ✕", closeOverlay);
    Object.assign(close.style, { position:"absolute", right:"8px", top:"8px" });

    top.append(title, sub, leftCol, close);

    // middle
    const middle = mkDiv(null, { flex:"1", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px" });
    const live = mkDiv("gx-live", { fontSize:"18px", textAlign:"center", minHeight:"24px" }, "Select cards or roll to begin.");

    const cardRow = mkDiv(null, { position:"relative", minHeight:"160px", width:"100%", padding:"0 48px" });
    const cardsWrap = mkDiv("gx-cards", {
      position:"absolute", left:"50%", transform:"translateX(-50%)",
      display:"flex", gap:"10px", flexWrap:"wrap", alignItems:"center", justifyContent:"center",
      maxWidth:"calc(100% - 300px)"
    });

    // deck (shuffle) column
    const deckCol = mkDiv(null, { position:"absolute", right:"48px", top:"50%", transform:"translateY(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:"6px" });
    const shuffleBtn = document.createElement("button");
    styleCardLike(shuffleBtn);
    Object.assign(shuffleBtn.style, {
      backgroundImage:`url(${chrome.runtime.getURL("cardassets/deck.webp")})`,
      backgroundSize:"cover", backgroundPosition:"center", color:"transparent", border:"none"
    });
    shuffleBtn.addEventListener("click", deckShuffle);
    const shuffleLabel = mkDiv(null, { fontSize:"12px", color:"#fff" }, "Shuffle Deck");
    const deckCount    = mkDiv("gx-deck-count", { fontSize:"12px", color:"#bbb", textAlign:"center" });
    deckCol.append(shuffleBtn, shuffleLabel, deckCount);

    cardRow.append(cardsWrap, deckCol);
    middle.append(live, cardRow);

    // bottom action + nav
    const bottom  = mkDiv(null, { borderTop:"1px solid #555", padding:"12px 16px", display:"flex", flexDirection:"column", gap:"8px" });
    const actionRow = mkDiv("gx-action-row", { display:"flex", justifyContent:"center", gap:"10px" });
    const navRow    = mkDiv("gx-nav-row",    { display:"flex", justifyContent:"center", gap:"10px" });
    bottom.append(actionRow, navRow);

    root.append(top, middle, bottom);
    document.documentElement.appendChild(root);

    // settings gear
    const gear = document.createElement("button");
    gear.textContent="⚙️";
    Object.assign(gear.style, { position:"absolute", left:"8px", bottom:"8px", background:"transparent", color:"#fff", border:"none", cursor:"pointer", fontSize:"18px", padding:"4px" });
    gear.addEventListener("click", toggleSettingsPanel);
    root.appendChild(gear);

    const panel = document.createElement("div");
    panel.id="gx-settings-panel";
    Object.assign(panel.style, { position:"absolute", left:"8px", bottom:"64px", background:"#111", color:"#fff", border:"1px solid #fff", padding:"10px 12px", minWidth:"260px", display:"none" });
    root.appendChild(panel);
    renderSettingsPanel();

    // first render
    if (STATE.items.length===0) {
      setTitle("No parsables found"); setSub(""); setLive("Waiting for [[...]] parsables...");
      renderButtonsEmpty();
    } else {
      resetWorkingStateForCurrent();
      renderCurrent();
    }
    renderCopyList();
    renderQuicknessList();
    renderHexList();
  }

  function closeOverlay(){
    const r = document.getElementById(GX_ID);
    if (r) r.remove();
    stopDiceAnim();
    // ensure persistent open button exists (in case page changed DOM)
    ensureOpenToggleButton();
  }

  // ---------- helpers (dom/ui) ----------
  function mkDiv(id, styles={}, text){ const d=document.createElement("div"); if(id) d.id=id; Object.assign(d.style,styles); if(text!==undefined) d.textContent=text; return d; }
  function bigBtn(label, onClick){ const b=document.createElement("button"); b.textContent=label; Object.assign(b.style,{background:"#111",color:"#fff",border:"1px solid #fff",padding:"8px 12px",fontSize:"14px",cursor:"pointer",borderRadius:"0"}); b.addEventListener("click", onClick); return b; }
  function smallBtn(label,onClick){ const b=document.createElement("button"); b.textContent=label; Object.assign(b.style,{background:"#111",color:"#fff",border:"1px solid #fff",padding:"4px 8px",fontSize:"12px",cursor:"pointer",borderRadius:"0"}); b.addEventListener("click",onClick); return b; }
  function styleCardLike(el){ Object.assign(el.style,{ width:"96px", height:"128px", background:"#111", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontWeight:"700", borderRadius:"0", userSelect:"none", border:"none" }); }
  const setTitle = t=>{ const e=document.getElementById("gx-title"); if(e) e.textContent=t; };
  const setSub   = t=>{ const e=document.getElementById("gx-sub");   if(e) e.textContent=t; };
  const setLive  = t=>{ const e=document.getElementById("gx-live");  if(e) e.textContent=t; };

  // ---------- header/meta ----------
  function renderHeaderOnly(){
    const item = STATE.items[STATE.curIndex];
    if (!item) return;
    const subjDisp = item.forWho ? ` (For ${item.forWho})` : "";
    setTitle(item.name + subjDisp);

    let meta = `${STATE.curIndex+1}/${STATE.items.length}`;
    if (item.type==="deck") meta = `Min: ${item.minRaw||"—"} • For: ${item.forWho} • ${meta}`;
    else if (item.type==="roll") {
      // Show "Exploding" and "Combat" flags as available
      const flags = [];
      if (item.exploding) flags.push("Exploding");
      if (item.combat)    flags.push("Combat");
      const flagStr = flags.length ? ` (${flags.join(", ")})` : "";
      meta = `Die: ${item.die}${flagStr} • TN: ${item.tn} Mod: ${signed(item.mod)} • ${meta}`;
    }
    else if (item.type==="qroll") meta = `Quickness Roll — Die: ${item.die} ${item.exploding?"Exploding":""} • TN: ${item.tn} Mod: ${signed(item.mod)} • ${meta}`;
    else if (item.type==="qdraw") meta = `Quickness Draw • For: ${item.forWho} • ${meta}`;
    else if (item.type==="hroll") meta = `Hex Roll — Die: ${item.die} ${item.exploding?"Exploding":""} • TN: ${item.tn} Mod: ${signed(item.mod)} • ${meta}`;
    else if (item.type==="hdraw") meta = `Hex Draw • Min: ${item.minRaw||"—"} • For: ${item.forWho} • ${meta}`;
    setSub(meta);
  }

  function ensureWorkingState(item){
    const wantsDeck = (item.type==="deck" || item.type==="qdraw" || item.type==="hdraw");
    if (wantsDeck && !STATE.deckState) {
      STATE.deckState = { deck: DM.shuffleInPlace(DM.makeDeck54()), drawn: [], selectedIdxs: [], trickDone:false, lastResult:null, manualOverride:false };
      STATE.diceState = null;
    }
    if (!wantsDeck && !STATE.diceState) {
      const cfg = DM.parseXdY(item.die);
      // NEW: Combat forces exploding
      const exploding = item.combat ? true
        : (item.type==="qroll" || item.type==="hroll")
            ? (item.hasOwnProperty("exploding") ? item.exploding : true)
            : !!item.exploding;
      STATE.diceState = {
        config: cfg, exploding, mod: item.mod|0, tn: item.tn|0,
        rolls: [], highIndex:0, chain:[], lastResult:null,
        isRolling:false, animValues:[], animTimer:null, animStart:0, animNumSpans:[],
        hit: null // NEW: combat hit location (persist across explosions)
      };
      STATE.deckState = null;
    }
  }

  function resetWorkingStateForCurrent(){
    stopDiceAnim();
    STATE.deckState = null;
    STATE.diceState = null;
    const item = STATE.items[STATE.curIndex];
    if (item) ensureWorkingState(item);
  }

  function renderCurrent(){
    const item = STATE.items[STATE.curIndex];
    if (!item) return;
    STATE.currentKey = item.raw;
    ensureWorkingState(item);
    renderHeaderOnly();

    const cw = document.getElementById("gx-cards");
    const ar = document.getElementById("gx-action-row");
    const nr = document.getElementById("gx-nav-row");
    if (cw) cw.textContent="";
    if (ar) ar.textContent="";
    if (nr) nr.textContent="";

    if (item.type==="deck" || item.type==="qdraw" || item.type==="hdraw") renderDeckMode(item);
    else renderDiceMode(item);

    if (nr) { nr.append(bigBtn("Prev", onPrev), bigBtn("Next", onNext)); }
  }

  // ---------- deck mode (Deck / Quickness Draw / Hex Draw) ----------
  function renderDeckMode(item){
    const ds = STATE.deckState;
    const ar = document.getElementById("gx-action-row");

    if (item.type==="qdraw") {
      if (ds.lastResult?.label) setLive(ds.lastResult.label);
      else setLive("Quickness Draw: hand is ignored — press Draw to get Actions.");
    } else if (item.type==="hdraw") {
      if (ds.lastResult?.label) setLive(ds.lastResult.label);
      else setLive("Hex Draw: press Draw to pull cards (requires a successful Hex Roll).");
    } else {
      if (ds.lastResult?.label) setLive(ds.lastResult.label);
      else setLive("Select your hand then Play. (Jokers are wild)");
    }

    renderDrawnCards();
    updateDeckCount();

    ar.textContent = "";

    if (item.actor !== "User") {
      const tgl = bigBtn( ds.manualOverride ? "Return to Auto" : "Take Control", () => {
        ds.manualOverride = !ds.manualOverride;
        setLive(ds.manualOverride ? "Manual mode." : "Auto mode. Draw to auto-play.");
        renderDeckMode(item);
      });
      ar.append(tgl);
    }

    ar.append(bigBtn("Auto-Play", onAutoPlayDeck));
    ar.append(bigBtn("Play", onPlayDeck));
    ar.append(bigBtn("Draw", onDrawDeck));
  }

  function renderDrawnCards(){
    const cw = document.getElementById("gx-cards");
    const ds = STATE.deckState; cw.textContent="";

    ds.drawn.forEach((c, idx)=>{
      const card = document.createElement("div");
      styleCardLike(card);

      if (!c.joker) {
        if (STATE.settings.cardStyle==="balatro") {
          const img=document.createElement("img"); img.src = balatroSrcForCard(c); img.alt = DM.cardText(c);
          Object.assign(img.style,{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none", userSelect:"none" });
          card.appendChild(img);
        } else if (STATE.settings.cardStyle==="vintage") {
          const img=document.createElement("img"); img.src = vintageSrcForCard(c); img.alt = DM.cardText(c);
          Object.assign(img.style,{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none", userSelect:"none" });
          card.appendChild(img);
        } else {
          card.style.background="#fff"; card.style.color=(c.suit==="♥"||c.suit==="♦")?"#c00":"#000";
          const rk=mkDiv(null,{fontSize:"22px",fontWeight:"800",lineHeight:"22px"}, c.rank);
          const st=mkDiv(null,{fontSize:"20px",marginTop:"2px"}, c.suit);
          card.append(rk,st);
        }
      } else {
        if (STATE.settings.cardStyle==="vintage") {
          const suitName=getJokerVintageSuit(c);
          const img=document.createElement("img"); img.src=chrome.runtime.getURL(`cardassets/scan/${suitName}/Joker.png`); img.alt="Joker";
          Object.assign(img.style,{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none", userSelect:"none" });
          card.appendChild(img);
        } else {
          card.style.background="#fff"; card.style.color="#000"; card.textContent="🃏Joker";
        }
      }

      card.addEventListener("click", ()=>{
        const item = STATE.items[STATE.curIndex];
        const pos = ds.selectedIdxs.indexOf(idx);
        ds.lastResult = null;
        if (pos>=0) {
          ds.selectedIdxs.splice(pos,1); card.style.transform="translateY(0)"; card.style.outline="none";
        } else {
          if (ds.selectedIdxs.length>=5) {
            const old = ds.selectedIdxs.shift();
            const oldEl = cw.children[old]; if (oldEl){ oldEl.style.transform="translateY(0)"; oldEl.style.outline="none"; }
          }
          ds.selectedIdxs.push(idx); card.style.transform="translateY(-6px)"; card.style.outline="3px solid #f80";
        }
        updateLiveSelectionLabel(item);
      });

      if (ds.selectedIdxs.includes(idx)) { card.style.transform="translateY(-6px)"; card.style.outline="3px solid #f80"; }

      cw.appendChild(card);
    });
  }

  function updateDeckCount(){
    const dc=document.getElementById("gx-deck-count");
    if (!dc) return;
    const ds=STATE.deckState;
    dc.textContent = ds ? `Deck: ${ds.deck.length} cards remaining (54 with Jokers)` : "";
  }

  function deckShuffle(){
    const ds=STATE.deckState; if (!ds) return;
    ds.deck = DM.shuffleInPlace(DM.makeDeck54());
    ds.drawn = []; ds.selectedIdxs=[]; ds.lastResult=null;
    setLive("Shuffled new deck.");
    renderDrawnCards(); updateDeckCount();
  }

  function onDrawDeck(){
    const item = STATE.items[STATE.curIndex]; const ds=STATE.deckState; if (!ds || !item) return;

    let drawCount = 1;
    if (item.type==="deck") {
      drawCount = item.trick ? 1 : Math.max(1, item.handSize|0);
    } else if (item.type==="qdraw") {
      const saved = STATE.qstore.get(subjectKey(item.forWho));
      drawCount = saved ? saved.cards : 1;
      setLive(saved ? `Quickness Draw for ${saved.subject}: drawing ${drawCount} card(s).` : `Quickness Draw for ${item.forWho}: no saved roll — drawing 1 card.`);
    } else if (item.type==="hdraw") {
      const saved = STATE.hstore.get(subjectKey(item.forWho));
      if (!saved) { setLive(`Hex Draw for ${item.forWho}: no saved Hex Roll — cannot draw.`); return; }
      if (!saved.success) { setLive(`Hex Draw for ${item.forWho}: last Hex Roll failed — cannot draw.`); return; }
      const bonus = (saved.raises|0) * 2;
      drawCount = Math.max(1, (item.handSize|0) + bonus);
      setLive(`Hex Draw for ${saved.subject}: base ${item.handSize} + ${bonus} (raises) = ${drawCount} card(s).`);
    }

    if (ds.deck.length < drawCount) {
      ds.deck = DM.shuffleInPlace(DM.makeDeck54());
      setLive("Auto-reshuffled (low deck).");
    }

    ds.drawn = DM.draw(ds.deck, drawCount);
    ds.selectedIdxs = [];
    ds.trickDone = (item.type==="deck") ? !!item.trick : false;
    ds.lastResult = null;

    renderDrawnCards(); updateDeckCount();

    // Auto for NonUser unless manual override
    if (item.actor !== "User" && !ds.manualOverride) {
      if (item.type==="deck" && item.trick) {
        const ok = DM.trickSuccess(ds.drawn[0]);
        const label = `Auto Trick: ${DM.cardText(ds.drawn[0])} → ${ok ? "SUCCESS" : "FAIL"}`;
        ds.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`; setLive(label); return;
      }
      if (item.type==="qdraw") {
        const label = `Auto plays • Actions: ${ds.drawn.length} [${ds.drawn.map(DM.cardText).join(", ")}]`;
        ds.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`; setLive(label); return;
      }
      autoPlayEnemy(item);
      return;
    }

    if (item.type==="qdraw") setLive(`Quickness Draw — Actions: ${ds.drawn.length} (hand ignored).`);
    else setLive("Select up to 5 cards (your selection is your hand).");
  }

  function onPlayDeck(){
    const item = STATE.items[STATE.curIndex]; const ds=STATE.deckState; if (!ds || !item) return;

    // NonUser auto mode
    if (item.actor !== "User" && !ds.manualOverride) {
      if (item.type==="qdraw") {
        const label = `Auto plays • Actions: ${ds.drawn.length} [${ds.drawn.map(DM.cardText).join(", ")}]`;
        ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label); return;
      }
      if (item.type==="deck" && item.trick) {
        if (ds.drawn.length!==1) { setLive("Draw 1 card first (Trick)."); return; }
        const ok = DM.trickSuccess(ds.drawn[0]);
        const label = `Auto Trick: ${DM.cardText(ds.drawn[0])} → ${ok ? "SUCCESS" : "FAIL"}`;
        ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label); return;
      }
      autoPlayEnemy(item); return;
    }

    // Manual
    if (item.type==="deck" && item.trick) {
      if (ds.drawn.length!==1) { setLive("Draw 1 card first (Trick)."); return; }
      const ok = DM.trickSuccess(ds.drawn[0]);
      const label = `Trick result: ${DM.cardText(ds.drawn[0])} → ${ok ? "SUCCESS" : "FAIL"}`;
      ds.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`; setLive(label); return;
    }

    if (!ds.drawn.length) { setLive("Draw cards first."); return; }

    // Quickness: ignore hand — actions only
    if (item.type==="qdraw") {
      const label = `You play • Actions: ${ds.drawn.length} [${ds.drawn.map(DM.cardText).join(", ")}]`;
      ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label); return;
    }

    // Deck / Hex Draw
    if (ds.selectedIdxs.length===0){ setLive("Select cards to play (or use Auto-Play)."); return; }
    const selected = ds.selectedIdxs.map(i=>ds.drawn[i]);
    const cat = DM.classifySelectionQuick(selected).name;

    let req = {pass:true, why:""};
    if (item.type==="deck") req = DM.checkDeckRequirement(item.minRaw, cat, selected);
    else if (item.type==="hdraw") req = DM.checkDeckRequirement(item.minRaw, cat, selected);

    let label = `You play: ${cat} [${selected.map(DM.cardText).join(", ")}] — ${req.pass ? "SUCCESS" : "FAIL"}${req.why?` (${req.why})`:""}`;
    if (item.type==="hdraw") label += ` • Actions: ${ds.drawn.length}`;
    ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label);
  }

  function onAutoPlayDeck(){
    const item = STATE.items[STATE.curIndex]; const ds=STATE.deckState; if (!ds || !item) return;

    if (item.type==="deck" && item.trick) {
      if (ds.drawn.length!==1){ setLive("Draw 1 card first (Trick)."); return; }
      const ok = DM.trickSuccess(ds.drawn[0]);
      const label = `Trick result: ${DM.cardText(ds.drawn[0])} → ${ok ? "SUCCESS" : "FAIL"}`;
      ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label); return;
    }

    if (!ds.drawn.length){ setLive("Draw cards first."); return; }

    if (item.type==="qdraw") {
      const label = `You auto-play • Actions: ${ds.drawn.length} [${ds.drawn.map(DM.cardText).join(", ")}]`;
      ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`; setLive(label); return;
    }

    const ranked = DM.rankAll5Hands(ds.drawn);
    if (!ranked.length){ setLive("No playable 5-card hand from current draw."); return; }
    const best = ranked[0];

    ds.selectedIdxs = idxsForCards(ds.drawn, best.cardsResolved || []);
    let req = {pass:true, why:""};
    if (item.type==="deck") req = DM.checkDeckRequirement(item.minRaw, best.name, best.cardsResolved||ds.drawn.slice(0,5));
    else if (item.type==="hdraw") req = DM.checkDeckRequirement(item.minRaw, best.name, best.cardsResolved||ds.drawn.slice(0,5));

    let label = `You auto-play: ${best.name} [${(best.cardsResolved||[]).map(DM.cardText).join(", ")}] — ${req.pass?"SUCCESS":"FAIL"}${req.why?` (${req.why})`:""}`;
    if (item.type==="hdraw") label += ` • Actions: ${ds.drawn.length}`;
    ds.lastResult={label}; STATE.lastSummary=`[${item.name}] ${label}`;
    setLive(label);
    renderDrawnCards();
  }

  function autoPlayEnemy(item){
    const ds=STATE.deckState; if (!ds) return;

    if (item.type==="qdraw") {
      const label = `Auto plays • Actions: ${ds.drawn.length} [${ds.drawn.map(DM.cardText).join(", ")}]`;
      ds.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`; setLive(label); return;
    }

    const list = DM.rankAll5Hands(ds.drawn);
    if (!list.length){ setLive("No playable 5-card hand from current draw."); return; }
    const pick = enemyPick(list); const chosen=pick.chosen;

    const req = (item.type==="hdraw")
      ? DM.checkDeckRequirement(item.minRaw, chosen.name, chosen.cardsResolved || ds.drawn.slice(0,5))
      : DM.checkDeckRequirement(item.minRaw, chosen.name, chosen.cardsResolved || ds.drawn.slice(0,5));

    const cardsUsed = (chosen.cardsResolved || ds.drawn.slice(0,5)).map(DM.cardText);
    let label = `Auto plays: ${chosen.name} — ${req.pass?"SUCCESS":"FAIL"}${req.why?` (${req.why})`:""}; ${pick.reason} [${cardsUsed.join(", ")}]`;
    if (item.type==="hdraw") label += ` • Actions: ${ds.drawn.length}`;
    ds.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`; setLive(label);
  }

  function enemyPick(list){
    if (!list || list.length===0) return { chosen: list?.[0], reason:"No hand" };
    const r=Math.random();
    if (r<0.025 && list.length>=2) return { chosen:list[1], reason:"Missed best (2nd best)" };
    if (r<0.05) return { chosen:list[list.length-1], reason:"Blundered (worst hand)" };
    return { chosen:list[0], reason:"Best hand" };
  }

  function idxsForCards(pool, chosen){
    const idxs=[];
    chosen.forEach(ch=>{
      let i = pool.indexOf(ch);
      if (i<0) {
        const txt = DM.cardText(ch);
        i = pool.findIndex((p,ix)=> DM.cardText(p)===txt && !idxs.includes(ix));
      }
      if (i>=0) idxs.push(i);
    });
    return idxs.slice(0,5);
  }

  function updateLiveSelectionLabel(item){
    const ds=STATE.deckState; if (!ds) return;
    if (!item) item = STATE.items[STATE.curIndex];
    if (item?.type === "qdraw") {
      setLive(`Quickness Draw — Actions: ${ds.drawn.length} (hand ignored).`);
      return;
    }
    if (ds.selectedIdxs.length===0){ setLive("Select up to 5 cards (your selection is your hand)."); return; }
    const sel = ds.selectedIdxs.map(i=>ds.drawn[i]);
    const cat = DM.classifySelectionQuick(sel).name;
    setLive(`${cat} — [${sel.map(DM.cardText).join(", ")}]`);
  }

  // ---------- dice mode ----------
  function renderDiceMode(item){
    const d=STATE.diceState; const ar=document.getElementById("gx-action-row"); const cw=document.getElementById("gx-cards");

    const chainTotal = DM.sum(d.chain);
    const eff = chainTotal + (d.mod||0);
    const rz = DM.raises(eff, d.tn);

    if (d.isRolling) {
      setLive("Rolling…");
    } else if (d.lastResult?.label) {
      setLive(d.lastResult.label);
    } else if (item.type==="qroll") {
      const cards = DM.quicknessCardsFromResult(chainTotal, d.mod, d.tn);
      setLive(`Highest: ${chainTotal} (Mod ${signed(d.mod)}) • TN: ${d.tn} • Raises: ${rz} • Quickness Cards: ${cards}`);
    } else if (item.type==="hroll") {
      setLive(`Highest: ${chainTotal} (Mod ${signed(d.mod)}) • TN: ${d.tn} • Raises: ${rz} • Hex: ${eff>=d.tn?"Success":"Not ready"}`);
    } else if (item.type==="roll" && item.combat) {
      setLive(`Combat roll ready — press Roll to resolve hit location.`);
    } else {
      setLive(`Highest: ${chainTotal} (Mod ${signed(d.mod)}) • TN: ${d.tn} • Raises: ${rz}`);
    }

    cw.textContent="";
    const lblRow = mkDiv(null,{color:"#bbb", textAlign:"center", margin:"6px 0", fontSize:"12px"},"Base Roll");
    cw.appendChild(lblRow);

    const row=mkDiv(null,{display:"flex",gap:"16px",justifyContent:"center",flexWrap:"wrap"});
    const sides=d.config.sides; const dieBg=diceAssetUrl(sides);
    const showVals = d.isRolling && d.animValues.length ? d.animValues : (d.rolls.length ? d.rolls : []);
    const count=d.config.count;
    d.animNumSpans = [];

    for (let i=0;i<count;i++){
      const wrap=mkDiv(null,{display:"flex",flexDirection:"column",alignItems:"center",gap:"6px"});
      const die=mkDiv(null,{
        position:"relative", width: Math.round(180*0.895)+"px", height:"180px",
        backgroundImage:`url(${dieBg})`, backgroundSize:"cover", backgroundPosition:"center",
        border:"none", borderRadius:"0", display:"flex", alignItems:"center", justifyContent:"center", userSelect:"none"
      });
      const num=mkDiv(null,{
        position:"absolute", inset:"0", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:"40px", fontWeight:"800", color:"#fff", textShadow:"0 2px 4px rgba(0,0,0,0.8)"
      }, showVals[i] ? String(showVals[i]) : "-");
      num.className="gx-die-num"; num.dataset.index=String(i);
      die.appendChild(num); wrap.appendChild(die);

      if (!d.isRolling && d.rolls.length && i===d.highIndex) {
        wrap.appendChild(mkDiv(null,{fontSize:"11px", color:"#ddd"},"Highest"));
      }
      if (!d.isRolling && i===d.highIndex) {
        const canExplode = d.exploding && d.chain.length>0 && d.chain[d.chain.length-1]===d.config.sides;
        if (canExplode) {
          const exBtn=bigBtn("Explosion! Roll Again", onExplodeDice);
          exBtn.style.fontSize="12px"; exBtn.style.padding="6px 10px";
          wrap.appendChild(exBtn);
        }
      }

      row.appendChild(wrap);
      d.animNumSpans.push(num);
    }
    cw.appendChild(row);

    if (!d.isRolling && d.chain.length>1) {
      const chainRow=mkDiv(null,{display:"flex",gap:"8px",justifyContent:"center",marginTop:"8px",flexWrap:"wrap"});
      d.chain.forEach((val,idx)=> chainRow.appendChild(mkDiv(null,{border:"1px solid #fff",padding:"6px 8px",minWidth:"28px",textAlign:"center",fontWeight:"600"}, idx===0?String(val):`+${val}`)));
      cw.appendChild(chainRow);
    }

    ar.textContent="";
    const rollBtn = bigBtn(`Roll ${item.die || (item.type==='qroll'?'Quickness': item.type==='hroll'?'Hex':'')}`, ()=>startDiceRollAnimation(item));
    if (d.isRolling){ rollBtn.disabled=true; rollBtn.style.opacity="0.6"; }
    ar.append(rollBtn);
  }

  function startDiceRollAnimation(item){
    const d=STATE.diceState; if (!d) return;
    stopDiceAnim();
    const count=d.config.count, sides=d.config.sides;
    d.isRolling=true; d.animValues=Array.from({length:count},()=>randInt(1,sides)); d.animStart=performance.now();
    renderDiceMode(item);

    d.animTimer = setInterval(()=>{
      const elapsed = performance.now() - d.animStart;
      if (elapsed >= 500) {
        stopDiceAnim();
        d.rolls = DM.rollDice(count, sides);
        const maxVal=Math.max(...d.rolls); d.highIndex=d.rolls.findIndex(x=>x===maxVal); d.chain=[maxVal];

        let labelBase = `Rolled ${item.die}${d.exploding?" (Exploding)":""} → [${d.rolls.join(", ")}]  Highest=${maxVal}  TN=${d.tn}  Raises=${DM.raises(maxVal + d.mod, d.tn)}`;

        if (item.type==="qroll") {
          const subj=subjectKey(item.forWho);
          const cards=DM.quicknessCardsFromResult(DM.sum(d.chain), d.mod, d.tn);
          saveQuickness(subj, item.forWho, item.die, d.mod, d.tn, d.chain);
          renderQuicknessList();
          labelBase += ` • Quickness saved: ${cards} card(s) for ${item.forWho}`;
        } else if (item.type==="hroll") {
          const subj=subjectKey(item.forWho);
          const eff = DM.sum(d.chain) + (d.mod||0);
          const success = eff >= d.tn; const raises = success ? DM.raises(eff, d.tn) : 0;
          saveHex(subj, item.forWho, item.die, d.mod, d.tn, d.chain, success, raises);
          renderHexList();
          labelBase += ` • Hex ${success?"SUCCESS":"FAIL"}${success?` (Raises: ${raises})`:""}`;
        }

        // NEW: Combat adds a random hit location (chosen once per roll)
        if (item.type==="roll" && item.combat) {
          if (!d.hit) d.hit = randomHitLocation();
          labelBase += ` • Hit: ${d.hit}`;
        }

        d.lastResult={label: labelBase}; STATE.lastSummary = `[${item.name}] ${labelBase}`;
        renderDiceMode(item);
        return;
      }
      d.animValues = Array.from({length: count},()=>randInt(1,sides));
      for (let i=0;i<d.animNumSpans.length;i++){ const span=d.animNumSpans[i]; if (span) span.textContent=String(d.animValues[i] ?? "-"); }
    }, 50);
  }

  function onExplodeDice(){
    const item=STATE.items[STATE.curIndex]; const d=STATE.diceState; if (!d) return;
    if (!d.exploding){ setLive("This roll type is not Exploding."); return; }
    const last=d.chain[d.chain.length-1]||0; if (last!==d.config.sides){ setLive("No explosion available (highest die not at max)."); return; }
    const roll = DM.rollDice(1, d.config.sides)[0]; d.chain.push(roll);

    const chainTotal=DM.sum(d.chain);
    let label = `Explosion added [${roll}] → Highest-chain=${chainTotal}  TN=${d.tn}  Raises=${DM.raises(chainTotal + d.mod, d.tn)}`;

    if (item.type==="qroll") {
      const subj=subjectKey(item.forWho);
      const cards=DM.quicknessCardsFromResult(chainTotal, d.mod, d.tn);
      saveQuickness(subj, item.forWho, item.die, d.mod, d.tn, d.chain); renderQuicknessList();
      label += ` • Quickness saved: ${cards} card(s) for ${item.forWho}`;
    } else if (item.type==="hroll") {
      const subj=subjectKey(item.forWho);
      const eff = chainTotal + (d.mod||0);
      const success = eff >= d.tn; const raises = success ? DM.raises(eff, d.tn) : 0;
      saveHex(subj, item.forWho, item.die, d.mod, d.tn, d.chain, success, raises); renderHexList();
      label += ` • Hex ${success?"SUCCESS":"FAIL"}${success?` (Raises: ${raises})`:""}`;
    }

    // NEW: Combat — persist hit location (don't re-roll it)
    if (item.type==="roll" && item.combat) {
      if (!d.hit) d.hit = randomHitLocation();
      label += ` • Hit: ${d.hit}`;
    }

    d.lastResult={label}; STATE.lastSummary = `[${item.name}] ${label}`;
    renderDiceMode(item);
  }

  function stopDiceAnim(){ const d=STATE.diceState; if (d?.animTimer){ clearInterval(d.animTimer); d.animTimer=null; } if (d) d.isRolling=false; }

  // ---------- quickness / hex store ----------
  function subjectKey(name){ return String(name||"User").toLowerCase().replace(/\s+/g," ").trim(); }
  function saveQuickness(key, displayName, die, mod, tn, chainArr){
    const chain=Array.from(chainArr); const highest=DM.sum(chain);
    const cards=DM.quicknessCardsFromResult(highest, mod, tn);
    const rz=DM.raises(highest + (mod||0), tn);
    STATE.qstore.set(key,{ subject:displayName, die, mod, tn, baseHighest:chain[0]||0, chain, raises:rz, cards, ts:Date.now() });
  }
  function saveHex(key, displayName, die, mod, tn, chainArr, success, raises){
    const chain=Array.from(chainArr);
    STATE.hstore.set(key,{ subject:displayName, die, mod, tn, baseHighest:chain[0]||0, chain, raises:raises|0, success:!!success, ts:Date.now() });
  }
  function renderQuicknessList(){
    const box=document.getElementById("gx-qstore"); if (!box) return;
    box.textContent=""; if (STATE.qstore.size===0){ box.textContent="(none)"; return; }
    const entries=Array.from(STATE.qstore.values()).sort((a,b)=> b.ts - a.ts);
    for (const e of entries) {
      const chip=document.createElement("button"); chip.textContent=e.subject;
      chip.title = `Cards: ${e.cards} • Die: ${e.die} • TN: ${e.tn} • Mod: ${signed(e.mod)} • Raises: ${e.raises} • Chain: [${e.chain.join(", ")}]`;
      Object.assign(chip.style,{display:"block",width:"100%",textAlign:"left",background:"#111",color:"#fff",border:"1px solid #fff",padding:"4px 6px",marginBottom:"4px",cursor:"pointer",borderRadius:"0",fontSize:"12px"});
      chip.addEventListener("click",()=>{ STATE.qstore.delete(subjectKey(e.subject)); renderQuicknessList(); });
      box.appendChild(chip);
    }
  }
  function renderHexList(){
    const box=document.getElementById("gx-hstore"); if (!box) return;
    box.textContent=""; if (STATE.hstore.size===0){ box.textContent="(none)"; return; }
    const entries=Array.from(STATE.hstore.values()).sort((a,b)=> b.ts - a.ts);
    for (const e of entries) {
      const chip=document.createElement("button"); chip.textContent = `${e.subject}${e.success?"":" (fail)"}`;
      chip.title = `Hex ${e.success?"OK":"Failed"} • Raises: ${e.raises} • Die: ${e.die} • TN: ${e.tn} • Mod: ${signed(e.mod)} • Chain: [${e.chain.join(", ")}]`;
      Object.assign(chip.style,{display:"block",width:"100%",textAlign:"left",background:"#111",color:"#fff",border:"1px solid #fff",padding:"4px 6px",marginBottom:"4px",cursor:"pointer",borderRadius:"0",fontSize:"12px"});
      chip.addEventListener("click",()=>{ STATE.hstore.delete(subjectKey(e.subject)); renderHexList(); });
      box.appendChild(chip);
    }
  }

  // ---------- copy pad ----------
  async function onCopyLatest(){ if(!STATE.lastSummary) return; await navigator.clipboard.writeText(STATE.lastSummary); flash("Copied latest."); }
  function onAddToCopy(){ if(!STATE.lastSummary) return; STATE.copyBucket.push(STATE.lastSummary); renderCopyList(); flash("Added."); }
  async function onCopyAll(){ if(STATE.copyBucket.length===0) return; await navigator.clipboard.writeText(STATE.copyBucket.join("\n")); flash("Copied all."); }
  function onClearCopyList(){ STATE.copyBucket=[]; renderCopyList(); }
  function renderCopyList(){ const list=document.getElementById("gx-copy-list"); if(!list) return; list.textContent=""; if(STATE.copyBucket.length===0){ list.textContent="(empty)"; return; } STATE.copyBucket.forEach((t,i)=>{ const it=mkDiv(null,{borderTop:i?"1px solid #666":"none",padding:"4px 0"},t); list.appendChild(it); }); }
  function flash(msg){ const el=mkDiv(null,{position:"fixed",left:"8px",top:"40px",background:"#111",border:"1px solid #fff",color:"#fff",padding:"6px 8px",fontSize:"12px",zIndex:"2147483647"}, msg); document.documentElement.appendChild(el); setTimeout(()=>el.remove(),1200); }

  // ---------- nav ----------
  function onPrev(){ if (!STATE.items.length) return; STATE.curIndex = (STATE.curIndex + 1) % STATE.items.length; STATE.currentKey = STATE.items[STATE.curIndex]?.raw||null; resetWorkingStateForCurrent(); renderCurrent(); }
  function onNext(){ if (!STATE.items.length) return; STATE.curIndex = (STATE.curIndex - 1 + STATE.items.length) % STATE.items.length; STATE.currentKey = STATE.items[STATE.curIndex]?.raw||null; resetWorkingStateForCurrent(); renderCurrent(); }

  // ---------- settings panel ----------
  function toggleSettingsPanel(){
    const p=document.getElementById("gx-settings-panel"); if (!p) return;
    p.style.display = (p.style.display==="none"||!p.style.display) ? "block" : "none";
  }
  function renderSettingsPanel(){
    const p=document.getElementById("gx-settings-panel"); if (!p) return;
    p.textContent="";
    p.appendChild(mkDiv(null,{fontWeight:"700",marginBottom:"8px",fontSize:"14px"},"Settings"));
    p.appendChild(mkDiv(null,{fontWeight:"600",marginBottom:"6px",fontSize:"13px"},"Card Style"));
    const list=mkDiv(null,{display:"flex",flexDirection:"column",gap:"6px"});
    [
      {val:"standard", label:"Standard (text)"},
      {val:"balatro",  label:"Balatro images"},
      {val:"vintage",  label:"Vintage images"}
    ].forEach(o=>{
      const row=mkDiv(null,{display:"flex",alignItems:"center",gap:"8px"});
      const r=document.createElement("input");
      r.type="radio"; r.name="gx-card-style"; r.value=o.val; r.id=`gx-style-${o.val}`; r.checked=(STATE.settings.cardStyle===o.val);
      const lbl=document.createElement("label"); lbl.htmlFor=r.id; lbl.textContent=o.label; lbl.style.cursor="pointer";
      r.addEventListener("change",()=>{ if(!r.checked) return; STATE.settings.cardStyle=o.val; saveSettings(); const cur=STATE.items[STATE.curIndex]; if(cur&&(cur.type==="deck"||cur.type==="qdraw"||cur.type==="hdraw")) renderDrawnCards(); });
      row.append(r,lbl); list.appendChild(row);
    });
    p.appendChild(list);
  }

  // ---------- assets & utils ----------
  function balatroSrcForCard(c){
    const suitInit = c.suit==="♥"?"H": c.suit==="♦"?"D": c.suit==="♣"?"C":"S";
    const file = `${suitInit}${c.rank}.png`;
    return chrome.runtime.getURL(`cardassets/balatro/${file}`);
  }
  function vintageSrcForCard(c){
    const suitName = c.suit==="♥"?"Hearts": c.suit==="♦"?"Diamonds": c.suit==="♣"?"Clubs":"Spades";
    const rankName = ({J:"Jack",Q:"Queen",K:"King",A:"Ace"})[c.rank] || String(c.rank);
    return chrome.runtime.getURL(`cardassets/scan/${suitName}/${rankName}.png`);
  }
  function getJokerVintageSuit(cardObj){
    if (JOKER_SKIN.has(cardObj)) return JOKER_SKIN.get(cardObj);
    const suits=["Spades","Hearts","Diamonds","Clubs"];
    const pick=suits[Math.floor(Math.random()*suits.length)];
    JOKER_SKIN.set(cardObj, pick); return pick;
  }

  const signed = (n)=> (n>=0?"+":"")+n;
  const randInt = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
  const diceAssetUrl = (sides)=> chrome.runtime.getURL(`diceassets/d${sides}.png`);

  // NEW: random hit location for Combat rolls (weighted 1..20 map)
  function randomHitLocation(){
    const r = randInt(1,20);
    if (r <= 3)  return "Head";        // 1-3
    if (r <= 7)  return "Guts";        // 4-7
    if (r <= 10) return "Left Arm";    // 8-10
    if (r <= 13) return "Right Arm";   // 11-13
    if (r <= 16) return "Left Leg";    // 14-16
    return "Right Leg";                // 17-20
  }
})();
