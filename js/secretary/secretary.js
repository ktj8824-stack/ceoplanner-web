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
    catch (e) { root.innerHTML = U.failBox(e); return; }
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
          <div id="alerts"></div>
          <section class="panel" id="stats"></section>
          <section class="panel cal" id="cal"></section>
        </main>
      </div>
      <aside class="drawer" id="drawer" aria-hidden="true"></aside>
      <div class="plan-lock-back" id="planlock" hidden></div>`;
    Store.on(() => this.refresh());
    setInterval(() => { this.renderStats(); this.renderAlerts(); if (this.view === 'day') this.renderCal(); }, 60000);
    this.refresh();
  },

  refresh() {
    this.renderPlan();
    this.renderSide();
    this.renderHead();
    this.renderUrgent();
    this.renderAlerts();
    this.renderStats();
    this.renderCal();
    if (this.chatOpen) this.renderDrawer();
  },

  // ───────── 데이터 도우미 ─────────
  visible(list) { return this.filter === 'all' ? list : list.filter(s => s.masked || s.category === this.filter); },
  day(ymd) { return this.visible(Store.byDate(ymd)).filter(s => s.status !== 'cancelled'); },
  newMsgs() { return Store.messages().slice(this.seenMsgs).filter(m => m.from === 'ceo').length; },
  pendingAll() { return Store.list().filter(s => !s.masked && !s.ackAt && s.status !== 'cancelled' && s.date >= U.today()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)); },
  conflictsOn(ymd) { return Backtime.conflictsOn(Store.list(), ymd).filter(w => !(w.a.masked && w.b.masked)); },   // 대표 개인 일정끼리는 비서가 고칠 일이 아님
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
    const upcoming = Store.list().filter(s => !s.masked && s.status !== 'cancelled' && s.date >= U.today() && s.date <= U.addDays(U.today(), 30));
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
        <button class="side-btn" data-billing>${Icon.svg('file', 16)} ${Plan.isFree() ? '이용 안내' : '구독 · 결제'}<small class="side-sub">${U.esc(Plan.summary())}</small></button>
        <a class="side-btn dim" href="privacy.html" target="_blank">개인정보 처리방침</a>
        ${Store.mode === 'demo' ? `<button class="side-btn dim" data-reset>데모 데이터 초기화</button>` : `<button class="side-btn dim" data-logout>로그아웃</button>`}
        <button class="side-btn dim" data-withdraw>회원 탈퇴</button>
      </div>`;
    el.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { this.filter = b.dataset.filter; this.refresh(); }));
    el.querySelector('[data-reset]')?.addEventListener('click', () => { if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) Store.resetDemo(); });
    el.querySelector('[data-logout]')?.addEventListener('click', () => Store.signOut());
    el.querySelector('[data-withdraw]')?.addEventListener('click', () => U.withdraw());
    el.querySelector('[data-accounts]').addEventListener('click', () => this.openAccounts());
    document.querySelector('[data-exitdemo]')?.addEventListener('click', () => Store.exitDemo());
    el.querySelector('[data-billing]').addEventListener('click', () => this.openBilling());
  },

  /** 무료 기간 안내 (결제가 닫혀 있을 때 '구독 · 결제' 대신) */
  openFreeInfo() {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal free-info" role="dialog" aria-label="이용 안내" style="max-width:460px;width:100%">
      <div class="ed-head"><div><h3>이용 안내</h3><p class="muted small">${U.esc(Plan.FREE_TEXT)}</p></div><button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="ed-body" style="display:block"><p style="margin:0 0 10px"><b>${U.esc(Plan.FREE_TEXT)}</b>로 모든 기능을 쓸 수 있어요.</p>
        <ul style="margin:0 0 12px;padding-left:18px;line-height:1.7"><li>비서 웹 · 대표 앱 · 기사님 계정</li><li>AI 비서 — 말로 일정 등록 · 변경 · 미루기</li><li>역산 알림 · 동선 확인 · 비서톡 · 손님 초대장</li></ul>
        <p class="muted small" style="margin:0">무료 기간이 끝나기 전에 요금과 결제 방법을 미리 알려 드려요. 그때까지 결제 정보는 받지 않아요.</p></div>
      <div class="ed-foot"><button class="btn primary" data-close>확인</button></div></div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
  },

  // ───────── 구독 (끝나면 화면 전체 안내, 얼마 안 남으면 위에 알림 줄) ─────────
  renderPlan() {
    const s = Plan.state();
    const lock = document.getElementById('planlock');
    lock.hidden = s.active;
    if (!s.active) { lock.innerHTML = Plan.lockHtml(); Plan.bindLock(lock); }
    const bar = document.getElementById('planbar');
    const soon = s.active && s.plan !== 'free' && ((s.plan === 'trial' && s.daysLeft <= 3) || (s.plan !== 'trial' && s.daysLeft <= 5));
    bar.innerHTML = soon ? `<div class="plan-bar">${Icon.svg('bell', 18)}<span>${s.plan === 'trial' ? `무료 체험이 <b>${s.daysLeft}일</b> 남았어요.` : `이용 기간이 <b>${s.daysLeft}일</b> 남았어요 (${Plan.untilText(s.until)}까지).`} 끊기지 않게 미리 결제해 주세요.</span>
      <a class="btn sm primary" href="${U.esc(Plan.payUrl())}">결제하기</a></div>` : '';
  },

  openBilling() {
    if (Plan.isFree()) return this.openFreeInfo();
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
            <p class="small muted" style="margin:0">기사님은 배차 알림 문자 속 링크(배차표)에서 대기 · 출발 · 도착을 눌러 알려 줘요.</p>
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

  /** 먼저 알려 주는 띠: ① 이동 중 늦을 것 같은 일정 (출발 기록 + 도착 예상)  ② 저녁 6시 이후 내일 브리핑 안 보냈을 때 */
  renderAlerts() {
    const el = document.getElementById('alerts'); if (!el) return;
    const now = new Date(), msgs = Store.messages(), all = Store.list();
    const rows = [];
    const draftBtn = (s, min) => s.briefing && s.briefing.who ? `<button class="btn" data-latedraft="${s.id}" data-min="${min}">${Icon.svg('sms', 15)} ${U.esc(s.briefing.who.split(' ')[0])}님께 문자 초안</button>` : '';
    for (const s of Store.byDate(U.today())) {
      if (s.masked || s.status === 'cancelled') continue;
      // 대표님이 앱에서 '늦어요'를 보냈으면 (60분 안) 맨 위 빨간 띠 + 늦어져서 다음 일정 이동이 모자라면 '…으로 미루기'
      const ln = Learn.lateNotice(s, msgs, now, 60);
      if (ln) {
        rows.unshift(`<div class="alert-band late ceo">${Icon.svg('siren', 18)}<span><b>대표님: ${U.esc(s.title)} ${ln.min}분 늦음 · ${U.hm(ln.at)}</b><small>${U.hm(ln.arriveAt)}쯤 도착 · 시작 ${s.start}${s.location ? ' · ' + U.esc(s.location) : ''}</small>${this.lateNextHtml(s, ln.min)}</span>
          ${draftBtn(s, ln.min)}</div>`);
        continue;
      }
      const e = Learn.eta(s, msgs, all);
      if (!e || e.late <= 0 || U.diffMin(now, U.at(s.date, s.start)) > 60) continue;
      rows.push(`<div class="alert-band late">${Icon.svg('alert', 18)}<span><b>'${U.esc(s.title)}' 약 ${e.late}분 늦을 것 같아요</b><small>출발 ${U.hm(e.depart)} · 도착 예상 ${U.hm(e.at)} · 시작 ${s.start}${e.learned ? ` · ${e.slotLabel || '지난 기록'} 평균 ${e.min}분` : ''}</small></span>
        ${draftBtn(s, e.late)}</div>`);
    }
    const t1 = U.addDays(U.today(), 1);
    const tomorrow = Store.byDate(t1).filter(s => s.status !== 'cancelled');
    const sent = msgs.some(m => m.from === 'secretary' && m.ref === 'brief:' + t1);
    let skip = ''; try { skip = localStorage.getItem('CEOP_BRIEF_SKIP') || ''; } catch { /* */ }
    if (now.getHours() >= 18 && tomorrow.length && !sent && skip !== t1) {
      rows.push(`<div class="alert-band brief">${Icon.svg('file', 18)}<span><b>내일 브리핑을 아직 안 보냈어요</b><small>내일 일정 ${tomorrow.length}건 · 보내면 대표님 앱에 '모두 확인'이 떠요</small></span>
        <button class="btn primary" data-briefnow>브리핑 보내기</button><button class="btn quiet" data-briefskip>오늘은 안 보내기</button></div>`);
    }
    // 손님께 초대장을 보낸 뒤 시각 · 장소가 바뀐 일정 (누가 · 어디서 바꿨든 — 비서 웹 · 대표 앱 AI · 다른 PC)
    for (const s of Store.list()) {
      if (s.date < U.today() || U.at(s.date, s.start) < now) continue;
      const sent = this.inviteStale(s); if (!sent) continue;
      rows.push(`<div class="alert-band brief inv">${Icon.svg('alert', 18)}<span><b>'${U.esc(s.title)}' 손님 초대장이 예전 내용이에요</b><small>${U.esc(this.inviteDiff(sent, s).join(' · '))} · 손님은 아직 예전 링크를 갖고 있어요</small></span>
        <button class="btn primary" data-reinvite="${s.id}">손님에게 바뀐 초대장 다시 보내기</button></div>`);
    }
    el.innerHTML = rows.join('');
    el.querySelectorAll('[data-reinvite]').forEach(b => b.addEventListener('click', () => { const x = Store.get(b.dataset.reinvite); if (x) this.openInvite(x.id, { from: this.inviteStale(x) }); }));
    el.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => this.shiftSchedule(b.dataset.shift, b.dataset.to, b.dataset.clash)));
    el.querySelectorAll('[data-latedraft]').forEach(b => b.addEventListener('click', () => { const s = Store.get(b.dataset.latedraft); if (s) this.openDraft(s, Drafts.late(s, b.dataset.min, Store.profile())); }));
    el.querySelector('[data-briefnow]')?.addEventListener('click', () => this.openBrief(t1));
    el.querySelector('[data-briefskip]')?.addEventListener('click', () => { try { localStorage.setItem('CEOP_BRIEF_SKIP', t1); } catch { /* */ } this.renderAlerts(); });
  },

  /** 대표님이 늦어 이 일정이 늦게 끝나면 다음 일정까지 이동이 모자란지 — '다음: 12:20 투자사 점심 — 이동 50분 부족' + 미루기 */
  lateNextHtml(s, min) {
    const add = m => U.hm(U.addMin(U.at(s.date, m), min));
    const late = { ...s, start: add(s.start), end: add(s.end || s.start) };
    const w = Backtime.conflictsOn([...Store.list().filter(x => x.id !== s.id), late], s.date).find(x => x.a.id === s.id);
    if (!w) return '';
    const b = w.b.masked ? '개인 일정' : w.b.title;
    const fix = w.b.masked ? null : this.fixFor(w);
    return `<small class="late-next">다음: ${w.b.start} ${U.esc(b)} — 이동 ${w.shortMin}분 부족${fix ? ` <button class="btn sm signal" data-shift="${w.b.id}" data-to="${fix.to}"${fix.clash ? ` data-clash="${U.esc(fix.clash.masked ? '개인 일정' : fix.clash.title)}"` : ''}>${U.esc(w.b.title)} ${fix.to}${this.ro(fix.to)} 미루기</button>` : ''}</small>`;
  },

  // ───────── 오늘 현황 (모든 숫자는 오늘 기준) ─────────
  renderStats() {
    const now = new Date();
    const today = Store.byDate(U.today()).filter(s => s.status !== 'cancelled');
    const mine = today.filter(s => !s.masked);
    const acked = mine.filter(s => s.ackAt).length;
    const waiting = mine.filter(s => !s.ackAt);
    const warns = this.conflictsOn(U.today());
    const plans = Backtime.planDay(today, { prepMin: Store.profile().prepMin, commuteMin: Store.profile().commuteMin });
    const next = plans.find(({ s, p }) => s.mode !== 'none' && !s.masked && p.leaveAt > now);
    const short = w => `${w.b.title}까지 ${w.shortMin}분 부족`;
    const stat = (label, value, sub, tone, view) => `
      <button class="stat ${tone}" ${view ? `data-goview="${view}"` : 'tabindex="-1"'}><span class="stat-label">${label}</span>
        <span class="stat-val num">${value}</span><span class="stat-sub">${sub}</span></button>`;
    const el = document.getElementById('stats');
    el.innerHTML = `<div class="panel-head"><h2>오늘 현황</h2><span class="muted small">${this.dateShort(U.today())} ${U.hm(now)} 기준</span></div>
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
    el.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => this.shiftSchedule(b.dataset.shift, b.dataset.to, b.dataset.clash)));
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
    const clash = this.clashAt(w.b, to);
    // 미룬 시각이 다른 일정과 또 겹치면, 5분씩 늦춰 겹치지 않는 가장 이른 시각도 찾아 둠 (같은 날 안에서)
    let free = null;
    if (clash) for (let m = add + 5; m <= 12 * 60; m += 5) {
      const t = U.addMin(U.at(w.b.date, w.b.start), m);
      if (U.ymd(t) !== w.b.date) break;
      if (!this.clashAt(w.b, U.hm(t))) { free = U.hm(t); break; }
    }
    return { to, add, clash, free };
  },
  /** s 를 to 로 옮기면 겹치는 다른 일정 (없으면 null) */
  clashAt(s, to) {
    const dur = U.diffMin(U.at(s.date, s.end), U.at(s.date, s.start));
    const moved = { ...s, start: to, end: U.hm(U.addMin(U.at(s.date, to), dur > 0 ? dur : 60)) };
    const all = [...Store.list().filter(x => x.id !== s.id), moved];
    const w = [...Backtime.conflictsOn(all, s.date), ...Backtime.conflictsOn(all, U.addDays(s.date, 1))].find(x => x.a === moved || x.b === moved);
    return w ? (w.a === moved ? w.b : w.a) : null;
  },

  /** 당일 동선 — 막대(기사 대기·이동은 빗금) + 현재 시각 선 + 이동 부족 해결 버튼 */
  dayView() {
    const list = this.day(this.cur);
    const plans = Backtime.planDay(list, { prepMin: Store.profile().prepMin, commuteMin: Store.profile().commuteMin });
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
        `<i class="g-main ${s.masked ? 'masked' : `cat-${s.category}`}" style="left:${pos(p.startAt)}%;width:${Math.max(.8, pos(p.endAt) - pos(p.startAt))}%" title="${U.esc(s.masked ? '바쁨' : s.title)}">${pos(p.endAt) - pos(p.startAt) >= 9 ? `<span>${s.masked ? '바쁨' : U.esc(s.title)}</span>` : ''}</i>`;
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
        <span>${asked ? '대표님이 앱에서 조정을 요청했어요 · ' : ''}${canFix ? (fix.clash
          ? `${fix.to}${this.ro(fix.to)} 미루면 '${U.esc(fix.clash.masked ? '개인 일정' : fix.clash.title)}'${Backtime.wa(fix.clash.masked ? '개인 일정' : fix.clash.title)} 새로 겹쳐요${fix.free ? ` · ${fix.free}${this.ro(fix.free)} 미루면 다른 일정과 안 겹쳐요` : ''}`
          : `'${U.esc(w.b.title)}' 시작을 ${fix.to}${this.ro(fix.to)} ${fix.add}분 미루면 해결돼요`) : '대표 개인 일정과 겹쳐요'}</span></div>
        ${asked && !seen ? `<button class="btn" data-seenadj="${w.b.id}">확인했어요</button>` : ''}${canFix ? (fix.clash
          ? `${fix.free ? `<button class="btn signal" data-shift="${w.b.id}" data-to="${fix.free}">${U.esc(w.b.title)} ${fix.free}${this.ro(fix.free)} 미루기 <small>(다른 일정과 안 겹침)</small></button>` : ''}<button class="btn" data-shift="${w.b.id}" data-to="${fix.to}" data-clash="${U.esc(fix.clash.masked ? '개인 일정' : fix.clash.title)}">${fix.to}${this.ro(fix.to)} <small>('${U.esc(fix.clash.masked ? '개인 일정' : fix.clash.title)}'${Backtime.wa(fix.clash.masked ? '개인 일정' : fix.clash.title)} 겹침)</small></button>`
          : `<button class="btn signal" data-shift="${w.b.id}" data-to="${fix.to}">${U.esc(w.b.title)} ${fix.to}${this.ro(fix.to)} 미루기</button>`) : ''}</div>`;
    }).join('');
    return `${warnHtml}<div class="gantt"><div class="g-row g-head"><div class="g-label"></div>${scale}</div>${rows}</div>
      <p class="legend"><i class="g-move"></i> 기사 대기 · 이동 <i class="g-main cat-external"></i> 일정 ${this.cur === U.today() ? '<i class="g-now-key"></i> 지금' : ''}</p>`;
  },

  async shiftSchedule(id, to, clash) {
    const s = Store.get(id); if (!s) return;
    const dur = U.diffMin(U.at(s.date, s.end), U.at(s.date, s.start));
    const end = U.hm(U.addMin(U.at(s.date, to), dur));
    if (!confirm(`'${s.title}' 시작을 ${s.start} → ${to}${this.ro(to)} 미룰까요? (종료 ${end})${clash ? `\n주의: 이 시각은 '${clash}'${Backtime.wa(clash)} 겹쳐요.` : ''}\n대표님께 다시 확인을 요청해요.`)) return;
    try {
      await Store.upsert({ ...s, start: to, end });
      await Store.send(`'${s.title}' 시작을 ${to}${this.ro(to)} 미뤘어요. 앱에서 확인 부탁드려요.`, { ref: s.id });
      U.toast(`${to}${this.ro(to)} 미뤘어요. 대표님께 알렸어요`);
      const steps = [];
      const sent = this.inviteStale(Store.get(id));
      if (sent) steps.push(() => this.openInvite(id, { from: sent }));
      if (s.briefing && s.briefing.who) steps.push(() => this.openDraft(s, Drafts.change(s, { date: s.date, start: s.start }, { date: s.date, start: to }, Store.profile())));
      if (steps.length) this.chain(steps);
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
  openDispatch(ymd, note = '') {
    const p = Store.profile();
    const plans = Backtime.planDay(Store.byDate(ymd).filter(s => s.status !== 'cancelled' && !s.masked), { prepMin: p.prepMin, commuteMin: p.commuteMin })
      .filter(({ s }) => Backtime.driverLeg(s));
    // 도착지 마중 (국제선은 전날 출발 일정도) — '20:40 인천공항 T2 3층 출구 마중 대기 (KE708 20:00 도착 · 도쿄 출장 귀국)'
    const pks = Store.list().filter(s => (s.date === ymd || s.date === U.addDays(ymd, -1)) && s.status !== 'cancelled' && !s.masked && Backtime.isTrip(s.mode) && s.trip && s.trip.pickup && s.trip.pickup.on)
      .map(s => ({ s, pk: Backtime.plan(s).pickup })).filter(({ pk }) => pk && U.ymd(pk.waitAt) === ymd);
    const pkWhere = pk => [pk.station, pk.spot].filter(Boolean).join(' ') || '도착 출구';
    const lines = [...plans.map(({ s, p: pl }) => ({ at: pl.driverCallAt || pl.leaveAt, t: `${U.hm(pl.driverCallAt || pl.leaveAt)} ${U.pickupLabel(s.origin || this.originFor(s.date, s.start, s.id)) || '본사'} 대기 → ${U.hm(pl.leaveAt)} 출발 · ${s.trip ? (s.trip.station || '역') : (s.location || '')} (${s.start} ${s.title})` })),
      ...pks.map(({ s, pk }) => ({ at: pk.waitAt, t: `${U.hm(pk.waitAt)} ${pkWhere(pk)} 마중 대기 (${pk.flightNo ? pk.flightNo + ' ' : ''}${U.hm(pk.arriveAt)} 도착 · ${s.title})` }))].sort((a, b) => a.at - b.at).map(x => x.t);
    const link = CEOP_CONFIG.DRIVER_URL ? `\n배차표 · 대기/출발/도착 알리기: ${new URL(CEOP_CONFIG.DRIVER_URL, location.href).href}` : '';
    const text = lines.length ? `${note ? `⚠ ${note}\n` : ''}[${this.dateShort(ymd)} 배차]\n${lines.join('\n')}${link}\n- ${p.secretaryName || '비서'}` : '';
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal dispatch" role="dialog" aria-label="기사님께 배차 알림">
      <div class="ed-head"><div><h3>기사님께 배차 알림</h3><p class="muted small">${U.esc(p.driverName || '기사님')} · ${this.dateShort(ymd)} · 기사 차량 일정 ${plans.length}건${pks.length ? ` · 도착 마중 ${pks.length}건` : ''}</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dp-body">${lines.length ? `<ol class="dp-list">${plans.map(({ s, p: pl }) => `<li><b class="num">${U.hm(pl.driverCallAt || pl.leaveAt)}</b><span>${U.esc(U.pickupLabel(this.originOf(s)) || '본사')} 대기 · ${U.hm(pl.leaveAt)} 출발<small>${U.esc(s.trip ? (s.trip.station || '역') : (s.location || ''))} · ${s.start} ${U.esc(s.title)}</small></span></li>`).join('')}${pks.map(({ s, pk }) => `<li><b class="num">${U.hm(pk.waitAt)}</b><span>마중 대기 · ${U.esc(pkWhere(pk))}<small>${pk.flightNo ? U.esc(pk.flightNo) + ' ' : ''}${U.hm(pk.arriveAt)} 도착 · ${U.esc(s.title)}</small></span></li>`).join('')}</ol>
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
    return back;
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
      <form id="ef" class="ed-form" novalidate>
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
          <label>출발지<input name="origin" value="${U.esc(s.origin || '')}" placeholder="앞 일정 장소 · 그날 첫 일정이면 자택" list="originList"></label>
          <label>이동수단<select name="mode">${opt(Backtime.MODES, s.mode)}</select></label>
          <label class="mv"><span id="travelLbl">이동 시간 (분)</span><input name="travelMin" type="number" min="0" max="600" value="${Number(s.travelMin || 0)}"></label>
          <label class="mv">여유 (분)<input name="bufferMin" type="number" min="0" max="120" value="${Number(s.bufferMin ?? 10)}"></label>
          <p class="hint">이동 시간은 지금은 직접 넣어요. 같은 길을 3번 넘게 다녀오면, 실제로 걸린 시간을 배워서 여기 알려 드려요.</p>
          <p class="learn-hint" id="learnHint"></p>
          <p class="learn-hint late" id="lateHint" hidden></p>
        </fieldset>
        <datalist id="originList"></datalist>
        <fieldset class="full" id="tripBox"><legend>기차 · 비행기</legend>
          <label>출발 역 · 공항<input name="station" value="${U.esc(t.station || '')}" placeholder="예: 서울역"></label>
          <label>출발 시각<input name="departTime" type="time" value="${t.departTime || ''}"></label>
          <label>도착 시각<input name="arriveTime" type="time" value="${t.arriveTime || ''}"></label>
          <label>역까지 (분)<input name="accessMin" type="number" min="0" max="300" value="${Number(t.accessMin || 0)}"></label>
          <label>역까지 수단<select name="accessMode" data-auto="1">${opt({ driver: Backtime.MODES.driver, taxi: Backtime.MODES.taxi, car: Backtime.MODES.car }, t.accessMode || 'driver')}</select></label>
          <label>국제선<select name="intl"><option value="">아니오</option><option value="1" ${t.intl ? 'selected' : ''}>예</option></select></label>
          <label>도착 공항 · 역<input name="arriveStation" value="${U.esc(t.arriveStation || '')}" placeholder="예: 인천공항 T2"></label>
          <label>편명<input name="flightNo" value="${U.esc(t.flightNo || '')}" placeholder="선택 · 예: KE708"></label>
          <p class="hint abroad" hidden>${Icon.svg('info', 13)} 서울 밖에서 출발하는 구간은 기사님 배차에서 빼요 · 기사님은 도착 마중만 가요</p>
          <label class="check pk-on"><input type="checkbox" name="pickupOn" ${t.pickup && t.pickup.on ? 'checked' : ''}> 도착지 마중 <span class="muted small">— 도착하면 기사님이 마중 장소에서 대기 (배차표에 자동으로 들어가요)</span></label>
          <label class="pk">짐 찾는 시간 (분)<input name="pickupBag" type="number" min="0" max="180" value="${t.pickup && t.pickup.bagMin != null ? Number(t.pickup.bagMin) : Backtime.pickupBagDefault(s.mode, t.intl)}" ${t.pickup && t.pickup.bagMin != null ? '' : 'data-auto="1"'}></label>
          <label class="pk pk-spot">마중 장소<input name="pickupSpot" value="${U.esc((t.pickup && t.pickup.spot) || '')}" placeholder="예: T2 3층 출구"></label>
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
      <div class="ed-foot">${target.id ? '<button type="button" class="btn quiet" data-del>일정 삭제</button>' : ''}${target.id && s.category !== 'personal' && U.at(s.date, s.start) > new Date() ? `<button type="button" class="btn ${this.inviteStale(s) ? 'signal' : ''}" data-invite>${this.inviteStale(s) ? '손님에게 바뀐 초대장 다시 보내기' : '손님에게 초대장 보내기'}</button>` : ''}<span style="flex:1"></span>
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
    f.elements.origin && f.elements.origin.addEventListener('input', e => { originTouched = true; e.target.dataset.touched = '1'; });
    const reOrigin = e => { if (!originTouched && f.elements.origin && ['date', 'start'].includes(e.target.name)) f.elements.origin.value = this.originFor(f.elements.date.value, f.elements.start.value, this.edit && this.edit.id); };
    f.addEventListener('change', reOrigin);
    f.elements.pickupBag && f.elements.pickupBag.addEventListener('input', e => { delete e.target.dataset.auto; });
    f.elements.accessMode && f.elements.accessMode.addEventListener('change', e => { if (e.isTrusted) delete e.target.dataset.auto; });
    f.addEventListener('input', () => { this.dirty = true; this.syncForm(f, back); });
    // 출발지를 바꾸고 칸을 떠나면 이동 시간 칸으로 (이동 시간이 예전 출발지 기준일 수 있어요)
    f.elements.origin.addEventListener('change', () => { if (this.originMoved(this.fromForm(f))) { f.elements.travelMin.focus(); f.elements.travelMin.select(); } });
    f.addEventListener('change', () => this.syncForm(f, back));
    f.addEventListener('submit', async e => { e.preventDefault(); if (await this.save(f)) { this.dirty = false; this.edit = null; back.remove(); } });
    // 배운 이동 시간 적용 · 추천 장소 고르기
    back.addEventListener('click', e => {
      const ap = e.target.closest('[data-applymin]');
      if (ap) { f.elements.travelMin.value = ap.dataset.applymin; this.dirty = true; this.syncForm(f, back); }
      const lp = e.target.closest('[data-latepull]');
      if (lp) { f.elements.travelMin.value = Number(f.elements.travelMin.value || 0) + Number(lp.dataset.latepull); f.dataset.latePulled = lp.dataset.latepull; this.dirty = true; this.syncForm(f, back); U.toast(`이동 시간을 ${lp.dataset.latepull}분 늘렸어요 — 출발이 그만큼 당겨져요`); }
      const pl = e.target.closest('[data-pickplace]');
      if (pl) { f.elements.location.value = pl.dataset.pickplace; this.dirty = true; this.syncForm(f, back); }
      // 도착이 늦어진 일정: 이 일정 시작 · 종료를 같은 길이로 미룸
      const ps = e.target.closest('[data-pvstart]');
      if (ps) {
        const st = f.elements.start.value, en = f.elements.end.value, to = ps.dataset.pvstart;
        const dur = U.diffMin(U.at(f.elements.date.value, en), U.at(f.elements.date.value, st));
        f.elements.start.value = to; f.elements.end.value = U.hm(U.addMin(U.at(f.elements.date.value, to), dur > 0 ? dur : 60));
        this.dirty = true; this.syncForm(f, back); U.toast(`시작을 ${to}${this.ro(to)} 바꿨어요. 저장하면 반영돼요`);
      }
      // 뒤 일정 미루기 (당일 동선과 같은 확인 → 저장 → 대표님께 알림)
      const sh = e.target.closest('[data-shift]');
      if (sh) this.shiftSchedule(sh.dataset.shift, sh.dataset.to).then(() => this.syncForm(f, back));
    });
    back.querySelector('[data-del]')?.addEventListener('click', () => this.deleteFlow(target.id, () => { this.dirty = false; this.edit = null; back.remove(); }));
    // 고친 내용이 있으면 먼저 저장 — 저장 안 하면 예전 시각으로 초대장이 나가요
    back.querySelector('[data-invite]')?.addEventListener('click', async () => {
      if (!this.dirty) { const st = this.inviteStale(Store.get(target.id)); return this.openInvite(target.id, st ? { from: st } : {}); }
      if (!confirm('고친 내용을 먼저 저장할까요?\n저장해야 바뀐 시간·장소로 초대장이 나가요.')) return;
      const sent = this.inviteSent(target.id);
      if (await this.save(f, { quietInvite: true })) {
        this.dirty = false; this.edit = null; back.remove();
        const now = Store.get(target.id);
        const changed = sent && now && (sent.date !== now.date || sent.start !== now.start || (sent.location || '') !== (now.location || ''));
        this.openInvite(target.id, changed ? { from: sent } : {});
      }
    });
    document.body.appendChild(back);
    this.syncForm(f, back);
    f.title.focus();
  },

  /** 출발지 기본값 — 이 일정 시작 전에 끝나는 마지막 일정 장소. 그날 첫 일정이면 자택.
   *  앞 일정이 끝나고 3시간 넘게 비면 그 사이 다른 곳(대개 자택)으로 갔다고 보고 앞 장소를 쓰지 않아요 (Backtime.defaultOrigin) */
  originFor(d, start, exceptId) { return Backtime.defaultOrigin(Store.list(), { date: d, start, id: exceptId }); },
  prevFor(d, start, exceptId) {
    return Store.byDate(d).filter(x => !x.masked && x.location && x.status !== 'cancelled' && x.id !== exceptId && (x.end || x.start) <= start && x.start <= start).pop();
  },
  gapMin(prev, start) {
    const m = t => { const [h, mi] = String(t || '0:0').split(':').map(Number); return h * 60 + mi; };
    return m(start) - m(prev.end || prev.start);
  },

  /** 새 일정 기본값 */
  blank(date) {
    let d = date || U.today(), start = '10:00';
    // 오늘이면 '다음 정각'부터 (지난 시각으로 열려 '이미 지난 시각' 경고가 먼저 뜨지 않게). 밤 10시 넘으면 내일 오전 10시
    if (d === U.today()) {
      const now = new Date(); const h = now.getHours() + (now.getMinutes() > 30 ? 2 : 1);
      if (h >= 22) d = U.addDays(d, 1); else if (h > 10) start = `${U.pad(h)}:00`;
    }
    const end = U.hm(U.addMin(U.at(d, start), 60));
    return { title: '', category: 'external', date: d, start, end, location: '', origin: this.originFor(d, start), mode: 'driver', travelMin: 30, bufferMin: 10, briefing: {}, trip: null, visibility: 'normal' };
  },

  fromForm(f) {
    const v = n => (f.elements[n] && f.elements[n].value) || '';
    const mode = v('mode');
    const id = this.edit && this.edit.id;
    // 새 일정에서 저절로 채운 '자택'(그날 첫 일정)은 비워서 저장 → 화면 · 배차표가 그때그때 계산 (나중에 앞에 일정이 생기면 그 장소로)
    const autoHome = !id && f.elements.origin && !f.elements.origin.dataset.touched && v('origin').trim() === Backtime.HOME;
    const s = {
      ...(id ? Store.get(id) : {}),
      title: v('title').trim(), category: v('category') || 'external', date: v('date'), start: v('start'), end: v('end'),
      location: v('location').trim(), origin: autoHome ? '' : v('origin').trim(), mode, travelMin: Number(v('travelMin')) || 0, bufferMin: Number(v('bufferMin')) || 0,
      visibility: 'normal', status: (id && Store.get(id) && Store.get(id).status) || 'scheduled',
      briefing: { who: v('who').trim(), company: v('company').trim(), purpose: v('purpose').trim(), last: v('last').trim(), notes: v('notes').trim(), bring: v('bring').trim(), phone: v('phone').trim() },
      trip: Backtime.isTrip(mode) ? { station: v('station').trim(), departTime: v('departTime'), arriveTime: v('arriveTime'), accessMin: Number(v('accessMin')) || 0, accessMode: v('accessMode'), intl: !!v('intl'),
        arriveStation: v('arriveStation').trim(), flightNo: v('flightNo').trim().toUpperCase(),
        pickup: f.elements.pickupOn && f.elements.pickupOn.checked ? { on: true, bagMin: v('pickupBag') === '' ? Backtime.pickupBagDefault(mode, !!v('intl')) : Number(v('pickupBag')), spot: v('pickupSpot').trim() } : null } : null,
    };
    if (id) s.id = id;
    return s;
  },

  syncForm(f, back) {
    const mode = f.elements.mode.value;
    const s = this.fromForm(f);
    back.querySelector('#tripBox').style.display = Backtime.isTrip(mode) ? '' : 'none';
    // 도착지 마중: 켰을 때만 짐 시간 · 마중 장소 · 짐 시간은 직접 고치기 전까지 국제선 40분 / 국내선 20분 / KTX 10분
    const bag = f.elements.pickupBag;
    if (bag && bag.dataset.auto) bag.value = Backtime.pickupBagDefault(mode, !!f.elements.intl.value);
    back.querySelectorAll('#tripBox .pk').forEach(el => { el.style.display = f.elements.pickupOn && f.elements.pickupOn.checked ? '' : 'none'; });
    // 도착지 마중을 켠 돌아오는 편인데 출발역 · 공항이 서울 밖(김해공항 · 부산역 · 해외): 서울 기사님이 못 가요 → '역까지 수단'을 택시로 (직접 고르기 전까지)
    const abroad = Backtime.departAbroad(s), am = f.elements.accessMode;
    if (am && am.dataset.auto) {
      if (abroad && am.value === 'driver') { am.value = 'taxi'; am.dataset.switched = '1'; s.trip.accessMode = 'taxi'; }
      else if (!abroad && am.dataset.switched) { am.value = 'driver'; delete am.dataset.switched; if (s.trip) s.trip.accessMode = 'driver'; }
    }
    back.querySelector('#tripBox .abroad').hidden = !abroad;
    if (f.elements.arriveStation) f.elements.arriveStation.placeholder = (s.trip && Backtime.arriveStation({ ...s, trip: { ...s.trip, arriveStation: '' } })) || '예: 인천공항 T2';
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
    const day = Backtime.planDay([...others, s], { prepMin: Store.profile().prepMin, commuteMin: Store.profile().commuteMin });
    const mine = day.find(d => d.s === s);
    const all = [...Store.list().filter(x => x.id !== s.id), s];
    const warns = [...Backtime.conflictsOn(all, s.date), ...Backtime.conflictsOn(all, U.addDays(s.date, 1))].filter(w => w.a === s || w.b === s);
    // 기차 · 비행기 도착이 늦어 시작에 못 맞추면 '시작 미루기' (이 창의 시작 · 종료만 바꿔요 — 저장은 직접)
    const ceil5 = m => Math.ceil(m / 5) * 5;
    if (mine.p.warn) warns.unshift({ msg: mine.p.warn, self: mine.p.lateMin > 0 ? U.hm(U.addMin(mine.p.startAt, ceil5(mine.p.lateMin))) : '' });
    const go = s.mode !== 'none';
    const past = s.date && s.start && U.at(s.date, s.start) < new Date() && !(this.edit && this.edit.id) ? `<p class="pv-status">${Icon.svg('info', 15)} 이미 지난 시각이에요 — 기록용이면 그대로 저장하세요 (대표님 확인 대기에는 안 들어가요)</p>` : '';
    const prevS = this.prevFor(s.date, s.start, s.id);
    const gapNote = prevS && this.gapMin(prevS, s.start) > 180 && s.origin !== prevS.location ? `<p class="pv-status">${Icon.svg('info', 15)} 앞 일정(${U.esc(prevS.location)})이 ${U.esc(prevS.end || prevS.start)}에 끝나고 시간이 많이 비어요 — 출발지(${U.esc(this.originOf(s))})가 맞는지 확인해 주세요</p>` : '';
    const om = this.originMoved(s);
    const originNote = om ? `<p class="pv-status warn">${Icon.svg('alert', 15)} 출발지가 바뀌었어요 — 이동 시간 ${Number(s.travelMin || 0)}분이 ${U.esc(this.originOf(s))} 기준인지 확인해 주세요</p>` : '';
    const overnight = s.end && s.end < s.start ? `<p class="pv-status">${Icon.svg('clock', 15)} 다음 날 ${s.end}에 끝나는 일정으로 저장돼요</p>` : '';
    // 새 일정을 막 열었을 때(아직 아무것도 안 고침)는 경고 대신 안내 — 처음 쓰는 분이 놀라지 않게
    const fresh = !(this.edit && this.edit.id) && !this.dirty;
    const status = fresh ? `<p class="pv-status">${Icon.svg('info', 15)} 날짜 · 시간 · 장소를 정하면 앞뒤 일정과 겹치는지 바로 알려 드려요</p>` : past + originNote + gapNote + overnight + (warns.length ? warns.map(w => {
        // 뒤 일정이 밀려 겹치면 그 일정을 '…으로 미루기' (당일 동선의 미루기와 같은 버튼)
        const nxt = w.a === s && w.b && !w.b.masked && w.b.id ? U.hm(U.addMin(U.at(w.b.date, w.b.start), ceil5(w.shortMin))) : '';
        const btn = w.self ? `<button type="button" class="btn sm signal" data-pvstart="${w.self}">시작 ${w.self}${this.ro(w.self)} 미루기</button>`
          : nxt ? `<button type="button" class="btn sm signal" data-shift="${w.b.id}" data-to="${nxt}">${U.esc(w.b.title)} ${nxt}${this.ro(nxt)} 미루기</button>` : '';
        return `<p class="pv-status bad">${Icon.svg('alert', 15)} <span>${U.esc(w.msg)}${btn ? `<br>${btn}` : ''}</span></p>`;
      }).join('')
      : `<p class="pv-status ok">${Icon.svg('checkCircle', 15)} 같은 날 앞뒤 일정과 겹치지 않아요${s.mode === 'driver' ? ` · ${U.esc(Store.profile().driverName || '기사님')} 배차 가능` : ''}</p>`);
    box.innerHTML = `<span class="pv-cap">대표님 앱에 이렇게 보여요</span>
      ${go ? `<span class="pv-cap">출발</span><b class="pv-big num">${U.hm(mine.p.leaveAt)}</b>` : `<span class="pv-cap">시작</span><b class="pv-big num">${s.start}</b>`}
      <ol class="pv">${mine.p.items.filter(it => it.kind !== 'end').map(it => `<li class="k-${it.kind}"><b class="num">${U.hm(it.at)}</b><span>${U.esc(it.title)}<small>${U.esc(it.detail || '')}</small></span></li>`).join('')}</ol>
      ${status}`;
  },

  async save(f, opts = {}) {
    const s = this.fromForm(f);
    const need = !s.title ? ['title', '일정 이름을 적어 주세요'] : !s.date ? ['date', '날짜를 골라 주세요'] : !s.start ? ['start', '시작 시간을 골라 주세요'] : !s.end ? ['end', '끝나는 시간을 골라 주세요'] : null;
    if (need) { const el = f.elements[need[0]]; U.toast(need[1]); if (el) { el.classList.add('invalid'); el.focus(); el.addEventListener('input', () => el.classList.remove('invalid'), { once: true }); } return false; }
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
      // 기사 차량 일정의 출발지(픽업 장소)가 바뀌면 기록 → 기사님 배차표 '픽업 장소 바뀜 · 예전: 자택', 대표 앱 '바뀜' (출발 전까지)
      if (before && Backtime.driverLeg(s)) {
        const from = this.originOf(before), to = this.originOf(s), pc = s.actual && s.actual.pickupChanged;
        if (Learn.key(from) !== Learn.key(to)) {
          const orig = pc && Learn.key(pc.from) !== Learn.key(to) ? pc.from : from;   // 여러 번 바꿔도 '예전'은 처음 장소
          s.actual = { ...(s.actual || {}), pickupChanged: pc && Learn.key(pc.from) === Learn.key(to) ? null : { from: orig, at: new Date().toISOString() } };
        }
      }
      const same = ({ id, date, ackAt, nudgedAt, actual, createdBy, status, ...rest }) => rest;   // 날짜 · 확인 · 실제 기록은 그대로
      await Store.upsertMany([s, ...later.map(x => ({ ...x, ...same(s) }))]);
      U.toast(this.edit.id ? `저장했어요${later.length ? ` (이후 반복 ${later.length}건 함께)` : ''}. 대표님께 다시 확인을 요청했어요` : '등록했어요. 대표님 앱에 표시돼요');
      // 시간 · 날짜가 바뀌었으면 상대방에게 보낼 문자 초안
      const needDraft = before && (before.start !== s.start || before.date !== s.date) && s.briefing && s.briefing.who;
      // 손님께 초대장을 보낸 일정의 시각 · 장소가 바뀌었으면 '바뀐 초대장 보내기'를 바로 (손님 링크는 예전 값 그대로라서)
      const sent = before && !opts.quietInvite ? this.inviteStale(s) : null;
      const invChanged = !!sent;
      // 오늘 · 내일 일정의 시각 · 장소 · 출발지가 바뀌면 대표님 비서톡에 바로 알림 (이미 출발했을 수 있어요 · 오늘이면 긴급 → 대표 앱 알림)
      const ch = before ? this.changeNote(before, s) : '';
      const soon = before && [before.date, s.date].some(d => d === U.today() || d === U.addDays(U.today(), 1));
      if (ch && soon) await Store.send(`'${s.title}' 일정이 바뀌었어요: ${ch}`, { ref: s.id, urgent: [before.date, s.date].includes(U.today()) }).catch(() => U.toast('저장했지만 대표님께 알림을 보내지 못했어요'));
      // 기사 차량 일정의 대기 장소(출발지) · 시각이 바뀌면 기사님께 보낼 변경 문자를 이어서 (기사님 배차표도 '픽업 장소 바뀜'으로 표시)
      const byDriver = x => Backtime.driverLeg(x);
      // 도착지 마중 일정의 도착 시각이 바뀌면(연착) 기사님 마중 대기 시각도 바뀌어요 → 배차 문자를 이어서
      const pkNote = before && soon ? this.pickupNote(before, s) : '';
      const drvNote = pkNote ? `변경 · '${s.title}' ${pkNote}` : before && soon && (byDriver(before) || byDriver(s)) && ((before.origin || '') !== (s.origin || '') || before.start !== s.start || before.date !== s.date)
        ? `변경 · '${s.title}' ${[(before.origin || '') !== (s.origin || '') ? `대기 장소 ${U.pickupLabel(this.originOf(before))} → ${U.pickupLabel(this.originOf(s))}` : '', before.start !== s.start || before.date !== s.date ? `시간 ${before.date !== s.date ? this.dateShort(before.date) + ' ' : ''}${before.start} → ${before.date !== s.date ? this.dateShort(s.date) + ' ' : ''}${s.start}` : ''].filter(Boolean).join(' · ')}` : '';
      const steps = [];
      // 손님 초대장이 먼저 (손님은 예전 링크로 출발 시간을 맞추고 있어요) — 닫아도 위쪽 띠에 '바뀐 초대장 다시 보내기'가 남아요
      if (invChanged) steps.push(() => this.openInvite(s.id, { from: sent }));
      if (needDraft) steps.push(() => this.openDraft(s, Drafts.change(s, { date: before.date, start: before.start }, { date: s.date, start: s.start }, Store.profile())));
      if (drvNote) steps.push(() => this.openDispatch(pkNote ? this.pickupDay(s) : s.date, drvNote));
      if (steps.length) setTimeout(() => this.chain(steps), 50);
      return true;
    } catch (err) { U.toast('저장하지 못했어요: ' + (err.message || err)); return false; }
  },

  /** 창을 하나씩 차례로 (앞 창을 닫으면 다음 창) */
  chain(steps) {
    const el = steps.shift()();
    if (!steps.length) return;
    if (!el) return this.chain(steps);
    const ob = new MutationObserver(() => { if (!el.isConnected) { ob.disconnect(); this.chain(steps); } });
    ob.observe(document.body, { childList: true });
  },

  /** 수정 중 출발지만 바뀌고 이동 시간은 그대로인지 (이동 시간이 예전 출발지 기준일 수 있어요) */
  originMoved(s) {
    const o = this.edit && this.edit.id ? Store.get(this.edit.id) : null;
    if (!o || !s || s.mode === 'none' || Backtime.isTrip(s.mode)) return false;
    return Learn.key(this.originOf(o)) !== Learn.key(this.originOf(s)) && Number(s.travelMin || 0) === Number(o.travelMin || 0);
  },

  /** 출발지 칸이 비면 화면처럼 앞 일정 장소(그날 첫 일정이면 자택) */
  originOf(x) { return x.origin || this.originFor(x.date, x.start, x.id); },

  /** 시각 · 장소 · 출발지가 어떻게 바뀌었는지 한 줄 ('15:00 → 15:30 · 장소 A → B') — 안 바뀌었으면 '' */
  changeNote(a, b) {
    return [
      a.date !== b.date || a.start !== b.start ? `${a.date !== b.date ? this.dateShort(a.date) + ' ' : ''}${a.start} → ${a.date !== b.date ? this.dateShort(b.date) + ' ' : ''}${b.start}` : '',
      (a.location || '') !== (b.location || '') ? `장소 ${a.location || '-'} → ${b.location || '-'}` : '',
      (a.origin || '') !== (b.origin || '') ? `출발지 ${this.originOf(a)} → ${this.originOf(b)}` : '',
      this.arriveNote(a, b),
    ].filter(Boolean).join(' · ');
  },
  /** 기차 · 비행기 도착 시각이 바뀌었으면 '귀국편 도착 18:00 → 20:00 · 마중 20:40' — 안 바뀌었으면 '' */
  arriveNote(a, b) {
    const ta = (a && a.trip) || {}, tb = (b && b.trip) || {};
    if (!Backtime.isTrip(b.mode) || !ta.arriveTime || !tb.arriveTime || ta.arriveTime === tb.arriveTime) return '';
    const kind = Backtime.departAbroad(b) && tb.intl ? '귀국편' : b.mode === 'flight' ? '비행기' : '기차';
    const pk = Backtime.plan(b).pickup;
    return `${kind}${tb.flightNo ? ` ${tb.flightNo}` : ''} 도착 ${ta.arriveTime} → ${tb.arriveTime}${pk ? ` · 마중 ${U.hm(pk.waitAt)}` : ''}`;
  },
  /** 도착지 마중 대기 시각이 바뀌었으면 기사님께 보낼 한 줄 ('마중 대기 18:40 → 20:40 · 도착 18:00 → 20:00') */
  pickupNote(a, b) {
    const pa = Backtime.plan(a).pickup, pb = Backtime.plan(b).pickup;
    if (!pb || (pa && +pa.waitAt === +pb.waitAt)) return '';
    const fn = b.trip.flightNo ? ` ${b.trip.flightNo}` : '';
    return pa ? `마중 대기 ${U.hm(pa.waitAt)} → ${U.hm(pb.waitAt)} · 도착${fn} ${U.hm(pa.arriveAt)} → ${U.hm(pb.arriveAt)}` : `마중 대기 ${U.hm(pb.waitAt)} · 도착${fn} ${U.hm(pb.arriveAt)}`;
  },
  /** 마중 대기하는 날 (국제선은 다음 날 도착일 수 있어요) */
  pickupDay(s) { const pk = Backtime.plan(s).pickup; return pk ? U.ymd(pk.waitAt) : s.date; },

  /** 등록 창 도우미: 배운 이동 시간 · 식사 장소 추천 · 반복 안내 */
  syncHelpers(f, back, s) {
    const hint = back.querySelector('#learnHint');
    if (hint) {
      const leaveAt = s.date && s.start ? U.addMin(U.at(s.date, s.start), -(Number(s.travelMin || 0) + Number(s.bufferMin || 0))) : null;
      const t = s.mode !== 'none' && !Backtime.isTrip(s.mode) && s.location ? Learn.travel(Store.list().filter(x => x.id !== s.id), Store.messages(), { origin: s.origin, location: s.location, at: leaveAt }) : null;
      const html = t ? `${Icon.svg('clock', 14)} <span>${t.slotLabel ? `${t.slotLabel}에 ` : ''}지난 ${t.n}번 실제로 <b>평균 ${t.avg}분</b> 걸렸어요 <small>(${t.mins.join(' · ')}분${t.sameOrigin ? ` · ${U.esc(s.origin)}에서` : ''})</small></span>${Number(s.travelMin) !== t.avg ? ` <button type="button" class="btn sm" data-applymin="${t.avg}">${t.avg}분으로</button>` : ''}` : '';
      if (hint._html !== html) { hint.innerHTML = html; hint._html = html; }   // 같은 내용이면 다시 그리지 않음 (누르는 중인 버튼이 사라지지 않게)
      hint.hidden = !t;
    }
    const lh = back.querySelector('#lateHint');
    if (lh) {
      // 같은 길 · 같은 시간대에 대표님이 2번 넘게 '늦어요'를 보냈으면 출발을 당기자고 권해요
      const hb = s.mode !== 'none' && !Backtime.isTrip(s.mode) && s.location ? Learn.lateHabit(Store.list(), { origin: this.originOf(s), location: s.location, date: s.date, start: s.start }) : null;
      const pulled = Number(f.dataset.latePulled || 0);
      const html = hb ? `${Icon.svg('alert', 14)} <span>${hb.slotLabel}에 이 길로 지난 ${hb.n}번 평균 <b>${hb.avg}분 늦음</b> — ${pulled ? `출발을 ${pulled}분 당겼어요 (이동 ${Number(s.travelMin || 0)}분)` : `출발 ${hb.pullMin}분 당길까요?`}</span>${pulled ? '' : ` <button type="button" class="btn sm" data-latepull="${hb.pullMin}">출발 ${hb.pullMin}분 당기기</button>`}` : '';
      if (lh._html !== html) { lh.innerHTML = html; lh._html = html; }
      lh.hidden = !hb;
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
  /** 손님용 미팅 초대장: 링크 안에 미팅 정보만 (서버 저장 없음). 받은 사람은 출발지·준비 시간·이동 수단만 고르면 출발 시간이 나옴 */
  INVITE_BASE: 'https://ktj8824-stack.github.io/ceoplanner-web/invite.html',
  openInvite(id, opts = {}) {
    const s = Store.get(id); if (!s) return;
    let co = '', note = ''; try { co = localStorage.getItem('ceo_company_name') || ''; note = localStorage.getItem('ceo_inv_note_' + id) || ''; } catch { /* */ }
    const lines = this.inviteDiff(opts.from, s), diff = lines.join(' · ');
    const head = lines.length ? '손님에게 바뀐 초대장 다시 보내기' : '손님에게 초대장 보내기';
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal dispatch" role="dialog" aria-label="${head}">
      <div class="ed-head"><div><h3>${head}</h3><p class="muted small">${U.esc(s.title)} · ${this.dateShort(s.date)} ${U.esc(s.start)}</p></div>
        <button class="icon-btn" data-close aria-label="닫기">${Icon.svg('x', 18)}</button></div>
      <div class="dp-body">
        ${diff ? `<p class="inv-changed">${Icon.svg('alert', 15)} <span>손님께 보낸 초대장과 달라졌어요 — ${U.esc(diff)}.<br>바뀐 초대장을 다시 보내 주세요.</span></p>` : ''}
        <p class="muted small" style="margin:0 0 10px">손님은 로그인·설치 없이 링크를 열어 출발지만 고르면 출발 시간과 길안내가 나와요. 미팅 이름·날짜·시각·장소만 보내요.</p>
        <label class="dp-text">회사 이름 (초대장 맨 위)<input id="inv-co" value="${U.esc(co)}" placeholder="예) 한빛전자"></label>
        <label class="dp-text">손님께 한마디 <span class="muted">(선택)</span><input id="inv-note" value="${U.esc(note)}" placeholder="예) 1층 안내데스크에서 방문증 받아 주세요"></label>
        <label class="dp-text">보낼 글<textarea id="inv-msg" rows="8" readonly></textarea></label>
      </div>
      <div class="ed-foot"><span style="flex:1"></span><button class="btn" data-close>닫기</button><button class="btn" data-copy>복사</button><button class="btn primary" data-send>${lines.length ? '바뀐 초대장 다시 보내기' : '보내기 (카톡 등)'}</button></div></div>`;
    document.body.appendChild(back);
    const build = () => {
      const c = back.querySelector('#inv-co').value.trim(), n = back.querySelector('#inv-note').value.trim();
      try { localStorage.setItem('ceo_company_name', c); localStorage.setItem('ceo_inv_note_' + id, n); } catch { /* */ }
      const o = { v: 1, id: String(s.id).slice(0, 12), c, t: s.title, d: s.date, s: s.start, l: s.location || '' };
      if (n) o.n = n.slice(0, 120);
      if (diff) o.x = diff.slice(0, 160);   // 손님 화면 맨 위에 '시간 변경: 15:00 → 15:30'
      const bin = Array.from(new TextEncoder().encode(JSON.stringify(o)), x => String.fromCharCode(x)).join('');
      const url = this.INVITE_BASE + '?i=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const dt = new Date(s.date + 'T00:00:00');
      const when = `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${'일월화수목금토'[dt.getDay()]}) ${s.start}`;
      // 다시 보내는 초대장은 바뀐 내용부터 ('시간 변경: 15:00 → 15:30')
      const text = (lines.length ? `${lines.join('\n')}\n\n` : '') + `💼 ${c ? `[${c}] ` : ''}미팅 초대\n▪ 일정  ${s.title}\n▪ 장소  ${s.location || '-'}\n▪ 일시  ${when}\n출발지만 고르면 출발 시간·길안내가 맞춰져요\n\n▶ 눌러서 받기\n${url}`;
      back.querySelector('#inv-msg').value = text;
      return { text, url };
    };
    build();
    back.querySelectorAll('input').forEach(i => i.addEventListener('input', build));
    back.addEventListener('click', async e => {
      if (e.target === back || e.target.closest('[data-close]')) return back.remove();
      if (e.target.closest('[data-copy], [data-send]')) {
        const rec = { date: s.date, start: s.start, location: s.location || '', at: Date.now() };
        try { localStorage.setItem('ceo_inv_sent_' + id, JSON.stringify(rec)); } catch { /* */ }
        // 일정에도 남겨 다른 PC · 다른 비서도 '보낸 초대장'을 알게 (실제 기록 칸이라 대표님 확인은 다시 안 받아요)
        // invitedAt: 언제 보냈는지 (일정에서 바로 보이게 — 시각 · 장소를 바꾸면 '바뀐 초대장 다시 보내기'를 띄우는 기준)
        Store.setActual(id, { invited: rec }).catch(() => { /* 이 PC 기록은 남음 */ }).finally(() => this.renderAlerts());
      }
      if (e.target.closest('[data-copy]')) { const { text } = build(); try { await navigator.clipboard.writeText(text); U.toast('복사했어요. 카톡에 붙여넣어 보내 주세요'); } catch { prompt('길게 눌러 복사하세요', text); } }
      if (e.target.closest('[data-send]')) { const { text } = build(); if (navigator.share) { try { await navigator.share({ text }); } catch { /* */ } } else { try { await navigator.clipboard.writeText(text); U.toast('복사했어요. 카톡에 붙여넣어 보내 주세요'); } catch { prompt('길게 눌러 복사하세요', text); } } }
    });
    return back;
  },

  deleteFlow(id, done) {
    const s = Store.get(id); if (!s) return;
    const later = s.series ? Store.list().filter(x => x.series === s.series && x.date > s.date && x.status !== 'cancelled') : [];
    // 오늘 · 내일 아직 안 끝난 일정은 지우지 않고 '취소'로 남겨요 → 대표님 비서톡 알림 · 기사님 배차표 '취소됨'
    const live = x => (x.date === U.today() || x.date === U.addDays(U.today(), 1)) && U.at(x.date, x.end || x.start) > new Date();
    const finish = async ids => {
      try {
        const all = ids.map(i => Store.get(i)).filter(Boolean), off = all.filter(live);
        if (off.length) await Store.upsertMany(off.map(x => ({ ...x, status: 'cancelled' })));
        await Store.removeMany(all.filter(x => !live(x)).map(x => x.id));
        for (const x of off) await Store.send(`'${x.title}'(${x.date === U.today() ? '오늘' : '내일'} ${x.start}) 일정이 취소됐어요.${Backtime.driverLeg(x) ? ' 기사님 배차표에도 \'취소됨\'으로 보여요.' : ''}`, { ref: x.id, urgent: x.date === U.today() });
        done && done();
        U.toast(off.length ? `취소했어요. 대표님${off.some(x => Backtime.driverLeg(x)) ? '·기사님' : ''}께 알렸어요` : ids.length > 1 ? `일정 ${ids.length}건을 삭제했어요` : '일정을 삭제했어요');
        if (s.briefing && s.briefing.who && U.at(s.date, s.start) > new Date()) setTimeout(() => this.openDraft(s, Drafts.cancel(s, Store.profile())), 50);
      } catch (err) { U.toast('삭제하지 못했어요: ' + (err.message || err)); }
    };
    if (!later.length) { if (confirm(live(s) ? '이 일정을 취소할까요? 대표님·기사님께 취소를 알려요.' : '이 일정을 삭제할까요? 대표님 앱에서도 사라져요.')) finish([id]); return; }
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
    return back;
  },

  /** 보낸 초대장과 지금 일정이 달라졌으면 보낸 기록을, 같으면 null (손님 링크는 예전 시각 · 장소 그대로라서) */
  inviteStale(s) {
    if (!s || s.masked || s.status === 'cancelled') return null;
    const sent = this.inviteSent(s.id);
    return sent && (sent.date !== s.date || sent.start !== s.start || (sent.location || '') !== (s.location || '')) ? sent : null;
  },
  /** 바뀐 내용 줄들 — ['시간 변경: 15:00 → 15:30', '장소 변경: A → B'] (날짜가 바뀌면 날짜도 같이) */
  inviteDiff(from, s) {
    if (!from) return [];
    const out = [];
    if (from.date !== s.date) out.push(`시간 변경: ${this.dateShort(from.date)} ${from.start} → ${this.dateShort(s.date)} ${s.start}`);
    else if (from.start !== s.start) out.push(`시간 변경: ${from.start} → ${s.start}`);
    if ((from.location || '') !== (s.location || '')) out.push(`장소 변경: ${from.location || '-'} → ${s.location || '-'}`);
    return out;
  },

  /** 손님께 마지막으로 보낸 초대장 내용 (이 브라우저 기록 + 일정에 남은 기록 중 최근 것) */
  inviteSent(id) {
    let mine = null; try { mine = JSON.parse(localStorage.getItem('ceo_inv_sent_' + id) || 'null'); } catch { /* */ }
    const s = Store.get(id), shared = s && s.actual && s.actual.invited;   // 다른 PC · 다른 비서가 보낸 기록
    return [mine, shared].filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
  },

  /** 대표님 메시지(시간 변경 · 취소)에서 상대방 문자 초안 만들기 */
  draftFromMsg(m) {
    if (m.from !== 'ceo' || !m.ref) return null;
    const s = Store.get(m.ref);
    if (!s || s.masked || !s.briefing || !s.briefing.who) return null;
    const ch = m.body.match(/(\d{1,2}:\d{2})\s*→\s*(\d{1,2}:\d{2})/);
    if (ch && /바꿨어요/.test(m.body)) return { s, text: Drafts.change(s, { date: s.date, start: ch[1] }, { date: s.date, start: ch[2] }, Store.profile()) };
    if (/취소했어요/.test(m.body)) return { s, text: Drafts.cancel(s, Store.profile()) };
    const late = m.body.match(/약\s*(\d+)분 늦을|(\d+)분 정도 늦을/);
    if (late) return { s, text: Drafts.late(s, late[1] || late[2], Store.profile()) };
    return null;
  },

  /** 대표님께 보낼 하루 브리핑 */
  briefText(ymd) {
    const p = Store.profile();
    const day = Backtime.planDay(Store.byDate(ymd).filter(s => s.status !== 'cancelled'), { prepMin: p.prepMin, commuteMin: p.commuteMin });
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
