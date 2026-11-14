'use strict';
/* 靈感:隨手記下文字、圖片、錄音、塗鴉。
   一則靈感可以不斷補充片段;放著沒動的會定期「重逢」,兩則之間可以「碰撞」。 */

const SP_STATUS = { new: '新火花', growing: '發展中', parked: '先放著', done: '已轉專案' };
const SP_KIND = { text: '文字', image: '圖片', audio: '錄音', doodle: '塗鴉' };
const RESURFACE_DAYS = 14; // 超過這麼多天沒碰的靈感,會出現在「重逢」
S.spFilter = 'all'; S.spQuery = '';

// ---------- 小工具 ----------
const mediaUrl = (id) => `/api/media/${id}`;
const spark = (id) => S.data.sparks.find((x) => x.id === id);
const spTexts = (sp) => sp.items.filter((i) => i.kind === 'text').map((i) => i.text);
const spCover = (sp) => sp.items.find((i) => i.kind === 'image' || i.kind === 'doodle');
const URL_RE = /https?:\/\/[^\s<>"']+/g;
function spTitle(sp) {
  if (sp.title) return sp.title;
  const line = (spTexts(sp)[0] || '').split('\n')[0].replace(URL_RE, '').trim();
  if (line) return line.length > 40 ? line.slice(0, 40) + '…' : line;
  const url = (spTexts(sp).join(' ').match(URL_RE) || [])[0];
  if (url) return hostOf(url);
  return `${SP_KIND[sp.items[0]?.kind] || '靈感'}・${sp.created_at.slice(5, 10).replace('-', '/')}`;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 864e5);
function ago(iso) {
  const d = daysSince(iso);
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前` : d < 365 ? `${Math.floor(d / 30)} 個月前` : `${Math.floor(d / 365)} 年前`;
}
function stamp(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 文字轉 HTML:跳脫後把網址變成連結
const linkify = (text) => h(text).replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 60 ? u.slice(0, 60) + '…' : u}</a>`);
const heatDots = (n) => `<span class="heat" title="熱度 ${n}:每次補充或按「還有感覺」就加溫">${'<i></i>'.repeat(Math.min(n, 5))}${n > 5 ? `<b>+${n - 5}</b>` : ''}</span>`;

// ---------- 靈感牆 ----------
function spMatches(sp) {
  if (S.spFilter !== 'all' && sp.status !== S.spFilter) return false;
  const q = S.spQuery.trim().toLowerCase();
  if (!q) return true;
  return [sp.title, TYPES[sp.type_key]?.label, ...spTexts(sp), ...sp.items.map((i) => i.text)].join('\n').toLowerCase().includes(q);
}
function sparkCard(sp, extra = '') {
  const cover = spCover(sp), text = spTexts(sp).join('\n');
  const body = text.replace(URL_RE, '').trim();
  const links = [...new Set((text.match(URL_RE) || []).map(hostOf))];
  const n = (k) => sp.items.filter((i) => i.kind === k).length;
  const title = spTitle(sp);
  // 沒有自訂標題時,標題就是內文第一行;摘要只放其餘部分(第一行被截斷時則保留全文)
  const lines = body.split('\n'), firstIsTitle = !sp.title && lines[0].trim() === title;
  const rest = (firstIsTitle ? lines.slice(1).join('\n') : body).trim();
  const excerpt = rest.length > 160 ? rest.slice(0, 160) + '…' : rest;
  return `<article class="sp st-${sp.status}${sp.heat >= 4 ? ' hot' : ''}" data-act="sp-open" data-id="${sp.id}" tabindex="0" role="button" aria-label="${h(title)}">
    ${cover ? `<img class="sp-cover${cover.kind === 'doodle' ? ' doodle' : ''}" src="${mediaUrl(cover.media_id)}" alt="" loading="lazy">` : ''}
    <div class="sp-b">
      <div class="sp-t">${h(title)}</div>
      ${excerpt ? `<div class="sp-x">${h(excerpt)}</div>` : ''}
      <div class="sp-chips">${links.map((l) => `<span class="badge">↗ ${h(l)}</span>`).join('')}${n('audio') ? `<span class="badge">♪ 錄音${n('audio') > 1 ? ' ×' + n('audio') : ''}</span>` : ''}${n('image') + n('doodle') > 1 ? `<span class="badge">圖 ×${n('image') + n('doodle')}</span>` : ''}</div>
      <div class="sp-f"><span class="badge sp-${sp.status}">${SP_STATUS[sp.status]}</span>${sp.type_key && TYPES[sp.type_key] ? `<span><span class="dot" style="background:${tcolor(sp.type_key)}"></span>${h(TYPES[sp.type_key].short)}</span>` : ''}<span>${ago(sp.touched_at)}</span><span class="spacer"></span>${heatDots(sp.heat)}</div>
      ${extra}
    </div></article>`;
}
// 今天該「重逢」的靈感:久未接觸、尚未轉成專案;依日期決定,同一天看到同樣的
function resurfaced(max = 2) {
  const pool = S.data.sparks.filter((sp) => sp.status !== 'done' && daysSince(sp.touched_at) >= RESURFACE_DAYS).sort((a, b) => a.id - b.id);
  if (!pool.length) return [];
  const seed = Number(today().replace(/-/g, ''));
  const out = [];
  for (let i = 0, n = Math.min(max, pool.length); i < n; i++) out.push(pool.splice((seed * (i + 7)) % pool.length, 1)[0]);
  return out;
}
const reunionActs = (sp) => `<div class="sp-re"><button class="btn sm" data-act="sp-touch" data-id="${sp.id}">還有感覺</button><button class="btn sm" data-act="sp-set" data-id="${sp.id}" data-status="growing">發展它</button><button class="btn sm" data-act="sp-set" data-id="${sp.id}" data-status="parked">繼續放著</button></div>`;
function wallHtml() {
  const list = S.data.sparks.filter(spMatches).sort((a, b) => b.touched_at.localeCompare(a.touched_at));
  if (!S.data.sparks.length) return `<div class="card empty">還沒有任何靈感。<br>想到什麼就按右下角的 ✦,打字、貼網址、拍照、錄音或隨手塗鴉都可以。</div>`;
  return list.length ? `<div class="wall">${list.map((sp) => sparkCard(sp)).join('')}</div>` : '<div class="card empty">沒有符合的靈感</div>';
}
function viewSparks() {
  const re = resurfaced(), cnt = (k) => S.data.sparks.filter((sp) => k === 'all' || sp.status === k).length;
  return `
  <div class="head"><h1>靈感</h1>${S.data.sparks.length > 1 ? '<button class="btn" data-act="sp-collide">碰撞</button>' : ''}<button class="btn primary" data-act="dlg-spark">＋ 記一筆</button></div>
  ${re.length ? `<div class="card reunion"><h2>重逢<span class="small muted" style="font-weight:400">・這些想法放了一陣子,現在看還有感覺嗎?</span></h2><div class="wall">${re.map((sp) => sparkCard(sp, reunionActs(sp))).join('')}</div></div>` : ''}
  <div class="head"><div class="chips">${[['all', '全部'], ...Object.entries(SP_STATUS)].map(([k, label]) => `<button class="chip${S.spFilter === k ? ' on' : ''}" data-act="sp-filter" data-k="${k}">${label} ${cnt(k)}</button>`).join('')}</div>
    <span style="flex:1"></span><input class="sp-q" type="search" data-sp-q placeholder="搜尋靈感" value="${h(S.spQuery)}" aria-label="搜尋靈感"></div>
  <div id="sp-wall">${wallHtml()}</div>`;
}
function sparkDashCard() {
  const re = resurfaced(1)[0], fresh = S.data.sparks.filter((sp) => sp.status === 'new').length, growing = S.data.sparks.filter((sp) => sp.status === 'growing').length;
  if (!S.data.sparks.length) return '';
  return `<div class="card"><h2>靈感<span class="small muted" style="font-weight:400">・新火花 ${fresh}・發展中 ${growing}</span><span class="spacer"></span><a class="small" href="#/sparks">靈感牆 ›</a></h2>
    ${re ? `<div class="small muted" style="margin-bottom:8px">今日重逢:${ago(re.touched_at)}的想法,現在看還有感覺嗎?</div><div class="wall one">${sparkCard(re, reunionActs(re))}</div>`
    : `<div class="wall">${S.data.sparks.slice().sort((a, b) => b.touched_at.localeCompare(a.touched_at)).slice(0, 3).map((sp) => sparkCard(sp)).join('')}</div>`}</div>`;
}
function sparkProjectCard(pid) {
  const list = S.data.sparks.filter((sp) => sp.project_id === pid);
  return list.length ? `<div class="card"><h2>相關靈感</h2><div class="wall">${list.map((sp) => sparkCard(sp)).join('')}</div></div>` : '';
}

// ---------- 記錄器(文字 + 圖片 + 錄音 + 塗鴉) ----------
const C = { att: [], rec: null, recTimer: 0, pad: null }; // att: [{ kind, blob, url }]
function resetComposer() {
  stopRecording(true);
  C.att.forEach((a) => URL.revokeObjectURL(a.url));
  C.att = []; C.pad = null;
}
function composerHtml(placeholder, text = '') {
  return `<div class="composer">
    <textarea name="text" placeholder="${h(placeholder)}" rows="4">${h(text)}</textarea>
    <div class="sp-tools">
      <button type="button" class="btn sm" data-act="sp-pick">圖片 / 拍照</button>
      <button type="button" class="btn sm" data-act="sp-rec" id="sp-rec">錄音</button>
      <button type="button" class="btn sm" data-act="sp-doodle">塗鴉</button>
      <input type="file" accept="image/*" multiple hidden data-sp-file>
    </div>
    <div id="sp-pad" hidden></div>
    <div id="sp-att" class="sp-att"></div>
    <div class="small muted">可直接貼上截圖或網址。</div>
  </div>`;
}
function renderAtt() {
  const box = $('#sp-att'); if (!box) return;
  box.innerHTML = C.att.map((a, i) => `<div class="att">${a.kind === 'audio' ? `<audio controls src="${a.url}"></audio>` : `<img src="${a.url}" alt="${SP_KIND[a.kind]}">`}<button type="button" class="btn sm" data-act="sp-att-del" data-i="${i}" aria-label="移除">✕</button></div>`).join('');
}
function addAtt(kind, blob) { C.att.push({ kind, blob, url: URL.createObjectURL(blob) }); renderAtt(); }

// 圖片先縮到長邊 1600px 再上傳,節省主機空間
async function addImage(file) {
  if (!file.type.startsWith('image/')) return;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    addAtt('image', blob);
  } catch {
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) addAtt('image', file);
    else toast('無法讀取這張圖片');
  }
}

