'use strict';
/* PMS 前端:單頁應用,資料一次載入、統計於瀏覽器計算 */

// ---------- 代碼表 ----------
let TYPES = {}; // 由伺服器載入:key → { id, label, short, c, sort, active }
const SOURCES = ['驗證公司', '顧問公司', 'SI 公司', '直接客戶', '自有/其他'];
const STATUS = { lead: '洽談中', reserved: '預定', confirmed: '已確認', active: '進行中', done: '已完成', cancelled: '取消' };
const SLOT = { FULL: '全天', AM: '上午', PM: '下午' };
const ESTATUS = { planned: '預定', done: '已完成' };
const BILLING = { milestone: '專案分期請款', daily: '按日計・月結請款', monthly: '每月固定費用' };
const ISTATUS = { expected: '預計', invoiced: '已請款', received: '已收款' };

// ---------- 工具 ----------
const $ = (s, el = document) => el.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const wan = (n) => (Math.abs(n) >= 10000 ? (n / 10000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' 萬' : money(n));
const days = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString('en-US');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const DOW = ['日', '一', '二', '三', '四', '五', '六'];
const dow = (s) => DOW[new Date(s + 'T00:00:00').getDay()];
const tcolor = (type) => (TYPES[type] ? `var(--t${TYPES[type].c})` : 'var(--text-3)');
const opts = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${h(k)}"${k === sel ? ' selected' : ''}>${h(v.label || v)}</option>`).join('');

async function api(method, path, data) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { S.user = null; render(); throw new Error(out.error || '請重新登入'); }
  if (!res.ok) throw new Error(out.error || '發生錯誤');
  return out;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
}

// ---------- 狀態 ----------
const S = {
  user: null, data: null,
  year: new Date().getFullYear(),
  calMonth: today().slice(0, 7), calDay: today(),
  pFilter: 'open', pType: '', dim: 'type',
};
const proj = (id) => S.data.projects.find((p) => p.id === id);
const live = (p) => p && p.status !== 'cancelled';
const setting = (k, def) => { const v = Number(S.data.settings[k]); return Number.isFinite(v) && S.data.settings[k] !== undefined ? v : def; };

async function reload() {
  S.data = await api('GET', '/data');
  TYPES = Object.fromEntries(S.data.types.map((t) => [t.key, { id: t.id, label: t.label, short: t.short, c: t.color, sort: t.sort, active: !!t.active }]));
  render();
}
const activeTypes = (keep) => Object.fromEntries(Object.entries(TYPES).filter(([k, t]) => t.active || k === keep));

// ---------- 統計 ----------
function projectSums(p) {
  const es = S.data.entries.filter((e) => e.project_id === p.id);
  const is = S.data.incomes.filter((i) => i.project_id === p.id);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  return {
    es, is,
    done: sum(es, (e) => (e.status === 'done' ? e.days : 0)),
    sched: sum(es, (e) => (e.status === 'planned' ? e.days : 0)),
    free: sum(es, (e) => (e.billable ? 0 : e.days)),       // 義工人天(不請款、不占預估人天)
    freeDone: sum(es, (e) => (!e.billable && e.status === 'done' ? e.days : 0)),
    received: sum(is, (i) => (i.status === 'received' ? i.amount : 0)),
    billed: sum(is, (i) => i.amount),
  };
}

