// 產品圖片獵取:第四步 — 本機覆核頁(使用者逐項確認候選圖,並可順便標記未販售)
// 用法:node scripts/image-hunt/review-server.mjs → 開 http://localhost:4600
// 決策存 工作區/decisions.json:{ [targetId]: { picks: [{dir,file,imageUrl,pageUrl}, ...], discontinued? } | { skip: true, discontinued? } | { discontinued: true } }
// 2026-07-21 改複選:picks 是有序陣列,第 1 張(picks[0])當主圖,第 2 張起用於官網/企業系統產品頁
// 「游標移到圖片時切換另一張圖」的 hover 效果來源圖。點候選圖是切換勾選(不是單選),選取順序即 picks 順序。
// discontinued 標記獨立於選圖,可單獨勾選;之後由 apply-discontinued.mjs(dry-run→--write)合併回 products_catalog.json

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const CAND = path.join(WORKSPACE, 'candidates')
const DECISIONS = path.join(WORKSPACE, 'decisions.json')
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../..')

// 目標品牌名 → crawl.mjs/match.mjs 的品牌代號(與 match.mjs 的 BRAND_NAME 對照表互為反向,只列已有官網爬蟲設定的品牌)
const BRAND_TO_KEY = {
  Zirkonzahn: 'zirkonzahn',
  YAMAHACHI: 'yamahachi',
  'Davis Schottlander': 'schottlander',
  'GC / 台灣而至': 'gc',
  DENKEN: 'denken',
  'Song Young': 'songyoung',
  貝施美: 'besmile',
  YAMAKIN: 'yamakin',
  'WHIP MIX': 'whipmix',
  MESTRA: 'mestra',
  DETAX: 'detax',
  KEYSTONE: 'keystone',
  Dekema: 'dekema',
  SAEYANG: 'saeyang',
  ASIGA: 'asiga',
  'UGin Dental': 'ugin',
  CADstar: 'cadstar',
}

// brandKey → { status: 'running'|'done'|'error', step, startedAt, finishedAt, error }
const researchJobs = new Map()

function loadDecisions() {
  try { return JSON.parse(fs.readFileSync(DECISIONS, 'utf8')) } catch { return {} }
}

// 目標名稱幾乎是純中文、又沒有英文 hints 可用 → 天生沒有可比對的字詞,配不到英文官網頁面,
// 混在一般清單裡只會讓使用者白核對(2026-07-21 使用者反饋)。獨立標記出來,另外用「純中文」分頁處理。
function isChineseOnly(target) {
  if ((target.hints || []).length > 0) return false
  const name = target.name || ''
  let ascii = 0, total = 0
  for (const ch of name) {
    if (!/[0-9A-Za-z一-鿿]/.test(ch)) continue
    total++
    if (/[0-9A-Za-z]/.test(ch)) ascii++
  }
  return total > 0 && ascii / total < 0.2
}

function listItems() {
  const decisions = loadDecisions()
  const dirs = fs.existsSync(CAND) ? fs.readdirSync(CAND).filter((d) => fs.existsSync(path.join(CAND, d, 'meta.json'))) : []
  return dirs.map((d) => {
    const meta = JSON.parse(fs.readFileSync(path.join(CAND, d, 'meta.json'), 'utf8'))
    return { dir: d, target: meta.target, candidates: meta.candidates, decided: decisions[meta.target.id] ?? null }
  })
}

// 純中文目標從來不會進 candidates/(match.mjs 因為沒有可用詞直接跳過,連資料夾都不會產生),
// 所以不能從 listItems() 篩,必須另外直接讀 targets.json 才找得到這批。
function loadTargets() {
  try { return JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8')).targets } catch { return [] }
}

function listChineseOnlyTargets() {
  const decisions = loadDecisions()
  const existingDirs = new Set(fs.existsSync(CAND) ? fs.readdirSync(CAND) : [])
  return loadTargets()
    .filter((t) => isChineseOnly(t) && !existingDirs.has(t.id.replace(/[:\/]/g, '_')))
    .map((t) => ({ target: t, decided: decisions[t.id] ?? null }))
}

function runStep(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], { cwd: REPO_ROOT })
    let stderr = ''
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-2000) || `exit ${code}`))))
  })
}

