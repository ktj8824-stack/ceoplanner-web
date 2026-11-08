/* =========================================
   CEO플래너 — 비서실 관제 (PC 웹)
   로드플래너 본사 관제 포털과 같은 구성:
   왼쪽 사이드바(담당 대표 · 분류 필터) / 위 헤더(빠른 버튼 · 새 일정 등록)
   오늘 현황 / 캘린더 패널(월간 · 주간 · 당일 동선 · 확인 대기)
   일정 등록은 모달, 비서톡은 오른쪽 서랍.
   ========================================= */
const Sec = {
  view: 'month',          // month | week | day | review
  cur: U.today(),         // 기준 날짜
  filter: 'all',          // 분류 필터
  edit: null,             // { id } | { date } — 열린 편집 모달
  dirty: false,
  chatOpen: false,
  seenMsgs: 0,
  seenUrgent: 0,

  async start() {
    const root = document.getElementById('root');
    try { await Store.init('secretary'); }
    catch (e) { root.innerHTML = `<p style="padding:20px">연결 오류: ${U.esc(e.message || e)}</p>`; return; }
    if (Store.needsLogin) return Login.render(root, 'CEO플래너 비서실 로그인', () => this.boot());
    this.boot();
  },

  boot() {
    this.seenMsgs = Number(localStorage.getItem('CEOP_SEEN_SEC') || 0);
    this.seenUrgent = Number(localStorage.getItem('CEOP_SEEN_SEC_URGENT') || 0);
    const root = document.getElementById('root');
    root.innerHTML = `
      ${Store.mode === 'demo' ? `<div class="demo-bar">데모 모드입니다. 같은 브라우저에서 <a href="${U.esc(CEOP_CONFIG.APP_URL)}" target="_blank">CEO 앱</a>을 열면 양쪽에 바로 반영돼요.</div>` : ''}
      <div class="shell">
        <aside class="side" id="side"></aside>
        <main class="main">
          <header class="main-head" id="head"></header>
          <div id="urgent"></div>
          <section class="panel" id="stats"></section>
          <section class="panel cal" id="cal"></section>
        </main>
      </div>
      <aside class="drawer" id="drawer" aria-hidden="true"></aside>`;
    Store.on(() => this.refresh());
    setInterval(() => this.renderStats(), 60000);
    this.refresh();
  },

  refresh() {
    this.renderSide();
    this.renderHead();
    this.renderUrgent();
    this.renderStats();
    this.renderCal();
    if (this.chatOpen) this.renderDrawer();
  },

  // ───────── 데이터 도우미 ─────────
  visible(list) { return this.filter === 'all' ? list : list.filter(s => s.masked || s.category === this.filter); },
  day(ymd) { return this.visible(Store.byDate(ymd)).filter(s => s.status !== 'cancelled'); },
  newMsgs() { return Store.messages().slice(this.seenMsgs).filter(m => m.from === 'ceo').length; },

  // ───────── 사이드바 ─────────
  renderSide() {
    const p = Store.profile();
    const today = Store.byDate(U.today());
    const upcoming = Store.list().filter(s => !s.masked && s.date >= U.today() && s.date <= U.addDays(U.today(), 30));
    const cats = Object.entries(Backtime.CATEGORIES).filter(([k]) => k !== 'personal');
    const item = (key, label, sub, count, icon) => `
      <button class="side-item ${this.filter === key ? 'on' : ''}" data-filter="${key}">
        <span class="side-ic">${icon}</span><span class="side-txt"><b>${label}</b><small>${sub}</small></span><span class="side-count">${count}</span></button>`;
    const el = document.getElementById('side');
    el.innerHTML = `
      <div class="brand"><img src="icon.svg" alt="" width="34" height="34"><div><b>CEO플래너</b><small>비서실 일정 관제</small></div></div>
      <div class="side-sec"><div class="side-title">담당 대표</div>
        <div class="ceo-card"><span class="avatar">${U.esc((p.name || '대').slice(0, 1))}</span>
          <span class="side-txt"><b>${U.esc(p.name || '대표')}</b><small>오늘 일정 ${today.length}건</small></span></div></div>
      <div class="side-sec grow"><div class="side-title">분류</div>
        <div class="side-list">
          ${item('all', '전체 일정', '앞으로 30일', upcoming.length, Icon.svg('grid', 16))}
          ${cats.map(([k, c]) => item(k, c.label, k === 'golf' ? '티오프 1시간 전 도착' : k === 'trip' ? 'KTX · 항공' : '앞으로 30일', upcoming.filter(s => s.category === k).length, Icon.cat(k, 16))).join('')}
        </div></div>
      <div class="side-foot">
        <a class="side-btn" href="${U.esc(CEOP_CONFIG.APP_URL)}" target="_blank">${Icon.svg('phone', 16)} CEO 앱 열기</a>
        ${Store.mode === 'demo' ? `<button class="side-btn" data-reset>${Icon.svg('settings', 16)} 데모 데이터 초기화</button>` : `<button class="side-btn" data-logout>${Icon.svg('settings', 16)} 로그아웃</button>`}
      </div>`;
    el.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { this.filter = b.dataset.filter; this.refresh(); }));
    el.querySelector('[data-reset]')?.addEventListener('click', () => { if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) Store.resetDemo(); });
    el.querySelector('[data-logout]')?.addEventListener('click', () => Store.signOut());
  },

  // ───────── 헤더 ─────────
  renderHead() {
    const p = Store.profile();
    const n = this.newMsgs();
    const el = document.getElementById('head');
    el.innerHTML = `
      <div><h1>대표 일정 관제</h1><p>${U.esc(p.name || '대표')}님 일정 · 담당 ${U.esc(p.secretaryName || '비서')}</p></div>
      <div class="head-actions">
        <a class="btn" href="${U.telLink(p.driverPhone)}">${Icon.svg('car', 16)} ${U.esc(p.driverName || '기사님')} 연결</a>
        <button class="btn" data-chat>${Icon.svg('chat', 16)} 비서톡${n ? `<span class="pill-count">${n}</span>` : ''}</button>
        <button class="btn primary" data-new>${Icon.svg('plus', 16)} 새 일정 등록</button>
      </div>`;
    el.querySelector('[data-chat]').addEventListener('click', () => this.toggleChat(true));
    el.querySelector('[data-new]').addEventListener('click', () => this.openEditor({ date: this.view === 'day' ? this.cur : U.today() }));
  },

  renderUrgent() {
    const el = document.getElementById('urgent');
    const msgs = Store.messages();
    const urgent = msgs.filter(m => m.from === 'ceo' && m.urgent);
    if (urgent.length <= this.seenUrgent) { el.innerHTML = ''; return; }
    const m = urgent[urgent.length - 1];
    el.innerHTML = `<div class="urgent">${Icon.svg('siren', 20)}<b>대표님 긴급 요청</b><span>${U.esc(m.body)} · ${U.hm(new Date(m.at))}</span>
      <a class="btn" href="${U.telLink(Store.profile().ceoPhone)}">전화하기</a><button class="btn" data-seen>확인함</button></div>`;
    el.querySelector('[data-seen]').addEventListener('click', () => {
      this.seenUrgent = urgent.length; localStorage.setItem('CEOP_SEEN_SEC_URGENT', String(urgent.length)); this.renderUrgent();
    });
  },

  // ───────── 오늘 현황 ─────────
  renderStats() {
    const now = new Date();
    const today = Store.byDate(U.today()).filter(s => s.status !== 'cancelled');
    const mine = today.filter(s => !s.masked);
    const acked = mine.filter(s => s.ackAt).length;
    const pending = Store.list().filter(s => !s.masked && !s.ackAt && s.date >= U.today()).length;
    let conflicts = 0;
    for (let i = 0; i < 7; i++) conflicts += Backtime.conflicts(Store.byDate(U.addDays(U.today(), i)).filter(s => s.status !== 'cancelled')).length;
    const plans = Backtime.planDay(today, { prepMin: Store.profile().prepMin });
    const next = plans.find(({ s, p }) => s.mode !== 'none' && !s.masked && p.leaveAt > now);
    const stat = (label, value, sub, icon, tone = '', view = '') => `
      <button class="stat ${tone}" ${view ? `data-goview="${view}"` : 'tabindex="-1"'}><span class="stat-txt"><span class="stat-label">${label}</span>
        <span class="stat-val num">${value}</span><span class="stat-sub">${sub}</span></span><span class="stat-ic">${icon}</span></button>`;
    const el = document.getElementById('stats');
    el.innerHTML = `<div class="panel-head"><h2>오늘 현황</h2><span class="muted small">${U.dateLabel(U.today())} · ${U.hm(now)} 기준</span></div>
      <div class="stats">
        ${stat('오늘 일정', today.length, `개인 일정 ${today.length - mine.length}건 포함`, Icon.svg('calendar', 20), '', 'day')}
        ${stat('대표 확인', `${acked}/${mine.length}`, '오늘 일정 중', Icon.svg('checkCircle', 20), 'ok')}
        ${stat('확인 대기', pending, '앞으로의 일정', Icon.svg('clock', 20), pending ? 'warn' : '', 'review')}
        ${stat('이동 경고', conflicts, '7일 안 충돌·시간 부족', Icon.svg('alert', 20), conflicts ? 'signal' : '', 'review')}
        ${stat('다음 출발', next ? U.hm(next.p.leaveAt) : '—', next ? U.esc(next.s.title) : '오늘 남은 이동 없음', Icon.svg('car', 20), 'brass')}
      </div>`;
    el.querySelectorAll('[data-goview]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.goview; this.cur = U.today(); this.renderCal(); }));
  },

  // ───────── 캘린더 패널 ─────────
  VIEWS: [['month', '월간 캘린더'], ['week', '주간 시간표'], ['day', '당일 동선'], ['review', '확인 대기']],

  rangeLabel() {
    const d = U.at(this.cur, '00:00');
    if (this.view === 'month') return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (this.view === 'week') { const w = this.weekDays(); const a = U.at(w[0], '00:00'), b = U.at(w[6], '00:00'); return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`; }
    if (this.view === 'day') return U.dateLabel(this.cur);
    return '앞으로 7일';
  },

  move(dir) {
    if (dir === 0) this.cur = U.today();
    else if (this.view === 'month') { const d = U.at(this.cur, '00:00'); this.cur = U.ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
    else this.cur = U.addDays(this.cur, dir * (this.view === 'week' ? 7 : 1));
    this.renderCal();
  },

  renderCal() {
    const el = document.getElementById('cal');
    const body = { month: () => this.monthView(), week: () => this.weekView(), day: () => this.dayView(), review: () => this.reviewView() }[this.view]();
    el.innerHTML = `
      <div class="cal-bar">
        ${this.view === 'review' ? '' : `<div class="cal-nav"><button class="icon-btn" data-move="-1" aria-label="이전">${Icon.svg('left', 16)}</button>
          <button class="btn" data-move="0">오늘</button><button class="icon-btn" data-move="1" aria-label="다음">${Icon.svg('right', 16)}</button></div>`}
        <h2 class="num">${this.rangeLabel()}</h2>
        ${this.filter !== 'all' ? `<span class="badge">${Backtime.CATEGORIES[this.filter].label}만 보기</span>` : ''}
        <div class="tabs">${this.VIEWS.map(([k, l]) => `<button class="${this.view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="cal-body">${body}</div>`;
    el.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => this.move(Number(b.dataset.move))));
    el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.view; this.renderCal(); }));
    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.openEditor({ id: b.dataset.open }); }));
    el.querySelectorAll('[data-newon]').forEach(b => b.addEventListener('click', () => this.openEditor({ date: b.dataset.newon })));
    el.querySelectorAll('[data-dayof]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.cur = b.dataset.dayof; this.view = 'day'; this.renderCal(); }));
  },

  pill(s) {
    if (s.masked) return `<div class="ev masked"><span class="num">${s.start}</span>${Icon.svg('lock', 12)} 바쁨</div>`;
    return `<button class="ev cat-${s.category} ${s.ackAt ? '' : 'unacked'}" data-open="${s.id}" title="${U.esc(s.title)}">
      <span class="num">${s.start}</span><span class="ev-t">${U.esc(s.title)}</span>${s.ackAt ? '' : '<i class="dot" title="대표 미확인"></i>'}</button>`;
  },

  monthView() {
    const d = U.at(this.cur, '00:00');
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const start = U.addDays(U.ymd(first), -first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) / 7);
    let html = `<div class="month">${U.WEEK.map((w, i) => `<div class="mh ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}`;
    for (let i = 0; i < weeks * 7; i++) {
      const ymd = U.addDays(start, i);
      const dd = U.at(ymd, '00:00');
      const list = this.day(ymd);
      const out = dd.getMonth() !== d.getMonth();
      const warn = Backtime.conflicts(Store.byDate(ymd).filter(s => s.status !== 'cancelled')).length;
      html += `<div class="mc ${out ? 'out' : ''} ${ymd === U.today() ? 'today' : ''}" data-newon="${ymd}">
        <div class="mc-head"><button class="mc-num num ${dd.getDay() === 0 ? 'sun' : dd.getDay() === 6 ? 'sat' : ''}" data-dayof="${ymd}">${dd.getDate()}</button>
        ${warn ? `<span class="mc-warn" title="이동 경고 ${warn}건">${Icon.svg('alert', 13)}</span>` : ''}${list.length ? `<span class="mc-count">${list.length}건</span>` : ''}</div>
        <div class="mc-evs">${list.slice(0, 3).map(s => this.pill(s)).join('')}${list.length > 3 ? `<button class="more" data-dayof="${ymd}">+${list.length - 3}건 더</button>` : ''}</div></div>`;
    }
    return html + '</div>';
  },

  weekDays() {
    const d = U.at(this.cur, '00:00');
    const sun = U.addDays(this.cur, -d.getDay());
    return Array.from({ length: 7 }, (_, i) => U.addDays(sun, i));
  },

  weekView() {
    return `<div class="week">${this.weekDays().map(ymd => {
      const dd = U.at(ymd, '00:00');
      const list = this.day(ymd);
      return `<div class="wc ${ymd === U.today() ? 'today' : ''}">
        <button class="wc-head" data-dayof="${ymd}"><b class="${dd.getDay() === 0 ? 'sun' : dd.getDay() === 6 ? 'sat' : ''}">${U.WEEK[dd.getDay()]}요일</b><span class="num">${dd.getMonth() + 1}/${dd.getDate()}</span><em>${list.length}건</em></button>
        <div class="wc-list">${list.map(s => this.pill(s)).join('') || '<p class="empty">일정 없음</p>'}</div>
        <button class="wc-add" data-newon="${ymd}">${Icon.svg('plus', 14)} 추가</button></div>`;
    }).join('')}</div>`;
  },

  /** 당일 동선 — 로드플래너 '당일 동선 간트차트'처럼 이동·일정 막대 + 역산 세부 */
  dayView() {
    const list = this.day(this.cur);
    const plans = Backtime.planDay(list, { prepMin: Store.profile().prepMin });
    const warns = Backtime.conflicts(list);
    if (!plans.length) return `<div class="empty-big">${Icon.svg('calendar', 28)}<p>이 날은 일정이 없어요.</p><button class="btn primary" data-newon="${this.cur}">${Icon.svg('plus', 16)} 이 날 일정 등록</button></div>`;
    const times = plans.flatMap(({ p }) => [p.wakeAt || p.driverCallAt || p.leaveAt, p.endAt]);
    const h0 = Math.max(0, Math.min(...times.map(t => t.getHours())) - 1);
    const h1 = Math.min(24, Math.max(...times.map(t => t.getHours() + (t.getMinutes() ? 1 : 0))) + 1);
    const span = (h1 - h0) * 60;
    const base = U.at(this.cur, `${U.pad(h0)}:00`);
    const pos = t => Math.max(0, Math.min(100, U.diffMin(t, base) / span * 100));
    const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    const scale = `<div class="g-scale">${hours.map(h => `<span style="left:${(h - h0) * 60 / span * 100}%">${h}</span>`).join('')}</div>`;
    const rows = plans.map(({ s, p }) => {
      const go = s.mode !== 'none' && !s.masked;
      const from = p.driverCallAt || p.leaveAt;
      const bars = (go ? `<i class="g-move" style="left:${pos(from)}%;width:${pos(p.startAt) - pos(from)}%" title="기사 대기·이동"></i>` : '') +
        `<i class="g-main ${s.masked ? 'masked' : `cat-${s.category}`}" style="left:${pos(p.startAt)}%;width:${Math.max(.8, pos(p.endAt) - pos(p.startAt))}%"></i>`;
      const steps = go ? p.items.filter(it => it.kind !== 'end').map(it => `<li><b class="num">${U.hm(it.at)}</b>${Icon.kind(it.kind, 14)}<span>${U.esc(it.title)}</span></li>`).join('') : '';
      return `<div class="g-row">
        <div class="g-label">${s.masked ? `<span class="num">${s.start}–${s.end}</span><b class="masked-t">${Icon.svg('lock', 14)} 대표 개인 일정</b>`
          : `<span class="num">${s.start}–${s.end}</span><button class="g-title" data-open="${s.id}">${Icon.cat(s.category, 15)} ${U.esc(s.title)}</button>
             <span class="muted small">${U.esc(s.location || '')}${go ? ` · ${Backtime.MODES[s.mode].label}` : ''}</span>
             ${s.ackAt ? '<span class="badge ok">대표 확인</span>' : '<span class="badge warn">미확인</span>'}`}</div>
        <div class="g-track">${bars}</div>
        ${steps ? `<ol class="g-steps">${steps}</ol>` : ''}</div>`;
    }).join('');
    return `${warns.map(w => `<div class="note signal">${Icon.svg('alert', 16)} ${U.esc(w.msg)}</div>`).join('')}
      <div class="gantt"><div class="g-row g-head"><div class="g-label"></div>${scale}</div>${rows}</div>
      <p class="legend"><i class="g-move"></i> 기사 대기·이동 <i class="g-main cat-external"></i> 일정</p>`;
  },

  reviewView() {
    const items = [];
    for (let i = 0; i < 7; i++) {
      const ymd = U.addDays(U.today(), i);
      Backtime.conflicts(Store.byDate(ymd).filter(s => s.status !== 'cancelled')).forEach(w => {
        const target = w.b.masked ? w.a : w.b;
        items.push(`<li class="rv signal">${Icon.svg('alert', 18)}<div><b>${U.esc(w.msg)}</b><span>${U.dateLabel(ymd)}</span></div>${target.masked ? '' : `<button class="btn" data-open="${target.id}">고치기</button>`}</li>`);
      });
    }
    Store.list().filter(s => !s.masked && !s.ackAt && s.date >= U.today())
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .forEach(s => items.push(`<li class="rv">${Icon.svg('clock', 18)}<div><b>${U.esc(s.title)}</b><span>${U.dateLabel(s.date)} ${s.start} · 대표님이 아직 확인하지 않았어요</span></div><button class="btn" data-open="${s.id}">열기</button></li>`));
    return items.length ? `<ul class="review">${items.join('')}</ul>` : `<div class="empty-big">${Icon.svg('checkCircle', 28)}<p>확인할 일정이 없어요. 모든 일정에 문제가 없어요.</p></div>`;
  },

  // ───────── 일정 등록·수정 모달 ─────────
  openEditor(target) {
    const s = target.id ? Store.get(target.id) : this.blank(target.date);
    if (!s || s.masked) return;
    this.edit = target; this.dirty = false;
    const b = s.briefing || {}, t = s.trip || {};
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`).join('');
    const cats = Object.fromEntries(Object.entries(Backtime.CATEGORIES).filter(([k]) => k !== 'personal'));
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal editor" role="dialog" aria-label="일정 등록">
      <div class="ed-head"><div><h3>${target.id ? '일정 수정' : '새 일정 등록'}</h3>
        <p class="muted small">${target.id ? (s.ackAt ? '대표님이 확인한 일정이에요. 고치면 다시 확인을 받아요.' : '대표님이 아직 확인하지 않았어요.') : '저장하면 대표님 앱에 바로 표시돼요.'}</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="ed-body">
      <form id="ef" class="ed-form">
        <label class="wide">일정 이름<input name="title" required value="${U.esc(s.title || '')}" placeholder="예: 한빛전자 협력 미팅"></label>
        <label>분류<select name="category">${opt(cats, s.category)}</select></label>
        <label>날짜<input name="date" type="date" required value="${s.date}"></label>
        <label><span id="startLbl">시작</span><input name="start" type="time" required value="${s.start}"></label>
        <label>종료<input name="end" type="time" required value="${s.end}"></label>
        <label class="full">장소<input name="location" value="${U.esc(s.location || '')}" placeholder="예: 한빛전자 삼성동 사옥"></label>
        <label>이동수단<select name="mode">${opt(Backtime.MODES, s.mode)}</select></label>
        <label class="mv"><span id="travelLbl">예상 이동 시간 (분)</span><input name="travelMin" type="number" min="0" max="600" value="${Number(s.travelMin || 0)}"></label>
        <label class="mv">여유 시간 (분)<input name="bufferMin" type="number" min="0" max="120" value="${Number(s.bufferMin ?? 10)}"></label>
        <fieldset class="wide" id="tripBox"><legend>기차 · 비행기</legend>
          <label>역 · 공항<input name="station" value="${U.esc(t.station || '')}" placeholder="예: 서울역"></label>
          <label>출발 시각<input name="departTime" type="time" value="${t.departTime || ''}"></label>
          <label>도착 시각<input name="arriveTime" type="time" value="${t.arriveTime || ''}"></label>
          <label>역까지 (분)<input name="accessMin" type="number" min="0" max="300" value="${Number(t.accessMin || 0)}"></label>
          <label>역까지 수단<select name="accessMode">${opt({ driver: Backtime.MODES.driver, taxi: Backtime.MODES.taxi, car: Backtime.MODES.car }, t.accessMode || 'driver')}</select></label>
          <label>국제선<select name="intl"><option value="">아니오</option><option value="1" ${t.intl ? 'selected' : ''}>예</option></select></label>
        </fieldset>
        <fieldset class="wide"><legend>미팅 브리핑 — 대표님 앱에 일정 직전 표시</legend>
          <label><span id="whoLbl">만날 분</span><input name="who" value="${U.esc(b.who || '')}" placeholder="예: 정민호 부사장"></label>
          <label>회사 · 직함<input name="company" value="${U.esc(b.company || '')}"></label>
          <label class="wide">목적<input name="purpose" value="${U.esc(b.purpose || '')}"></label>
          <label>지난 미팅<textarea name="last">${U.esc(b.last || '')}</textarea></label>
          <label>메모<textarea name="notes">${U.esc(b.notes || '')}</textarea></label>
          <label class="wide">준비물<input name="bring" value="${U.esc(b.bring || '')}"></label>
        </fieldset>
      </form>
      <aside class="ed-preview" id="preview"></aside>
      </div>
      <div class="ed-foot">${target.id ? '<button type="button" class="btn quiet" data-del>일정 삭제</button>' : ''}<span style="flex:1"></span>
        <button type="button" class="btn" data-close>취소</button><button class="btn primary" form="ef">${target.id ? '저장하고 다시 확인 요청' : '등록하고 대표님께 보내기'}</button></div>
    </div>`;
    const close = () => { if (this.dirty && !confirm('저장하지 않은 내용이 있어요. 닫을까요?')) return; this.edit = null; this.dirty = false; back.remove(); };
    back.addEventListener('click', e => { if (e.target === back) close(); });
    back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && document.body.contains(back)) { close(); } if (!document.body.contains(back)) document.removeEventListener('keydown', esc); });
    const f = back.querySelector('#ef');
    f.addEventListener('input', () => { this.dirty = true; this.syncForm(f, back); });
    f.addEventListener('change', () => this.syncForm(f, back));
    f.addEventListener('submit', async e => { e.preventDefault(); if (await this.save(f)) { this.dirty = false; this.edit = null; back.remove(); } });
    back.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('이 일정을 삭제할까요? 대표님 앱에서도 사라져요.')) return;
      try { await Store.remove(target.id); this.dirty = false; this.edit = null; back.remove(); U.toast('일정을 삭제했어요'); }
      catch (err) { U.toast('삭제하지 못했어요: ' + (err.message || err)); }
    });
    document.body.appendChild(back);
    this.syncForm(f, back);
    f.title.focus();
  },

  blank(date) {
    return { title: '', category: 'external', date: date || U.today(), start: '10:00', end: '11:00', location: '', mode: 'driver', travelMin: 30, bufferMin: 10, briefing: {}, trip: null, visibility: 'normal' };
  },

  fromForm(f) {
    const v = n => f.elements[n].value;
    const mode = v('mode');
    const id = this.edit && this.edit.id;
    const s = {
      ...(id ? Store.get(id) : {}),
      title: v('title').trim(), category: v('category'), date: v('date'), start: v('start'), end: v('end'),
      location: v('location').trim(), mode, travelMin: Number(v('travelMin')) || 0, bufferMin: Number(v('bufferMin')) || 0,
      visibility: 'normal', status: 'scheduled',
      briefing: { who: v('who').trim(), company: v('company').trim(), purpose: v('purpose').trim(), last: v('last').trim(), notes: v('notes').trim(), bring: v('bring').trim() },
      trip: Backtime.isTrip(mode) ? { station: v('station').trim(), departTime: v('departTime'), arriveTime: v('arriveTime'), accessMin: Number(v('accessMin')) || 0, accessMode: v('accessMode'), intl: !!v('intl') } : null,
    };
    if (id) s.id = id;
    return s;
  },

  syncForm(f, back) {
    const mode = f.elements.mode.value, cat = f.elements.category.value;
    back.querySelector('#tripBox').style.display = Backtime.isTrip(mode) ? '' : 'none';
    back.querySelectorAll('.mv').forEach(el => { el.style.display = mode === 'none' ? 'none' : ''; });
    back.querySelector('#travelLbl').textContent = Backtime.isTrip(mode) ? '도착역 → 현장 (분)' : '예상 이동 시간 (분)';
    back.querySelector('#startLbl').textContent = cat === 'golf' ? '티오프' : '시작';
    back.querySelector('#whoLbl').textContent = cat === 'golf' ? '동반자' : '만날 분';
    const s = this.fromForm(f);
    if (!s.title) s.title = '새 일정';
    const box = back.querySelector('#preview');
    if (!s.date || !s.start) { box.innerHTML = ''; return; }
    const others = Store.byDate(s.date).filter(x => x.id !== s.id && x.status !== 'cancelled');
    const day = Backtime.planDay([...others, s], { prepMin: Store.profile().prepMin });
    const mine = day.find(d => d.s === s);
    const warns = Backtime.conflicts([...others, s]).filter(w => w.a === s || w.b === s);
    const lead = mine.p.leaveAt && s.mode !== 'none';
    box.innerHTML = `<h4>대표님 앱에 보이는 동선</h4>
      ${lead ? `<div class="pv-lead"><span>출발</span><b class="num">${U.hm(mine.p.leaveAt)}</b></div>` : ''}
      <ol class="pv">${mine.p.items.map(it => `<li class="k-${it.kind}"><b class="num">${U.hm(it.at)}</b><span>${Icon.kind(it.kind, 14)} ${U.esc(it.title)}<small>${U.esc(it.detail || '')}</small></span></li>`).join('')}</ol>
      ${warns.map(w => `<div class="note signal">${Icon.svg('alert', 15)} ${U.esc(w.msg)}</div>`).join('')}
      ${s.end < s.start ? `<div class="note signal">${Icon.svg('alert', 15)} 종료 시간이 시작보다 빨라요</div>` : ''}`;
  },

  async save(f) {
    const s = this.fromForm(f);
    if (!s.title) { U.toast('일정 이름을 입력하세요'); return false; }
    if (s.end < s.start) { U.toast('종료 시간이 시작보다 빨라요'); return false; }
    try { await Store.upsert(s); U.toast(this.edit.id ? '저장했어요. 대표님께 다시 확인을 요청했어요' : '등록했어요. 대표님 앱에 표시돼요'); return true; }
    catch (err) { U.toast('저장하지 못했어요: ' + (err.message || err)); return false; }
  },

  // ───────── 비서톡 서랍 ─────────
  toggleChat(open) {
    this.chatOpen = open;
    const d = document.getElementById('drawer');
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', String(!open));
    if (open) { this.renderDrawer(); d.querySelector('input')?.focus(); }
  },

  renderDrawer() {
    const d = document.getElementById('drawer');
    const msgs = Store.messages();
    this.seenMsgs = msgs.length; localStorage.setItem('CEOP_SEEN_SEC', String(msgs.length));
    const keep = d.querySelector('input')?.value || '';
    d.innerHTML = `<div class="dr-head"><div><b>비서톡</b><small>${U.esc(Store.profile().name || '대표')}님과 대화</small></div>
        <button class="icon-btn" data-x aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dr-msgs" id="drMsgs">${msgs.map(m => `<div class="m ${m.from === 'secretary' ? 'me' : 'them'} ${m.urgent ? 'urgent' : ''}">${m.urgent ? '<b>긴급</b> ' : ''}${U.esc(m.body)}<small class="num">${m.from === 'ceo' ? '대표' : '나'} · ${U.hm(new Date(m.at))}</small></div>`).join('') || '<p class="muted small">대표님 요청이 여기에 표시돼요.</p>'}</div>
      <form class="dr-send" id="drSend"><input name="body" placeholder="대표님께 보낼 메시지" autocomplete="off"><button class="btn primary" aria-label="보내기">${Icon.svg('send', 16)}</button></form>`;
    const box = d.querySelector('#drMsgs'); box.scrollTop = box.scrollHeight;
    const form = d.querySelector('#drSend');
    form.body.value = keep;
    d.querySelector('[data-x]').addEventListener('click', () => this.toggleChat(false));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = form.body.value.trim(); if (!v) return;
      try { form.body.value = ''; await Store.send(v); } catch (err) { U.toast('보내지 못했어요: ' + (err.message || err)); }
    });
    this.renderHead();
  },
};

Sec.start();