// 起訖月份(YYYY-MM)之間的所有月份
function monthSpan(from, to) {
  const out = [];
  for (let [y, m] = from.split('-').map(Number); `${y}-${pad(m)}` <= to; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${pad(m)}`);
  return out;
}
const billingLabel = (p) => (p.billing === 'daily' ? `按日計 ${money(p.rate)}/天` : p.billing === 'monthly' ? `月費 ${money(p.rate)}` : '分期請款');

// 按日計/月費專案的各計費月份:應請金額 due 與已開立的收款紀錄 recs
function billingPeriods(p, ps = projectSums(p)) {
  if (p.billing !== 'daily' && p.billing !== 'monthly') return [];
  const rec = {}, m = {};
  for (const i of ps.is) if (i.period) (rec[i.period] ||= []).push(i);
  if (p.billing === 'daily') for (const e of ps.es) (m[e.date.slice(0, 7)] ||= { done: 0, planned: 0, free: 0 })[!e.billable ? 'free' : e.status === 'done' ? 'done' : 'planned'] += e.days;
  else if (p.start_date && p.end_date) for (const ym of monthSpan(p.start_date.slice(0, 7), p.end_date.slice(0, 7))) m[ym] = { done: 0, planned: 0 };
  for (const ym in rec) m[ym] ||= { done: 0, planned: 0 };
  return Object.keys(m).sort().map((ym) => ({
    ym, ...m[ym], recs: rec[ym] || [], billed: (rec[ym] || []).reduce((t, i) => t + i.amount, 0),
    due: p.billing === 'daily' ? m[ym].done * p.rate : p.rate,
    est: p.billing === 'daily' ? (m[ym].done + m[ym].planned) * p.rate : p.rate, // 含已排未完成
  }));
}
// 已過月份、有應請金額但尚未開立請款
function unbilledPeriods() {
  const cur = today().slice(0, 7), out = [];
  for (const p of S.data.projects) {
    if (!live(p) || p.status === 'lead') continue;
    for (const b of billingPeriods(p)) if (!b.recs.length && b.due > 0 && b.ym < cur) out.push({ p, ...b });
  }
  return out.sort((a, b) => a.ym.localeCompare(b.ym));
}

// 年度統計。收入依「工作發生的月份」歸屬(有計費月份的收款紀錄歸該月,其餘依收款日期):
//   earned 已實現 = 已完成工作的價值(按日計:完成人天×日費;月費:已到期月份;分期:已請款/已收款的期款)
//   pre    已排預收 = 已排程未完成的人天、合約尚未到期的月份、分期的預計收款
//   unrev  未排預估 = 預估人天/預估收入中尚未排入的餘額
//   fc 預估合計 = earned + pre + unrev;billed 已請款(含已收);actual 實收;lead 洽談中(不計入 fc)
// 人天 = done 已完成 + sched 已排程 + unsched 未排程(平均攤在專案剩餘月份);free 義工
function yearStats(year) {
  const mk = () => ({ fc: 0, earned: 0, pre: 0, unrev: 0, lead: 0, billed: 0, actual: 0, done: 0, sched: 0, unsched: 0, free: 0 });
  const months = Array.from({ length: 12 }, mk);
  const dims = { type: {}, source: {}, sourceName: {}, project: {} };
  let undatedRev = 0, undatedDays = 0;
  const thisMonth = today().slice(0, 7);
  const idx = (ym) => (Number(ym.slice(0, 4)) === year ? Number(ym.slice(5, 7)) - 1 : -1);

  for (const p of S.data.projects) {
    if (!live(p)) continue;
    const lead = p.status === 'lead';
    const ps = projectSums(p);
    const groups = [[dims.type, p.type], [dims.source, p.source_type || '未分類'], [dims.sourceName, p.source_name || '(未填來源名稱)'], [dims.project, p.id]]
      .map(([d, k]) => (d[k] ||= { ...mk(), n: 0 }));
    let touched = false;
    const add = (ym, key, v) => {
      const i = idx(ym); if (i < 0 || !v) return;
      months[i][key] += v; groups.forEach((g) => (g[key] += v)); touched = true;
    };
    const rev = (ym, key, v) => { if (lead) add(ym, 'lead', v); else { add(ym, key, v); add(ym, 'fc', v); } };

    // 收款紀錄
    const byPeriod = {};
    for (const inc of ps.is) {
      const when = inc.period || inc.date;
      if (inc.status !== 'expected') add(when, 'billed', inc.amount);
      if (inc.status === 'received') add(when, 'actual', inc.amount);
      if (inc.period) byPeriod[inc.period] = (byPeriod[inc.period] || 0) + inc.amount;
      else rev(inc.date, inc.status === 'expected' ? 'pre' : 'earned', inc.amount);
    }
    // 依收款方式推算各月收入
    if (p.billing === 'daily') {
      const per = {};
      for (const e of ps.es) if (e.billable) (per[e.date.slice(0, 7)] ||= { done: 0, planned: 0 })[e.status === 'done' ? 'done' : 'planned'] += e.days;
      for (const ym of new Set([...Object.keys(per), ...Object.keys(byPeriod)])) {
        const d = per[ym] || { done: 0, planned: 0 };
        rev(ym, 'earned', ym in byPeriod ? byPeriod[ym] : d.done * p.rate); // 已請款的月份以請款金額為準
        rev(ym, 'pre', d.planned * p.rate);
      }
    } else if (p.billing === 'monthly') {
      const span = p.start_date && p.end_date ? monthSpan(p.start_date.slice(0, 7), p.end_date.slice(0, 7)) : [];
      for (const ym of new Set([...span, ...Object.keys(byPeriod)])) {
        if (ym in byPeriod) rev(ym, 'earned', byPeriod[ym]);
        else rev(ym, ym <= thisMonth ? 'earned' : 'pre', p.rate);
      }
    } else {
      for (const ym in byPeriod) rev(ym, 'earned', byPeriod[ym]);
      const restRev = p.est_revenue - ps.billed;
      if (restRev > 0) {
        const anchor = p.end_date || p.start_date;
        if (anchor) rev(anchor, 'unrev', restRev); else undatedRev += restRev;
      }
    }
    // 人天
    for (const e of ps.es) { add(e.date, e.status === 'done' ? 'done' : 'sched', e.days); if (!e.billable) add(e.date, 'free', e.days); }
    const restDays = p.est_days - (ps.done + ps.sched - ps.free); // 義工不占預估人天
    if (restDays > 0 && p.status !== 'done') {
      const a = p.start_date || p.end_date, b = p.end_date || p.start_date;
      if (!a) { if (!lead) undatedDays += restDays; if (p.billing === 'daily') undatedRev += restDays * p.rate; }
      else {
        const from = a.slice(0, 7) > thisMonth ? a.slice(0, 7) : thisMonth;
        const span = monthSpan(from, b.slice(0, 7) > from ? b.slice(0, 7) : from);
        for (const ym of span) {
          if (!lead) add(ym, 'unsched', restDays / span.length);
          if (p.billing === 'daily') rev(ym, 'unrev', (restDays / span.length) * p.rate);
        }
      }
    }
    if (touched) groups.forEach((g) => g.n++);
  }
  const total = months.reduce((t, m) => { for (const k in m) t[k] += m[k]; return t; }, mk());
  return { months, total, dims, undatedRev, undatedDays };
}

function dayLoad(date) {
  const es = S.data.entries.filter((e) => e.date === date && live(proj(e.project_id)));
  const total = es.reduce((t, e) => t + e.days, 0);
  const cnt = (s) => es.filter((e) => e.slot === s).length;
  return { es, total, conflict: total > 1 || cnt('AM') > 1 || cnt('PM') > 1 };
}

// ---------- 版面 ----------
const ICON = {
  home: '<path d="M4 11l8-7 8 7v9H14v-6h-4v6H4z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  proj: '<path d="M3 7h7l2 2h9v10H3z"/>',
  money: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9.2c-.6-1-1.7-1.4-3-1.4-1.700 0-3 .8-3 2.100 0 3 6 1.400 6 4.300 0 1.300-1.300 2.100-3 2.100-1.400 0-2.600-.5-3.200-1.600M12 6v12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
};
const NAV = [['', '總覽', 'home'], ['calendar', '行事曆', 'cal'], ['projects', '專案', 'proj'], ['income', '收入', 'money'], ['settings', '設定', 'gear']];
const route = () => location.hash.replace(/^#\/?/, '').split('/');

function render() {
  const app = $('#app');
  if (!S.user) return (app.innerHTML = viewLogin());
  if (!S.data) return (app.innerHTML = '<main class="empty">載入中…</main>');
  const [r, arg] = route();
  const top = r === 'project' ? 'projects' : r;
  const views = { '': viewDashboard, calendar: viewCalendar, projects: viewProjects, project: () => viewProject(Number(arg)), income: viewIncome, settings: viewSettings };
  const y0 = window.scrollY;
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span>Allan Lo</span>的今天和明天</div>
      <nav class="nav">${NAV.map(([k, label, ic]) => `<a href="#/${k}" class="${top === k ? 'on' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round">${ICON[ic]}</svg>${label}</a>`).join('')}</nav>
      <div class="spacer"></div>
    </header>
    <main>${S.user.must_change ? `<div class="banner"><span>⚠ 目前仍使用預設密碼,上線前請先變更。</span><span class="spacer"></span><button class="btn sm" data-act="dlg-password">變更密碼</button></div>` : ''}
    ${(views[r] || viewDashboard)()}</main>`;
  if (render.last === location.hash) window.scrollTo(0, y0); else window.scrollTo(0, 0);
  render.last = location.hash;
}

function viewLogin() {
  return `<div class="login"><div class="card">
    <h1>Allan Lo的今天和明天</h1><p class="muted small">個人專案・人天・收入管理</p>
    <form data-form="login">
      <label class="f"><span>帳號</span><input name="username" autocomplete="username" autocapitalize="none" required autofocus></label>
      <label class="f"><span>密碼</span><input name="password" type="password" autocomplete="current-password" required></label>
      <div class="err"></div>
      <button class="btn primary" style="width:100%">登入</button>
    </form></div></div>`;
}

const yearSelect = () => {
  const ys = new Set([S.year, new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]);
  for (const p of S.data.projects) for (const d of [p.start_date, p.end_date]) if (d) ys.add(Number(d.slice(0, 4)));
  return `<select class="inline" data-change="year" aria-label="年度">${[...ys].sort().map((y) => `<option${y === S.year ? ' selected' : ''}>${y}</option>`).join('')}</select>`;
};

// ---------- 圖表 ----------
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= v);
}
function columnChart({ max, fmt, cols, cap }) {
  const top = niceMax(Math.max(max, cap || 0));
  const gl = [0, 0.5, 1].map((f) => `<div class="gl" style="bottom:${f * 100}%"><span>${fmt(top * f)}</span></div>`).join('');
  const nowIdx = S.year === new Date().getFullYear() ? new Date().getMonth() : -1;
  return `<div class="chart">${gl}${cap ? `<div class="cap" style="bottom:${(cap / top) * 100}%"></div>` : ''}
    <div class="cols">${cols.map((c, i) => `<div class="col${i === nowIdx ? ' now' : ''}" data-tip="${h(c.tip)}">${c.html(top)}</div>`).join('')}</div></div>
    <div class="xlabels">${cols.map((_, i) => `<span>${i + 1}</span>`).join('')}</div>`;
}