async function toggleRecording() {
  if (C.rec) return stopRecording(false);
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('這個瀏覽器不支援錄音(需使用 HTTPS)');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('無法使用麥克風,請允許麥克風權限'); }
  const rec = new MediaRecorder(stream), chunks = [], t0 = Date.now();
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (!rec.discard && chunks.length) addAtt('audio', new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] }));
  };
  rec.start(); C.rec = rec;
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000), b = $('#sp-rec');
    if (b) { b.textContent = `■ 停止 ${Math.floor(s / 60)}:${pad(s % 60)}`; b.classList.add('recording'); }
    if (s >= 600) stopRecording(false); // 單段最長 10 分鐘
  };
  tick(); C.recTimer = setInterval(tick, 500);
}
function stopRecording(discard) {
  clearInterval(C.recTimer);
  if (C.rec) { C.rec.discard = discard; if (C.rec.state !== 'inactive') C.rec.stop(); C.rec = null; }
  const b = $('#sp-rec'); if (b) { b.textContent = '錄音'; b.classList.remove('recording'); }
}

// 塗鴉板:白底,筆畫存成陣列以便復原
const PAD_COLORS = ['#111111', '#d92d20', '#1c5cab', '#1b7a3a'];
function openPad() {
  const box = $('#sp-pad'); if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; C.pad = null; return; }
  box.hidden = false;
  box.innerHTML = `<canvas class="pad" aria-label="塗鴉區"></canvas>
    <div class="sp-tools">${PAD_COLORS.map((c, i) => `<button type="button" class="swatch${i ? '' : ' on'}" data-act="pad-color" data-c="${c}" style="background:${c}" aria-label="顏色"></button>`).join('')}
      <button type="button" class="btn sm" data-act="pad-width" data-w="3">細</button><button type="button" class="btn sm" data-act="pad-width" data-w="8">粗</button>
      <span style="flex:1"></span><button type="button" class="btn sm" data-act="pad-undo">復原</button><button type="button" class="btn sm" data-act="pad-clear">清除</button><button type="button" class="btn sm primary" data-act="pad-done">完成塗鴉</button></div>`;
  const cv = $('canvas', box), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, hgt = cv.clientHeight;
  cv.width = w * dpr; cv.height = hgt * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = (C.pad = { cv, ctx, w, h: hgt, strokes: [], cur: null, color: PAD_COLORS[0], width: 3 });
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); P.cur = { color: P.color, width: P.width, pts: [pos(e)] }; P.strokes.push(P.cur); drawPad(); });
  cv.addEventListener('pointermove', (e) => { if (!P.cur) return; P.cur.pts.push(pos(e)); drawPad(); });
  const end = () => { P.cur = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  drawPad();
}
function drawPad() {
  const P = C.pad; if (!P) return;
  P.ctx.fillStyle = '#fff'; P.ctx.fillRect(0, 0, P.w, P.h);
  for (const s of P.strokes) {
    P.ctx.strokeStyle = P.ctx.fillStyle = s.color; P.ctx.lineWidth = s.width;
    if (s.pts.length === 1) { P.ctx.beginPath(); P.ctx.arc(s.pts[0][0], s.pts[0][1], s.width / 2, 0, 7); P.ctx.fill(); continue; }
    P.ctx.beginPath(); P.ctx.moveTo(...s.pts[0]);
    for (const p of s.pts.slice(1)) P.ctx.lineTo(...p);
    P.ctx.stroke();
  }
}
async function finishPad() {
  const P = C.pad; if (!P) return;
  if (!P.strokes.length) return toast('還沒有畫任何東西');
  const blob = await new Promise((r) => P.cv.toBlob(r, 'image/png'));
  addAtt('doodle', blob);
  const box = $('#sp-pad'); box.hidden = true; box.innerHTML = ''; C.pad = null;
}

