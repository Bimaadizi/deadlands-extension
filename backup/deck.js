// deck.js — helpers for parsing, cards, dice, hands, requirements, quickness/hex, and combat hit locations.

// ---------- Parsing ----------
export function parseParsablesFromText(text) {
  if (!text) return [];
  const items = [];

  // Helper to normalize "Name" (detect star)
  const normName = (s) => {
    const name = (s || "").trim();
    return { name, starred: /⭐/.test(name) };
  };

  // Parse key:value pairs inside [[ ... | ... ]]
  const parseFields = (inner) => {
    const out = {};
    const parts = inner.split("|").map(p => p.trim()).filter(Boolean);
    for (let p of parts) {
      const m = p.match(/^\s*([^:|]+)\s*:\s*(.+)\s*$/);
      if (m) {
        const key = m[1].trim().toLowerCase();
        const val = m[2].trim();
        out[key] = val;
      } else {
        // free token like "1d8"
        const dm = p.match(/^\s*(\d+)d(\d+)\s*$/i);
        if (dm) out["die"] = `${dm[1]}d${dm[2]}`;
      }
    }
    return out;
  };

  // --- Deck ---
  const deckRe = /\[\[\s*deck\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(deckRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const handSize = toInt(f["hand size"]);
    const trick = parseYesNo(f["trick"]);
    const minRaw = f["min hand/tn"] || f["min"] || null;
    const forWho = f["for"] || "User";
    items.push({
      type: "deck", raw, name, starred,
      handSize: isFinite(handSize) && handSize>0 ? handSize : 5,
      trick: !!trick,
      minRaw,
      forWho
    });
  }

  // --- Roll ---
  const rollRe = /\[\[\s*roll\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(rollRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const die = f["die"] || "1d6";
    const tn = toInt(f["tn"], 0);
    const mod = toSignedInt(f["mod"], 0);
    const tRaw = (f["type"] || "").toLowerCase();
    let exploding = /explod/i.test(tRaw);
    let combat = /combat/i.test(tRaw);
    // Combat is exploding by default
    if (combat) exploding = true;
    const forWho = f["for"] || "User";
    items.push({
      type: "roll", raw, name, starred,
      die, tn, mod, exploding, combat,
      forWho
    });
  }

  // --- Quickness Roll ---
  const qrollRe = /\[\[\s*quickness\s+roll\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(qrollRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const die = f["die"] || f["1d4"] || f["1d8"] || f["1d10"] || findDieToken(m[1]) || "1d4";
    const tn = toInt(f["tn"], 5);
    const mod = toSignedInt(f["mod"], 0);
    let exploding = true;
    if (f["type"]) exploding = /explod/i.test(f["type"]);
    const forWho = f["for"] || "User";
    items.push({ type:"qroll", raw, name, starred, die, tn, mod, exploding, forWho });
  }

  // --- Quickness Draw ---
  const qdrawRe = /\[\[\s*quickness\s+draw\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(qdrawRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const forWho = f["for"] || "User";
    items.push({ type:"qdraw", raw, name, starred, forWho });
  }

  // --- Hex Roll ---
  const hrollRe = /\[\[\s*hex\s+roll\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(hrollRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const die = f["die"] || findDieToken(m[1]) || "1d8";
    const tn = toInt(f["tn"], 5);
    const mod = toSignedInt(f["mod"], 0);
    let exploding = true;
    if (f["type"]) exploding = /explod/i.test(f["type"]);
    const forWho = f["for"] || "User";
    items.push({ type:"hroll", raw, name, starred, die, tn, mod, exploding, forWho });
  }

  // --- Hex Draw ---
  const hdrawRe = /\[\[\s*hex\s+draw\s*\|\s*([^\]]+?)\s*\]\]/gi;
  for (const m of text.matchAll(hdrawRe)) {
    const raw = m[0];
    const f = parseFields(m[1]);
    const { name, starred } = normName(f["name"]);
    const handSize = toInt(f["hand size"], 5);
    const minRaw = f["min"] || f["min hand/tn"] || null;
    const forWho = f["for"] || "User";
    items.push({ type:"hdraw", raw, name, starred, handSize, minRaw, forWho });
  }

  return items;
}

function findDieToken(s) {
  const m = /\b(\d+)d(\d+)\b/i.exec(s || "");
  return m ? `${m[1]}d${m[2]}` : null;
}
function toInt(v, def=0){ const n = parseInt(String(v||"").replace(/[^\d-]/g,""),10); return isNaN(n)?def:n; }
function toSignedInt(v, def=0){
  if (v==null) return def;
  const m = String(v).match(/([+-]?)\s*(\d+)/);
  if (!m) return def;
  const sign = m[1]==="-"?-1:1; return sign*parseInt(m[2],10);
}
function parseYesNo(v){ return /^y/i.test(String(v||"")); }

// ---------- Cards ----------
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

export function makeDeck54(){
  const deck=[];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit:s, rank:r, joker:false });
  // two jokers
  deck.push({ joker:true }); deck.push({ joker:true });
  return deck;
}
export function shuffleInPlace(arr){
  for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}
export function draw(deck, n){
  const out=[]; for (let i=0;i<n && deck.length;i++) out.push(deck.shift()); return out;
}
export function cardText(c){
  if (!c) return "";
  if (c.joker) return "🃏Joker";
  return `${c.suit}${c.rank}`;
}

// Trick: success if red card (♥♦). Treat Joker as success.
export function trickSuccess(card){
  if (!card) return false;
  if (card.joker) return true;
  return card.suit==="♥" || card.suit==="♦";
}

// ---------- Dice ----------
export function parseXdY(s){
  const m = String(s||"1d6").match(/(\d+)\s*d\s*(\d+)/i);
  return { count: m?parseInt(m[1],10):1, sides: m?parseInt(m[2],10):6 };
}
export function rollDice(count, sides){
  const out=[]; for (let i=0;i<count;i++) out.push(1+Math.floor(Math.random()*sides)); return out;
}
export const sum = (arr)=> arr.reduce((a,b)=>a+b,0);
export function raises(total, tn){
  if (total < tn) return 0;
  return Math.floor((total - tn) / 5);
}
export function quicknessCardsFromResult(highestChain, mod, tn){
  const eff = highestChain + (mod||0);
  if (eff < tn) return 1;
  return 2 + raises(eff, tn);
}

// ---------- Combat hit location ----------
export function pickCombatHitLocation(){
  const n = 1 + Math.floor(Math.random()*20);
  if (n<=3) return "Head";
  if (n<=7) return "Guts";
  if (n<=10) return "Left Arm";
  if (n<=13) return "Right Arm";
  if (n<=16) return "Left Leg";
  return "Right Leg";
}

// ---------- Hand evaluation helpers with Jokers (simplified but robust) ----------
const RVAL = new Map(RANKS.map((r,i)=>[r, i+2])); // 2..14(A)

function countByRank(cards){
  const map=new Map(); let jokers=0;
  for (const c of cards){
    if (c.joker) { jokers++; continue; }
    map.set(c.rank, (map.get(c.rank)||0)+1);
  }
  return { map, jokers };
}
function countBySuit(cards){
  const map=new Map(); let jokers=0;
  for (const c of cards){
    if (c.joker) { jokers++; continue; }
    map.set(c.suit, (map.get(c.suit)||0)+1);
  }
  return { map, jokers };
}

function canMakeNKind(n, counts){
  const { map, jokers } = counts;
  let need = n;
  for (const v of map.values()) need = Math.min(need, Math.max(n - v, 0));
  return jokers >= Math.min(n-1, need);
}

function bestKindRank(n, cards){
  const { map, jokers } = countByRank(cards);
  let best = -1;
  for (const [r, v] of map.entries()){
    const need = Math.max(0, n - v);
    if (need <= jokers) best = Math.max(best, RVAL.get(r));
  }
  if (best<0 && jokers>=n) best = 14; // all jokers can form Aces
  return best;
}

function canMakeFlush(cards){
  const { map, jokers } = countBySuit(cards);
  for (const v of map.values()) if (v + jokers >= 5) return true;
  return jokers>=5;
}

function canMakeStraight(cards){
  // consider ranks 2..14; jokers can fill gaps
  const { map, jokers } = countByRank(cards);
  const ranks = [...map.keys()].map(r=>RVAL.get(r)).sort((a,b)=>a-b);
  const uniq = [...new Set(ranks)];
  // try sequences starting from 10 down to 2; also A-low (A counts as 1)
  const trySeq = (vals, J) => {
    for (let start=2; start<=10; start++){
      let need=0;
      for (let k=0;k<5;k++){
        const v=start+k;
        if (!vals.includes(v)) need++;
      }
      if (need<=J) return true;
    }
    // A-low straight (A,2,3,4,5)
    let needA = 0;
    const low = [14,2,3,4,5];
    for (const v of low) if (!uniq.includes(v)) needA++;
    return needA<=J;
  };
  return trySeq(uniq, jokers);
}

function classify5(cards){
  // returns {rank, name}
  const j = cards.filter(c=>c.joker).length;
  const countsR = countByRank(cards);
  const countsS = countBySuit(cards);
  const isFlush = canMakeFlush(cards);
  const isStraight = canMakeStraight(cards);
  const four = canMakeNKind(4, countsR);
  const three = canMakeNKind(3, countsR);
  // full house: 3 + 2 using jokers
  let full = false;
  {
    const { map, jokers } = countsR;
    // try each rank as trips
    for (const [r,v] of map.entries()){
      const need3 = Math.max(0, 3-v);
      if (need3>jokers) continue;
      const jLeft = jokers - need3;
      // pair from remaining ranks or jokers
      let possiblePair = jLeft>=2;
      for (const [r2,v2] of map.entries()){
        if (r2===r) continue;
        const need2 = Math.max(0, 2-v2);
        if (need2<=jLeft) { possiblePair=true; break; }
      }
      if (possiblePair){ full=true; break; }
    }
    if (!full && jokers>=3 && (map.size>=1 || jokers>=5)) full=true;
  }

  if (isStraight && isFlush) return { rank:9, name:"Straight Flush" };
  if (four) return { rank:8, name:"Four of a Kind" };
  if (full) return { rank:7, name:"Full House" };
  if (isFlush) return { rank:6, name:"Flush" };
  if (isStraight) return { rank:5, name:"Straight" };
  if (three) return { rank:4, name:"Three of a Kind" };

  // two pair / pair (approximate with jokers)
  const { map, jokers } = countsR;
  const pairs = [...map.values()].filter(v=>v>=2).length;
  if (pairs>=2 || (pairs===1 && jokers>=1) || jokers>=2) return { rank:3, name:"Two Pair" };
  if (pairs===1 || jokers>=1) return { rank:2, name:"Pair" };

  return { rank:1, name:"High Card" };
}

// For dynamic label on selections with <5 cards
export function classifySelectionQuick(sel){
  if (!sel || sel.length===0) return { name:"High Card" };
  if (sel.length<5){
    // quick pass: look for multiples
    const { map, jokers } = countByRank(sel);
    const maxv = Math.max(0, ...map.values());
    if (maxv + jokers >= 4) return { name:"Four of a Kind" };
    if (maxv + jokers >= 3) return { name:"Three of a Kind" };
    if ((maxv>=2 && jokers>=1) || jokers>=2) return { name:"Full House" }; // optimistic
    if (maxv + jokers >= 2) return { name:"Pair" };
    return { name:"High Card" };
  }
  return classify5(sel);
}

// Rank best 5-card hand from drawn cards (with jokers)
export function rankAll5Hands(cards){
  if (!cards || cards.length<1) return [];
  const hands=[];
  const combos = kCombos(cards, Math.min(5, cards.length));
  for (const combo of combos){
    if (combo.length<5) continue;
    const cls = classify5(combo);
    hands.push({ name: cls.name, strength: cls.rank, cardsResolved: combo });
  }
  hands.sort((a,b)=> b.strength - a.strength);
  return hands;
}

function kCombos(arr, k){
  const res=[]; const n=arr.length;
  if (k>n) return [arr.slice()];
  const idxs = Array.from({length:k},(_,i)=>i);
  while (true){
    res.push(idxs.map(i=>arr[i]));
    let i=k-1;
    while (i>=0 && idxs[i]===i+n-k) i--;
    if (i<0) break;
    idxs[i]++;
    for (let j=i+1;j<k;j++) idxs[j]=idxs[j-1]+1;
  }
  return res;
}

// ---------- Requirements ----------
export function checkDeckRequirement(minRaw, handName, selected){
  if (!minRaw) return { pass:true, why:"" };
  const s = String(minRaw||"").trim().toLowerCase();

  // High Card with Ace (many phrasings)
  if (/high\s*card/.test(s) && /ace/.test(s) || /\bace\b/.test(s)){
    const hasAce = containsAceOrJokerAsAce(selected);
    return { pass: !!hasAce, why: hasAce? "" : "Must include an Ace (Joker counts)" };
  }

  // Pair w/ Jacks (or “Jacks” tokens)
  if (/pair/.test(s) && /jack/.test(s)){
    const ok = hasAtLeastPairOfRankOrHigher(selected, "J"); // J or A with jokers allowed
    return { pass: ok, why: ok? "" : "Must include at least a Pair of Jacks (Jokers can complete)" };
  }

  // "None" or unspecified
  if (/none/.test(s)) return { pass:true, why:"" };

  // Generic: accept anything
  return { pass:true, why:"" };
}

function containsAceOrJokerAsAce(cards){
  let hasAce = cards.some(c=>!c.joker && c.rank==="A");
  if (hasAce) return true;
  return cards.some(c=>c.joker); // treat any Joker as acceptable Ace
}
function hasAtLeastPairOfRankOrHigher(cards, minRank="J"){
  const target = RVAL.get(minRank);
  const { map, jokers } = countByRank(cards);
  // direct pair of rank >= J
  for (const [r, v] of map.entries()){
    const rv = RVAL.get(r);
    const need = Math.max(0, 2 - v);
    if (rv>=target && need<=jokers) return true;
  }
  // all jokers can make AA
  if (jokers>=2) return true;
  // one joker + single J/A
  for (const [r,v] of map.entries()){
    const rv = RVAL.get(r);
    if (rv>=target && v>=1 && jokers>=1) return true;
  }
  return false;
}