// ---------- 總覽 ----------
function viewDashboard() {
  const st = yearStats(S.year), T = st.total;
  const target = setting('annual_target', 0), capM = setting('monthly_capacity', 20);
  const now = new Date(), isThisYear = S.year === now.getFullYear();
  const elapsed = isThisYear ? (now - new Date(S.year, 0, 1)) / (new Date(S.year + 1, 0, 1) - new Date(S.year, 0, 1)) : S.year < now.getFullYear() ? 1 : 0;
  const base = Math.max(target, T.fc, 1);
  const allDays = T.done + T.sched + T.unsched;
  const t = today();

  const revChart = revenueChart(st);
  const dayChart = columnChart({
    max: Math.max(...st.months.map((m) => m.done + m.sched + m.unsched)), cap: capM, fmt: (v) => days(v),
    cols: st.months.map((m, i) => {
      const tot = m.done + m.sched + m.unsched;
      return {
        tip: `${i + 1} 月 合計 ${days(tot)} 天(產能 ${pct(tot, capM)})\n已完成 ${days(m.done)}\n已排程 ${days(m.sched)}\n未排程預估 ${days(m.unsched)}`,
        html: (top) => `<div class="stack">${[['done', '--seq-1', ''], ['sched', '--seq-2', ''], ['unsched', '--seq-3', ' hatch']].filter(([k]) => m[k] > 0)
          .map(([k, c, cls]) => `<i class="${cls}" style="height:calc(${(m[k] / top) * 100}% - 2px);background-color:var(${c})"></i>`).join('')}</div>`,
      };
    }),
  });

  // 待處理事項
  const conflicts = [...new Set(S.data.entries.filter((e) => e.date >= t).map((e) => e.date))].filter((d) => dayLoad(d).conflict).sort();
  const stale = S.data.entries.filter((e) => e.date < t && e.status === 'planned' && live(proj(e.project_id)));
  const overdue = S.data.incomes.filter((i) => i.date < t && i.status !== 'received' && live(proj(i.project_id)));
  const unbilled = unbilledPeriods();
  const until = ymd(new Date(Date.now() + 21 * 864e5));
  const upcoming = S.data.entries.filter((e) => e.date >= t && e.date <= until && live(proj(e.project_id)));

  return `
  <div class="head"><h1>${S.year} 年度總覽</h1>${yearSelect()}<button class="btn primary" data-act="dlg-project">＋ 專案</button></div>
  <div class="grid kpi">
    <div class="card"><div class="lbl">預估年收入</div><div class="val">${wan(T.fc)}</div>
      <div class="sub">${target ? `年度目標 ${wan(target)}・達成 ${pct(T.fc, target)}` : '<a href="#/settings">設定年度目標</a>'}</div></div>
    <div class="card"><div class="lbl">已實現收入(已完成工作)</div><div class="val">${wan(T.earned)}</div>
      <div class="sub">已請款 ${wan(T.billed)}・實收 ${wan(T.actual)}</div></div>
    <div class="card"><div class="lbl">投入人天(完成/全部)</div><div class="val">${days(T.done)}<span class="muted" style="font-size:15px"> / ${days(allDays)}</span></div>
      <div class="sub">年產能 ${days(capM * 12)} 天・已占用 ${pct(allDays, capM * 12)}${T.free ? `・含義工 ${days(T.free)} 天` : ''}</div></div>
    <div class="card"><div class="lbl">每人天產值(預估)</div><div class="val">${allDays > 0 ? money(T.fc / allDays) : '—'}</div>
      <div class="sub">洽談中潛在 ${wan(T.lead)}</div></div>
  </div>
  <div class="card"><h2>收入進度</h2>
    <div class="legend">${REV_LEGEND(T)}
      ${target ? `<span>目標 ${money(target)}</span>` : ''}${isThisYear ? `<span><i style="background:var(--text);width:2px;border-radius:0"></i>年度時間進度 ${Math.round(elapsed * 100)}%</span>` : ''}</div>
    <div class="meter" data-tip="已實現 ${money(T.earned)}\n已排預收 ${money(T.pre)}\n未排預估 ${money(T.unrev)}\n預估合計 ${money(T.fc)}${target ? `\n目標 ${money(target)}` : ''}\n(實收 ${money(T.actual)})"><i class="fc hatch" style="width:${(T.fc / base) * 100}%"></i><i class="mid" style="width:${((T.earned + T.pre) / base) * 100}%"></i><i class="act" style="width:${(T.earned / base) * 100}%"></i>${isThisYear ? `<b style="left:${elapsed * 100}%"></b>` : ''}</div>
    <div class="small muted">${target && T.fc < target ? `距年度目標尚差 ${money(target - T.fc)} 的案源。` : ''}${st.undatedRev ? ` 另有 ${money(st.undatedRev)} 預估收入的專案未填日期,未計入年度。` : ''}${st.undatedDays ? ` 另有 ${days(st.undatedDays)} 人天的專案未填日期。` : ''}</div>
  </div>
  <div class="grid two">
    <div class="card"><h2>每月收入</h2><div class="legend">${REV_LEGEND()}</div>${revChart}</div>
    <div class="card"><h2>每月人天負載</h2><div class="legend"><span><i style="background:var(--seq-1)"></i>已完成</span><span><i style="background:var(--seq-2)"></i>已排程</span><span><i class="hatch" style="background-color:var(--seq-3)"></i>未排程預估</span><span><i class="ln"></i>月產能 ${days(capM)} 天</span></div>${dayChart}</div>
  </div>
  <div class="grid two">
    <div class="card"><h2>待處理</h2><ul class="list">
      ${conflicts.map((d) => `<li><span class="badge s-bad">⚠ 時間衝突</span><div class="main">${md(d)}(${dow(d)})已排 ${days(dayLoad(d).total)} 天</div><div class="acts"><button class="btn sm" data-act="goto-day" data-date="${d}">查看</button></div></li>`).join('')}
      ${stale.length ? `<li><span class="badge s-lead">待確認</span><div class="main">${stale.length} 筆過去的排程尚未確認(共 ${days(stale.reduce((s, e) => s + e.days, 0))} 天)</div><div class="acts"><button class="btn sm" data-act="confirm-stale">全部標為完成</button></div></li>` : ''}
      ${overdue.map((i) => `<li><span class="badge s-bad">逾期未收</span><div class="main"><div class="t">${h(proj(i.project_id).name)}</div><div class="small muted">${i.date}・${money(i.amount)}・${ISTATUS[i.status]}</div></div><div class="acts"><button class="btn sm" data-act="income-received" data-id="${i.id}">已收款</button></div></li>`).join('')}
      ${unbilled.map((b) => `<li><span class="badge s-lead">未請款</span><div class="main"><div class="t">${h(b.p.name)}</div><div class="small muted">${b.ym}${b.p.billing === 'daily' ? ` 月結・${days(b.done)} 天` : ' 月費'}・<span class="num">${money(b.due)}</span></div></div><div class="acts"><button class="btn sm" data-act="bill-period" data-pid="${b.p.id}" data-ym="${b.ym}">請款</button></div></li>`).join('')}
      ${!conflicts.length && !stale.length && !overdue.length && !unbilled.length ? '<li class="empty" style="justify-content:center">沒有待處理事項</li>' : ''}
    </ul></div>
    <div class="card"><h2>未來 3 週行程<span class="spacer"></span><a class="small" href="#/calendar">行事曆 ›</a></h2><ul class="list">
      ${upcoming.map((e) => entryLi(e, true)).join('') || '<li class="empty" style="justify-content:center">未來 3 週沒有排程</li>'}
    </ul></div>
  </div>
  ${analysisCard(st)}
  ${monthTable(st, capM)}`;
}

const REV_KEYS = [['earned', '已實現', '--seq-1', ''], ['pre', '已排預收', '--seq-2', ''], ['unrev', '未排預估', '--seq-3', ' hatch']];
const REV_LEGEND = (T) => REV_KEYS.map(([k, label, c, cls]) => `<span><i class="${cls}" style="background-color:var(${c})"></i>${label}${T ? ' ' + money(T[k]) : ''}</span>`).join('');
const revTip = (title, m) => `${title}\n${REV_KEYS.map(([k, label]) => `${label} ${money(m[k])}`).join('\n')}\n預估合計 ${money(m.fc)}\n已請款 ${money(m.billed)}・實收 ${money(m.actual)}${m.lead ? `\n洽談中 ${money(m.lead)}` : ''}`;