async function startResearch(brandKey, targetId) {
  researchJobs.set(brandKey, { status: 'running', step: '重新爬取官網…', startedAt: Date.now() })
  try {
    await runStep(path.join(SCRIPTS_DIR, 'crawl.mjs'), [brandKey])
    researchJobs.set(brandKey, { status: 'running', step: '比對候選圖…', startedAt: researchJobs.get(brandKey).startedAt })
    await runStep(path.join(SCRIPTS_DIR, 'match.mjs'), [brandKey, `--target-id=${targetId}`])
    researchJobs.set(brandKey, { status: 'done', startedAt: researchJobs.get(brandKey).startedAt, finishedAt: Date.now() })
  } catch (e) {
    researchJobs.set(brandKey, { status: 'error', error: String(e.message || e).slice(0, 500), startedAt: researchJobs.get(brandKey)?.startedAt, finishedAt: Date.now() })
  }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>產品圖片覆核</title>
<style>
body{font-family:system-ui,'PingFang TC',sans-serif;margin:0;background:#f5f4f0;color:#333}
header{position:sticky;top:0;background:#fff;padding:12px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;gap:16px;align-items:center;z-index:2}
header b{font-size:18px} .prog{color:#8a7a55;font-weight:600}
.item{background:#fff;margin:14px 20px;border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.item.done{opacity:.45}
.item.discontinued{opacity:1;background:#fdf3f2;box-shadow:0 1px 3px rgba(196,60,44,.15)}
.hd{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.hd .code{font-family:ui-monospace,monospace;color:#8a7a55}
.hd .kind{font-size:12px;background:#f0ead8;border-radius:6px;padding:2px 8px}
.hd .members{font-size:12px;color:#999}
.hd .badge-disc{font-size:12px;background:#c43c2c;color:#fff;border-radius:6px;padding:2px 8px;font-weight:600}
.cands{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
.cand{position:relative;border:2px solid #e5e0d5;border-radius:10px;padding:8px;width:200px;cursor:pointer;background:#fafaf8}
.cand:hover{border-color:#b49b57}
.cand.selected{border-color:#8a7a55;background:#f6f1e3}
.cand img{width:100%;height:150px;object-fit:contain;background:#fff;border-radius:6px}
.cand .src{font-size:11px;color:#888;margin-top:6px;word-break:break-all;max-height:42px;overflow:hidden}
.cand .score{font-size:12px;color:#b49b57;font-weight:600}
.cand .order{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;background:#8a7a55;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.cand .order.hover-tag{background:#2c5fa3}
.hint-multi{margin:0 20px 14px;padding:10px 16px;border-radius:10px;background:#eef3fb;color:#2c5fa3;font-size:13px}
.actions{margin-top:10px;display:flex;gap:8px;align-items:center}
button{border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:14px}
.skip{background:#eee} .undo{background:#fbe9e7}
.disc{background:#fbe4e1;color:#c43c2c;font-weight:600}
.disc.on{background:#c43c2c;color:#fff}
.research{background:#eaf1fb;color:#2c5fa3}
.research:disabled{opacity:.6;cursor:wait}
.filter{margin-left:auto;display:flex;gap:8px;align-items:center}
.filter button{background:#f0ead8}
.filter button.on{background:#8a7a55;color:#fff}
.filter button.discOn{background:#c43c2c;color:#fff}
.filter button.zhOn{background:#7a6a9a;color:#fff}
.filter select{border:1px solid #e5e0d5;border-radius:8px;padding:7px 10px;font-size:14px;background:#fff;max-width:220px}
.hint-zh{margin:14px 20px;padding:12px 16px;border-radius:10px;background:#f3f0f8;color:#6a5a8a;font-size:13px}
</style></head><body>
<header><b>產品圖片覆核</b><span class="prog" id="prog"></span>
<div class="filter">
  <select id="fBrand"><option value="">全部品牌</option></select>
  <button id="fAll">全部</button><button id="fTodo" class="on">未決</button><button id="fDone">已決</button>
  <button id="fDisc">未販售</button><button id="fZh">純中文(需人工)</button>
</div>
</header>
<div id="list"></div>
<script>
const BRAND_TO_KEY = ${JSON.stringify(BRAND_TO_KEY)};
let items=[], mode='todo', brand='', discOnly=false, zhOnly=false;
const polling = new Set();
async function research(id, brandKey, btn){
  btn.disabled = true; btn.textContent = '🔍 搜尋中…(可能要 1-2 分鐘)';
  await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,brandKey})});
  if (polling.has(brandKey)) return;
  polling.add(brandKey);
  const timer = setInterval(async () => {
    const s = await (await fetch('/api/research-status?brand='+brandKey)).json();
    if (s.status === 'running') { btn.textContent = '🔍 ' + (s.step||'搜尋中…'); return; }
    clearInterval(timer); polling.delete(brandKey);
    if (s.status === 'error') { btn.disabled = false; btn.textContent = '⚠️ 搜尋失敗,再試一次'; console.error(s.error); }
    else { await load(); }
  }, 3000);
}
let zhItems=[];
async function load(){
  [items, zhItems] = await Promise.all([
    (await fetch('/api/items')).json(),
    (await fetch('/api/chinese-only')).json(),
  ]);
  const sel = document.getElementById('fBrand');
  const counts = {};
  for (const it of items) { const b = it.target.brand || '(無品牌)'; counts[b] = (counts[b]||0)+1; }
  const brands = Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
  sel.innerHTML = '<option value="">全部品牌 ('+items.length+')</option>' + brands.map(b=>'<option value="'+b+'">'+b+' ('+counts[b]+')</option>').join('');
  sel.value = brand;
  render();
}
function render(){
  const el=document.getElementById('list'); el.innerHTML='';
  const byBrand = brand ? items.filter(it=>(it.target.brand||'(無品牌)')===brand) : items;
  const zhByBrand = brand ? zhItems.filter(it=>(it.target.brand||'(無品牌)')===brand) : zhItems;
  const discCount = byBrand.filter(i=>i.decided && i.decided.discontinued).length;
  document.getElementById('prog').textContent = '已決 '+byBrand.filter(i=>i.decided).length+' / '+byBrand.length+(brand?'(此品牌)':'')+' ・ 未販售 '+discCount+' 筆 ・ 純中文待人工 '+zhByBrand.length+' 筆';

  if (zhOnly) {
    const hint = document.createElement('div'); hint.className = 'hint-zh';
    hint.textContent = '這些品項名稱幾乎是純中文,沒有可比對的英文詞,官網爬蟲/比對從一開始就配不到(不是選錯,是根本沒有候選圖可生成)。建議直接手動搜圖,或標記未販售/跳過。';
    el.appendChild(hint);
    for (const it of zhByBrand) {
      const disc = !!(it.decided && it.decided.discontinued);
      const t = it.target;
      const d=document.createElement('div'); d.className='item'+(it.decided&&!disc?' done':'')+(disc?' discontinued':'');
      d.innerHTML='<div class="hd"><span class="kind">'+(t.kind==='series'?'系列':'品項組')+'</span><b>'+t.name+'</b>'+
        '<span class="code">'+t.code+'</span><span>'+ (t.brand||'') +'</span>'+
        (t.memberCodes?'<span class="members">覆蓋 '+t.memberCodes.length+' SKU</span>':(t.memberCount?'<span class="members">系列 '+t.memberCount+' SKU</span>':''))+
        (disc?'<span class="badge-disc">未販售</span>':'')+'</div>'+
        '<div class="actions"><button class="skip" onclick="skip(\\''+t.id+'\\')">已用其他方式處理,跳過</button>'+
        '<button class="disc'+(disc?' on':'')+'" onclick="toggleDisc(\\''+t.id+'\\')">'+(disc?'✓ 已標記未販售(點擊取消)':'🚫 標記未販售/停售')+'</button>'+
        (it.decided?'<button class="undo" onclick="undo(\\''+t.id+'\\')">撤銷</button>':'')+'</div>';
      el.appendChild(d);
    }
    return;
  }

  let shown;
  if (discOnly) shown = byBrand.filter(it=> it.decided && it.decided.discontinued);
  else shown = byBrand.filter(it=> mode==='all' || (mode==='todo'?!it.decided:it.decided));
  if (shown.length) {
    const hint = document.createElement('div'); hint.className = 'hint-multi';
    hint.textContent = '圖片可複選:點擊切換勾選,選取順序就是排序。①號當主圖,②號用於滑鼠移過去時切換顯示的圖(官網/企業系統產品頁 hover 效果)。';
    el.appendChild(hint);
  }
  for(const it of shown){
    const disc = !!(it.decided && it.decided.discontinued);
    const picks = (it.decided && it.decided.picks) || [];
    const d=document.createElement('div'); d.className='item'+(it.decided&&!disc?' done':'')+(disc?' discontinued':'');
    const t=it.target;
    d.innerHTML='<div class="hd"><span class="kind">'+(t.kind==='series'?'系列':'品項組')+'</span><b>'+t.name+'</b>'+
      '<span class="code">'+t.code+'</span><span>'+ (t.brand||'') +'</span>'+
      (t.memberCodes?'<span class="members">覆蓋 '+t.memberCodes.length+' SKU</span>':(t.memberCount?'<span class="members">系列 '+t.memberCount+' SKU</span>':''))+
      (disc?'<span class="badge-disc">未販售</span>':'')+'</div>'+
      '<div class="cands">'+it.candidates.map(c=>{
        const idx = picks.findIndex(p=>p.file===c.file);
        const selected = idx>=0;
        const badge = selected ? ('<div class="order'+(idx===1?' hover-tag':'')+'">'+(idx+1)+'</div>') : '';
        return '<div class="cand'+(selected?' selected':'')+'" onclick="toggleCand(\\''+t.id+'\\',\\''+it.dir+'\\',\\''+c.file+'\\')">'+
          badge+'<img loading="lazy" src="/img/'+it.dir+'/'+c.file+'"><div class="score">分數 '+c.score+'</div><div class="src">'+c.pageTitle+'</div></div>';
      }).join('')+'</div>'+
      '<div class="actions"><button class="skip" onclick="skip(\\''+t.id+'\\')">全部不對,跳過</button>'+
      (BRAND_TO_KEY[t.brand]?'<button class="research" onclick="research(\\''+t.id+'\\',\\''+BRAND_TO_KEY[t.brand]+'\\',this)">🔄 重新搜尋(該品牌官網)</button>':'')+
      '<button class="disc'+(disc?' on':'')+'" onclick="toggleDisc(\\''+t.id+'\\')">'+(disc?'✓ 已標記未販售(點擊取消)':'🚫 標記未販售/停售')+'</button>'+
      (it.decided?'<button class="undo" onclick="undo(\\''+t.id+'\\')">撤銷</button>':'')+'</div>';
    el.appendChild(d);
  }
}
async function post(body){ await fetch('/api/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); await load(); }
function toggleCand(id,dir,file){ post({id,dir,file,toggle:true}) }
function skip(id){ post({id,skip:true}) }
function undo(id){ post({id,undo:true}) }
function toggleDisc(id){ post({id,toggleDiscontinued:true}) }
for(const [b,m] of [['fAll','all'],['fTodo','todo'],['fDone','done']]){
  document.getElementById(b).onclick=()=>{
    mode=m; discOnly=false; zhOnly=false;
    document.getElementById('fDisc').classList.remove('discOn');
    document.getElementById('fZh').classList.remove('zhOn');
    document.querySelectorAll('.filter button').forEach(x=>x.classList.remove('on'));
    document.getElementById(b).classList.add('on');
    render();
  }
}
document.getElementById('fDisc').onclick=()=>{discOnly=!discOnly; if(discOnly) zhOnly=false; document.getElementById('fDisc').classList.toggle('discOn',discOnly); document.getElementById('fZh').classList.toggle('zhOn',zhOnly); render()}
document.getElementById('fZh').onclick=()=>{zhOnly=!zhOnly; if(zhOnly) discOnly=false; document.getElementById('fZh').classList.toggle('zhOn',zhOnly); document.getElementById('fDisc').classList.toggle('discOn',discOnly); render()}
document.getElementById('fBrand').onchange=(e)=>{brand=e.target.value;render()}
load();
</script></body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE) }
  if (url.pathname === '/api/items') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listItems())) }
  if (url.pathname === '/api/chinese-only') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listChineseOnlyTargets())) }
  if (url.pathname.startsWith('/img/')) {
    const p = path.join(CAND, decodeURIComponent(url.pathname.slice(5)))
    if (!p.startsWith(CAND) || !fs.existsSync(p)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    return fs.createReadStream(p).pipe(res)
  }
  if (url.pathname === '/api/research-status' && req.method === 'GET') {
    const brand = url.searchParams.get('brand')
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(researchJobs.get(brand) || { status: 'idle' }))
  }
  if (url.pathname === '/api/research' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { id, brandKey } = JSON.parse(body)
      if (!Object.values(BRAND_TO_KEY).includes(brandKey)) {
        res.writeHead(400); return res.end('unknown brand key')
      }
      const current = researchJobs.get(brandKey)
      if (current && current.status === 'running') { res.writeHead(200); return res.end('already running') }
      startResearch(brandKey, id) // 背景執行,不擋 response
      res.writeHead(200); res.end('started')
    })
    return
  }
  if (url.pathname === '/api/decide' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const { id, dir, file, skip, undo, toggleDiscontinued, toggle } = JSON.parse(body)
      const decisions = loadDecisions()
      if (undo) delete decisions[id]
      else if (toggleDiscontinued) {
        const current = decisions[id] || {}
        decisions[id] = { ...current, discontinued: !current.discontinued }
      }
      else if (skip) decisions[id] = { ...(decisions[id] || {}), skip: true }
      else if (toggle) {
        // 複選:點候選圖是切換勾選,不是單選。picks 陣列順序 = 選取順序(①主圖 ②hover 替換圖)
        const current = decisions[id] || {}
        const picks = current.picks || []
        const existingIdx = picks.findIndex((p) => p.file === file)
        let nextPicks
        if (existingIdx >= 0) nextPicks = picks.filter((p) => p.file !== file)
        else {
          const meta = JSON.parse(fs.readFileSync(path.join(CAND, dir, 'meta.json'), 'utf8'))
          const cand = meta.candidates.find((c) => c.file === file)
          nextPicks = [...picks, { dir, file, imageUrl: cand.imageUrl, pageUrl: cand.pageUrl }]
        }
        // 全部取消勾選、又沒有標未販售/跳過 → 回到「未決」,不要留一個空殼決策
        if (nextPicks.length === 0 && !current.discontinued && !current.skip) delete decisions[id]
        else decisions[id] = { ...current, picks: nextPicks }
      }
      fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 1))
      res.writeHead(200); res.end('ok')
    })
    return
  }
  res.writeHead(404); res.end()
})
server.listen(4600, () => console.log('覆核頁:http://localhost:4600(決策即時存 decisions.json,關掉重開不會掉)'))