async function uploadMedia(blob) {
  const res = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || '上傳失敗');
  return out.id;
}
// 把記錄器目前的內容轉成片段(會先上傳附件)
async function collectItems(text) {
  if (C.rec) stopRecording(false);
  if (C.pad && C.pad.strokes.length) await finishPad();
  await new Promise((r) => setTimeout(r, 150)); // 等錄音收尾
  const items = [];
  if (String(text || '').trim()) items.push({ kind: 'text', text: text.trim() });
  for (const a of C.att) items.push({ kind: a.kind, media_id: await uploadMedia(a.blob) });
  if (!items.length) throw new Error('請先寫點什麼,或加上圖片、錄音、塗鴉');
  return items;
}

// ---------- 對話框 ----------
const typeOptions = (sel) => `<option value="">不指定類型</option>${opts(activeTypes(sel), sel)}`;
function dlgSpark(text = '') {
  resetComposer();
  openDlg(`<form data-form="spark"><h2>記一筆靈感</h2>
    ${composerHtml('想到什麼?工作、產品、點子,或只是一個念頭…', text)}
    <div class="row2" style="margin-top:10px"><label class="f"><span>相關工作類型(可不選)</span><select name="type_key">${typeOptions('')}</select></label>
      <label class="f"><span>先怎麼處理</span><select name="status"><option value="new">新火花(之後再看)</option><option value="growing">發展中(想繼續做)</option><option value="parked">先放著</option></select></label></div>
    ${dlgActions(false)}</form>`);
  $('#dlg textarea').focus();
}
function itemHtml(it, canDelete) {
  const del = canDelete ? `<button type="button" class="btn sm" data-act="sp-item-del" data-id="${it.id}" aria-label="刪除這個片段">✕</button>` : '';
  const bodyHtml = it.kind === 'text' ? `<div class="it-text">${linkify(it.text)}</div>`
    : it.kind === 'audio' ? `<audio controls preload="metadata" src="${mediaUrl(it.media_id)}"></audio>`
    : `<a href="${mediaUrl(it.media_id)}" target="_blank" rel="noopener"><img class="${it.kind === 'doodle' ? 'doodle' : ''}" src="${mediaUrl(it.media_id)}" alt="${SP_KIND[it.kind]}" loading="lazy"></a>`;
  return `<div class="it"><div class="it-h"><span>${stamp(it.created_at)}・${SP_KIND[it.kind]}</span>${del}</div>${bodyHtml}</div>`;
}
function dlgSparkView(id) {
  const sp = spark(id); if (!sp) return;
  resetComposer();
  const p = sp.project_id && proj(sp.project_id);
  openDlg(`<form data-form="spark-add" data-id="${id}" class="sp-view">
    <input class="sp-title" name="title" value="${h(sp.title)}" placeholder="${h(spTitle(sp))}(可自訂標題)" maxlength="200" data-change="sp-meta" aria-label="標題">
    <div class="sp-f" style="margin:6px 0 10px"><span>建立於 ${ago(sp.created_at)}・最後接觸 ${ago(sp.touched_at)}</span><span class="spacer"></span>${heatDots(sp.heat)}</div>
    <div class="chips" style="margin-bottom:10px">${Object.entries(SP_STATUS).filter(([k]) => k !== 'done' || sp.status === 'done').map(([k, label]) => `<button type="button" class="chip${sp.status === k ? ' on' : ''}" data-act="sp-set" data-id="${id}" data-status="${k}">${label}</button>`).join('')}
      <button type="button" class="chip" data-act="sp-touch" data-id="${id}">還有感覺 +1</button></div>
    <div class="row2"><label class="f"><span>相關工作類型</span><select name="type_key" data-change="sp-meta">${typeOptions(sp.type_key)}</select></label>
      <label class="f"><span>相關專案</span><select name="project_id" data-change="sp-meta"><option value="">無</option>${S.data.projects.filter((x) => x.id === sp.project_id || x.status !== 'cancelled').map((x) => `<option value="${x.id}"${x.id === sp.project_id ? ' selected' : ''}>${h(x.name)}</option>`).join('')}</select></label></div>
    <div class="timeline">${sp.items.map((it) => itemHtml(it, sp.items.length > 1)).join('')}</div>
    <h3 style="margin:14px 0 6px">補充</h3>
    ${composerHtml('後來又想到…')}
    <div class="err"></div>
    <div class="dlg-actions"><button type="button" class="btn danger" data-act="sp-del" data-id="${id}">刪除</button>
      ${p ? `<a class="btn" href="#/project/${p.id}" data-act="dlg-close">前往專案</a>` : `<button type="button" class="btn" data-act="sp-to-project" data-id="${id}">發展成專案</button>`}
      <span class="spacer"></span><button type="button" class="btn" data-act="dlg-close">關閉</button><button class="btn primary">加入補充</button></div>
  </form>`);
}
function dlgCollide() {
  const pool = S.data.sparks.slice();
  if (pool.length < 2) return;
  const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0], b = pool[Math.floor(Math.random() * pool.length)];
  openDlg(`<form data-form="collide" data-a="${a.id}" data-b="${b.id}"><h2>碰撞</h2>
    <p class="muted small" style="margin-top:0">隨機抽兩則靈感放在一起。它們之間有沒有關聯?能不能變成一個新點子?</p>
    <div class="wall two">${sparkCard(a)}${sparkCard(b)}</div>
    <div class="dlg-actions"><button type="button" class="btn" data-act="sp-collide">再抽一次</button><span class="spacer"></span><button type="button" class="btn" data-act="dlg-close">關閉</button><button class="btn primary">接起來,記成新靈感</button></div></form>`);
}