function revenueChart(st) {
  return columnChart({
    max: Math.max(...st.months.map((m) => m.fc)), fmt: (v) => (v / 10000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '萬',
    cols: st.months.map((m, i) => ({
      tip: revTip(`${i + 1} 月`, m),
      html: (top) => `<div class="stack">${REV_KEYS.filter(([k]) => m[k] > 0).map(([k, , c, cls]) => `<i class="${cls}" style="height:calc(${(m[k] / top) * 100}% - 2px);background-color:var(${c})"></i>`).join('')}</div>`,
    })),
  });
}

// 多面向收入分析:工作類型 / 來源 / 來源名稱 / 專案
const DIMS = {
  type: ['工作類型', (k) => TYPES[k]?.label || k, (k) => tcolor(k)],
  source: ['來源', (k) => k, () => 'var(--text-3)'],
  sourceName: ['來源名稱', (k) => k, () => 'var(--text-3)'],
  project: ['專案', (k) => proj(Number(k))?.name || k, (k) => tcolor(proj(Number(k))?.type)],
};
function analysisCard(st) {
  const [title, labelOf, colorOf] = DIMS[S.dim], T = st.total, isProj = S.dim === 'project';
  const rows = Object.entries(st.dims[S.dim]).map(([k, g]) => ({ k, g, d: g.done + g.sched + g.unsched }))
    .filter((r) => r.g.fc || r.d || r.g.actual || r.g.billed).sort((a, b) => b.g.fc - a.g.fc || b.d - a.d);
  const max = Math.max(1, ...rows.map((r) => r.g.fc));
  const allDays = T.done + T.sched + T.unsched;
  const cells = (g, d) => `<td class="num">${money(g.earned)}</td><td class="num">${money(g.pre)}</td><td class="num">${money(g.unrev)}</td><td class="num"><b>${money(g.fc)}</b></td>
    <td class="num">${pct(g.fc, T.fc)}</td><td class="num">${money(g.billed)}</td><td class="num">${money(g.actual)}</td><td class="num">${days(d)}</td><td class="num">${d > 0 ? money(g.fc / d) : '—'}</td>`;
  return `<div class="card"><h2>收入分析</h2>
    <div class="chips" style="margin-bottom:10px">${Object.entries(DIMS).map(([k, [label]]) => `<button class="chip${S.dim === k ? ' on' : ''}" data-act="dim" data-k="${k}">依${label}</button>`).join('')}</div>
    ${rows.length ? `<div class="legend">${REV_LEGEND()}</div>
    <div class="hrows">${rows.map(({ k, g }) => `<div class="hrow" data-tip="${h(revTip(labelOf(k), g))}">
      <div class="hl"><span class="dot" style="background:${colorOf(k)}"></span>${h(labelOf(k))}</div>
      <div class="ht">${REV_KEYS.filter(([key]) => g[key] > 0).map(([key, , c, cls]) => `<i class="${cls}" style="width:${(g[key] / max) * 100}%;background-color:var(${c})"></i>`).join('')}</div>
      <div class="hv num">${wan(g.fc)}</div></div>`).join('')}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table>
      <tr><th>${title}</th>${isProj ? '' : '<th>案數</th>'}<th>已實現</th><th>已排預收</th><th>未排預估</th><th>預估合計</th><th>占比</th><th>已請款</th><th>實收</th><th>人天</th><th>每人天產值</th></tr>
      ${rows.map(({ k, g, d }) => `<tr><td><span class="dot" style="background:${colorOf(k)}"></span>${isProj ? `<a href="#/project/${k}">${h(labelOf(k))}</a>` : h(labelOf(k))}</td>${isProj ? '' : `<td class="num">${g.n}</td>`}${cells(g, d)}</tr>`).join('')}
      <tr class="total"><td>合計</td>${isProj ? '' : '<td></td>'}${cells(T, allDays)}</tr>
    </table></div>` : '<div class="empty">本年度尚無資料</div>'}</div>`;
}

function monthTable(st, capM) {
  const nowIdx = S.year === new Date().getFullYear() ? new Date().getMonth() : -1, T = st.total;
  const row = (label, m, cls, cap) => { const d = Math.round((m.done + m.sched + m.unsched) * 10) / 10; return `<tr class="${cls}"><td>${label}</td>
    <td class="num">${money(m.earned)}</td><td class="num">${money(m.pre)}</td><td class="num">${money(m.unrev)}</td><td class="num"><b>${money(m.fc)}</b></td>
    <td class="num">${money(m.billed)}</td><td class="num">${money(m.actual)}</td><td class="num">${m.lead ? money(m.lead) : '—'}</td>
    <td class="num">${days(m.done)}</td><td class="num">${days(m.sched)}</td><td class="num">${days(m.unsched)}</td><td class="num${d > cap ? ' bad' : ''}">${d > cap ? '⚠ ' : ''}${pct(d, cap)}</td></tr>`; };
  return `<div class="card"><h2>月統計表</h2><div class="tbl-wrap"><table>
    <tr><th>月份</th><th>已實現</th><th>已排預收</th><th>未排預估</th><th>預估合計</th><th>已請款</th><th>實收</th><th>洽談中</th><th>完成人天</th><th>已排程</th><th>未排程</th><th>產能占用</th></tr>
    ${st.months.map((m, i) => row(`${i + 1} 月`, m, i === nowIdx ? 'now' : '', capM)).join('')}${row('全年', T, 'total', capM * 12)}
  </table></div>
  <p class="muted small" style="margin-bottom:0">收入依工作發生的月份歸屬。已實現=已完成工作的價值;已排預收=已排程未完成、合約未到期月份與分期的預計收款;未排預估=預估人天或預估收入尚未排入的餘額;實收=已標記收款的金額。</p></div>`;
}

function entryLi(e, showDate) {
  const p = proj(e.project_id);
  return `<li><div class="when">${showDate ? `${md(e.date)}(${dow(e.date)})` : SLOT[e.slot]}</div>
    <div class="main"><div class="t"><span class="dot" style="background:${tcolor(p.type)}"></span>${h(p.name)}</div>
    ${e.content ? `<div class="work">${h(e.content)}</div>` : ''}
    <div class="small muted">${e.billable ? '' : '<span class="badge s-lead">義工</span> '}${showDate ? SLOT[e.slot] + '・' : ''}${days(e.days)} 天・${ESTATUS[e.status]}${e.note ? '・備註:' + h(e.note) : ''}</div></div>
    <div class="acts">${e.status === 'planned' && e.date <= today() ? `<button class="btn sm" data-act="entry-done" data-id="${e.id}">完成</button>` : ''}
    <button class="btn sm" data-act="dlg-entry" data-id="${e.id}">編輯</button></div></li>`;
}

// ---------- 行事曆 ----------
function viewCalendar() {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = new Date(y, m - 1, 1 - first.getDay());
  const t = today();
  let cells = '', total = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), ds = ymd(d);
    if (i === 35 && d.getMonth() !== m - 1) break;
    if (d.getMonth() !== m - 1) { cells += '<div class="cal-cell out"></div>'; continue; }
    const L = dayLoad(ds); total += L.total;
    cells += `<button class="cal-cell${ds === t ? ' today' : ''}${ds === S.calDay ? ' sel' : ''}${L.conflict ? ' conflict' : ''}${d.getDay() % 6 === 0 ? ' we' : ''}" data-act="cal-day" data-date="${ds}" aria-label="${ds} 已排 ${L.total} 天">
      <div class="d"><b>${d.getDate()}</b>${L.conflict ? '<span class="x">⚠</span>' : ''}</div>
      ${L.es.map((e) => { const p = proj(e.project_id); return `<div class="ev ${e.status} ${e.slot}${e.slot === 'FULL' ? '' : ' half'}" style="--c:${tcolor(p.type)}" title="${h(p.name)}${e.content ? ' — ' + h(e.content) : ''}">${e.slot === 'FULL' ? '' : SLOT[e.slot][0] + ' '}${h(p.name)}</div>`; }).join('')}
    </button>`;
  }
  const capM = setting('monthly_capacity', 20), L = dayLoad(S.calDay);
  const usedTypes = [...new Set(S.data.entries.filter((e) => e.date.startsWith(S.calMonth)).map((e) => proj(e.project_id)?.type))].filter(Boolean);
  return `
  <div class="head"><h1>${y} 年 ${m} 月</h1>
    <button class="btn icon" data-act="cal-prev" aria-label="上個月">‹</button><button class="btn" data-act="cal-today">今天</button><button class="btn icon" data-act="cal-next" aria-label="下個月">›</button>
    <button class="btn primary" data-act="dlg-entry" data-date="${S.calDay}">＋ 排程</button></div>
  <div class="small muted" style="margin-bottom:8px">本月已排 <b class="${total > capM ? 'bad' : ''}">${days(total)}</b> / 產能 ${days(capM)} 天。實色=已完成,虛框(手機為淡色)=預定。</div>
  <div class="cal">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>
  <div class="legend" style="margin-top:8px">${usedTypes.map((k) => `<span><i style="background:${tcolor(k)}"></i>${h(TYPES[k].short)}</span>`).join('')}</div>
  <div class="card" style="margin-top:8px"><h2>${md(S.calDay)}(${dow(S.calDay)})${L.conflict ? '<span class="badge s-bad">⚠ 時間衝突</span>' : ''}<span class="spacer"></span><span class="small muted">已排 ${days(L.total)} 天</span></h2>
    <ul class="list">${L.es.map((e) => entryLi(e, false)).join('') || '<li class="empty" style="justify-content:center">這天沒有排程</li>'}</ul></div>`;
}

