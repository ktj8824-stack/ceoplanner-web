/* =========================================
   CEO플래너 — 비서실 관제 (PC 웹)
   로드플래너 본사 관제 포털과 같은 구성:
   왼쪽 사이드바(담당 대표 · 분류 필터) / 위 헤더(배차 알림 · 비서톡 · 새 일정 등록)
   오늘 현황(모두 오늘 기준) / 캘린더 패널(월간 · 주간 · 당일 동선 · 확인 대기)
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

  CAT_COLOR: { meeting: '#556274', external: '#2F5DA8', dinner: '#A7864B', golf: '#276A4E', trip: '#5B54B8', event: '#B4442E', personal: '#5B54B8' },

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
      ${Store.mode === 'demo' ? `<div class="demo-bar">데모 모드예요. 같은 브라우저에서 <a href="${U.esc(CEOP_CONFIG.APP_URL)}" target="_blank">대표 앱</a>을 열면 양쪽에 바로 반영돼요.${Store.forcedDemo ? ' · <button data-exitdemo>데모 끝내기</button>' : ''}</div>` : ''}
      <div class="shell">
        <aside class="side" id="side"></aside>
        <main class="main">
          <header class="main-head" id="head"></header>
          <div id="planbar"></div>
          <div id="urgent"></div>
          <section class="panel" id="stats"></section>
          <section class="panel cal" id="cal"></section>
        </main>
      </div>
      <aside class="drawer" id="drawer" aria-hidden="true"></aside>
      <div class="plan-lock-back" id="planlock" hidden></div>`;
    Store.on(() => this.refresh());
    setInterval(() => { this.renderStats(); if (this.view === 'day') this.renderCal(); }, 60000);
    this.refresh();
  },

  refresh() {
    this.renderPlan();
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
  pendingAll() { return Store.list().filter(s => !s.masked && !s.ackAt && s.status !== 'cancelled' && s.date >= U.today()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)); },
  conflictsOn(ymd) { return Backtime.conflictsOn(Store.list(), ymd); },
  dateShort(ymd) { const d = U.at(ymd, '00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${U.WEEK[d.getDay()]})`; },
  whenLabel(s) {
    const rel = s.date === U.today() ? '오늘' : s.date === U.addDays(U.today(), 1) ? `내일 (${U.WEEK[U.at(s.date, '00:00').getDay()]})` : this.dateShort(s.date);
    return `${rel} ${s.start}`;
  },
  /** '12:50으로' · '13:00로' · '12:45로' — 시각을 읽는 소리에 맞춘 조사 */
  ro(hm) { const m = hm.slice(-2); return m === '00' || m.endsWith('5') ? '로' : '으로'; },
  ampm(hm) { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}:${U.pad(m)}`; },
  ago(iso) {
    const m = U.diffMin(new Date(), new Date(iso));
    if (m < 1) return '방금'; if (m < 60) return `${m}분 전`; if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
    return `${Math.floor(m / 1440)}일 전`;
  },

  // ───────── 사이드바 ─────────
  renderSide() {
    const p = Store.profile();
    const upcoming = Store.list().filter(s => !s.masked && s.date >= U.today() && s.date <= U.addDays(U.today(), 30));
    const cats = Object.entries(Backtime.CATEGORIES).filter(([k]) => k !== 'personal');
    const item = (key, label, count, color) => `
      <button class="side-item ${this.filter === key ? 'on' : ''}" data-filter="${key}">
        ${color ? `<i class="sw" style="background:${color}"></i>` : ''}<span class="side-txt">${label}</span><span class="side-count">${count}</span></button>`;
    const el = document.getElementById('side');
    el.innerHTML = `
      <div class="brand"><img src="icon.svg" alt="" width="36" height="36"><div><b>CEO플래너</b><small>비서실 일정 관제</small></div></div>
      <div class="ceo-card"><span class="avatar">${U.esc((p.name || '대').slice(0, 1))}</span>
        <span class="side-txt"><b>${U.esc(p.name || '대표')}님</b><small>담당 ${U.esc(p.secretaryName || '비서')} · ${U.esc(p.driverName || '기사')}</small></span></div>
      <div class="side-sec grow"><div class="side-title">분류 · 앞으로 30일</div>
        <div class="side-list">
          ${item('all', '전체 일정', upcoming.length, '')}
          ${cats.map(([k, c]) => item(k, c.label, upcoming.filter(s => s.category === k).length, this.CAT_COLOR[k])).join('')}
        </div></div>
      <div class="side-foot">
        <a class="side-btn" href="${U.esc(CEOP_CONFIG.APP_URL)}" target="_blank">${Icon.svg('phone', 16)} CEO 앱 열기</a>
        <button class="side-btn" data-accounts>${Icon.svg('user', 16)} 계정 관리</button>
        <button class="side-btn" data-billing>${Icon.svg('file', 16)} 구독 · 결제<small class="side-sub">${U.esc(Plan.summary())}</small></button>
        <a class="side-btn dim" href="privacy.html" target="_blank">개인정보 처리방침</a>
        ${Store.mode === 'demo' ? `<button class="side-btn dim" data-reset>데모 데이터 초기화</button>` : `<button class="side-btn dim" data-logout>로그아웃</button>`}
      </div>`;
    el.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { this.filter = b.dataset.filter; this.refresh(); }));
    el.querySelector('[data-reset]')?.addEventListener('click', () => { if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) Store.resetDemo(); });
    el.querySelector('[data-logout]')?.addEventListener('click', () => Store.signOut());
    el.querySelector('[data-accounts]').addEventListener('click', () => this.openAccounts());
    document.querySelector('[data-exitdemo]')?.addEventListener('click', () => Store.exitDemo());
    el.querySelector('[data-billing]').addEventListener('click', () => this.openBilling());
  },

  // ───────── 구독 (끝나면 화면 전체 안내, 얼마 안 남으면 위에 알림 줄) ─────────
  renderPlan() {
    const s = Plan.state();
    const lock = document.getElementById('planlock');
    lock.hidden = s.active;
    if (!s.active) { lock.innerHTML = Plan.lockHtml(); Plan.bindLock(lock); }
    const bar = document.getElementById('planbar');
    const soon = s.active && ((s.plan === 'trial' && s.daysLeft <= 3) || (s.plan !== 'trial' && s.daysLeft <= 5));
    bar.innerHTML = soon ? `<div class="plan-bar">${Icon.svg('bell', 18)}<span>${s.plan === 'trial' ? `무료 체험이 <b>${s.daysLeft}일</b> 남았어요.` : `이용 기간이 <b>${s.daysLeft}일</b> 남았어요 (${Plan.untilText(s.until)}까지).`} 끊기지 않게 미리 결제해 주세요.</span>
      <a class="btn sm primary" href="${U.esc(Plan.payUrl())}">결제하기</a></div>` : '';
  },

  openBilling() {
    const s = Plan.state(), P = Plan.PRICES;
    const hist = Store.payments().filter(p => p.status === 'DONE');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal accounts billing" role="dialog" aria-label="구독 · 결제">
      <div class="ed-head"><div><h3>구독 · 결제</h3><p class="muted small">매달 자동결제 · 언제든 해지 · 이용 중 늘리면 일할, 줄이면 다음 결제일부터</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="ac-body">
        <div class="bill-now r-${s.plan}"><span><small>지금 요금제</small><b>${Plan.NAMES[s.plan]}</b></span>
          <span><small>${s.plan === 'expired' ? '상태' : s.plan === 'trial' ? '무료 체험' : '다음 결제일'}</small><b>${s.until ? (s.plan === 'trial' ? `${Plan.untilText(s.until)}까지 · ${s.daysLeft}일 남음` : `${Plan.md(s.until)} · 매달 ${Plan.won(Plan.charge(s.plan, s.extraExecs).total)}`) : '결제가 필요해요'}</b></span>
          <span><small>AI 비서</small><b>${s.ai ? '사용 중' : '쓸 수 없음'}</b></span></div>
        <div class="bill-plans">
          ${['basic', 'premium'].map(k => `<div class="bill-plan${s.plan === k ? ' on' : ''}"><b>${Plan.NAMES[k]}</b><span class="pr">${Plan.won(P[k])}<small> / 월 · VAT 별도</small></span>
            <ul>${Plan.FEATURES[k].map(f => `<li>${U.esc(f)}</li>`).join('')}</ul></div>`).join('')}
        </div>
        <p class="muted small" style="margin:0">가격은 VAT 별도 (결제 시 부가세 10% 추가) · 추가 임원 1명당 월 ${Plan.won(P.perExec)} · 비서 · 기사 계정은 무료${s.extraExecs ? ` · 지금 추가 임원 ${s.extraExecs}명` : ''}</p>
        ${(() => { const c = Store.company() || {}; const np = c.nextPlan || (c.nextExtraExecs != null ? c.plan : null);
          return s.active && s.plan !== 'trial' && np ? `<p class="small" style="margin:0; background:var(--brass-soft); border-radius:10px; padding:8px 12px;">${Plan.md(s.until)}부터 ${U.esc(Plan.NAMES[np])}${(c.nextExtraExecs ?? c.extraExecs) ? ` + 임원 ${c.nextExtraExecs ?? c.extraExecs}명` : ''}(으)로 바뀌어요 (예약됨)</p>` : ''; })()}
        <div class="ac-foot"><span class="small muted">${s.active && s.plan !== 'trial' ? '늘리면 남은 날만큼 일할 결제, 줄이면 다음 결제일부터 적용돼요.' : '결제한 날부터 매달 같은 날 자동결제돼요.'}</span>
          <a class="btn primary" href="${U.esc(Plan.payUrl())}">${s.plan === 'trial' || s.plan === 'expired' ? '결제하기' : '요금제 · 임원 바꾸기'}</a></div>
        <div><b class="small">결제 내역</b>
          ${hist.length ? `<ul class="ac-list bill-hist">${hist.map(h => `<li><span class="ac-role">${h.mode === 'live' ? '결제' : h.mode === 'demo' ? '데모' : '테스트'}</span>
            <span class="ac-who"><b>${Plan.NAMES[h.plan]}${h.extraExecs ? ` + 임원 ${h.extraExecs}명` : ''} · ${Plan.won(h.amount)}</b><small>${Plan.untilText(h.approvedAt)} 결제${h.kind === 'prorate' ? ' (일할)' : ''} · ${U.esc(h.method || '')} · ${U.esc(h.orderId || '')}</small></span><span></span></li>`).join('')}</ul>`
            : '<p class="muted small" style="margin:6px 0 0">아직 결제 내역이 없어요.</p>'}</div>
      </div></div>`;
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    document.body.appendChild(back);
  },

  // ───────── 계정 관리 (기사 · 비서 아이디 만들기, 비밀번호 재설정, 삭제) ─────────
  ROLE_LABEL: { ceo: '대표', secretary: '비서', driver: '기사' },
  openAccounts() {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const paint = (msg = '') => {
      const list = Store.members();
      back.innerHTML = `<div class="modal accounts" role="dialog" aria-label="계정 관리">
        <div class="ed-head"><div><h3>계정 관리</h3><p class="muted small">우리 회사 계정 ${list.length}개 · 기사님 · 비서님 아이디를 여기서 만들어요</p></div>
          <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
        <div class="ac-body">
          <ul class="ac-list">${list.map(m => `<li>
            <span class="ac-role r-${m.role}">${this.ROLE_LABEL[m.role]}</span>
            <span class="ac-who"><b>${U.esc(m.name)}</b><small>아이디 ${U.esc(m.loginId)}${m.phone ? ' · ' + U.esc(m.phone) : ''}</small></span>
            <span class="ac-act"><button class="btn sm" data-pw="${U.esc(m.loginId)}">비밀번호 재설정</button>
              ${m.role !== 'ceo' && m.loginId !== Store.myLogin ? `<button class="btn sm quiet" data-del="${U.esc(m.loginId)}" aria-label="${U.esc(m.name)} 계정 삭제">삭제</button>` : ''}</span>
          </li>`).join('')}</ul>
          <form class="ac-add" id="acAdd">
            <b>새 계정 만들기</b>
            <div class="ac-grid">
              <label>역할<select name="role"><option value="driver">기사</option><option value="secretary">비서</option></select></label>
              <label>이름<input name="name" required autocomplete="off"></label>
              <label>아이디<input name="loginId" required autocapitalize="none" spellcheck="false" placeholder="영어·숫자 3~30자" autocomplete="off"></label>
              <label>임시 비밀번호<input name="password" required minlength="8" placeholder="8자 이상" autocomplete="off"></label>
              <label><span>휴대폰 <span class="muted">(선택)</span></span><input name="phone" type="tel" placeholder="010-0000-0000" autocomplete="off"></label>
            </div>
            <p class="small muted" style="margin:0">기사님 앱 화면은 준비 중이에요. 지금은 '기사님께 배차 알림'으로 문자를 보내 주세요.</p>
            <div class="ac-foot"><span class="small ac-msg" role="status">${msg}</span><button class="btn primary" type="submit">계정 만들기</button></div>
          </form>
        </div></div>`;
      const add = back.querySelector('#acAdd'), out = back.querySelector('.ac-msg');
      const fail = x => { out.className = 'small ac-msg bad'; out.textContent = x.message || String(x); };
      add.addEventListener('submit', async e => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(add));
        const btn = add.querySelector('[type=submit]'); btn.disabled = true;
        try {
          await Store.account('add_member', v);
          paint(`${this.ROLE_LABEL[v.role]} 계정을 만들었어요. 아이디 <b>${U.esc(v.loginId.trim().toLowerCase())}</b> · 임시 비밀번호 <b>${U.esc(v.password)}</b> 를 전해 주세요.`);
        } catch (x) { fail(x); btn.disabled = false; }
      });
      back.querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.pw;
        const pw = prompt(`${id} 의 새 임시 비밀번호 (8자 이상)`);
        if (pw == null) return;
        try { await Store.account('reset_password', { loginId: id, password: pw }); paint(`<b>${U.esc(id)}</b> 비밀번호를 바꿨어요. 새 비밀번호를 전해 주세요.`); }
        catch (x) { fail(x); }
      }));
      back.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const id = b.dataset.del;
        if (!confirm(`${id} 계정을 지울까요? 이 사람은 더 이상 로그인할 수 없어요.`)) return;
        try { await Store.account('remove_member', { loginId: id }); paint(`<b>${U.esc(id)}</b> 계정을 지웠어요.`); }
        catch (x) { fail(x); }
      }));
    };
    paint();
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    document.body.appendChild(back);
  },

  // ───────── 헤더 ─────────
  renderHead() {
    const p = Store.profile();
    const n = this.newMsgs();
    const el = document.getElementById('head');
    el.innerHTML = `
      <div><h1>대표 일정 관제</h1><p>${U.esc(p.name || '대표')}님 일정 · 담당 ${U.esc(p.secretaryName || '비서')}</p></div>
      <div class="head-actions">
        <button class="btn" data-brief>${Icon.svg('file', 16)} 브리핑 보내기</button>
        <button class="btn" data-dispatch>${Icon.svg('car', 16)} 기사님께 배차 알림</button>
        <button class="btn" data-chat>${Icon.svg('chat', 16)} 비서톡${n ? `<span class="pill-count">${n}</span>` : ''}</button>
        <button class="btn primary" data-new>${Icon.svg('plus', 16)} 새 일정 등록</button>
      </div>`;
    el.querySelector('[data-brief]').addEventListener('click', () => this.openBrief());
    el.querySelector('[data-dispatch]').addEventListener('click', () => this.openDispatch(this.view === 'day' ? this.cur : U.today()));
    el.querySelector('[data-chat]').addEventListener('click', () => this.toggleChat(true));
    el.querySelector('[data-new]').addEventListener('click', () => this.openEditor({ date: this.view === 'day' ? this.cur : U.today() }));
  },

  renderUrgent() {
    const el = document.getElementById('urgent');
    const urgent = Store.messages().filter(m => m.from === 'ceo' && m.urgent);
    if (urgent.length <= this.seenUrgent) { el.innerHTML = ''; return; }
    const m = urgent[urgent.length - 1];
    el.innerHTML = `<div class="urgent">${Icon.svg('siren', 20)}<b>대표님 긴급 요청</b><span>${U.esc(m.body)} · ${U.hm(new Date(m.at))}</span>
      <a class="btn" href="${U.telLink(Store.profile().ceoPhone)}">전화하기</a><button class="btn" data-seen>확인함</button></div>`;
    el.querySelector('[data-seen]').addEventListener('click', () => {
      this.seenUrgent = urgent.length; localStorage.setItem('CEOP_SEEN_SEC_URGENT', String(urgent.length)); this.renderUrgent();
    });
  },

  // ───────── 오늘 현황 (모든 숫자는 오늘 기준) ─────────
  renderStats() {
    const now = new Date();
    const today = Store.byDate(U.today()).filter(s => s.status !== 'cancelled');
    const mine = today.filter(s => !s.masked);
    const acked = mine.filter(s => s.ackAt).length;
    const waiting = mine.filter(s => !s.ackAt);
    const warns = this.conflictsOn(U.today());
    const plans = Backtime.planDay(today, { prepMin: Store.profile().prepMin });
    const next = plans.find(({ s, p }) => s.mode !== 'none' && !s.masked && p.leaveAt > now);
    const short = w => `${w.b.title}까지 ${w.shortMin}분 부족`;
    const stat = (label, value, sub, tone, view) => `
      <button class="stat ${tone}" ${view ? `data-goview="${view}"` : 'tabindex="-1"'}><span class="stat-label">${label}</span>
        <span class="stat-val num">${value}</span><span class="stat-sub">${sub}</span></button>`;
    const el = document.getElementById('stats');
    el.innerHTML = `<div class="panel-head"><h2>오늘 현황</h2><span class="muted small">${this.dateShort(U.today())} · ${U.hm(now)} 기준 · 모든 숫자는 오늘 기준</span></div>
      <div class="stats">
        ${stat('오늘 일정', today.length, today.length - mine.length ? `개인 일정 ${today.length - mine.length}건 포함` : '개인 일정 없음', '', 'day')}
        ${stat('대표 확인', `${acked} / ${mine.length}`, '개인 일정 제외', 'ok', '')}
        ${stat('확인 대기', waiting.length, waiting.length ? U.esc(waiting.map(s => s.title).join(' · ')) : '모두 확인됨', waiting.length ? 'warn' : '', 'review')}
        ${stat('이동 경고', warns.length, warns.length ? U.esc(short(warns[0])) : '문제 없음', warns.length ? 'signal' : '', 'day')}
        ${stat('다음 출발', next ? U.hm(next.p.leaveAt) : '—', next ? U.esc(next.s.title) : '오늘 남은 이동 없음', 'brass', '')}
      </div>`;
    el.querySelectorAll('[data-goview]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.goview; this.cur = U.today(); this.renderCal(); }));
  },

  // ───────── 캘린더 패널 ─────────
  VIEWS: [['month', '월간 캘린더'], ['week', '주간 시간표'], ['day', '당일 동선'], ['review', '확인 대기']],

  rangeLabel() {
    const d = U.at(this.cur, '00:00');
    if (this.view === 'month') return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (this.view === 'week') { const w = this.weekDays(); const a = U.at(w[0], '00:00'), b = U.at(w[6], '00:00'); return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`; }
    if (this.view === 'day') return this.dateShort(this.cur) + (this.cur === U.today() ? ' · 오늘' : '');
    return '앞으로의 일정';
  },

  move(dir) {
    if (dir === 0) this.cur = U.today();
    else if (this.view === 'month') { const d = U.at(this.cur, '00:00'); this.cur = U.ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
    else this.cur = U.addDays(this.cur, dir * (this.view === 'week' ? 7 : 1));
    this.renderCal();
  },

  renderCal() {
    const el = document.getElementById('cal');
    const pend = this.pendingAll().length;
    const body = { month: () => this.monthView(), week: () => this.weekView(), day: () => this.dayView(), review: () => this.reviewView() }[this.view]();
    el.innerHTML = `
      <div class="cal-bar">
        ${this.view === 'review' ? '' : `<div class="cal-nav"><button class="icon-btn" data-move="-1" aria-label="이전">${Icon.svg('left', 16)}</button>
          <button class="btn" data-move="0">오늘</button><button class="icon-btn" data-move="1" aria-label="다음">${Icon.svg('right', 16)}</button></div>`}
        <h2 class="num">${this.rangeLabel()}</h2>
        ${this.filter !== 'all' ? `<span class="badge">${Backtime.CATEGORIES[this.filter].label}만 보기</span>` : ''}
        <div class="tabs" role="tablist">${this.VIEWS.map(([k, l]) => `<button role="tab" aria-selected="${this.view === k}" class="${this.view === k ? 'on' : ''}" data-view="${k}">${l}${k === 'review' && pend ? `<span class="tab-count">${pend}</span>` : ''}</button>`).join('')}</div>
      </div>
      ${this.view === 'month' || this.view === 'week' ? `<p class="legend-line"><i class="dot amber"></i> 대표 확인 대기 <i class="dot private"></i> 대표 개인 일정 ('바쁨')</p>` : ''}
      <div class="cal-body">${body}</div>`;
    el.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => this.move(Number(b.dataset.move))));
    el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.view; this.renderCal(); }));
    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.openEditor({ id: b.dataset.open }); }));
    el.querySelectorAll('[data-newon]').forEach(b => b.addEventListener('click', () => this.openEditor({ date: b.dataset.newon })));
    el.querySelectorAll('[data-dayof]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.cur = b.dataset.dayof; this.view = 'day'; this.renderCal(); }));
    el.querySelectorAll('[data-seenadj]').forEach(b => b.addEventListener('click', async () => {
      const t = Store.get(b.dataset.seenadj);
      try { await Store.send(`'${t ? t.title : '일정'}' 조정 요청 확인했어요. 바로 조정할게요.`, { ref: b.dataset.seenadj }); U.toast('대표님께 확인했다고 알렸어요'); }
      catch (err) { U.toast('보내지 못했어요: ' + (err.message || err)); }
    }));
    el.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => this.shiftSchedule(b.dataset.shift, b.dataset.to)));
    el.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => this.nudge(b.dataset.nudge)));
    el.querySelectorAll('.ev.masked').forEach(b => b.addEventListener('click', e => e.stopPropagation()));
  },

  pill(s) {
    if (s.masked) return `<div class="ev masked"><span class="num">${s.start}</span>${Icon.svg('lock', 12)} 바쁨</div>`;
    return `<button class="ev cat-${s.category} ${s.ackAt ? '' : 'unacked'}" data-open="${s.id}" title="${U.esc(s.title)}${s.ackAt ? '' : ' · 대표 확인 대기'}">
      <span class="num">${s.start}</span><span class="ev-t">${U.esc(s.title)}</span>${s.ackAt ? '' : '<i class="dot amber" aria-label="대표 확인 대기"></i>'}</button>`;
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
      const warn = this.conflictsOn(ymd).length;
      html += `<div class="mc ${out ? 'out' : ''} ${ymd === U.today() ? 'today' : ''}" data-newon="${ymd}">
        <div class="mc-head"><button class="mc-num num ${dd.getDay() === 0 ? 'sun' : dd.getDay() === 6 ? 'sat' : ''}" data-dayof="${ymd}" aria-label="${this.dateShort(ymd)} 당일 동선">${dd.getDate()}</button>
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

  /** 이동 부족을 없애려면 뒤 일정을 몇 시로 미뤄야 하는지 (5분 단위 올림) */
  fixFor(w) {
    const add = Math.ceil(w.shortMin / 5) * 5;
    const to = U.hm(U.addMin(U.at(w.b.date, w.b.start), add));
    return { to, add };
  },

  /** 당일 동선 — 막대(기사 대기·이동은 빗금) + 현재 시각 선 + 이동 부족 해결 버튼 */
  dayView() {
    const list = this.day(this.cur);
    const plans = Backtime.planDay(list, { prepMin: Store.profile().prepMin });
    const warns = this.conflictsOn(this.cur);
    if (!plans.length) return `<div class="empty-big">${Icon.svg('calendar', 28)}<p>이 날은 일정이 없어요.</p><button class="btn primary" data-newon="${this.cur}">${Icon.svg('plus', 16)} 이 날 일정 등록</button></div>`;
    const now = new Date();
    const times = plans.flatMap(({ p }) => [p.wakeAt || p.driverCallAt || p.leaveAt, p.endAt]);
    if (this.cur === U.today()) times.push(now);
    const h0 = Math.max(0, Math.min(...times.map(t => t.getHours())) - 1);
    const h1 = Math.min(24, Math.max(...times.map(t => t.getHours() + (t.getMinutes() ? 1 : 0))) + 1);
    const span = (h1 - h0) * 60;
    const base = U.at(this.cur, `${U.pad(h0)}:00`);
    const pos = t => Math.max(0, Math.min(100, U.diffMin(t, base) / span * 100));
    const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    const nowLine = this.cur === U.today() ? `<i class="g-now" style="left:${pos(now)}%"><span>${U.hm(now)}</span></i>` : '';
    const scale = `<div class="g-scale">${hours.map(h => `<span style="left:${(h - h0) * 60 / span * 100}%">${h}시</span>`).join('')}</div>`;
    const rows = plans.map(({ s, p }) => {
      const go = s.mode !== 'none' && !s.masked;
      const from = p.driverCallAt || p.leaveAt;
      const late = warns.some(w => w.b.id === s.id);
      const bars = (go ? `<i class="g-move ${late ? 'late' : ''}" style="left:${pos(from)}%;width:${pos(p.startAt) - pos(from)}%" title="기사 대기·이동 ${U.hm(from)}–${U.hm(p.arriveBy)}"></i>` : '') +
        `<i class="g-main ${s.masked ? 'masked' : `cat-${s.category}`}" style="left:${pos(p.startAt)}%;width:${Math.max(.8, pos(p.endAt) - pos(p.startAt))}%"><span>${s.masked ? '바쁨' : U.esc(s.title)}</span></i>`;
      const steps = go ? p.items.filter(it => it.kind !== 'end').map(it => `<li class="k-${it.kind}"><b class="num">${U.hm(it.at)}</b>${Icon.kind(it.kind, 14)}<span>${U.esc(it.title)}</span></li>`).join('') : '';
      return `<div class="g-row">
        <div class="g-label">${s.masked ? `<span class="num">${s.start}–${s.end}</span><b class="masked-t">${Icon.svg('lock', 14)} 대표 개인 일정</b>`
          : `<span class="num">${s.start}–${s.end}</span><button class="g-title" data-open="${s.id}">${U.esc(s.title)}</button>
             <span class="muted small">${U.esc(s.location || '')}${go ? ` · ${Backtime.MODES[s.mode].label}` : ''}</span>
             ${s.ackAt ? '<span class="badge ok">확인함</span>' : '<span class="badge warn">확인 대기</span>'}`}</div>
        <div class="g-track">${bars}${nowLine}</div>
        ${steps ? `<ol class="g-steps">${steps}</ol>` : ''}</div>`;
    }).join('');
    const warnHtml = warns.map(w => {
      const fix = this.fixFor(w);
      const canFix = !w.b.masked;
      const msgs = Store.messages();
      const req = [...msgs].reverse().find(m => m.from === 'ceo' && m.ref === w.b.id && m.body.includes('조정'));
      const asked = !!req;
      const seen = req && msgs.some(m => m.from === 'secretary' && m.ref === w.b.id && String(m.at) > String(req.at));
      return `<div class="fix">${Icon.svg('alert', 20)}<div><b>${U.esc(w.msg)}</b>
        <span>${asked ? '대표님이 앱에서 조정을 요청했어요 · ' : ''}${canFix ? `'${U.esc(w.b.title)}' 시작을 ${fix.to}${this.ro(fix.to)} ${fix.add}분 미루면 해결돼요` : '대표 개인 일정과 겹쳐요'}</span></div>
        ${asked && !seen ? `<button class="btn" data-seenadj="${w.b.id}">확인했어요</button>` : ''}${canFix ? `<button class="btn signal" data-shift="${w.b.id}" data-to="${fix.to}">${U.esc(w.b.title)} ${fix.to}${this.ro(fix.to)} 미루기</button>` : ''}</div>`;
    }).join('');
    return `${warnHtml}<div class="gantt"><div class="g-row g-head"><div class="g-label"></div>${scale}</div>${rows}</div>
      <p class="legend"><i class="g-move"></i> 기사 대기 · 이동 <i class="g-main cat-external"></i> 일정 ${this.cur === U.today() ? '<i class="g-now-key"></i> 지금' : ''}</p>`;
  },

  async shiftSchedule(id, to) {
    const s = Store.get(id); if (!s) return;
    const dur = U.diffMin(U.at(s.date, s.end), U.at(s.date, s.start));
    const end = U.hm(U.addMin(U.at(s.date, to), dur));
    if (!confirm(`'${s.title}' 시작을 ${s.start} → ${to}${this.ro(to)} 미룰까요? (종료 ${end})\n대표님께 다시 확인을 요청해요.`)) return;
    try {
      await Store.upsert({ ...s, start: to, end });
      await Store.send(`'${s.title}' 시작을 ${to}${this.ro(to)} 미뤘어요. 앱에서 확인 부탁드려요.`, { ref: s.id });
      U.toast(`${to}${this.ro(to)} 미뤘어요. 대표님께 알렸어요`);
      if (s.briefing && s.briefing.who) this.openDraft(s, Drafts.change(s, { date: s.date, start: s.start }, { date: s.date, start: to }, Store.profile()));
    } catch (err) { U.toast('바꾸지 못했어요: ' + (err.message || err)); }
  },

  reviewView() {
    const items = this.pendingAll();
    const todayN = items.filter(s => s.date === U.today()).length;
    if (!items.length) return `<div class="empty-big">${Icon.svg('checkCircle', 28)}<p>대표님이 모든 일정을 확인했어요.</p></div>`;
    const warnIds = new Map();
    [...new Set(items.map(s => s.date))].forEach(d => this.conflictsOn(d).forEach(w => warnIds.set(w.b.id, w)));
    const rows = items.map(s => {
      const w = warnIds.get(s.id);
      const adjust = Store.messages().some(m => m.from === 'ceo' && m.ref === s.id && m.body.includes('조정'));
      const note = w ? `이동 시간 ${w.shortMin}분 부족${adjust ? ' · 대표님이 조정 요청함' : ''}`
        : s.nudgedAt ? `${this.ago(s.nudgedAt)} 다시 알림 · 대표님 아직 확인 안 함` : '등록됨 · 대표님 아직 확인 안 함';
      return `<li class="rv"><i class="rv-bar" style="background:${this.CAT_COLOR[s.category] || '#556274'}"></i>
        <div><b>${U.esc(s.title)} <small>· ${this.whenLabel(s)}</small></b><span class="${w ? 'warn-t' : ''}">${U.esc(note)}</span></div>
        ${w ? `<button class="btn line-signal" data-dayof="${s.date}">동선 고치기</button>` : ''}
        <button class="btn ${s.nudgedAt && U.diffMin(new Date(), new Date(s.nudgedAt)) < 10 ? 'sent' : 'primary'}" data-nudge="${s.id}">${s.nudgedAt && U.diffMin(new Date(), new Date(s.nudgedAt)) < 10 ? `${Icon.svg('check', 14)} 다시 알렸어요` : '대표님께 다시 알리기'}</button>
        <button class="btn" data-open="${s.id}">열기</button></li>`;
    }).join('');
    return `<div class="rv-head"><b>대표님 확인을 기다리는 일정 ${items.length}건</b><span>오늘 ${todayN} · 앞으로 ${items.length - todayN} · 대표님이 앱에서 '확인'을 누르면 사라져요</span></div>
      <ul class="review">${rows}</ul><p class="rv-foot">'다시 알리기'는 대표님 비서톡에 일정 링크와 함께 가요</p>`;
  },

  async nudge(id) {
    const s = Store.get(id); if (!s) return;
    try {
      await Store.send(`'${s.title}' (${this.whenLabel(s)}) 일정 확인 부탁드려요.`, { ref: s.id });
      await Store.patch(s.id, { nudgedAt: new Date().toISOString() });
      U.toast('대표님께 다시 알렸어요');
    } catch (err) { U.toast('보내지 못했어요: ' + (err.message || err)); }
  },

  // ───────── 기사님께 배차 알림 ─────────
  openDispatch(ymd) {
    const p = Store.profile();
    const plans = Backtime.planDay(Store.byDate(ymd).filter(s => s.status !== 'cancelled' && !s.masked), { prepMin: p.prepMin })
      .filter(({ s }) => s.mode === 'driver' || (s.trip && s.trip.accessMode === 'driver'));
    const lines = plans.map(({ s, p: pl }) => `${U.hm(pl.driverCallAt || pl.leaveAt)} 대기 → ${U.hm(pl.leaveAt)} 출발 · ${s.trip ? (s.trip.station || '역') : (s.location || '')} (${s.start} ${s.title})`);
    const link = CEOP_CONFIG.DRIVER_URL ? `\n배차표 · 대기/출발/도착 알리기: ${new URL(CEOP_CONFIG.DRIVER_URL, location.href).href}` : '';
    const text = lines.length ? `[${this.dateShort(ymd)} 배차]\n${lines.join('\n')}${link}\n- ${p.secretaryName || '비서'}` : '';
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal dispatch" role="dialog" aria-label="기사님께 배차 알림">
      <div class="ed-head"><div><h3>기사님께 배차 알림</h3><p class="muted small">${U.esc(p.driverName || '기사님')} · ${this.dateShort(ymd)} · 기사 차량 일정 ${plans.length}건</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dp-body">${lines.length ? `<ol class="dp-list">${plans.map(({ s, p: pl }) => `<li><b class="num">${U.hm(pl.driverCallAt || pl.leaveAt)}</b><span>대기 · ${U.hm(pl.leaveAt)} 출발<small>${U.esc(s.trip ? (s.trip.station || '역') : (s.location || ''))} · ${s.start} ${U.esc(s.title)}</small></span></li>`).join('')}</ol>
        <label class="dp-text">보낼 문자<textarea id="dpText" rows="${lines.length + 3}">${U.esc(text)}</textarea></label>`
        : '<p class="muted">이 날은 기사 차량 일정이 없어요.</p>'}</div>
      <div class="ed-foot"><span style="flex:1" class="muted small">문자 속 링크로 기사님이 대기 · 출발 · 도착을 알려 줘요</span>
        <button class="btn" data-close>닫기</button>${lines.length ? `<button class="btn" data-copy>복사</button><a class="btn primary" id="dpSms" href="#">${Icon.svg('sms', 16)} 문자 보내기</a>` : ''}</div></div>`;
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    document.body.appendChild(back);
    const sms = back.querySelector('#dpSms');
    if (sms) {
      const upd = () => { sms.href = `sms:${String(p.driverPhone || '').replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(back.querySelector('#dpText').value)}`; };
      upd(); back.querySelector('#dpText').addEventListener('input', upd);
      back.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(back.querySelector('#dpText').value); U.toast('복사했어요'); } catch { U.toast('복사하지 못했어요. 직접 선택해 복사해 주세요'); } });
    }
  },

  // ───────── 일정 등록·수정 모달 ─────────
  openEditor(target) {
    const s = target.id ? Store.get(target.id) : this.blank(target.date);
    if (!s || s.masked) return;
    this.edit = target; this.dirty = false;
    const b = s.briefing || {}, t = s.trip || {};
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`).join('');
    const cats = Object.entries(Backtime.CATEGORIES).filter(([k]) => k !== 'personal');
    const hasBrief = Object.values(b).some(Boolean);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal editor" role="dialog" aria-label="일정 등록">
      <div class="ed-head"><div><h3>${target.id ? '일정 수정' : '새 일정 등록'}</h3>
        <p class="muted small">${target.id ? (s.ackAt ? '대표님이 확인한 일정이에요. 고치면 다시 확인을 받아요.' : '대표님이 아직 확인하지 않았어요.') : '등록하면 대표님 앱에 바로 표시돼요.'}</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="ed-body">
      <form id="ef" class="ed-form">
        <label class="full">일정 이름<input name="title" required value="${U.esc(s.title || '')}" placeholder="예: 한빛전자 협력 미팅"></label>
        <div class="full field"><span class="lbl">분류</span><div class="chips" role="radiogroup">${cats.map(([k, c]) => `<label class="chip"><input type="radio" name="category" value="${k}" ${k === s.category ? 'checked' : ''}><span><i style="background:${this.CAT_COLOR[k]}"></i>${c.label}</span></label>`).join('')}</div></div>
        <label>날짜<input name="date" type="date" required value="${s.date}"></label>
        <label><span id="startLbl">시작</span><input name="start" type="time" required value="${s.start}"></label>
        <label>종료<input name="end" type="time" required value="${s.end}"></label>
        <p class="full when" id="whenTxt"></p>
        ${target.id ? (s.series ? `<label class="full check"><input type="checkbox" name="applySeries"> 이후 반복 일정 ${Store.list().filter(x => x.series === s.series && x.date > s.date && x.status !== 'cancelled').length}건에도 시간 · 장소 · 브리핑을 똑같이 바꾸기</label>` : '')
          : `<div class="full rep-row"><label>반복<select name="repeat"><option value="">안 함</option><option value="weekly">매주</option><option value="weekdays">평일 매일</option><option value="biweekly">격주</option><option value="monthly">매월 같은 날</option></select></label>
             <label>횟수<select name="repeatN">${[4, 8, 12, 26].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n}번</option>`).join('')}</select></label><p class="rep-txt" id="repTxt"></p></div>`}
        <label class="full">장소<input name="location" value="${U.esc(s.location || '')}" placeholder="예: 한빛전자 삼성동 사옥"></label>
        <div class="full place-rec" id="placeRec"></div>
        <fieldset class="full move" id="moveBox"><legend>이동</legend>
          <label>출발지<input name="origin" value="${U.esc(s.origin || '')}" placeholder="앞 일정 장소 또는 본사" list="originList"></label>
          <label>이동수단<select name="mode">${opt(Backtime.MODES, s.mode)}</select></label>
          <label class="mv"><span id="travelLbl">이동 시간 (분)</span><input name="travelMin" type="number" min="0" max="600" value="${Number(s.travelMin || 0)}"></label>
          <label class="mv">여유 (분)<input name="bufferMin" type="number" min="0" max="120" value="${Number(s.bufferMin ?? 10)}"></label>
          <p class="hint">이동 시간은 지금은 직접 넣어요. 같은 길을 3번 넘게 다녀오면, 실제로 걸린 시간을 배워서 여기 알려 드려요.</p>
          <p class="learn-hint" id="learnHint"></p>
        </fieldset>
        <datalist id="originList"></datalist>
        <fieldset class="full" id="tripBox"><legend>기차 · 비행기</legend>
          <label>역 · 공항<input name="station" value="${U.esc(t.station || '')}" placeholder="예: 서울역"></label>
          <label>출발 시각<input name="departTime" type="time" value="${t.departTime || ''}"></label>
          <label>도착 시각<input name="arriveTime" type="time" value="${t.arriveTime || ''}"></label>
          <label>역까지 (분)<input name="accessMin" type="number" min="0" max="300" value="${Number(t.accessMin || 0)}"></label>
          <label>역까지 수단<select name="accessMode">${opt({ driver: Backtime.MODES.driver, taxi: Backtime.MODES.taxi, car: Backtime.MODES.car }, t.accessMode || 'driver')}</select></label>
          <label>국제선<select name="intl"><option value="">아니오</option><option value="1" ${t.intl ? 'selected' : ''}>예</option></select></label>
        </fieldset>
        <details class="full brief" ${hasBrief ? 'open' : ''}><summary>미팅 브리핑 (선택) · 대표님 앱에 일정 직전 표시</summary>
          <div class="brief-grid">
          <label><span id="whoLbl">만날 분</span><input name="who" value="${U.esc(b.who || '')}" placeholder="예: 정민호 부사장"></label>
          <label>회사 · 직함<input name="company" value="${U.esc(b.company || '')}"></label>
          <label class="span2">목적<input name="purpose" value="${U.esc(b.purpose || '')}"></label>
          <label>지난 미팅<textarea name="last">${U.esc(b.last || '')}</textarea></label>
          <label>메모<textarea name="notes">${U.esc(b.notes || '')}</textarea></label>
          <label>준비물<input name="bring" value="${U.esc(b.bring || '')}"></label>
          <label>상대 연락처 <span class="muted">(문자 초안용)</span><input name="phone" type="tel" value="${U.esc(b.phone || '')}" placeholder="010-0000-0000"></label>
          </div>
        </details>
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
    // 출발지 후보: 그날 앞 일정 장소 + 자주 쓰는 곳
    const places = [...new Set([...Store.list().filter(x => !x.masked && x.location).map(x => x.location), '본사', '자택'])];
    back.querySelector('#originList').innerHTML = places.map(pl => `<option value="${U.esc(pl)}">`).join('');
    // 출발지를 직접 고치지 않았으면, 날짜·시작 시각이 바뀔 때 '그 전 일정 장소'로 다시 채움
    let originTouched = !!(this.edit && this.edit.id);
    f.elements.origin && f.elements.origin.addEventListener('input', () => { originTouched = true; });
    const reOrigin = e => { if (!originTouched && f.elements.origin && ['date', 'start'].includes(e.target.name)) f.elements.origin.value = this.originFor(f.elements.date.value, f.elements.start.value, this.edit && this.edit.id); };
    f.addEventListener('change', reOrigin);
    f.addEventListener('input', () => { this.dirty = true; this.syncForm(f, back); });
    f.addEventListener('change', () => this.syncForm(f, back));
    f.addEventListener('submit', async e => { e.preventDefault(); if (await this.save(f)) { this.dirty = false; this.edit = null; back.remove(); } });
    // 배운 이동 시간 적용 · 추천 장소 고르기
    back.addEventListener('click', e => {
      const ap = e.target.closest('[data-applymin]');
      if (ap) { f.elements.travelMin.value = ap.dataset.applymin; this.dirty = true; this.syncForm(f, back); }
      const pl = e.target.closest('[data-pickplace]');
      if (pl) { f.elements.location.value = pl.dataset.pickplace; this.dirty = true; this.syncForm(f, back); }
    });
    back.querySelector('[data-del]')?.addEventListener('click', () => this.deleteFlow(target.id, () => { this.dirty = false; this.edit = null; back.remove(); }));
    document.body.appendChild(back);
    this.syncForm(f, back);
    f.title.focus();
  },

  /** 출발지 기본값 — 이 일정 시작 전에 끝나는 마지막 일정 장소, 없으면 본사 */
  originFor(d, start, exceptId) {
    const prev = Store.byDate(d).filter(x => !x.masked && x.location && x.status !== 'cancelled' && x.id !== exceptId && (x.end || x.start) <= start && x.start <= start).pop();
    return prev ? prev.location : '본사';
  },

  /** 새 일정 기본값 */
  blank(date) {
    const d = date || U.today();
    return { title: '', category: 'external', date: d, start: '10:00', end: '11:00', location: '', origin: this.originFor(d, '10:00'), mode: 'driver', travelMin: 30, bufferMin: 10, briefing: {}, trip: null, visibility: 'normal' };
  },

  fromForm(f) {
    const v = n => (f.elements[n] && f.elements[n].value) || '';
    const mode = v('mode');
    const id = this.edit && this.edit.id;
    const s = {
      ...(id ? Store.get(id) : {}),
      title: v('title').trim(), category: v('category') || 'external', date: v('date'), start: v('start'), end: v('end'),
      location: v('location').trim(), origin: v('origin').trim(), mode, travelMin: Number(v('travelMin')) || 0, bufferMin: Number(v('bufferMin')) || 0,
      visibility: 'normal', status: (id && Store.get(id) && Store.get(id).status) || 'scheduled',
      briefing: { who: v('who').trim(), company: v('company').trim(), purpose: v('purpose').trim(), last: v('last').trim(), notes: v('notes').trim(), bring: v('bring').trim(), phone: v('phone').trim() },
      trip: Backtime.isTrip(mode) ? { station: v('station').trim(), departTime: v('departTime'), arriveTime: v('arriveTime'), accessMin: Number(v('accessMin')) || 0, accessMode: v('accessMode'), intl: !!v('intl') } : null,
    };
    if (id) s.id = id;
    return s;
  },

  syncForm(f, back) {
    const mode = f.elements.mode.value;
    const s = this.fromForm(f);
    back.querySelector('#tripBox').style.display = Backtime.isTrip(mode) ? '' : 'none';
    back.querySelectorAll('.mv').forEach(el => { el.style.display = mode === 'none' ? 'none' : ''; });
    back.querySelector('#travelLbl').textContent = Backtime.isTrip(mode) ? '도착역 → 현장 (분)' : '이동 시간 (분)';
    back.querySelector('#startLbl').textContent = s.category === 'golf' ? '티오프' : '시작';
    back.querySelector('#whoLbl').textContent = s.category === 'golf' ? '동반자' : '만날 분';
    back.querySelector('#whenTxt').textContent = s.date && s.start ? `${this.dateShort(s.date)} · ${this.ampm(s.start)} – ${this.ampm(s.end)}` : '';
    this.syncHelpers(f, back, s);
    if (!s.title) s.title = '새 일정';
    const box = back.querySelector('#preview');
    if (!s.date || !s.start) { box.innerHTML = ''; return; }
    const others = Store.byDate(s.date).filter(x => x.id !== s.id && x.status !== 'cancelled');
    const day = Backtime.planDay([...others, s], { prepMin: Store.profile().prepMin });
    const mine = day.find(d => d.s === s);
    const all = [...Store.list().filter(x => x.id !== s.id), s];
    const warns = [...Backtime.conflictsOn(all, s.date), ...Backtime.conflictsOn(all, U.addDays(s.date, 1))].filter(w => w.a === s || w.b === s);
    if (mine.p.warn) warns.unshift({ msg: mine.p.warn });
    const go = s.mode !== 'none';
    const overnight = s.end && s.end < s.start ? `<p class="pv-status">${Icon.svg('clock', 15)} 다음 날 ${s.end}에 끝나는 일정으로 저장돼요</p>` : '';
    const status = overnight + (warns.length ? warns.map(w => `<p class="pv-status bad">${Icon.svg('alert', 15)} ${U.esc(w.msg)}</p>`).join('')
      : `<p class="pv-status ok">${Icon.svg('checkCircle', 15)} 같은 날 앞뒤 일정과 겹치지 않아요${s.mode === 'driver' ? ` · ${U.esc(Store.profile().driverName || '기사님')} 배차 가능` : ''}</p>`);
    box.innerHTML = `<span class="pv-cap">대표님 앱에 이렇게 보여요</span>
      ${go ? `<span class="pv-cap">출발</span><b class="pv-big num">${U.hm(mine.p.leaveAt)}</b>` : `<span class="pv-cap">시작</span><b class="pv-big num">${s.start}</b>`}
      <ol class="pv">${mine.p.items.filter(it => it.kind !== 'end').map(it => `<li class="k-${it.kind}"><b class="num">${U.hm(it.at)}</b><span>${U.esc(it.title)}<small>${U.esc(it.detail || '')}</small></span></li>`).join('')}</ol>
      ${status}`;
  },

  async save(f) {
    const s = this.fromForm(f);
    if (!s.title) { U.toast('일정 이름을 입력하세요'); return false; }
    if (s.end < s.start && !confirm(`끝나는 시간(${s.end})이 시작(${s.start})보다 빨라요.\n다음 날 ${s.end}에 끝나는 일정으로 저장할까요?`)) return false;
    const before = s.id ? Store.get(s.id) : null;
    const rep = f.elements.repeat && f.elements.repeat.value;
    try {
      if (!s.id && rep) {
        // 반복 등록: 같은 내용으로 날짜만 바꿔 여러 건 (묶음 id 로 나중에 함께 바꾸거나 지움)
        const dates = Learn.repeatDates(s.date, rep, f.elements.repeatN.value);
        const series = U.uid();
        await Store.upsertMany(dates.map(d => ({ ...s, id: U.uid(), date: d, series })));
        U.toast(`반복 일정 ${dates.length}건을 등록했어요. 대표님 앱에 표시돼요`);
        return true;
      }
      const later = s.series && f.elements.applySeries && f.elements.applySeries.checked
        ? Store.list().filter(x => x.series === s.series && x.date > s.date && x.status !== 'cancelled') : [];
      const same = ({ id, date, ackAt, nudgedAt, actual, createdBy, status, ...rest }) => rest;   // 날짜 · 확인 · 실제 기록은 그대로
      await Store.upsertMany([s, ...later.map(x => ({ ...x, ...same(s) }))]);
      U.toast(this.edit.id ? `저장했어요${later.length ? ` (이후 반복 ${later.length}건 함께)` : ''}. 대표님께 다시 확인을 요청했어요` : '등록했어요. 대표님 앱에 표시돼요');
      // 시간 · 날짜가 바뀌었으면 상대방에게 보낼 문자 초안
      if (before && (before.start !== s.start || before.date !== s.date) && s.briefing && s.briefing.who) {
        setTimeout(() => this.openDraft(s, Drafts.change(s, { date: before.date, start: before.start }, { date: s.date, start: s.start }, Store.profile())), 50);
      }
      return true;
    } catch (err) { U.toast('저장하지 못했어요: ' + (err.message || err)); return false; }
  },

  /** 등록 창 도우미: 배운 이동 시간 · 식사 장소 추천 · 반복 안내 */
  syncHelpers(f, back, s) {
    const hint = back.querySelector('#learnHint');
    if (hint) {
      const t = s.mode !== 'none' && !Backtime.isTrip(s.mode) && s.location ? Learn.travel(Store.list().filter(x => x.id !== s.id), Store.messages(), { origin: s.origin, location: s.location }) : null;
      const html = t ? `${Icon.svg('clock', 14)} <span>지난 ${t.n}번 실제로 <b>평균 ${t.avg}분</b> 걸렸어요 <small>(${t.mins.join(' · ')}분${t.sameOrigin ? ` · ${U.esc(s.origin)}에서` : ''})</small></span>${Number(s.travelMin) !== t.avg ? ` <button type="button" class="btn sm" data-applymin="${t.avg}">${t.avg}분으로</button>` : ''}` : '';
      if (hint._html !== html) { hint.innerHTML = html; hint._html = html; }   // 같은 내용이면 다시 그리지 않음 (누르는 중인 버튼이 사라지지 않게)
      hint.hidden = !t;
    }
    const rec = back.querySelector('#placeRec');
    if (rec) {
      let html = '';
      const list = Store.list().filter(x => x.id !== s.id);
      const note = s.location ? Learn.placeNote(list, s.location) : null;
      if (note && note.lastRating === 'bad') html += `<p class="rec-warn">${Icon.svg('alert', 14)} 지난번(${note.last.slice(5).replace('-', '/')}) 대표님 평가: <b>별로</b>였어요</p>`;
      else if (note && note.lastRating) html += `<p class="rec-ok">${Icon.svg('checkCircle', 14)} 대표님 지난 평가: ${Learn.RATING[note.lastRating]} (${note.n}번 가 봄)</p>`;
      if (s.category === 'dinner') {
        const picks = Learn.places(list, s.briefing || {}).filter(p => Learn.key(p.name) !== Learn.key(s.location));
        if (picks.length) html += `<div class="rec-chips"><span class="lbl">대표님이 좋았다고 한 곳</span>${picks.map(p => `<button type="button" class="rec-chip" data-pickplace="${U.esc(p.name)}"><b>${U.esc(p.name)}</b><small>${p.withThem ? `${U.esc((p.withThem.who || p.withThem.company).split(' ')[0])}님과 ${p.withThem.date.slice(5).replace('-', '/')} · ` : ''}좋았어요 ${p.good}번</small></button>`).join('')}</div>`;
      }
      if (rec._html !== html) { rec.innerHTML = html; rec._html = html; }
      rec.hidden = !html;
    }
    const rt = back.querySelector('#repTxt');
    if (rt) {
      const rep = f.elements.repeat.value;
      const dates = rep && s.date ? Learn.repeatDates(s.date, rep, f.elements.repeatN.value) : [];
      rt.textContent = dates.length ? `${this.dateShort(dates[0])}부터 ${this.dateShort(dates[dates.length - 1])}까지 ${dates.length}건` : '';
      f.elements.repeatN.disabled = !rep;
    }
  },

  /** 삭제: 반복 일정이면 '이 일정만 / 이후 모두' 고르기, 만날 분이 있으면 취소 문자 초안 */
  deleteFlow(id, done) {
    const s = Store.get(id); if (!s) return;
    const later = s.series ? Store.list().filter(x => x.series === s.series && x.date > s.date && x.status !== 'cancelled') : [];
    const finish = async ids => {
      try {
        await Store.removeMany(ids); done && done();
        U.toast(ids.length > 1 ? `일정 ${ids.length}건을 삭제했어요` : '일정을 삭제했어요');
        if (s.briefing && s.briefing.who && U.at(s.date, s.start) > new Date()) setTimeout(() => this.openDraft(s, Drafts.cancel(s, Store.profile())), 50);
      } catch (err) { U.toast('삭제하지 못했어요: ' + (err.message || err)); }
    };
    if (!later.length) { if (confirm('이 일정을 삭제할까요? 대표님 앱에서도 사라져요.')) finish([id]); return; }
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal choice" role="dialog" aria-label="반복 일정 삭제"><h3>반복 일정이에요</h3>
      <p class="muted">'${U.esc(s.title)}' ${this.dateShort(s.date)} 일정을 지워요. 이후 반복 일정 ${later.length}건도 함께 지울까요?</p>
      <div class="choice-acts"><button class="btn" data-one>이 일정만 삭제</button><button class="btn signal" data-all>이후 반복 ${later.length}건까지 모두 삭제</button><button class="btn quiet" data-close>취소</button></div></div>`;
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    back.querySelector('[data-one]').addEventListener('click', () => { back.remove(); finish([id]); });
    back.querySelector('[data-all]').addEventListener('click', () => { back.remove(); finish([id, ...later.map(x => x.id)]); });
    document.body.appendChild(back);
  },

  /** 상대방에게 보낼 문자 초안 (비서가 고쳐서 보냄) */
  openDraft(s, text) {
    const b = s.briefing || {};
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal dispatch" role="dialog" aria-label="상대방 문자 초안">
      <div class="ed-head"><div><h3>${U.esc(b.who || '상대방')}님께 보낼 문자</h3><p class="muted small">'${U.esc(s.title)}' · 고쳐서 보내셔도 돼요</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dp-body"><label class="dp-text">받는 분 연락처<input id="drPhone" type="tel" value="${U.esc(b.phone || '')}" placeholder="비워 두면 문자 앱에서 고르기"></label>
        <label class="dp-text">보낼 문자<textarea id="drText" rows="6">${U.esc(text)}</textarea></label></div>
      <div class="ed-foot"><span style="flex:1"></span><button class="btn" data-close>닫기</button><button class="btn" data-copy>복사</button><a class="btn primary" id="drSms" href="#">${Icon.svg('sms', 16)} 문자 보내기</a></div></div>`;
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    document.body.appendChild(back);
    const sms = back.querySelector('#drSms'), ta = back.querySelector('#drText'), ph = back.querySelector('#drPhone');
    const upd = () => { sms.href = `sms:${ph.value.replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(ta.value)}`; };
    upd(); ta.addEventListener('input', upd); ph.addEventListener('input', upd);
    back.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(ta.value); U.toast('복사했어요'); } catch { U.toast('복사하지 못했어요. 직접 선택해 복사해 주세요'); } });
  },

  /** 대표님 메시지(시간 변경 · 취소)에서 상대방 문자 초안 만들기 */
  draftFromMsg(m) {
    if (m.from !== 'ceo' || !m.ref) return null;
    const s = Store.get(m.ref);
    if (!s || s.masked || !s.briefing || !s.briefing.who) return null;
    const ch = m.body.match(/(\d{1,2}:\d{2})\s*→\s*(\d{1,2}:\d{2})/);
    if (ch && /바꿨어요/.test(m.body)) return { s, text: Drafts.change(s, { date: s.date, start: ch[1] }, { date: s.date, start: ch[2] }, Store.profile()) };
    if (/취소했어요/.test(m.body)) return { s, text: Drafts.cancel(s, Store.profile()) };
    return null;
  },

  /** 대표님께 보낼 하루 브리핑 */
  briefText(ymd) {
    const p = Store.profile();
    const day = Backtime.planDay(Store.byDate(ymd).filter(s => s.status !== 'cancelled'), { prepMin: p.prepMin });
    if (!day.length) return '';
    const first = day.find(({ s }) => s.mode && s.mode !== 'none');
    const pending = day.filter(({ s }) => !s.masked && !s.ackAt).length;
    const lines = day.map(({ s, p: pl }) => s.masked ? `· ${s.start} 개인 일정` : `· ${s.start} ${s.title}${s.location ? ` — ${s.location}` : ''}${s.mode !== 'none' ? ` (${U.hm(pl.leaveAt)} 출발)` : ''}${s.briefing && s.briefing.who ? ` · ${s.briefing.who}` : ''}`);
    const head = first ? `첫 출발 ${U.hm(first.p.leaveAt)}${first.p.wakeAt ? ` · 기상 ${U.hm(first.p.wakeAt)}` : ''}${first.p.driverCallAt ? ` · ${p.driverName || '기사'}님 ${U.hm(first.p.driverCallAt)} 대기` : ''}` : '나가실 일정은 없어요';
    const warns = this.conflictsOn(ymd);
    return `[${this.dateShort(ymd)} 브리핑]\n${head}\n${lines.join('\n')}` +
      (warns.length ? `\n주의: ${warns.map(w => w.msg).join(' / ')}` : '') +
      (pending ? `\n확인 대기 ${pending}건 — 앱에서 '모두 확인'을 눌러 주세요.` : '');
  },

  openBrief(ymd) {
    ymd = ymd || U.addDays(U.today(), 1);
    const sent = [...Store.messages()].reverse().find(m => m.from === 'secretary' && m.ref === 'brief:' + ymd);
    const back = document.createElement('div');
    back.className = 'modal-back';
    const text = this.briefText(ymd);
    back.innerHTML = `<div class="modal dispatch" role="dialog" aria-label="브리핑 보내기">
      <div class="ed-head"><div><h3>대표님께 브리핑 보내기</h3><p class="muted small">${sent ? `${this.dateShort(ymd)} 브리핑은 ${U.hm(new Date(sent.at))}에 이미 보냈어요 · 다시 보낼 수 있어요` : '대표님 앱 홈에 브리핑과 \'모두 확인\' 버튼이 떠요'}</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dp-body"><label class="dp-text">날짜<input type="date" id="brDate" value="${ymd}"></label>
        ${text ? `<label class="dp-text">보낼 내용<textarea id="brText" rows="${text.split('\n').length + 2}">${U.esc(text)}</textarea></label>` : '<p class="muted">이 날은 일정이 없어요.</p>'}</div>
      <div class="ed-foot"><span style="flex:1"></span><button class="btn" data-close>닫기</button>${text ? `<button class="btn primary" data-send>${Icon.svg('send', 16)} 대표님께 보내기</button>` : ''}</div></div>`;
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
    document.body.appendChild(back);
    back.querySelector('#brDate').addEventListener('change', e => { back.remove(); this.openBrief(e.target.value); });
    back.querySelector('[data-send]')?.addEventListener('click', async () => {
      try { await Store.send(back.querySelector('#brText').value.trim(), { ref: 'brief:' + ymd }); back.remove(); U.toast('브리핑을 보냈어요. 대표님 앱 홈에 표시돼요'); }
      catch (err) { U.toast('보내지 못했어요: ' + (err.message || err)); }
    });
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
      <div class="dr-msgs" id="drMsgs">${msgs.map(m => `<div class="m ${m.from === 'secretary' ? 'me' : 'them'} ${m.urgent ? 'urgent' : ''}">${m.urgent ? '<b>긴급</b> ' : ''}${U.esc(m.body)}${m.ref && m.from === 'ceo' && Store.get(m.ref) && !Store.get(m.ref).masked ? `<br><button class="ref" data-ref="${U.esc(m.ref)}">${Icon.svg('calendar', 13)} 일정 열기</button>` : ''}${this.draftFromMsg(m) ? `<br><button class="ref" data-draftmsg="${U.esc(m.id)}">${Icon.svg('sms', 13)} 상대방 문자 초안</button>` : ''}<small class="num">${m.from === 'ceo' ? '대표' : m.from === 'driver' ? U.esc(Store.profile().driverName || '기사') + '님' : '나'} · ${U.hm(new Date(m.at))}</small></div>`).join('') || '<p class="muted small">대표님 요청이 여기에 표시돼요.</p>'}</div>
      <form class="dr-send" id="drSend"><input name="body" placeholder="대표님께 보낼 메시지" autocomplete="off"><button class="btn primary" aria-label="보내기">${Icon.svg('send', 16)}</button></form>`;
    const box = d.querySelector('#drMsgs'); box.scrollTop = box.scrollHeight;
    const form = d.querySelector('#drSend');
    form.body.value = keep;
    d.querySelector('[data-x]').addEventListener('click', () => this.toggleChat(false));
    d.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => this.openEditor({ id: b.dataset.ref })));
    d.querySelectorAll('[data-draftmsg]').forEach(b => b.addEventListener('click', () => { const m = msgs.find(x => x.id === b.dataset.draftmsg); const r = m && this.draftFromMsg(m); if (r) this.openDraft(r.s, r.text); }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = form.body.value.trim(); if (!v) return;
      try { form.body.value = ''; await Store.send(v); } catch (err) { U.toast('보내지 못했어요: ' + (err.message || err)); }
    });
    this.renderHead();
  },
};

Sec.start();