// ---------- 事件 ----------
const spPut = (sp, patch) => api('PUT', '/sparks/' + sp.id, { title: sp.title, status: sp.status, type_key: sp.type_key, project_id: sp.project_id, ...patch });
const dlgSparkId = () => Number($('#dlg form.sp-view')?.dataset.id) || 0;
async function refreshAfter(id) { await reload(); if (id && $('#dlg').open && spark(id)) dlgSparkView(id); }

FORMS.spark = async (f) => {
  const items = await collectItems(f.text);
  await api('POST', '/sparks', { status: f.status, type_key: f.type_key, items });
  resetComposer(); closeDlg(); toast('已記下'); await reload();
};
FORMS['spark-add'] = async (f, id) => {
  const items = await collectItems(f.text);
  await api('POST', `/sparks/${id}/items`, { items });
  resetComposer(); toast('已補充'); await refreshAfter(id);
};
FORMS.collide = async () => {
  const f = $('#dlg form'), a = spark(Number(f.dataset.a)), b = spark(Number(f.dataset.b));
  dlgSpark(`「${spTitle(a)}」×「${spTitle(b)}」\n`);
};

Object.assign(ACTS, {
  'dlg-spark': () => dlgSpark(),
  'sp-open': (d) => dlgSparkView(Number(d.id)),
  'sp-filter': (d) => { S.spFilter = d.k; render(); },
  'sp-collide': dlgCollide,
  'sp-pick': () => $('#dlg [data-sp-file]').click(),
  'sp-rec': toggleRecording,
  'sp-doodle': openPad,
  'sp-att-del': (d) => { const a = C.att.splice(Number(d.i), 1)[0]; if (a) URL.revokeObjectURL(a.url); renderAtt(); },
  'pad-color': (d) => { if (!C.pad) return; C.pad.color = d.c; document.querySelectorAll('#sp-pad .swatch').forEach((b) => b.classList.toggle('on', b.dataset.c === d.c)); },
  'pad-width': (d) => { if (C.pad) C.pad.width = Number(d.w); },
  'pad-undo': () => { if (C.pad) { C.pad.strokes.pop(); drawPad(); } },
  'pad-clear': () => { if (C.pad) { C.pad.strokes = []; drawPad(); } },
  'pad-done': finishPad,
  'sp-touch': async (d) => { await api('POST', `/sparks/${d.id}/touch`, {}); toast('加溫了'); await refreshAfter(dlgSparkId()); },
  'sp-set': async (d) => { await spPut(spark(Number(d.id)), { status: d.status }); await refreshAfter(dlgSparkId()); },
  'sp-item-del': async (d) => { if (!confirm('刪除這個片段?')) return; await api('DELETE', '/spark-items/' + d.id); await refreshAfter(dlgSparkId()); },
  'sp-del': async (d) => { if (!confirm('刪除整則靈感(含圖片、錄音)?')) return; await api('DELETE', '/sparks/' + d.id); resetComposer(); closeDlg(); await reload(); },
  'sp-to-project': async (d) => {
    const sp = spark(Number(d.id)), type = sp.type_key && TYPES[sp.type_key] ? sp.type_key : Object.keys(activeTypes())[0];
    if (!confirm(`用「${spTitle(sp)}」建立一個「洽談中」的專案?\n之後可在專案頁修改類型、人天與收款方式。`)) return;
    const p = await api('POST', '/projects', { name: sp.title || spTitle(sp), type, status: 'lead', source_type: '自有/其他', billing: 'milestone', notes: spTexts(sp).join('\n\n').slice(0, 3900) });
    await spPut(sp, { project_id: p.id, status: 'done' });
    resetComposer(); closeDlg(); location.hash = '#/project/' + p.id; await reload();
  },
});