// ---------- 專案 ----------
const P_FILTERS = { open: ['已確認/進行中', ['confirmed', 'active']], reserved: ['預定', ['reserved']], lead: ['洽談中', ['lead']], done: ['已完成', ['done']], cancelled: ['取消', ['cancelled']], all: ['全部', Object.keys(STATUS)] };
function viewProjects() {
  const list = S.data.projects.filter((p) => P_FILTERS[S.pFilter][1].includes(p.status) && (!S.pType || p.type === S.pType))
    .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
  return `
  <div class="head"><h1>專案</h1><button class="btn primary" data-act="dlg-project">＋ 專案</button></div>
  <div class="head"><div class="chips">${Object.entries(P_FILTERS).map(([k, [label, sts]]) => `<button class="chip${S.pFilter === k ? ' on' : ''}" data-act="p-filter" data-k="${k}">${label} ${S.data.projects.filter((p) => sts.includes(p.status)).length}</button>`).join('')}</div>
    <span style="flex:1"></span><select class="inline" data-change="ptype" aria-label="工作類型"><option value="">全部類型</option>${opts(TYPES, S.pType)}</select></div>
  <div class="pgrid">${list.map(projectCard).join('')}</div>
  ${list.length ? '' : '<div class="empty">沒有符合的專案。按「＋ 專案」建立第一筆。</div>'}`;
}
function projectCard(p) {
  const s = projectSums(p), used = s.done + s.sched;
  return `<a class="pcard" href="#/project/${p.id}" style="--c:${tcolor(p.type)}">
    <div class="meta"><span class="badge s-${p.status}">${STATUS[p.status]}</span><span>${h(TYPES[p.type]?.short)}</span><span>・${billingLabel(p)}</span>${p.source_name || p.source_type ? `<span>・${h(p.source_name || p.source_type)}</span>` : ''}</div>
    <div class="t">${h(p.name)}</div>
    <div class="meta">${p.client ? h(p.client) + '・' : ''}${p.start_date || '未定'}${p.end_date ? ' ~ ' + p.end_date : ''}</div>
    <div class="nums">
      <div>人天 完成/排程/預估${s.free ? `(義工 ${days(s.free)})` : ''}<b>${days(s.done)} / ${days(used)} / ${days(p.est_days)}</b><div class="meter"><i class="fc" style="width:${Math.min(100, (used / Math.max(p.est_days, used, 0.5)) * 100)}%"></i><i class="act" style="width:${Math.min(100, (s.done / Math.max(p.est_days, used, 0.5)) * 100)}%"></i></div></div>
      <div>收入 實收/預估<b>${wan(s.received)} / ${wan(p.est_revenue)}</b><div class="meter"><i class="act" style="width:${Math.min(100, (s.received / Math.max(p.est_revenue, s.received, 1)) * 100)}%"></i></div></div>
    </div></a>`;
}
function viewProject(id) {
  const p = proj(id);
  if (!p) return '<div class="empty">找不到專案。<a href="#/projects">回專案列表</a></div>';
  const s = projectSums(p), used = s.done + s.sched;
  const paid = used - s.free, over = paid > p.est_days; // 占用預估人天的只有可請款的排程
  const periods = billingPeriods(p, s), cur = today().slice(0, 7), daily = p.billing === 'daily';
  const rest = p.est_revenue - s.billed;
  const billingCard = periods.length ? `<div class="card"><h2>${daily ? '月結請款' : '每月顧問費'}<span class="spacer"></span><span class="small muted">${billingLabel(p)}</span></h2>
    <div class="tbl-wrap"><table><tr><th>計費月份</th>${daily ? '<th>完成人天</th><th>已排未完成</th><th>義工</th><th>預估金額</th>' : ''}<th>應請金額</th><th>已開立</th><th></th></tr>
    ${periods.map((b) => `<tr class="${b.ym === cur ? 'now' : ''}"><td>${b.ym}</td>${daily ? `<td class="num">${days(b.done)}</td><td class="num">${days(b.planned)}</td><td class="num">${b.free ? days(b.free) : '—'}</td><td class="num">${money(b.est)}</td>` : ''}
      <td class="num">${money(b.due)}</td>
      <td class="num">${b.recs.length ? `${money(b.billed)} <span class="badge s-${b.recs.every((i) => i.status === 'received') ? 'received' : 'invoiced'}">${b.recs.every((i) => i.status === 'received') ? '已收款' : ISTATUS[b.recs[0].status]}</span>${b.billed !== b.due ? ' <span class="warn" title="與應請金額不同">⚠</span>' : ''}` : '—'}</td>
      <td>${!b.recs.length && b.due > 0 && b.ym <= cur ? `<button class="btn sm" data-act="bill-period" data-pid="${p.id}" data-ym="${b.ym}">請款</button>` : ''}</td></tr>`).join('')}
    ${(() => { const t = (k) => periods.reduce((a, b) => a + (b[k] || 0), 0); return `<tr class="total"><td>合計</td>${daily ? `<td class="num">${days(t('done'))}</td><td class="num">${days(t('planned'))}</td><td class="num">${t('free') ? days(t('free')) : '—'}</td><td class="num">${money(t('est'))}</td>` : ''}<td class="num">${money(t('due'))}</td><td class="num">${money(t('billed'))}</td><td></td></tr>`; })()}
    </table></div>
    <p class="muted small" style="margin-bottom:0">${daily ? '預估金額 = (已完成 + 已排未完成)人天 × 日費;應請金額只算已完成(半天半價),義工都不計。' : ''}按「請款」會建立一筆「已請款」的收款紀錄,可再到下方收款清單修改日期、金額或標為已收款。</p></div>` : '';
  return `
  <div class="head"><a class="btn icon" href="#/projects" aria-label="返回" style="display:grid;place-items:center">‹</a><h1>${h(p.name)}</h1><button class="btn" data-act="dlg-project" data-id="${p.id}">編輯</button></div>
  <div class="card" style="border-left:4px solid ${tcolor(p.type)}">
    <div class="chips" style="margin-bottom:8px"><span class="badge s-${p.status}">${STATUS[p.status]}</span><span class="badge">${h(TYPES[p.type]?.label)}</span><span class="badge">${billingLabel(p)}</span>${p.source_type ? `<span class="badge">來源:${h(p.source_type)}${p.source_name ? ' ' + h(p.source_name) : ''}</span>` : ''}${p.client ? `<span class="badge">客戶:${h(p.client)}</span>` : ''}</div>
    <div class="muted small">期間 ${p.start_date || '未定'}${p.end_date ? ' ~ ' + p.end_date : ''}</div>
    ${p.notes ? `<div style="white-space:pre-wrap;margin-top:8px">${h(p.notes)}</div>` : ''}
  </div>
  <div class="grid kpi">
    <div class="card"><div class="lbl">預估人天</div><div class="val">${days(p.est_days)}</div><div class="sub ${over ? 'bad' : ''}">${over ? `⚠ 已排超出 ${days(paid - p.est_days)} 天` : `已排 ${days(paid)}・尚未排程 ${days(p.est_days - paid)} 天`}</div></div>
    <div class="card"><div class="lbl">實際人天(完成/已排)</div><div class="val">${days(s.done)}<span class="muted" style="font-size:15px"> / ${days(used)}</span></div><div class="sub">${s.free ? `含義工 ${days(s.free)} 天(不請款)` : `完成 ${pct(s.done, p.est_days)}`}</div></div>
    <div class="card"><div class="lbl">預估收入</div><div class="val">${wan(p.est_revenue)}</div><div class="sub">每人天 ${p.est_days > 0 ? money(p.est_revenue / p.est_days) : '—'}</div></div>
    <div class="card"><div class="lbl">已實收</div><div class="val">${wan(s.received)}</div><div class="sub">${pct(s.received, p.est_revenue)}・實際每人天 ${s.done > 0 ? money(s.received / s.done) : '—'}</div></div>
  </div>
  ${billingCard}
  <div class="grid two">
    <div class="card"><h2>人天排程<span class="spacer"></span><button class="btn sm primary" data-act="dlg-entry" data-pid="${p.id}">＋ 排程</button></h2>
      <ul class="list">${s.es.map((e) => entryLi(e, true)).join('') || '<li class="empty" style="justify-content:center">尚未排程</li>'}</ul></div>
    <div class="card"><h2>收款<span class="spacer"></span>${p.billing === 'milestone' && rest > 0 ? `<button class="btn sm" data-act="dlg-installments" data-id="${p.id}">建立分期</button>` : ''}<button class="btn sm primary" data-act="dlg-income" data-pid="${p.id}">＋ 收款</button></h2>
      <ul class="list">${s.is.map((i) => incomeLi(i, false)).join('') || `<li class="empty" style="justify-content:center">尚無收款紀錄。${p.billing === 'milestone' ? '未建立時,預估收入會記在專案結束月;可按「建立分期」拆成數期。' : '未請款的月份會依費率自動計入預估收入。'}</li>`}</ul></div>
  </div>`;
}

