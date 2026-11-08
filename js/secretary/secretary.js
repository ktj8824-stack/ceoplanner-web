/* =========================================
   CEO플래너 — 비서 웹 (PC)
   왼쪽: 주간 일정 (대표 개인 일정은 '바쁨')
   가운데: 일정 등록·수정 + 역산 미리보기
   오른쪽: 경고(충돌·미확인) + 비서톡
   ========================================= */
const Sec = {
  weekOffset: 0,
  selId: null,       // 수정 중인 일정 id
  draftDate: null,   // 새 일정 날짜
  dirty: false,
  seenMsgs: 0,

  async start() {
    const root = document.getElementById('root');
    try { await Store.init('secretary'); }
    catch (e) { root.innerHTML = `<p style="padding:20px">연결 오류: ${U.esc(e.message || e)}</p>`; return; }
    if (Store.needsLogin) return Login.render(root, 'CEO플래너 비서 웹 로그인', () => this.boot());
    this.boot();
  },

  boot() {
    this.seenMsgs = Number(localStorage.getItem('CEOP_SEEN_SEC') || 0);
    const root = document.getElementById('root');
    root.innerHTML = `
      ${Store.mode === 'demo' ? `<div class="demo-bar">데모 모드 — 같은 브라우저에서 <a href="${U.esc(CEOP_CONFIG.APP_URL)}" target="_blank">CEO 앱</a>을 열면 서로 바로 반영돼요</div>` : ''}
      <header class="sec-head"><h1>CEO플래너 · 비서 웹</h1><span class="who" id="who"></span><span class="sp"></span>
        <button class="btn gold" data-new>＋ 새 일정</button>
        ${Store.mode === 'supabase' ? '<button class="btn" data-logout>로그아웃</button>' : '<button class="btn" data-reset>데모 초기화</button>'}</header>
      <div id="urgent"></div>
      <div class="layout">
        <section class="card panel" id="week"></section>
        <section class="card panel editor" id="editor"></section>
        <aside class="side-r"><section class="card panel" id="alerts"></section><section class="card panel" id="chat"></section></aside>
      </div>`;
    root.querySelector('[data-new]').addEventListener('click', () => this.open(null, U.today()));
    root.querySelector('[data-reset]')?.addEventListener('click', () => { if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) { this.selId = null; this.dirty = false; Store.resetDemo(); } });
    root.querySelector('[data-logout]')?.addEventListener('click', () => Store.signOut());
    Store.on(() => this.refresh());
    this.refresh();
  },

  refresh() {
    document.getElementById('who').textContent = `담당: ${Store.profile().name || '대표'}`;
    this.renderWeek();
    this.renderAlerts();
    this.renderChat();
    this.renderUrgent();
    // 입력 중인 내용은 지우지 않음
    if (!this.dirty) this.renderEditor();
  },

  // ───────── 주간 일정 ─────────
  /** 오늘부터 7일 (‹ › 로 한 주씩 이동) */
  weekDays() {
    const first = U.addDays(U.today(), this.weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => U.addDays(first, i));
  },

  renderWeek() {
    const days = this.weekDays();
    const el = document.getElementById('week');
    el.innerHTML = `<h2>주간 일정 <span class="week-nav"><button class="btn ghost" data-w="-1">‹</button><button class="btn ghost" data-w="0">오늘부터</button><button class="btn ghost" data-w="1">›</button></span></h2>` +
      days.map(ymd => {
        const list = Store.byDate(ymd);
        const rows = list.map(s => {
          const cat = Backtime.CATEGORIES[s.category] || {};
          const badge = s.masked ? '<span class="badge private">바쁨</span>' : s.ackAt ? '<span class="badge ok">✔ 확인</span>' : '<span class="badge warn">미확인</span>';
          return `<div class="wrow ${s.masked ? 'masked' : ''} ${s.id === this.selId ? 'sel' : ''}" ${s.masked ? '' : `data-open="${s.id}"`}>
            <span class="tm">${s.start}</span><span class="tt">${s.masked ? '🔒 대표 개인 일정' : `${cat.emoji || ''} ${U.esc(s.title)}`}</span>${badge}</div>`;
        }).join('');
        return `<div class="wday ${ymd === U.today() ? 'today' : ''}"><div class="wd">${U.dateLabel(ymd)}</div>${rows}<button class="add" data-add="${ymd}">＋ 일정 추가</button></div>`;
      }).join('');
    el.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => { const v = Number(b.dataset.w); this.weekOffset = v === 0 ? 0 : this.weekOffset + v; this.renderWeek(); }));
    el.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', () => this.open(r.dataset.open)));
    el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => this.open(null, b.dataset.add)));
  },

  open(id, date) {
    if (this.dirty && !confirm('저장하지 않은 내용이 있어요. 버릴까요?')) return;
    this.selId = id; this.draftDate = date || null; this.dirty = false;
    this.renderWeek();
    this.renderEditor();
  },

  // ───────── 일정 편집 ─────────
  renderEditor() {
    const el = document.getElementById('editor');
    const s = this.selId ? Store.get(this.selId) : (this.draftDate ? this.blank(this.draftDate) : null);
    if (!s || s.masked) {
      el.innerHTML = `<div class="empty-editor"><p style="font-size:30px;margin:0">🗓️</p><p>왼쪽에서 일정을 고르거나 <b>＋ 새 일정</b>을 누르세요.</p>
        <p class="small">저장하면 대표님 앱에 바로 뜨고, 대표님이 <b>확인</b>을 누르면 여기 표시돼요.</p></div>`;
      return;
    }
    const b = s.briefing || {}, t = s.trip || {};
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.emoji} ${v.label}</option>`).join('');
    const cats = Object.fromEntries(Object.entries(Backtime.CATEGORIES).filter(([k]) => k !== 'personal'));
    el.innerHTML = `<h2>${this.selId ? '일정 수정' : '새 일정'} ${s.ackAt ? '<span class="badge ok">대표 확인함</span>' : this.selId ? '<span class="badge warn">대표 미확인</span>' : ''}</h2>
      <form class="f" id="ef">
        <label>제목<input name="title" required value="${U.esc(s.title || '')}" placeholder="예: 한빛전자 협력 미팅"></label>
        <div class="grid3">
          <label>분류<select name="category">${opt(cats, s.category)}</select></label>
          <label>날짜<input name="date" type="date" required value="${s.date}"></label>
          <label>장소<input name="location" value="${U.esc(s.location || '')}" placeholder="예: 삼성동 사옥"></label>
        </div>
        <div class="grid3">
          <label><span id="startLbl">시작</span><input name="start" type="time" required value="${s.start}"></label>
          <label>종료<input name="end" type="time" required value="${s.end}"></label>
          <label>이동수단<select name="mode">${opt(Backtime.MODES, s.mode)}</select></label>
        </div>
        <div class="grid2" id="moveRow">
          <label><span id="travelLbl">예상 이동 시간 (분)</span><input name="travelMin" type="number" min="0" max="600" value="${Number(s.travelMin || 0)}"></label>
          <label>여유 시간 (분)<input name="bufferMin" type="number" min="0" max="120" value="${Number(s.bufferMin ?? 10)}"></label>
        </div>
        <fieldset id="tripBox"><legend>🚄 기차·비행기</legend>
          <div class="grid3">
            <label>역·공항<input name="station" value="${U.esc(t.station || '')}" placeholder="예: 서울역"></label>
            <label>출발 시각<input name="departTime" type="time" value="${t.departTime || ''}"></label>
            <label>도착 시각<input name="arriveTime" type="time" value="${t.arriveTime || ''}"></label>
          </div>
          <div class="grid3">
            <label>역·공항까지 (분)<input name="accessMin" type="number" min="0" max="300" value="${Number(t.accessMin || 0)}"></label>
            <label>역·공항까지 수단<select name="accessMode">${opt({ driver: Backtime.MODES.driver, taxi: Backtime.MODES.taxi, car: Backtime.MODES.car }, t.accessMode || 'driver')}</select></label>
            <label>국제선<select name="intl"><option value="">아니오</option><option value="1" ${t.intl ? 'selected' : ''}>예</option></select></label>
          </div>
        </fieldset>
        <fieldset><legend>📋 미팅 브리핑 (대표님 앱에 일정 직전 표시)</legend>
          <div class="grid2">
            <label><span id="whoLbl">만날 분</span><input name="who" value="${U.esc(b.who || '')}" placeholder="예: 정민호 부사장"></label>
            <label>회사·직함<input name="company" value="${U.esc(b.company || '')}"></label>
          </div>
          <label>목적<input name="purpose" value="${U.esc(b.purpose || '')}"></label>
          <div class="grid2">
            <label>지난 미팅<textarea name="last">${U.esc(b.last || '')}</textarea></label>
            <label>메모<textarea name="notes">${U.esc(b.notes || '')}</textarea></label>
          </div>
          <label>준비물<input name="bring" value="${U.esc(b.bring || '')}"></label>
        </fieldset>
        <div class="preview" id="preview"></div>
        <div class="bar">${this.selId ? '<button type="button" class="btn ghost left" data-del>삭제</button>' : ''}
          <button type="button" class="btn ghost" data-cancel>닫기</button><button class="btn primary">저장하고 대표님께 보내기</button></div>
      </form>`;
    const f = el.querySelector('#ef');
    f.addEventListener('input', () => { this.dirty = true; this.syncForm(f); });
    f.addEventListener('change', () => this.syncForm(f));
    f.addEventListener('submit', e => { e.preventDefault(); this.save(f); });
    el.querySelector('[data-cancel]').addEventListener('click', () => { this.dirty = false; this.selId = null; this.draftDate = null; this.renderWeek(); this.renderEditor(); });
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('이 일정을 삭제할까요? 대표님 앱에서도 사라져요.')) return;
      try { await Store.remove(this.selId); this.dirty = false; this.selId = null; this.refresh(); U.toast('삭제했어요'); }
      catch (err) { U.toast('삭제 실패: ' + (err.message || err)); }
    });
    this.syncForm(f);
  },

  blank(date) {
    return { title: '', category: 'external', date, start: '10:00', end: '11:00', location: '', mode: 'driver', travelMin: 30, bufferMin: 10, briefing: {}, trip: null, visibility: 'normal' };
  },

  fromForm(f) {
    const v = n => f.elements[n].value;
    const mode = v('mode');
    const s = {
      ...(this.selId ? Store.get(this.selId) : {}),
      title: v('title').trim(), category: v('category'), date: v('date'), start: v('start'), end: v('end'),
      location: v('location').trim(), mode, travelMin: Number(v('travelMin')) || 0, bufferMin: Number(v('bufferMin')) || 0,
      visibility: 'normal', status: 'scheduled',
      briefing: { who: v('who').trim(), company: v('company').trim(), purpose: v('purpose').trim(), last: v('last').trim(), notes: v('notes').trim(), bring: v('bring').trim() },
      trip: Backtime.isTrip(mode) ? { station: v('station').trim(), departTime: v('departTime'), arriveTime: v('arriveTime'), accessMin: Number(v('accessMin')) || 0, accessMode: v('accessMode'), intl: !!v('intl') } : null,
    };
    if (this.selId) s.id = this.selId;
    return s;
  },

  /** 수단·분류에 따라 입력칸을 바꾸고 역산 미리보기를 다시 그림 */
  syncForm(f) {
    const mode = f.elements.mode.value, cat = f.elements.category.value;
    f.querySelector('#tripBox').style.display = Backtime.isTrip(mode) ? '' : 'none';
    f.querySelector('#moveRow').style.display = mode === 'none' ? 'none' : '';
    f.querySelector('#travelLbl').textContent = Backtime.isTrip(mode) ? '도착역 → 현장 (분)' : '예상 이동 시간 (분)';
    f.querySelector('#startLbl').textContent = cat === 'golf' ? '티오프' : '시작';
    f.querySelector('#whoLbl').textContent = cat === 'golf' ? '동반자' : '만날 분';
    const s = this.fromForm(f);
    const box = f.querySelector('#preview');
    if (!s.date || !s.start) { box.innerHTML = ''; return; }
    // 그날 다른 일정과 함께 계산해야 기상 시각·충돌이 맞음
    const others = Store.byDate(s.date).filter(x => x.id !== s.id && x.status !== 'cancelled');
    const day = Backtime.planDay([...others, s], { prepMin: Store.profile().prepMin });
    const mine = day.find(d => d.s === s);
    const warns = Backtime.conflicts([...others, s]).filter(w => w.a === s || w.b === s);
    box.innerHTML = `<h4>역산 결과 — 대표님 앱에 이렇게 보여요</h4>
      <ol>${mine.p.items.map(it => `<li><b>${U.hm(it.at)}</b>${it.icon} ${U.esc(it.title)} <span class="muted">${U.esc(it.detail || '')}</span></li>`).join('')}</ol>
      ${warns.map(w => `<div class="alert warn" style="margin:8px 0 0">⚠️ ${U.esc(w.msg)}</div>`).join('')}
      ${s.end < s.start ? '<div class="alert warn" style="margin:8px 0 0">⚠️ 종료 시간이 시작보다 빨라요</div>' : ''}`;
  },

  async save(f) {
    const s = this.fromForm(f);
    if (!s.title) return U.toast('제목을 입력하세요');
    if (s.end < s.start) return U.toast('종료 시간이 시작보다 빨라요');
    try {
      const saved = await Store.upsert(s);
      this.selId = saved.id; this.draftDate = null; this.dirty = false;
      this.refresh();
      U.toast('저장했어요 — 대표님 앱에 반영됐어요');
    } catch (err) { U.toast('저장 실패: ' + (err.message || err)); }
  },

  // ───────── 경고 ─────────
  renderAlerts() {
    const el = document.getElementById('alerts');
    const out = [];
    for (let i = 0; i < 7; i++) {
      const ymd = U.addDays(U.today(), i);
      const list = Store.byDate(ymd).filter(s => s.status !== 'cancelled');
      Backtime.conflicts(list).forEach(w => out.push({ cls: 'warn', id: w.b.masked ? w.a.id : w.b.id, text: `⚠️ ${U.dateLabel(ymd)} — ${w.msg}` }));
    }
    const unacked = Store.list().filter(s => !s.masked && !s.ackAt && s.date >= U.today()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    unacked.slice(0, 6).forEach(s => out.push({ cls: 'info', id: s.id, text: `🕒 대표 미확인 — ${U.dateLabel(s.date)} ${s.start} ${s.title}` }));
    el.innerHTML = `<h2>확인할 것 <span class="badge ${out.length ? 'warn' : 'ok'}">${out.length}</span></h2>` +
      (out.map(a => `<div class="alert ${a.cls}" data-open="${a.id}">${U.esc(a.text)}</div>`).join('') || '<p class="muted small">문제없어요.</p>');
    el.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', () => { const s = Store.get(r.dataset.open); if (s && !s.masked) this.open(s.id); }));
  },

  // ───────── 비서톡 ─────────
  renderChat() {
    const el = document.getElementById('chat');
    const msgs = Store.messages();
    const keep = el.querySelector('input')?.value || '';
    el.innerHTML = `<h2>비서톡</h2><div class="sec-chat" id="secChat">${msgs.map(m => `<div class="m ${m.from === 'secretary' ? 'me' : 'them'} ${m.urgent ? 'urgent' : ''}">${m.urgent ? '🚨 ' : ''}${U.esc(m.body)}<span class="at">${m.from === 'ceo' ? '대표' : '나'} · ${U.hm(new Date(m.at))}</span></div>`).join('') || '<p class="muted small">대표님 요청이 여기에 떠요.</p>'}</div>
      <form class="sec-send" id="secSend"><input name="body" placeholder="대표님께 메시지" autocomplete="off"><button class="btn primary">보내기</button></form>`;
    const box = el.querySelector('#secChat'); box.scrollTop = box.scrollHeight;
    const form = el.querySelector('#secSend');
    form.body.value = keep;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = form.body.value.trim(); if (!v) return;
      try { form.body.value = ''; await Store.send(v); } catch (err) { U.toast('전송 실패: ' + (err.message || err)); }
    });
  },

  renderUrgent() {
    const el = document.getElementById('urgent');
    const msgs = Store.messages();
    const fresh = msgs.slice(this.seenMsgs).filter(m => m.from === 'ceo' && m.urgent);
    if (!fresh.length) { el.innerHTML = ''; return; }
    const m = fresh[fresh.length - 1];
    el.innerHTML = `<div style="background:var(--danger);color:#fff;padding:12px 20px;display:flex;gap:12px;align-items:center">
      <b>🚨 대표님 긴급</b><span style="flex:1">${U.esc(m.body)} (${U.hm(new Date(m.at))})</span><button class="btn" style="background:#fff;color:var(--danger)" data-seen>확인</button></div>`;
    el.querySelector('[data-seen]').addEventListener('click', () => {
      this.seenMsgs = msgs.length; localStorage.setItem('CEOP_SEEN_SEC', String(msgs.length)); this.renderUrgent();
    });
  },
};

Sec.start();