// 標題、類型、專案:改了就存
document.addEventListener('change', async (ev) => {
  if (ev.target.dataset.spFile !== undefined) { for (const f of ev.target.files) await addImage(f); ev.target.value = ''; return; }
  if (ev.target.dataset.change !== 'sp-meta') return;
  const form = ev.target.form, sp = spark(Number(form.dataset.id));
  try {
    const el = form.elements;
    await spPut(sp, { title: el.title.value, type_key: el.type_key.value, project_id: Number(el.project_id.value) || null });
    await reload(); // 不重開對話框,避免打斷正在輸入的補充
  } catch (e) { toast(e.message); }
});
// 在記錄器貼上截圖
document.addEventListener('paste', (ev) => {
  if (!$('#dlg').open || !$('#dlg .composer')) return;
  const files = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  ev.preventDefault(); files.forEach(addImage);
});
// 搜尋:只重畫牆面,保留輸入焦點
document.addEventListener('input', (ev) => {
  if (ev.target.dataset.spQ === undefined) return;
  S.spQuery = ev.target.value;
  const w = $('#sp-wall'); if (w) w.innerHTML = wallHtml();
});
// 關閉對話框時停止錄音並釋放預覽
$('#dlg').addEventListener('close', resetComposer);
// 卡片可用鍵盤開啟
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('article.sp')) { ev.preventDefault(); dlgSparkView(Number(ev.target.dataset.id)); }
});