// ---------- 收入 ----------
function incomeLi(i, showProject) {
  const p = proj(i.project_id), late = i.status !== 'received' && i.date < today();
  return `<li><div class="when">${md(i.date)}</div>
    <div class="main"><div class="t">${showProject ? `<span class="dot" style="background:${tcolor(p.type)}"></span>${h(p.name)}` : `<span class="num">${money(i.amount)}</span>`}</div>
    <div class="small muted">${showProject ? `<span class="num">${money(i.amount)}</span>・` : i.date.slice(0, 4) + '・'}<span class="badge s-${late ? 'bad' : i.status}">${late ? '逾期・' : ''}${ISTATUS[i.status]}</span>${i.period ? `・計費 ${i.period}` : ''}${i.note ? '・' + h(i.note) : ''}</div></div>
    <div class="acts">${i.status !== 'received' ? `<button class="btn sm" data-act="income-received" data-id="${i.id}">已收款</button>` : ''}<button class="btn sm" data-act="dlg-income" data-id="${i.id}">編輯</button></div></li>`;
}
function viewIncome() {
  const st = yearStats(S.year), capM = setting('monthly_capacity', 20), T = st.total;
  const list = S.data.incomes.filter((i) => i.date.startsWith(String(S.year)) && live(proj(i.project_id)));
  let body = '';
  for (let m = 1; m <= 12; m++) {
    const rows = list.filter((i) => Number(i.date.slice(5, 7)) === m);
    if (rows.length) body += `<h3 style="margin:14px 0 6px">${m} 月<span class="small muted num" style="font-weight:400">・${money(rows.reduce((t, i) => t + i.amount, 0))}</span></h3><ul class="list">${rows.map((i) => incomeLi(i, true)).join('')}</ul>`;
  }
  return `
  <div class="head"><h1>${S.year} 收入</h1>${yearSelect()}<button class="btn primary" data-act="dlg-income">＋ 收款</button></div>
  <div class="grid kpi">
    <div class="card"><div class="lbl">預估年收入</div><div class="val">${wan(T.fc)}</div><div class="sub">已實現+已排預收+未排預估</div></div>
    <div class="card"><div class="lbl">已實現(已完成工作)</div><div class="val">${wan(T.earned)}</div><div class="sub">${T.earned > T.billed ? `其中 ${wan(T.earned - T.billed)} 尚未請款` : '皆已請款'}</div></div>
    <div class="card"><div class="lbl">已排預收</div><div class="val">${wan(T.pre)}</div><div class="sub">未排預估 ${wan(T.unrev)}</div></div>
    <div class="card"><div class="lbl">實收</div><div class="val">${wan(T.actual)}</div><div class="sub">已請款未收 ${wan(T.billed - T.actual)}</div></div>
  </div>
  <div class="card"><h2>每月收入</h2><div class="legend">${REV_LEGEND()}</div>${revenueChart(st)}</div>
  ${analysisCard(st)}
  ${monthTable(st, capM)}
  <div class="card"><h2>收款紀錄(依收款日期)</h2>${body || '<div class="empty">本年度尚無收款紀錄</div>'}</div>`;
}

// ---------- 設定 ----------
function viewSettings() {
  return `
  <div class="head"><h1>設定</h1></div>
  <div class="card"><h2>目標與產能</h2><form data-form="settings">
    <div class="row2"><label class="f"><span>年度收入目標(元)</span><input name="annual_target" type="number" min="0" step="10000" inputmode="numeric" value="${setting('annual_target', 0)}"></label>
    <label class="f"><span>每月可投入人天</span><input name="monthly_capacity" type="number" min="0" max="31" step="0.5" inputmode="decimal" value="${setting('monthly_capacity', 20)}"></label></div>
    <label class="f"><span>預設日費(元,按日計專案的預設值;半天為半價)</span><input name="default_daily_rate" type="number" min="0" step="500" inputmode="numeric" value="${setting('default_daily_rate', 12000)}"></label>
    <button class="btn primary">儲存</button></form></div>
  <div class="card"><h2>工作類型<span class="spacer"></span><button class="btn sm primary" data-act="dlg-type">＋ 類型</button></h2>
    <ul class="list">${Object.entries(TYPES).map(([k, t]) => { const n = S.data.projects.filter((p) => p.type === k).length; return `<li>
      <span class="dot" style="background:${tcolor(k)};width:14px;height:14px"></span>
      <div class="main"><div class="t">${h(t.label)}${t.active ? '' : ' <span class="badge">已停用</span>'}</div><div class="small muted">簡稱 ${h(t.short)}・${n} 個專案・排序 ${t.sort}</div></div>
      <div class="acts"><button class="btn sm" data-act="dlg-type" data-key="${h(k)}">編輯</button></div></li>`; }).join('')}</ul>
    <p class="muted small" style="margin-bottom:0">停用的類型不會出現在新增專案的選單,既有專案與統計不受影響。</p></div>
  <div class="card"><h2>帳號</h2><p class="muted small" style="margin-top:0">登入帳號:${h(S.user.username)}</p>
    <div class="chips"><button class="btn" data-act="dlg-password">變更密碼</button><button class="btn" data-act="logout">登出</button></div></div>
  <div class="card"><h2>資料備份</h2><p class="muted small" style="margin-top:0">匯出全部專案、排程與收款為 JSON 檔。</p><a class="btn" href="/api/export" download style="display:inline-block">下載備份</a></div>`;
}

// ---------- 對話框 ----------
function openDlg(html) { const d = $('#dlg'); d.innerHTML = html; if (!d.open) d.showModal(); }
const closeDlg = () => $('#dlg').close();
const dlgActions = (isEdit, delAct, id) => `<div class="err"></div><div class="dlg-actions">${isEdit ? `<button type="button" class="btn danger" data-act="${delAct}" data-id="${id}">刪除</button>` : ''}<span class="spacer"></span><button type="button" class="btn" data-act="dlg-close">取消</button><button class="btn primary">儲存</button></div>`;
const projectOptions = (sel) => {
  const ps = S.data.projects.filter((p) => p.id === sel || !['done', 'cancelled'].includes(p.status));
  return ps.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${h(p.name)}</option>`).join('');
};

function dlgProject(id) {
  const p = id ? proj(id) : { name: '', type: Object.keys(activeTypes())[0], source_type: SOURCES[0], source_name: '', client: '', status: 'reserved', start_date: '', end_date: '', est_days: '', est_revenue: '', billing: 'milestone', rate: '', notes: '' };
  const names = [...new Set(S.data.projects.map((x) => x.source_name).filter(Boolean))];
  openDlg(`<form data-form="project" data-id="${id || ''}"><h2>${id ? '編輯專案' : '新增專案'}</h2>
    <label class="f"><span>專案名稱</span><input name="name" value="${h(p.name)}" required maxlength="200"></label>
    <div class="row2"><label class="f"><span>工作類型</span><select name="type">${opts(activeTypes(p.type), p.type)}</select></label>
      <label class="f"><span>狀態</span><select name="status">${opts(STATUS, p.status)}</select></label></div>
    <div class="row2"><label class="f"><span>來源類別</span><select name="source_type">${SOURCES.map((s) => `<option${s === p.source_type ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f"><span>來源名稱(如 SGS)</span><input name="source_name" value="${h(p.source_name)}" list="srcnames"><datalist id="srcnames">${names.map((n) => `<option value="${h(n)}">`).join('')}</datalist></label></div>
    <label class="f"><span>最終客戶</span><input name="client" value="${h(p.client)}"></label>
    <div class="row2"><label class="f"><span>開始日</span><input name="start_date" type="date" value="${p.start_date || ''}"></label>
      <label class="f"><span>結束日</span><input name="end_date" type="date" value="${p.end_date || ''}"></label></div>
    <div class="row2"><label class="f"><span>預估人天(0.5 為單位)</span><input name="est_days" type="number" min="0" step="0.5" inputmode="decimal" value="${p.est_days}"></label>
      <label class="f"><span>收款方式</span><select name="billing" data-change="billing">${opts(BILLING, p.billing)}</select></label></div>
    <label class="f" data-b="milestone"><span>預估收入(元)</span><input name="est_revenue" type="number" min="0" step="1" inputmode="numeric" value="${p.est_revenue}"></label>
    <label class="f" data-b="daily monthly"><span data-rate-label></span><input name="rate" type="number" min="0" step="1" inputmode="numeric" value="${p.rate || ''}"></label>
    <p class="small muted" data-b="daily" style="margin-top:-4px">預估收入 = 預估人天 × 日費(半天半價)。每月依已完成人天結算請款。</p>
    <p class="small muted" data-b="monthly" style="margin-top:-4px">預估收入 = 月費 × 合約月數(開始日到結束日,跨到的月份都算一個月)。</p>
    <label class="f"><span>備註</span><textarea name="notes">${h(p.notes)}</textarea></label>
    ${dlgActions(!!id, 'project-del', id)}</form>`);
  syncBilling($('#dlg form'));
}
function syncBilling(form) {
  const b = form.billing.value;
  form.querySelectorAll('[data-b]').forEach((el) => (el.hidden = !el.dataset.b.split(' ').includes(b)));
  $('[data-rate-label]', form).textContent = b === 'daily' ? '日費(元/天)' : '月費(元/月)';
  if (b === 'daily' && !form.rate.value) form.rate.value = setting('default_daily_rate', 12000);
  form.rate.required = b !== 'milestone';
}
function dlgInstallments(id) {
  const p = proj(id), rest = p.est_revenue - projectSums(p).billed;
  openDlg(`<form data-form="installments" data-id="${id}"><h2>建立分期收款</h2>
    <p class="muted small" style="margin-top:0">將尚未排入收款的 <b class="num">${money(rest)}</b> 平均拆成數筆「預計」收款,日期依專案期間平均分布(最後一期在結束日),建立後可逐筆修改金額與日期。</p>
    <label class="f"><span>期數</span><select name="n"><option value="1">1 期(結案一次請款)</option><option value="2">2 期</option><option value="3">3 期</option><option value="4">4 期</option></select></label>
    ${dlgActions(false)}</form>`);
}
function dlgEntry({ id, pid, date }) {
  const e = id ? S.data.entries.find((x) => x.id === id) : { project_id: pid, date: date || today(), slot: 'FULL', status: 'planned', content: '', note: '', billable: 1 };
  if (!S.data.projects.some((p) => !['done', 'cancelled'].includes(p.status)) && !id) return toast('請先建立專案');
  openDlg(`<form data-form="entry" data-id="${id || ''}"><h2>${id ? '編輯排程' : '新增排程'}</h2>
    <label class="f"><span>專案</span><select name="project_id" required>${projectOptions(e.project_id)}</select></label>
    <div class="row2"><label class="f"><span>${id ? '日期' : '起日'}</span><input name="date" type="date" value="${e.date}" required></label>
      ${id ? '' : '<label class="f"><span>迄日(連續多天時填)</span><input name="to" type="date"></label>'}</div>
    ${id ? '' : '<label class="chk"><input type="checkbox" name="skip_weekends" checked>多天時略過週末</label>'}
    <div class="row2"><label class="f"><span>時段</span><select name="slot">${opts({ FULL: '全天(1 天)', AM: '上午(0.5 天)', PM: '下午(0.5 天)' }, e.slot)}</select></label>
      <label class="f"><span>狀態</span><select name="status">${opts(ESTATUS, e.status)}</select></label></div>
    <label class="chk"><input type="checkbox" name="free"${e.billable ? '' : ' checked'}>義工(不請款,不計入專案預估人天)</label>
    <label class="f"><span>工作內容</span><input name="content" value="${h(e.content)}" maxlength="500" placeholder="例:專案啟動會議、第一階段稽核"></label>
    <label class="f"><span>備註(其他紀錄)</span><textarea name="note" maxlength="500">${h(e.note)}</textarea></label>
    ${dlgActions(!!id, 'entry-del', id)}</form>`);
}
function dlgIncome({ id, pid }) {
  const i = id ? S.data.incomes.find((x) => x.id === id) : { project_id: pid, date: today(), amount: '', status: 'expected', period: '', note: '' };
  if (!S.data.projects.length) return toast('請先建立專案');
  openDlg(`<form data-form="income" data-id="${id || ''}"><h2>${id ? '編輯收款' : '新增收款'}</h2>
    <label class="f"><span>專案</span><select name="project_id" required>${projectOptions(i.project_id)}</select></label>
    <div class="row2"><label class="f"><span>日期(預計或實際)</span><input name="date" type="date" value="${i.date}" required></label>
      <label class="f"><span>金額(元)</span><input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${i.amount}" required></label></div>
    <div class="row2"><label class="f"><span>狀態</span><select name="status">${opts(ISTATUS, i.status)}</select></label>
      <label class="f"><span>計費月份(按日計/月費用)</span><input name="period" type="month" value="${h(i.period)}"></label></div>
    <label class="f"><span>備註(如:第一期款)</span><input name="note" value="${h(i.note)}" maxlength="500"></label>
    ${dlgActions(!!id, 'income-del', id)}</form>`);
}
function dlgType(key) {
  const t = key ? TYPES[key] : { label: '', short: '', c: (Object.keys(TYPES).length % 8) + 1, sort: Math.max(0, ...Object.values(TYPES).map((x) => x.sort)) + 10, active: true };
  openDlg(`<form data-form="type" data-id="${key ? t.id : ''}"><h2>${key ? '編輯工作類型' : '新增工作類型'}</h2>
    <label class="f"><span>類型名稱</span><input name="label" value="${h(t.label)}" required maxlength="40"></label>
    <div class="row2"><label class="f"><span>簡稱(行事曆圖例用)</span><input name="short" value="${h(t.short)}" maxlength="10"></label>
      <label class="f"><span>排序(小的在前)</span><input name="sort" type="number" step="1" inputmode="numeric" value="${t.sort}"></label></div>
    <div class="f"><span class="small muted">顏色</span><div class="swatches">${[1, 2, 3, 4, 5, 6, 7, 8].map((c) => `<label><input type="radio" name="color" value="${c}"${c === t.c ? ' checked' : ''}><i style="background:var(--t${c})"></i></label>`).join('')}</div></div>
    <label class="chk"><input type="checkbox" name="active"${t.active ? ' checked' : ''}>啟用(可用於新專案)</label>
    ${dlgActions(!!key, 'type-del', key ? t.id : 0)}</form>`);
}
function dlgPassword() {
  openDlg(`<form data-form="password"><h2>變更密碼</h2>
    <input name="username" autocomplete="username" value="${h(S.user.username)}" hidden>
    <label class="f"><span>目前密碼</span><input name="current" type="password" autocomplete="current-password" required></label>
    <label class="f"><span>新密碼(至少 8 碼)</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
    <label class="f"><span>再次輸入新密碼</span><input name="again" type="password" autocomplete="new-password" minlength="8" required></label>
    ${dlgActions(false)}</form>`);
}

// ---------- 事件 ----------
const FORMS = {
  async login(f) { S.user = await api('POST', '/login', f); await reload(); },
  async settings(f) { await api('PUT', '/settings', f); toast('已儲存'); await reload(); },
  async project(f, id) {
    const p = await api(id ? 'PUT' : 'POST', '/projects' + (id ? '/' + id : ''), f);
    closeDlg(); if (!id) location.hash = '#/project/' + p.id; await reload();
  },
  async entry(f, id) {
    f.project_id = Number(f.project_id); f.skip_weekends = !!f.skip_weekends; f.billable = !f.free;
    if (id) await api('PUT', '/entries/' + id, f);
    else if (f.to && f.to !== f.date) { const r = await api('POST', '/entries/batch', { ...f, from: f.date }); toast(`已建立 ${r.length} 筆排程`); }
    else await api('POST', '/entries', f);
    S.calDay = f.date; closeDlg(); await reload();
  },
  async income(f, id) { f.project_id = Number(f.project_id); await api(id ? 'PUT' : 'POST', '/incomes' + (id ? '/' + id : ''), f); closeDlg(); await reload(); },
  async type(f, id) { await api(id ? 'PUT' : 'POST', '/types' + (id ? '/' + id : ''), { ...f, color: Number(f.color), active: !!f.active }); closeDlg(); await reload(); },
  async installments(f, id) {
    const p = proj(id), n = Number(f.n), rest = p.est_revenue - projectSums(p).billed;
    if (!(rest > 0)) throw new Error('沒有尚未排入收款的金額');
    const a = Date.parse((p.start_date || today()) + 'T00:00:00Z'), b = Math.max(a, Date.parse((p.end_date || p.start_date || today()) + 'T00:00:00Z'));
    const each = Math.floor(rest / n);
    for (let k = 1; k <= n; k++) {
      const date = new Date(a + Math.round(((b - a) * k) / n / 864e5) * 864e5).toISOString().slice(0, 10);
      await api('POST', '/incomes', { project_id: id, date, amount: k === n ? rest - each * (n - 1) : each, status: 'expected', note: n === 1 ? '結案請款' : `第 ${k}/${n} 期` });
    }
    closeDlg(); await reload();
  },
  async password(f) {
    if (f.next !== f.again) throw new Error('兩次輸入的新密碼不一致');
    await api('POST', '/password', f); S.user.must_change = false; closeDlg(); toast('密碼已變更'); render();
  },
};
document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('[data-form]'); if (!form) return;
  ev.preventDefault();
  const err = $('.err', form), btn = $('button.primary', form);
  if (err) err.textContent = '';
  if (btn) btn.disabled = true;
  try { await FORMS[form.dataset.form](Object.fromEntries(new FormData(form)), Number(form.dataset.id) || 0); }
  catch (e) { if (err && form.isConnected) err.textContent = e.message; else toast(e.message); }
  finally { if (btn) btn.disabled = false; }
});

const shiftMonth = (n) => { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); S.calMonth = ymd(d).slice(0, 7); S.calDay = S.calMonth === today().slice(0, 7) ? today() : S.calMonth + '-01'; render(); };
const putRow = (kind, row, patch) => api('PUT', `/${kind}/${row.id}`, { ...row, ...patch }).then(reload);
const ACTS = {
  'dlg-project': (d) => dlgProject(Number(d.id) || 0),
  'dlg-entry': (d) => dlgEntry({ id: Number(d.id) || 0, pid: Number(d.pid) || 0, date: d.date }),
  'dlg-income': (d) => dlgIncome({ id: Number(d.id) || 0, pid: Number(d.pid) || 0 }),
  'dlg-password': dlgPassword,
  'dlg-installments': (d) => dlgInstallments(Number(d.id)),
  'bill-period': async (d) => {
    const p = proj(Number(d.pid)), b = billingPeriods(p).find((x) => x.ym === d.ym);
    if (!b || !(b.due > 0)) return;
    if (!confirm(`建立 ${p.name} ${b.ym} 的請款 ${money(b.due)}?`)) return;
    await api('POST', '/incomes', { project_id: p.id, date: today(), amount: b.due, status: 'invoiced', period: b.ym, note: p.billing === 'daily' ? `${b.ym} 月結 ${days(b.done)} 天` : `${b.ym} 顧問費` });
    toast('已建立請款紀錄'); await reload();
  },
  'dlg-type': (d) => dlgType(d.key || ''),
  'type-del': async (d) => { if (confirm('刪除這個工作類型?')) { await api('DELETE', '/types/' + d.id); closeDlg(); await reload(); } },
  'dlg-close': closeDlg,
  'cal-day': (d) => { S.calDay = d.date; render(); },
  'cal-prev': () => shiftMonth(-1), 'cal-next': () => shiftMonth(1),
  'cal-today': () => { S.calMonth = today().slice(0, 7); S.calDay = today(); render(); },
  'goto-day': (d) => { S.calDay = d.date; S.calMonth = d.date.slice(0, 7); location.hash = '#/calendar'; },
  'p-filter': (d) => { S.pFilter = d.k; render(); },
  dim: (d) => { S.dim = d.k; render(); },
  'entry-done': (d) => putRow('entries', S.data.entries.find((e) => e.id === Number(d.id)), { status: 'done' }),
  'income-received': (d) => putRow('incomes', S.data.incomes.find((i) => i.id === Number(d.id)), { status: 'received' }),
  'confirm-stale': async () => {
    const t = today(), list = S.data.entries.filter((e) => e.date < t && e.status === 'planned' && live(proj(e.project_id)));
    if (!confirm(`將 ${list.length} 筆過去的排程標為已完成?`)) return;
    for (const e of list) await api('PUT', '/entries/' + e.id, { ...e, status: 'done' });
    await reload();
  },
  'entry-del': async (d) => { if (confirm('刪除這筆排程?')) { await api('DELETE', '/entries/' + d.id); closeDlg(); await reload(); } },
  'income-del': async (d) => { if (confirm('刪除這筆收款?')) { await api('DELETE', '/incomes/' + d.id); closeDlg(); await reload(); } },
  'project-del': async (d) => {
    if (!confirm('刪除專案會一併刪除其排程與收款紀錄,確定?(若只是不做了,建議改狀態為「取消」)')) return;
    await api('DELETE', '/projects/' + d.id); closeDlg(); location.hash = '#/projects'; await reload();
  },
  logout: async () => { await api('POST', '/logout', {}); S.user = null; S.data = null; render(); },
};
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  try { await ACTS[el.dataset.act](el.dataset); } catch (e) { toast(e.message); }
});
document.addEventListener('change', (ev) => {
  const k = ev.target.dataset.change;
  if (k === 'year') { S.year = Number(ev.target.value); render(); }
  if (k === 'ptype') { S.pType = ev.target.value; render(); }
  if (k === 'billing') syncBilling(ev.target.form);
});
$('#dlg').addEventListener('click', (ev) => { if (ev.target.id === 'dlg') closeDlg(); });

// 圖表提示
const tip = $('#tip');
document.addEventListener('pointerover', (ev) => {
  const el = ev.target.closest('[data-tip]');
  if (!el) return (tip.hidden = true);
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = (r.top - hh - 6 > 0 ? r.top - hh - 6 : r.top + 24) + 'px';
});
window.addEventListener('scroll', () => (tip.hidden = true), { passive: true });
window.addEventListener('hashchange', render);

(async () => {
  try { S.user = await api('GET', '/me'); await reload(); } catch { render(); }
})();
