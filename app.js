/* 체전 라이브 대시보드. 빌드·외부 라이브러리 없음. 데이터 계약은 docs/DASHBOARD.md §6 (schema_version 1).
   URL: ?sido=경기  ?snapshot=replay/106/d2.json  ?target=top3  &reveal=1(다시 보기 결과 공개, §10)  &fav=배구,육상(관심 종목)
   탭은 #today #race #watch #mine(설계 13, docs/UX_SCENARIOS.md §6-1). 옛 #home·#nation 은 새 탭으로 연다.
   응원 프로필·나의 경기·캘린더·이미지·오늘의 질문은 docs/ENGAGEMENT.md */
(function () {
  "use strict";
  const F = window.Fmt;
  const SCHEMA = 1;
  const REFRESH_MS = 5 * 60 * 1000;
  const SIDOS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남",
    "전북", "전남", "경북", "경남", "제주"];
  const TABS = [["today", "오늘"], ["race", "레이스"], ["watch", "경기"], ["mine", "나의 체전"]];
  const TAB_ALIAS = { home: "today", nation: "race" };     // 설계 13 이전 주소(§6-1)
  const PAGE = 30;
  const LANE_H = 38;          // 트랙 한 줄 높이(px). style.css 의 --lane-h 와 같게
  const LANE_KEY = "chejeon.lanes";
  const FAV_KEY = "chejeon.fav", PICK_KEY = "chejeon.picks", FAV_MAX = 10, PICK_MAX = 300;     // 관심 종목 최대 10(설계 15 Y2). 옛 저장값·주소(3개 이하)는 그대로 읽힌다
  const MYDAY_MAX = 10, Q_PER = 3;
  // 오늘의 질문(설계 9 G)은 설계 14 X4 에서 "찜한 경기"(설계 15 Y1 이름) 로 대체. 코드·기록 키(chejeon.picks)는 남기고 화면에서만 끈다
  const LEGACY_QUESTION = false;
  // 찜한 경기(설계 14 X4, 설계 15 Y1 이름): {match_key: {t, p, side, s, e, day, n, a, b, r}} 이 기기에만. 다시 보기·남의 응원 카드에서는 이 페이지 안에서만(저장 안 함)
  const WATCH_KEY = "chejeon.watchlist", WATCH_MAX = 300;
  const JOURNAL_KEY = "chejeon.journal", JOURNAL_MAX = 50000;      // 기기 기록(§6-3), 글자 수 상한
  const RIVAL_KEY = "chejeon.rival";                               // 지역별로 고른 라이벌(§6-4)
  const MEMO_MAX = 60;                                             // 나의 체전 메모 한 줄(§6-6), 이 기기에만
  // 응원 집계 Worker(§6-5, worker/cheer/). 주소는 site/config.js 하나, 비어 있으면 응원 보내기·응원 레이스 전체가 꺼진다
  const CHEER_API = String((window.CHEJEON_CONFIG && window.CHEJEON_CONFIG.CHEER_API) || "").replace(/\/+$/, "");
  const CHEER_KEY = "chejeon.cheer";                               // 이 기기에서 누른 횟수 {count, last}
  // 알림(설계 14 X7, worker/cheer push 경로, docs/DEPLOY.md §13-N1). 둘 중 하나라도 비면 기능 전체가 꺼지고 화면에 흔적이 없다
  const PUSH_API = String((window.CHEJEON_CONFIG && window.CHEJEON_CONFIG.PUSH_API) || "").replace(/\/+$/, "");
  const VAPID_PUBLIC = String((window.CHEJEON_CONFIG && window.CHEJEON_CONFIG.VAPID_PUBLIC) || "");
  const WHO_KEY = "chejeon.who";                                   // 응원하는 선수·학교 {who: [id], school}(X8), 이 기기에만
  const PUSH_KEY = "chejeon.push";                                 // 이 기기의 알림 설정 {on, kinds, endpoint, sido, event}
  const PUSH_KINDS = [["result", "결과", "우리 지역 메달·라이벌 맞대결 결과"], ["before", "경기 전", "관심 종목·우리 영향이 큰 경기 30분 전"], ["recap", "저녁 마무리", "밤 10시 뒤 오늘의 한 줄"]];
  // 공유 입구 페이지 경로(§6-7, scripts/build_entry_pages.py·config/site.json 의 slugs 와 같게)
  const SLUG = { 서울: "seoul", 부산: "busan", 대구: "daegu", 인천: "incheon", 광주: "gwangju", 대전: "daejeon", 울산: "ulsan", 세종: "sejong",
    경기: "gyeonggi", 강원: "gangwon", 충북: "chungbuk", 충남: "chungnam", 전북: "jeonbuk", 전남: "jeonnam", 경북: "gyeongbuk", 경남: "gyeongnam", 제주: "jeju" };

  const q = new URLSearchParams(location.search);
  const S = {
    snap: null, timeline: null, status: null, replayIndex: null, commentary: null,
    loadError: null, schemaError: false, lastOk: null,
    sido: null, tab: "today", filter: null, shown: PAGE,
    // 오늘 탭(§6-2): 시간대 상태는 자료를 받을 때 정한다. 보고 있는 동안에는 카드 순서를 바꾸지 않는다
    day: null, dayAsOf: null, dayMore: false, dayNext: false,
    // 기기 기록(§6-3). seen 은 이 페이지를 열기 전의 last_seen(지난 방문 이후 카드의 기준)
    journal: null, seen: null, rivalParam: q.get("rival"),
    // 공유 카드로 들어옴(§6-7): from=card, 이 기기에 원래 고른 지역, 안내 줄 닫음, 지역 고르기 펼침, 주소 복사 알림
    fromCard: q.get("from") === "card", ownSido: null, cardClosed: false, cardPick: false, copied: null,
    // 돌아오기(§6-8): 온보딩 ③ 을 띄우는 중, 설치 안내 펼침, 설치 신호, 이 페이지에서 "나중에" 를 눌렀는지, 저녁에 한 번 더 물었는지
    returnStep: false, installGuide: false, installEvt: null, returnLater: false, returnEvening: false,
    // 진입 화면(설계 15 Y3): 장면(1~5, null = 닫힘), 장면 1 에서 고른 칸·두 번째 지역(라이벌)·목록 대체·"또 하나" 펼침, 역대 자료
    live: null, entry: null, entryPick: null, entryRival: null, entryList: false, entryMore: false, history: null, historyRaw: null, historyTried: false,
    targetKey: q.get("target"),
    snapshotPath: safePath(q.get("snapshot")),
    // 다시 보기(설계 6, docs/DASHBOARD.md §10): 결과는 "결과 공개" 를 눌렀을 때만 받는다
    reveal: q.get("reveal") === "1", outcomes: null, scorecard: null,
    // 움직임(docs/DASHBOARD.md §11-2): 값이 바뀔 때만. still=1 이나 prefers-reduced-motion 이면 끈다
    still: q.get("still") === "1" || !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches),
    prev: null, play: null,
    // 응원 프로필(docs/ENGAGEMENT.md §3): 관심 종목, 처음 지역을 고를 때의 종목 고르기, 오늘의 질문에서 고른 쪽
    fav: [], favSet: false, favAsk: false, onboard: false, favDraft: null, picks: {}, qMore: 0,
    // 나의 체전 탭 "고치기"(온보딩 ①② 다시, §6-6 1)
    profEdit: false,
    // 응원(§6-5): Worker 에서 받은 지역별 응원 수({as_of, counts}, 못 받으면 null), 마지막으로 누른 시각(1초에 한 번)
    cheer: null, cheerAt: 0,
    // 하이라이트 피드(설계 14 X2): 더 보기 펼침, 공유할 하이라이트의 순번
    momMore: false, momentIdx: 0,
    // 한 줄 경기 카드(X3): 펼친 줄(기본 접힘)·접은 줄(기본 펼침: 뜨거운 경기), 만약에 가정(새로 고치면 초기화)
    rowOpen: new Set(), rowClosed: new Set(), whatIf: {},
    watch: {},
    // 도전장(설계 14 X5): 받은 도전장의 보낸 지역(dare=), 안내 줄 닫음
    dare: null, dareClosed: false,
    // 알림(X7): 설정 시트 펼침, 고르는 중인 종류, 상태 한 줄
    pushSheet: false, pushDraft: null, pushMsg: null, pushBusy: false,
    // 사람(X8): people.json(없으면 null = 흔적 없음), 응원하는 선수 id·학교, 찾기 입력
    people: null, who: [], school: null, peopleQ: "",
  };

  // ── 공통 ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function safePath(p) {
    // 같은 사이트 안의 상대 경로 JSON 만 연다
    if (!p || !/^[\w\-./]+\.json$/.test(p) || p.includes("..") || p.startsWith("/")) return null;
    return p;
  }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* 사생활 보호 모드 등 */ }
    return null;
  }

  function session(key, val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem(key) || "null");
      sessionStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* 저장소를 못 쓰면 움직임 없이 그린다 */ }
    return null;
  }

  function setParam(key, val) {
    const u = new URL(location.href);
    if (val === null || val === undefined) u.searchParams.delete(key); else u.searchParams.set(key, val);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }

  function sched(m) {
    // 역대 대회 일정은 연도가 없어 대회 시작일의 연도를 쓴다
    const y = S.snap && S.snap.event && S.snap.event.start_date ? +S.snap.event.start_date.slice(0, 4) : null;
    return F.parseSchedule(m.scheduled_at, y);
  }

  function refNow() {
    // 리플레이는 그 시점이 '지금'이다
    if (S.snapshotPath && S.snap) return F.parseTime(S.snap.data_as_of) || new Date();
    return new Date();
  }

  function argmax(a) {
    let k = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
    return k;
  }

  async function getJSON(url, fresh) {
    const u = fresh ? url + (url.includes("?") ? "&" : "?") + "t=" + Date.now() : url;
    const r = await fetch(u, { cache: fresh ? "no-store" : "default" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  // ── 자료 받기 ─────────────────────────────────────────────────────────
  async function load() {
    const live = !S.snapshotPath;
    const main = live ? "data/latest.json" : S.snapshotPath;
    const dir = live ? "data/" : S.snapshotPath.replace(/[^/]*$/, "");
    // 해설(설계 5)은 별도 파일. 리플레이는 d2.json → commentary_d2.json
    const cm = live ? "data/commentary.json" : dir + "commentary_" + S.snapshotPath.replace(/^.*\//, "").replace(/\.json$/, "") + ".json";
    const [snap, tl, st, idx, com, lv] = await Promise.allSettled([
      getJSON(main, live), getJSON(dir + "timeline.json", live),
      live ? getJSON("data/status.json", true) : Promise.reject(new Error("replay")),
      live ? Promise.reject(new Error("live")) : getJSON(dir + "index.json", false),
      getJSON(cm, live),
      // 설계 15 Y7: 수동 입력 경기 중 승률(site/data/live.json, ENTRY §2 P5→M1). latest 와 같은 5분 주기, 다시 보기에서는 받지 않는다
      live ? getJSON("data/live.json", true) : Promise.reject(new Error("replay")),
    ]);
    S.live = lv.status === "fulfilled" && lv.value && lv.value.schema_version === 1 && lv.value.matches && typeof lv.value.matches === "object" ? lv.value : null;
    const asOf0 = S.snap ? S.snap.data_as_of : null;
    if (snap.status === "fulfilled") {
      if (snap.value.schema_version !== SCHEMA) {
        // 자료가 화면보다 새 형식이면 화면(app.js)을, 옛 형식이거나 표시가 없으면 자료를 새로 만들어야 한다
        S.schemaError = (snap.value.schema_version || 0) > SCHEMA ? "newer" : "older";
      } else {
        S.snap = snap.value;
        applyHistory();
        S.schemaError = false;
        S.loadError = null;
        S.lastOk = new Date();
        settlePicks();
        settleWatch();
      }
    } else {
      S.loadError = snap.reason;
    }
    if (tl.status === "fulfilled" && tl.value.schema_version === SCHEMA) S.timeline = tl.value;
    if (st.status === "fulfilled") S.status = st.value;
    if (idx.status === "fulfilled") S.replayIndex = idx.value;
    S.commentary = com.status === "fulfilled" && com.value.schema_version === SCHEMA ? com.value : null;
    // 시간대 상태는 시계만 흘러서는 바꾸지 않는다. 새 자료가 왔거나 오늘 탭을 보고 있지 않을 때 다시 정한다(§6-2 움직임)
    if (S.snap && (!S.day || S.dayAsOf !== S.snap.data_as_of || S.tab !== "today" || document.hidden)) {
      S.day = dayState().key;
      S.dayAsOf = S.snap.data_as_of;
    }
    render();
    // 새 자료(data_as_of 가 바뀜)가 오면 "지금" 띠가 한 번 번쩍(0.4초, X1). still·reduced-motion·다시 보기는 없음
    if (asOf0 && S.snap && S.snap.data_as_of !== asOf0 && !S.still && !S.snapshotPath) {
      const nb = document.querySelector(".c-hero .now-band");
      if (nb) { nb.classList.add("flash"); setTimeout(() => nb.classList.remove("flash"), 450); }
    }
    touchJournal();
    loadExtras();
    loadCheer();
    loadShout();
    loadPeople();
  }

  // ── 응원 보내기·응원 레이스(설계 13 §6-5). 못 받아도 알리지 않는다: 숫자·막대를 숨기고 단추만 남긴다 ──
  function cheerOn() { return !!CHEER_API && !S.snapshotPath && !!evNo(); }

  async function loadCheer() {
    if (!cheerOn()) return;
    try {
      const r = await fetch(`${CHEER_API}/cheer?event=${encodeURIComponent(evNo())}`, { cache: "default" });
      if (!r.ok) throw new Error("cheer " + r.status);
      const j = await r.json();
      if (!j || typeof j.counts !== "object" || !j.counts) throw new Error("cheer form");
      const counts = {};
      for (const k of SIDOS) { const n = Math.floor(+j.counts[k]); counts[k] = n > 0 ? n : 0; }
      S.cheer = { as_of: j.as_of || null, counts };
    } catch (e) { S.cheer = null; }
    paintCheer();
  }

  // 단추 옆 "전국 n": 전국에서 우리 지역에 보낸 응원 수
  function cheerNText(us) { return S.cheer && us ? `전국 ${F.num(S.cheer.counts[us] || 0)}` : ""; }
  // 화면 읽기 프로그램용: "전국 n" 이 17개 시도 합계로 읽히지 않게(W6 검토 메모 3)
  function cheerNLabel(us) { return S.cheer && us ? `전국에서 ${us}에 보낸 응원 ${F.num(S.cheer.counts[us] || 0)}번` : ""; }

  function cheerButton(us) {
    if (!cheerOn()) return "";
    const t = cheerNText(us);
    return `<button class="act-btn cheer-btn" data-cheer="1">♥ 응원 보내기</button>`
      + `<span class="cheer-n num" data-cheer-n="1" aria-live="polite" aria-label="${esc(cheerNLabel(us))}" title="${esc(cheerNLabel(us))}"${t ? "" : " hidden"}>${esc(t)}</span>`;
  }

  // 레이스 탭 17개 시도 표 아래 응원 레이스: 응원 수 순 막대 17개, 우리 지역 노랑. 받기 전·못 받으면 빈 자리(숨김)
  function cheerRaceCard(us) {
    if (!cheerOn()) return "";
    if (!S.cheer) return `<div id="cheer-race" hidden></div>`;
    const rows = SIDOS.map((k, i) => [k, S.cheer.counts[k] || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    const mx = Math.max(1, ...rows.map(r => r[1]));
    const bars = rows.map(([k, n]) => `<li class="cb${k === us ? " me" : ""}"><b>${esc(k)}</b>`
      + `<span class="cb-bar"><i style="width:${(n / mx * 100).toFixed(1)}%"></i></span><span class="num">${esc(F.num(n))}</span></li>`).join("");
    return `<section class="card c-wide c-cheer" id="cheer-race" aria-label="응원 레이스"><h3>응원 레이스 <small>지역별 응원 수</small></h3>`
      + `<ol class="cheer-bars">${bars}</ol>`
      + `<p class="note">응원 수는 단추를 누른 횟수의 익명 집계이며 전망 계산과 무관합니다. 위 라이벌 카드의 "응원 보내기"로 보탭니다.</p></section>`;
  }

  // 받은 숫자를 다시 그리기 없이 제자리에 넣는다(트랙 움직임을 끊지 않는다)
  function paintCheer() {
    const t = cheerNText(S.sido);
    const lb = cheerNLabel(S.sido);
    document.querySelectorAll("[data-cheer-n]").forEach(e => { e.textContent = t; e.hidden = !t; e.setAttribute("aria-label", lb); e.title = lb; });
    const slot = document.getElementById("cheer-race");
    if (slot) slot.outerHTML = cheerRaceCard(S.sido);
  }

  function sendCheer() {
    const us = S.sido, now = Date.now();
    if (!cheerOn() || !us || now - S.cheerAt < 1000) return;
    S.cheerAt = now;
    let c;
    try { c = JSON.parse(store(CHEER_KEY) || "null"); } catch (e) { c = null; }
    c = c && Number.isFinite(c.count) ? c : { count: 0, last: null };
    store(CHEER_KEY, JSON.stringify({ count: c.count + 1, last: new Date(now).toISOString() }));
    // 우리 지역 면이 한 번 번쩍(0.4초). still=1·reduced-motion 이면 없다
    const side = document.querySelector(".c-rival .rv-side.us");
    if (side && !S.still) {
      side.classList.remove("cheer-flash");
      void side.offsetWidth;
      side.classList.add("cheer-flash");
      setTimeout(() => side.classList.remove("cheer-flash"), 450);
    }
    // text/plain 이라 사전 요청(OPTIONS) 없이 간다. 쿨다운 안이면 {"counted": false} — 화면은 응답과 무관하다(결정 4)
    fetch(`${CHEER_API}/cheer`, { method: "POST", headers: { "Content-Type": "text/plain" }, keepalive: true,
      body: JSON.stringify({ sido: us, event: +evNo() }) })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && j.counted === true && S.cheer) { S.cheer.counts[us] = (S.cheer.counts[us] || 0) + 1; paintCheer(); } })
      .catch(() => {});
  }

  // ── 다시 보기: 시점 목록, 결과, 성적표 (docs/DASHBOARD.md §10) ──────────
  function points() { return (S.replayIndex && S.replayIndex.points) || []; }
  function curPoint() { return points().find(p => S.snapshotPath && S.snapshotPath.endsWith(p.file)) || null; }
  function isFinalPoint() {
    const pts = points(), p = curPoint();
    if (!p) return false;
    return pts.some(x => x.final) ? !!p.final : p === pts[pts.length - 1];
  }
  function bundleFile(name) {
    return name && /^[\w\-.]+\.json$/.test(name) && !name.includes("..") ? S.snapshotPath.replace(/[^/]*$/, "") + name : null;
  }
  function showReveal() { return !!(S.reveal && S.outcomes && !isFinalPoint()); }

  async function loadExtras() {
    const idx = S.replayIndex;
    if (!S.snapshotPath || !idx) return;
    const jobs = [];
    const oc = bundleFile(idx.outcomes), sc = bundleFile(idx.scorecard);
    if (S.reveal && oc && !S.outcomes && !isFinalPoint()) {
      jobs.push(getJSON(oc, false).then(v => { if (v.schema_version === SCHEMA) S.outcomes = v; }));
    }
    if (sc && !S.scorecard && isFinalPoint()) {
      jobs.push(getJSON(sc, false).then(v => { if (v.schema_version === SCHEMA) S.scorecard = v; }));
    }
    if (!jobs.length) return;
    await Promise.allSettled(jobs);
    // 성적표는 레이스 탭에만 나온다. 다시 그리면 막 시작한 트랙 움직임이 끊기므로 자리 표시에만 끼운다
    if (jobs.length === 1 && !S.reveal) {
      const slot = document.getElementById("score-slot");
      if (slot && S.tab === "race") slot.outerHTML = scorecardCard();
      return;
    }
    render();
  }

  function medalRanks(sidos) {
    const ks = Object.keys(sidos).sort((a, b) => {
      const x = sidos[a].medals, y = sidos[b].medals;
      return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
    });
    const out = {};
    ks.forEach((k, i) => { out[k] = i + 1; });
    return out;
  }

  // engine.scorecard.target_achieved 와 같은 규칙. 판정할 수 없으면 null
  function achieved(key, us, prevPoints) {
    const f = S.outcomes && S.outcomes.sidos[us];
    if (!f) return null;
    const r = f.rank, p = f.points;
    if (key === "rank1") return r <= 1;
    if (/^top\d+$/.test(key)) return r <= +key.slice(3);
    if (/^rank_le_\d+$/.test(key)) return r <= +key.split("_").pop();
    if (key === "medal_rank1" || key === "medal_top3") {
      const mr = medalRanks(S.outcomes.sidos)[us];
      return mr <= (key === "medal_rank1" ? 1 : 3);
    }
    if (!prevPoints) return null;
    if (/^points_x/.test(key)) return p >= prevPoints * parseFloat(key.slice(8));
    if (key === "beat_prev_points") return p > prevPoints;
    return null;
  }

  function officialNote() { return S.outcomes && S.outcomes.official === false ? " <small>(공식 확정 전)</small>" : ""; }

  function matchOutcome(m) {
    if (!showReveal()) return "";
    const o = S.outcomes.matches[m.match_key];
    if (o) return `<p class="reveal">실제: ${esc(F.josa(o.winner, "이", "가"))} 이겼습니다</p>`;
    const ev = m.record && m.event_id && S.outcomes.events[m.event_id];
    if (ev) {
      const parts = ["금", "은", "동"].filter(k => ev[k]).map(k => `${k} ${ev[k].map(esc).join("·")}`);
      return `<p class="reveal">실제: ${parts.join(" / ")}</p>`;
    }
    return "";
  }

  // ── 머리 · 상태 띠 ────────────────────────────────────────────────────
  function renderHeader() {
    const ev = S.snap && S.snap.event;
    document.getElementById("event-name").textContent = ev ? ev.name : "전국체육대회";
    const sel = document.getElementById("sido-select");
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">지역 선택</option>' + SIDOS.map(s => `<option>${esc(s)}</option>`).join("");
    }
    sel.value = S.sido || "";
    const asof = document.getElementById("asof");
    const t = S.snap && F.parseTime(S.snap.data_as_of);
    if (t) {
      const sameDay = F.dayKey(t) === F.dayKey(new Date());
      asof.textContent = "자료 " + (sameDay && !S.snapshotPath ? F.hm(t) : F.mdhm(t)) + " 기준";
    } else {
      asof.textContent = "";
    }
    const pre = document.getElementById("pre-label");
    pre.hidden = !(S.snap && S.snap.completed_events === 0);
    const fb = document.getElementById("fav-btn");
    if (fb) {
      fb.hidden = !S.sido;
      fb.textContent = S.fav.length ? "관심 종목 · " + favShort(" ") : "관심 종목 고르기";
      fb.setAttribute("aria-expanded", String(S.onboard));
    }
  }

  function loadReason() {
    // 원인을 짧게 덧붙인다(없는 파일 404, 깨진 자료 등). 관람객에게도 해가 없는 정도만.
    const e = S.loadError;
    if (!e) return "";
    const m = /\s(\d{3})$/.exec(e.message || "");
    if (m) return ` <small>(자료 파일 응답 ${esc(m[1])})</small>`;
    if (e instanceof SyntaxError) return " <small>(자료 파일 형식 오류)</small>";
    return "";
  }

  function renderBand() {
    const band = document.getElementById("band");
    const msgs = [];
    const s = S.snap;
    const t = s && F.parseTime(s.data_as_of);
    if (S.snapshotPath) {
      const r = (s && s.replay) || {};
      let nav = "";
      const pts = points();
      const cur = pts.findIndex(p => S.snapshotPath.endsWith(p.file));
      const href = p => {
        // 시점을 옮기면 결과 공개는 꺼진다: 다음 장면도 "전망 먼저"
        const u = new URL(location.href);
        u.searchParams.set("snapshot", S.snapshotPath.replace(/[^/]*$/, "") + p.file);
        u.searchParams.delete("reveal");
        return esc(u.pathname + u.search + u.hash);
      };
      const link = (p, txt) => `<a href="${href(p)}">${esc(txt)}</a>`;
      if (cur > 0) nav += link(pts[cur - 1], "◂ " + pts[cur - 1].label);
      if (cur >= 0 && cur < pts.length - 1) nav += link(pts[cur + 1], pts[cur + 1].label + " ▸");
      const live = new URL(location.href);
      live.searchParams.delete("snapshot");
      live.searchParams.delete("reveal");
      nav += `<a href="${esc(live.pathname + live.search + live.hash)}">실시간 보기</a>`;
      let chips = "";
      if (pts.length > 1) {
        chips = `<nav class="rp-chips" aria-label="시점">` + pts.map((p, i) => i === cur
          ? `<span class="rp-chip on" aria-current="true">${esc(p.label)}</span>`
          : `<a class="rp-chip" href="${href(p)}">${esc(p.label)}</a>`).join("") + `</nav>`;
      }
      const idx = S.replayIndex || {};
      const reveal = idx.outcomes && cur >= 0 && !isFinalPoint()
        ? `<button class="rp-reveal" data-reveal="1" aria-pressed="${S.reveal}">${S.reveal ? "결과 숨기기" : "결과 공개"}</button>` : "";
      const p = pts[cur];
      let proof = "";
      if (p && p.source === "archive") {
        proof = "보관 스냅샷에서 뒤에 뽑은 시점입니다.";
      } else if (p && p.stamped_at) {
        const st = F.parseTime(p.stamped_at);
        const pr = p.proof || {};
        const url = [pr.record_url, pr.wayback_url].find(x => typeof x === "string" && /^https:\/\//.test(x));
        proof = `이 전망은 ${esc(st ? F.mdhm(st) : p.stamped_at)}에 공개됐습니다`
          + (url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">기록 확인</a>` : "") + ".";
      } else if (p) {
        proof = "지난 결과를 가리고 다시 계산한 전망입니다.";
      }
      msgs.push(["replay", `다시 보기(리플레이): ${esc(r.label || (s ? s.event.name : "과거 대회"))} 시점. 실시간 자료가 아닙니다.`
        + chips + `<span class="band-nav">${nav}${reveal}</span>`
        + (proof ? `<span class="rp-proof">${proof}</span>` : "")]);
    }
    if (S.schemaError) {
      msgs.push(["stop", S.schemaError === "newer"
        ? "자료 형식이 바뀌었습니다. 화면을 새로 고쳐 주세요."
        : "자료 파일이 이 화면보다 예전 형식이라 표시할 수 없습니다. 자료를 다시 만들면 표시됩니다."]);
    } else if (!s && S.loadError) {
      msgs.push(["stop", location.protocol === "file:"
        ? "전망 자료를 받지 못했습니다. 파일을 직접 열면 브라우저가 자료를 읽지 못합니다. "
          + "site 폴더에서 <code>python -m http.server</code> 를 실행한 뒤 <code>http://localhost:8000</code> 으로 여세요."
        : "전망 자료를 받지 못했습니다. 잠시 후 다시 시도합니다." + loadReason()]);
    } else if (s && S.loadError) {
      msgs.push(["late", `새 자료를 받지 못했습니다. ${t ? esc(F.mdhm(t)) + " 기준 " : ""}전망을 계속 표시합니다.`]);
    }
    if (s && !S.snapshotPath && !S.loadError) {
      const f = F.freshness(s.data_as_of, new Date());
      if (f === "late") msgs.push(["late", `자료 갱신이 지연되고 있습니다(마지막 ${esc(F.hm(t))}).`]);
      if (f === "stopped") msgs.push(["stop", `수집이 멈춰 있습니다. 표시된 전망은 ${esc(F.mdhm(t))} 기준입니다.`]);
    }
    band.innerHTML = msgs.map(([k, m]) => `<div class="band band-${k}" role="status">${m}</div>`).join("");
  }

  function renderTabs() {
    document.getElementById("tabs").innerHTML = TABS.map(([k, label]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}" class="tab${S.tab === k ? " on" : ""}">${label}</button>`
    ).join("");
  }

  // ── 조각 ──────────────────────────────────────────────────────────────
  function probBar(p, label) {
    const w = Math.max(0, Math.min(1, p || 0)) * 100;
    return `<div class="pbar" role="img" aria-label="${esc(label || "")} ${esc(F.pct(p))}">`
      + `<div class="pbar-fill" style="width:${w.toFixed(1)}%"></div></div>`
      + `<div class="pbar-axis"><span>0</span><span>50</span><span>100</span></div>`;
  }

  function rankChart(probs, title) {
    const n = probs.length;
    const W = 340, H = 118, top = 16, base = 96, bw = W / n;
    const mx = Math.max(...probs, 0.01);
    const k = argmax(probs);
    let bars = "";
    for (let i = 0; i < n; i++) {
      const h = Math.max(probs[i] > 0 ? 2 : 0, (probs[i] / mx) * (base - top));
      const x = i * bw + 2;
      bars += `<g><title>${i + 1}위: ${esc(F.pct(probs[i]))}</title>`
        + `<rect class="hit" x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}"></rect>`
        + (h > 0 ? `<rect class="${i === k ? "bar-on" : "bar"}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" `
          + `width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>` : "")
        + `<text class="axis${i === k ? " axis-on" : ""}" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${i + 1}</text></g>`;
    }
    const lx = Math.min(Math.max(k * bw + bw / 2, 16), W - 16);
    const ly = base - (probs[k] / mx) * (base - top) - 4;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`
      + `<line class="baseline" x1="0" x2="${W}" y1="${base}" y2="${base}"></line>${bars}`
      + `<text class="val" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(F.pct(probs[k]))}</text></svg>`;
  }

  function sparkline(pts, opts) {
    // pts: [{t: Date, v: number}], 확률이면 opts.prob = true (0~1 고정 축)
    const W = 300, H = 64, pad = 6;
    if (pts.length < 2) return "";
    const t0 = pts[0].t.getTime(), t1 = pts[pts.length - 1].t.getTime();
    let lo = opts.prob ? 0 : Math.min(...pts.map(p => p.v)), hi = opts.prob ? 1 : Math.max(...pts.map(p => p.v));
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const X = t => pad + (W - 2 * pad) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1);
    const Y = v => H - pad - (H - 2 * pad) * (v - lo) / (hi - lo);
    const d = pts.map((p, i) => (i ? "L" : "M") + X(p.t.getTime()).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    const dots = pts.map(p => `<circle class="hit-dot" cx="${X(p.t.getTime()).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="8">`
      + `<title>${esc(F.mdhm(p.t))} · ${esc(opts.fmt(p.v))}</title></circle>`).join("");
    const grid = opts.prob ? `<line class="grid" x1="${pad}" x2="${W - pad}" y1="${Y(0.5).toFixed(1)}" y2="${Y(0.5).toFixed(1)}"></line>` : "";
    // 선 양 끝 값(§11-6, L4). 이웃 점에서 들어오는 선의 반대쪽(선이 위에서 내려오면 아래)에 적고,
    // 거의 평평하면 위에(자리가 없으면 아래에) 적어 선·끝점과 겹치지 않게 한다
    const endLabel = (p, nb, x, anchor) => {
      const y = Y(p.v), dy = Y(nb.v) - y;
      const above = (Math.abs(dy) < 2 || dy > 0) ? y - 9 >= 10 : y + 17 > H + 12;
      return `<text class="ends" x="${x}" y="${(above ? y - 9 : y + 17).toFixed(1)}" text-anchor="${anchor}">${esc(opts.fmt(p.v))}</text>`;
    };
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">${grid}`
      + `<path class="line" d="${d}"></path>`
      + `<circle class="end" cx="${X(t1).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4"></circle>`
      + endLabel(pts[0], pts[1], 0, "start") + endLabel(last, pts[pts.length - 2], W, "end") + `${dots}</svg>`;
  }

  function matchByKey(key) {
    if (!S._mk || S._mkSnap !== S.snap) {
      S._mk = new Map((S.snap.matches || []).map(m => [m.match_key, m]));
      S._mkSnap = S.snap;
    }
    return S._mk.get(key);
  }

  function finished(m) { return m.status === "종료" || !!(S.snap.results_recent && S.snap.results_recent[m.match_key]); }

  // 경기 중: 시각이 있고 시작 ≤ 지금 ≤ 끝 + 1시간(연장 여유), 결과가 아직 없음. 오늘 탭 머리와 카드 표시가 같은 규칙을 쓴다
  function liveMatch(m, now) {
    const sc = sched(m);
    return !!(sc && sc.timed && sc.start <= now && now <= sc.end.getTime() + 3600e3 && !finished(m));
  }

  function statusLabel(m, now) {
    if (finished(m)) return ["done", "종료"];
    return liveMatch(m, now) ? ["live", "경기 중"] : ["", ""];
  }

  function timeLabel(m) {
    const sc = sched(m);
    if (!sc) return m.scheduled_at || "";
    return F.dayLabel(sc.day) + (sc.timed ? " " + F.hm(sc.start) + (m.scheduled_at.includes("~") ? "~" + F.hm(sc.end) : "") : "");
  }

  // 이유 줄의 재료(§12-2). 스냅샷·지역마다 한 번 만든다. 기본 목표 기준(영향도 자체가 기본 목표 기준, §8)
  function whyCtx(us) {
    if (S._wcSnap !== S.snap) { S._wc = {}; S._wcSnap = S.snap; }
    if (!(us in S._wc)) S._wc[us] = F.impactCtx(S.snap, us);
    return S._wc[us];
  }

  function whyLine(m, us, b) {
    const o = (m.sides || []).find(sd => sd !== b.side);
    // §12-8: stake 는 우리 쪽 값(_impactCase 가 뒤집으면 b.side 는 상대다)
    const mine = (m.sides || []).find(sd => sd.sido === us);
    const t = F.impactWhy(us, b.side.sido, !m.record && o ? o.sido : null, usMove(m, us, b).delta, whyCtx(us), !!m.record, mine && mine.stake);
    return t ? `<small class="why">${esc(t)}</small>` : "";
  }

  function usImpact(m, us) {
    // 우리 목표에 영향이 가장 큰 쪽과 그 영향. 우리 지역이 뛰는 경기는 우리 쪽 기준으로 말한다.
    const own = (m.sides || []).find(sd => sd.sido === us && sd.impact && sd.impact[us]);
    if (own && !m.record) return { side: own, v: own.impact[us] };
    let best = null;
    for (const sd of m.sides || []) {
      const v = sd.impact && sd.impact[us];
      if (v && (!best || v.swing > best.v.swing)) best = { side: sd, v };
    }
    return best;
  }

  // 영향 문장에 넣을 숫자: 지금(기본 목표) 대비 화면 정수 차(DASHBOARD §13-2). 엔진 delta(이기면 − 지면)는 숫자로 내지 않는다
  function usMove(m, us, b) {
    const o = (m.sides || []).find(sd => sd !== b.side), t = S.snap.sidos[us] && S.snap.sidos[us].target;
    return F.impactMove(us, b.side.sido, !m.record && o ? o.sido : null, b.v, t ? t.prob : null, !!m.record);
  }

  // ── 한 줄 경기 카드(설계 14 X3): 시각 · 종목 · 놓치면 아쉬운 경기 지수 / 승률 · 점수 우선 영향. 누르면 펼쳐 결론·이유 줄·경기장·캘린더 ──
  // 우리 쪽 "이기면 지금보다 n점": (1−p)·stake(유효숫자 2자리, §12-8 반올림). 지금 대비 숫자라 헤드라인·만약에와 같은 셈(§15-3)
  function gainOf(m, us) {
    const mine = !m.record && !m.light && (m.sides || []).find(sd => sd.sido === us);
    return mine && !mine.settled && typeof mine.stake === "number" ? F.stakeText((1 - mine.p_win) * mine.stake) : null;
  }

  // 결론 줄의 점수 우선: "우리 지역이 이기면 목표 확률 +5%p" → "우리 지역이 이기면 +330점 (목표 확률 +5%p)"
  function pointsFirst(t, m, us) {
    const g = us && gainOf(m, us);
    return g ? t.replace(/^우리 지역이 이기면 목표 확률 ([+−]\d+%p)/, `우리 지역이 이기면 +${g}점 (목표 확률 $1)`) : t;
  }

  // 놓치면 아쉬운 경기 지수의 크기 항(R8): 우리 쪽 (1−p)·stake(승패 경기) / 그날 최대, 없으면 우리 영향 |Δ%p| / 그날 최대. importance(전국 중요도)는 쓰지 않는다
  const HEAT_GAIN_REF = 300, HEAT_PP_REF = 5;     // 놓치면 아쉬운 경기 지수 크기 항의 고정 기준(점, %p, R10)
  function heatGain(m, us) {
    const mine = !m.record && !m.light && (m.sides || []).find(sd => sd.sido === us);
    return mine && !mine.settled && typeof mine.stake === "number" ? (1 - mine.p_win) * mine.stake : null;
  }
  function heatOf(m, us) {
    const sc = sched(m), day = sc ? sc.day : 0, key = (us || "") + "|" + day;
    if (S._hcSnap !== S.snap) { S._hc = {}; S._hcSnap = S.snap; }
    const hasUs = us && S.snap.sidos[us];
    if (!S._hc[key]) {
      let maxGain = 0, maxPp = 0;
      if (hasUs) for (const x of allMatches()) {
        const xs = sched(x);
        if (!xs || xs.day !== day) continue;
        const g = heatGain(x, us);
        if (g !== null) maxGain = Math.max(maxGain, g);
        maxPp = Math.max(maxPp, impactAbs(x, us));
      }
      const rv = hasUs ? rivalOf(us) : null;
      S._hc[key] = { us, rival: rv && !rv.prev ? rv.key : null, maxGain, maxPp };
    }
    const h = S._hc[key], g = hasUs ? heatGain(m, us) : null;
    // R10: 분모 = max(그날 최대, 고정 기준 300점 또는 5%p). 그날 경기가 모두 미지근하면 지수도 낮게 남는다
    const size = g !== null ? Math.min(1, g / Math.max(h.maxGain, HEAT_GAIN_REF)) : hasUs ? Math.min(1, impactAbs(m, us) / Math.max(h.maxPp, HEAT_PP_REF)) : 0;
    return F.heat(m, { us, rival: h.rival, size });
  }

  function heatMarks(h) {
    return `<span class="mr-h" role="img" aria-label="놓치면 아쉬운 경기 ${h.level}/5" title="놓치면 아쉬운 경기 ${h.level}/5">`
      + [1, 2, 3, 4, 5].map(i => `<i${i <= h.level ? ' class="on"' : ""}></i>`).join("") + `</span>`;
  }

  // 승률 칸: 승패 "부산 27% · 서울 74%", 한쪽만 "부산 62% · 상대 미정", 기록 "메달 가능성 광주 90% · 충남 45%"
  function rowProbs(m, us) {
    const lv = liveOf(m);
    if (lv) return liveProbs(lv, us);
    const sides = m.sides || [], nm = sd => `<b${sd.sido === us ? ' class="us"' : ""}>${esc(sd.sido)}</b> ${esc(F.pct(sd.p_win))}`;
    if (!sides.length) return "대진 미정";
    if (m.record) return "메달 가능성 " + sides.slice().sort((a, b) => b.p_win - a.p_win).slice(0, 2).map(nm).join(" · ");
    return sides.length === 2 ? `${nm(sides[0])} · ${nm(sides[1])}` : `${nm(sides[0])} · 상대 미정`;
  }

  // 영향 칸: 우리 경기 "+330점 (+5%p)", 남의 경기 "충북 승 +4%p". 영향도가 없으면 빈칸
  function rowImpact(m, us) {
    if (!us || m.light || !S.snap.sidos[us]) return "";
    const b = usImpact(m, us);
    if (!b || (m.sides || []).every(sd => sd.settled)) return "";
    const o = (m.sides || []).find(sd => sd !== b.side), mv = usMove(m, us, b);
    const r = Math.round(mv.delta * 100), g = gainOf(m, us);
    const own = (m.sides || []).some(sd => sd.sido === us);
    if (own && !m.record) {
      const w = r === 0 ? "" : F.pp(mv.delta);
      if (!g && !w) return mv.lose !== null && Math.round(mv.lose * 100) <= -1 ? `<span class="mr-i down">지면 ${esc(F.pp(mv.lose))}</span>` : "";
      return `<span class="mr-i${r > 0 || g ? " up" : r < 0 ? " down" : ""}">${g ? `+${esc(g)}점` : ""}${g && w ? ` (${esc(w)})` : esc(w)}</span>`;
    }
    if (r === 0) return "";
    if (m.record) return `<span class="mr-i${r > 0 ? " up" : " down"}">${esc(F.sidoLabel(b.side.sido))} 메달 ${esc(F.pp(mv.delta))}</span>`;
    const good = mv.delta > 0 ? b.side.sido : o && o.sido;
    return good ? `<span class="mr-i up">${esc(good === us ? "우리" : good)} 승 ${esc(F.pp(Math.abs(mv.delta)))}</span>` : "";
  }

  function matchRow(m, us, opts) {
    opts = opts || {};
    const sc = sched(m), now = refNow(), [stk, stt] = statusLabel(m, now);
    const key = m.match_key, open = opts.open ? !S.rowClosed.has(key) : S.rowOpen.has(key);
    const tm = sc ? (sc.timed ? F.hm(sc.start) : "") : "";
    const dl = sc && sc.day !== F.dayKey(now) ? `<small class="mr-d">${esc(F.dayLabel(sc.day).replace(/\(.\)$/, ""))}</small>` : "";
    const rest = [F.shortKind(m.kind_nm || ""), F.hw(m.detail_nm || ""), F.hw(m.round_nm || "").replace(/경기\s*\d+$/, "")].filter(Boolean).join(" ");
    const h = heatOf(m, us);
    const ics = !S.snapshotPath && sc ? ` <button class="linkish mr-ics" data-ics-one="${esc(key)}">캘린더에 담기</button>` : "";
    return `<details class="mrow${(m.sides || []).some(sd => sd.sido === us) ? " mine" : ""}${opts.duel ? " duel" : ""}" data-k="${esc(key)}"${open ? " open" : ""}${opts.open ? ' data-default-open="1"' : ""}>`
      + `<summary><span class="mr-t num">${esc(tm || (dl ? "" : "–"))}</span>${stt ? "" : dl}`
      + `<span class="mr-n">${opts.duel ? `<span class="star">★ 맞대결</span> ` : ""}${(peopleByMatch().get(key) || []).slice(0, 2).map(p => `<span class="mr-who">${esc(personLabel(p, true))}</span> `).join("")}<b>${esc(F.hw(m.class_nm))}</b> ${esc(rest)}</span>`
      + heatMarks(h)
      + `<span class="mr-p">${rowProbs(m, us)}</span>${rowImpact(m, us)}`
      + (stt ? `<span class="st st-${stk}">${stt}</span>` : "")
      + `<button class="mr-w${watching(key) ? " on" : ""}" data-watch="${esc(key)}" aria-pressed="${watching(key)}" aria-label="찜" title="찜">${watching(key) ? "★" : "☆"}</button></summary>`
      + `<div class="mrow-body">${matchCard(m, us, Object.assign({}, opts, { bare: true, compact: true, ics }))}</div></details>`;
  }

  function matchCard(m, us, opts) {
    opts = opts || {};
    const now = refNow();
    const [stk, stt] = statusLabel(m, now);
    const rest = F.hw([m.kind_nm, m.detail_nm, m.round_nm].filter(Boolean).join(" · "));   // "예선경기６" → 6 (해설 hw 와 같게, §11-14 M4)
    const sub = [timeLabel(m), m.venue].filter(Boolean).join(" · ");
    const sides = m.sides || [];
    let body = "";
    const target = us && S.snap.sidos[us] ? S.snap.sidos[us].target : null;
    const settled = sides.length && sides.every(sd => sd.settled);
    if (opts.bare) {
      // 한 줄 카드를 펼친 안: 승률은 요약 줄에 있다(X3). 수동 입력 경기면 경기 전 승률과 설명층 한 줄(Y7)
      const lv = liveOf(m);
      // p_pre 가 null(경기 전 승률을 모름, M1-R2)이면 "경기 전" 줄은 뺀다(0.5 를 50% 로 보이면 모델 산출로 오해된다)
      if (lv) body += (typeof lv.p_pre === "number" ? `<p class="lv-pre">경기 전 ${esc(lv.sides[0])} ${esc(F.pct(lv.p_pre))}</p>` : "")
        + `<p class="note lv-note">운영자가 중계를 보며 입력한 세트 점수입니다. 공식 기록이 아니며 전망 계산에는 들어가지 않습니다.</p>`;
    } else if (!m.record && sides.length === 2) {
      const [a, b] = sides;
      body += `<div class="duel">` + [a, b].map((sd, i) => `<div class="side${i ? " r" : ""}${sd.sido === us ? " us" : ""}">`
        + `<b>${esc(sd.sido)}</b><span class="num">${esc(F.pct(sd.p_win))}</span></div>`).join("") + `</div>`
        + `<div class="dbar${b.sido === us ? " us-r" : ""}" role="img" aria-label="${esc(a.sido)} 승리 확률 ${esc(F.pct(a.p_win))}">`
        + `<div class="dbar-a${a.sido === us ? " us" : ""}" style="width:${(a.p_win * 100).toFixed(1)}%"></div></div>`;
    } else if (!m.record && sides.length === 1) {
      // 토너먼트에서 한쪽 대진만 정해진 경기(상대는 앞 경기 결과를 기다리는 중)
      body += `<p class="medal-line">${esc(sides[0].sido)} 이길 확률 ${esc(F.pct(sides[0].p_win))} · 상대 미정</p>`;
    } else if (sides.length) {
      const top = sides.slice().sort((x, y) => y.p_win - x.p_win).slice(0, 3);
      body += `<p class="medal-line">메달 가능성: ${top.map(sd => `${esc(sd.sido)} ${esc(F.pct(sd.p_win))}`).join(" · ")}</p>`;
    }
    if (us && target && !opts.noImpact && m.light) {
      // day_matches 의 가벼운 항목: 영향도를 계산해 싣지 않은 경기(중요도 상위 밖)
      body += `<p class="imp imp-flat">영향이 큰 경기가 아니어서 영향도를 따로 싣지 않았습니다</p>`;
    } else if (us && target && !opts.noImpact) {
      const best = usImpact(m, us);
      if (settled) {
        body += `<p class="imp imp-flat">결과 거의 확정</p>`;
      } else if (best) {
        const v = best.v;
        // 승패 경기 문장은 늘 '우리에게 유리한 쪽'을 말하므로 유리 표시. 우리가 이겨도 손해인 드문 경우만 불리.
        const good = best.side.sido === us && v.delta < 0 ? "bad" : "good";
        if (!m.record) {
          const other = sides.find(sd => sd !== best.side);
          const own = best.side.sido === us;
          // 지금 목표 확률 대비 변화. 색은 보조이고 ▲▼ 와 글자가 뜻을 말한다
          // 변화량은 화면에 보이는 정수끼리 뺀다(76% → 69% 면 −7%p). 반올림 전 값으로 빼면 눈으로 한 셈과 어긋난다
          const shown = x => bigParts(x).n;
          const chg = x => { const d = shown(x) - shown(target.prob);
            return d === 0 ? `<em>변화 거의 없음</em>`
              : `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${esc(F.pp(d / 100))}</em>`; };
          const l1 = own ? "이기면 목표 확률" : `${esc(best.side.sido)} 승이면`;
          const l2 = own ? "지면" : `${esc(other ? other.sido : "상대")} 승이면`;
          if (opts.bare && opts.noFork) { /* 뜨거운 경기: 결론·이유 줄만(첫 화면 높이) */ }
          else if (opts.bare) body += `<p class="sub fork-line">우리(${esc(us)}) ${esc(target.label)} 지금 ${esc(F.pct(target.prob))} → ${l1} ${esc(F.pct(v.if_win))} ${chg(v.if_win)} · ${l2} ${esc(F.pct(v.if_lose))} ${chg(v.if_lose)}</p>`;
          else body += `<p class="sub">우리(${esc(us)}) ${esc(target.label)} · 지금 ${esc(F.pct(target.prob))}</p>`
            + `<div class="fork"><div><small>${l1}</small><span class="num">${esc(F.pct(v.if_win))}</span>${chg(v.if_win)}</div>`
            + `<div><small>${l2}</small><span class="num">${esc(F.pct(v.if_lose))}</span>${chg(v.if_lose)}</div></div>`;
          body += `<p class="imp imp-${good}">${esc(pointsFirst(F.impactSentence(us, best.side.sido, other && other.sido, usMove(m, us, best).delta, usMove(m, us, best).lose), m, us))}</p>` + whyLine(m, us, best);
        } else {
          body += `<p class="imp imp-${v.delta >= 0 ? "good" : "bad"}">${esc(F.recordSentence(us, best.side.sido, usMove(m, us, best).delta))}</p>` + whyLine(m, us, best);
        }
      } else if (!opts.compact) {
        body += `<p class="imp imp-flat">우리 목표에는 영향이 작습니다</p>`;
      }
    }
    if (m.evidence !== undefined && m.evidence < 3) body += `<p class="flag">⚑ 과거 자료 부족: 보수적 추정</p>`;
    body += matchOutcome(m);
    return `<article class="match${opts.compact ? " compact" : ""}${opts.bare ? " bare" : ""}${m.record ? " rec" : ""}">`
      + (opts.bare ? "" : `<h4><b>${esc(F.hw(m.class_nm))}</b>${esc(rest)}</h4><p class="sub">${esc(sub)}${stt ? ` <span class="st st-${stk}">${stt}</span>` : ""}</p>`)
      + body + (opts.bare ? `<p class="sub mr-venue">${esc(sub)}${opts.ics || ""}</p>` : "") + `</article>`;
  }

  function watchFallback(w) {
    // 경기 목록에 없는 watch 항목(축약본 밖)도 카드로 보여준다
    return { match_key: w.match_key, class_nm: w.class_nm, kind_nm: w.kind_nm, detail_nm: w.detail_nm,
      round_nm: w.round_nm, scheduled_at: w.scheduled_at, status: w.status, record: false,
      sides: [{ sido: w.side, p_win: w.p_win, impact: {} }] };
  }

  function card(title, inner, cls) {
    return `<section class="card${cls ? " " + cls : ""}">${title ? `<h3>${title}</h3>` : ""}${inner}</section>`;
  }

  function empty(msg) { return `<p class="empty">${msg}</p>`; }

  function confirmedNote(s) {
    // 확정 득점의 출처: 공식 집계(공인 기준 시각) 또는 엔진 추정
    const a = s.anchor;
    if (a) {
      const t = F.parseTime(a.official_as_of);
      // 공인된 뒤 끝난 세부종목은 엔진 추정을 더한 값이라 그 수를 출처 줄에 적는다(10-08 예행 R1)
      const extra = (s.completed_events || 0) - (a.certified_events || 0);
      if (extra > 0) return "공식 집계" + (t ? " " + esc(F.mdhm(t)) : "") + " + 그 뒤 " + esc(F.num(extra)) + "개 추정";
      return "공식 집계" + (t ? " · " + esc(F.mdhm(t)) + " 확인" : "");
    }
    return s.completed_events ? "끝난 경기로 계산한 추정" : "";
  }

  // ── 응원 프로필 (docs/ENGAGEMENT.md §3, A) ──────────────────────────────
  // 관심 종목은 주소(&fav=)가 이기고, 열면 이 기기에 저장한다. 서버에는 아무것도 보내지 않는다
  function readFav() {
    const u = q.get("fav");
    if (u !== null) {
      // 쉼표로 나누되 괄호 안 쉼표는 이름의 일부("수영(경영,다이빙)")
      const a = u.split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean).slice(0, FAV_MAX);
      store(FAV_KEY, JSON.stringify(a));
      return [a, true];
    }
    const s = store(FAV_KEY);
    if (s === null) return [[], false];
    try {
      const a = JSON.parse(s);
      return [Array.isArray(a) ? a.filter(x => typeof x === "string").slice(0, FAV_MAX) : [], true];
    } catch (e) { return [[], false]; }
  }

  // 좁은 자리(머리 단추·카드 제목)의 관심 종목: 셋까지 이름, 넘치면 "외 n"(Y2)
  function favShort(sep) {
    return S.fav.length > 3 ? S.fav.slice(0, 3).join(sep) + ` 외 ${S.fav.length - 3}` : S.fav.join(sep);
  }

  function setFav(a) {
    S.fav = a.slice(0, FAV_MAX);
    S.favSet = true;
    store(FAV_KEY, JSON.stringify(S.fav));
    setParam("fav", S.fav.length ? S.fav.join(",") : null);
  }

  // 다음 경기일의 나머지 경기(영향도 없음, 엔진 pipeline.day_matches)를 경기 카드 꼴로
  function lightMatches() {
    const dm = S.snap && S.snap.day_matches;
    if (!dm || !Array.isArray(dm.items)) return [];
    if (S._lm && S._lmSnap === S.snap) return S._lm;
    S._lm = dm.items.map(x => ({ match_key: x.k, class_nm: x.c, kind_nm: x.kn, detail_nm: x.d, round_nm: x.r,
      scheduled_at: x.t, venue: x.v, status: "미종료", record: !!x.rec, light: true, importance: 0,
      sides: (x.sd || []).map(([sido, p]) => ({ sido, p_win: p })) }));
    S._lmSnap = S.snap;
    return S._lm;
  }

  function allMatches() { return (S.snap.matches || []).concat(lightMatches()); }

  function classNames() {
    const n = new Map();
    for (const c of S.snap.class_names || []) n.set(c, 0);
    for (const m of allMatches()) if (m.class_nm) n.set(m.class_nm, (n.get(m.class_nm) || 0) + 1);
    for (const f of S.fav) if (!n.has(f)) n.set(f, 0);
    return [...n.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function matchName(m) {
    return F.hw([m.class_nm, m.kind_nm, m.detail_nm, m.round_nm].filter(Boolean).join(" "));
  }

  // 처음 지역을 고르면 종목을 묻는다(건너뛸 수 있다). 상단 "관심 종목" 단추로 다시 연다
  function favCard() {
    const names = classNames(), draft = S.favDraft || S.fav.slice();
    const chips = names.map(nm => {
      const on = draft.includes(nm);
      return `<button class="chip${on ? " on" : ""}" data-fav="${esc(nm)}" aria-pressed="${on}"`
        + `${!on && draft.length >= FAV_MAX ? " disabled" : ""}>${esc(nm)}</button>`;
    }).join("");
    return card(`좋아하는 종목이 있나요? <small>최대 ${FAV_MAX}개 · <span class="fav-n">${draft.length}/${FAV_MAX}</span></small>`,
      `<p class="note">고른 종목의 경기를 "나의 경기"로 모아 시간순으로 보여 드립니다. 고르지 않아도 됩니다.</p>`
      + (chips ? `<div class="chips fav-chips" role="group" aria-label="관심 종목">${chips}</div>` : empty("종목 목록을 아직 받지 못했습니다."))
      + `<div class="btn-row"><button class="act-btn primary" data-fav-done="save">${draft.length ? "이 종목으로 보기" : "종목 없이 보기"}</button>`
      + `<button class="act-btn" data-fav-done="${S.favSet ? "close" : "skip"}">${S.favSet ? "닫기" : "건너뛰기"}</button></div>`
      + (S.people ? peopleSearch() : `<p class="note">선택은 이 기기에만 저장됩니다. 선수·학교를 고르는 기능은 다음 단계로 준비하고 있습니다.</p>`), "c-wide c-fav");
  }

  // 처음 지역을 고른 사람에게 목표 아래 한 줄로 묻는다. 누르면 그 자리에 종목 고르기 카드가 펼쳐진다
  function favBar() {
    if (!S.favAsk || S.favSet) return "";
    return `<section class="card c-wide c-favbar" aria-label="관심 종목"><p>좋아하는 종목을 고르면 그날 "나의 경기"가 생깁니다</p>`
      + `<div class="btn-row"><button class="act-btn primary" data-fav-open="1">종목 고르기</button>`
      + `<button class="act-btn" data-fav-done="skip">괜찮아요</button></div></section>`;
  }

  // ── 나의 경기 (B): 관심 종목 경기 + 우리 지역이 뛰는 경기 중 영향이 큰 셋, 시간순 ──
  function myDay() {
    const d = filters(allMatches(), refNow()).find(f => f[0] === "d1");
    return d ? { day: d[2], label: d[1] } : null;
  }

  // 오늘 다음의 경기일(저녁 결산의 "내일 나의 경기", §6-2)
  function nextDay() {
    const now = refNow(), today = F.dayKey(now), tomorrow = F.dayKey(new Date(now.getTime() + 864e5));
    const d = matchDays(allMatches().filter(m => m.status !== "종료")).find(x => x > today);
    return d === undefined ? null : { day: d, label: d === tomorrow ? "내일" : F.dayLabel(d) };
  }

  function myDayList(us, day) {
    const fav = new Set(S.fav);
    const all = allMatches().filter(m => { const sc = sched(m); return sc && sc.day === day && m.status !== "종료"; });
    const ours = all.filter(m => !m.light && (m.sides || []).some(sd => sd.sido === us))
      .map(m => [usImpact(m, us), m]).filter(x => x[0]).sort((a, b) => b[0].v.swing - a[0].v.swing).slice(0, 3).map(x => x[1]);
    const rank = m => (ours.includes(m) ? 0 : 4) + ((m.sides || []).some(sd => sd.sido === us) ? 0 : 2) + (m.light ? 1 : 0);
    const favs = all.filter(m => fav.has(m.class_nm) && !ours.includes(m))
      .sort((a, b) => rank(a) - rank(b) || (b.importance || 0) - (a.importance || 0));
    const total = favs.length;
    // 찜 ★(X4)는 늘 먼저, 상한과 무관하게 모두 싣는다
    const pk = peopleByMatch();
    const stars = all.filter(m => watching(m.match_key) || pk.has(m.match_key));
    const rest = ours.concat(favs).filter(m => !watching(m.match_key)).slice(0, Math.max(0, MYDAY_MAX - stars.length));
    // 시각이 있으면 시간순. 역대 일정처럼 시각이 없으면 우리 지역 경기(영향 큰 순) → 관심 종목 그대로 둔다(ENGAGEMENT §9 R9)
    const byTime = l => { if (l.every(m => sched(m).timed)) l.sort((a, b) => sched(a).start - sched(b).start || (b.importance || 0) - (a.importance || 0)); return l; };
    const list = byTime(stars).concat(byTime(rest));
    return { list, ours, stars, favTotal: total, favShown: list.filter(m => fav.has(m.class_nm)).length };
  }

  function myLine(m, us) {
    const sides = m.sides || [], mine = sides.find(sd => sd.sido === us);
    if (!m.light) {
      const b = usImpact(m, us);
      if (b && m.record) return F.recordSentence(us, b.side.sido, usMove(m, us, b).delta);
      if (b) { const o = sides.find(sd => sd !== b.side), mv = usMove(m, us, b); return F.impactSentence(us, b.side.sido, o && o.sido, mv.delta, mv.lose); }
    }
    if (mine) return m.record ? `우리 지역 메달권 확률 ${F.pct(mine.p_win)}` : `우리 지역 출전 · 이길 확률 ${F.pct(mine.p_win)}`;
    if (m.record) return "";
    if (sides.length === 2) return `${sides[0].sido} 대 ${sides[1].sido}`;
    return sides.length === 1 ? `${sides[0].sido} 대 상대 미정` : "대진 미정";
  }

  function myRow(m, us) {
    return `<li class="my-row mr-li${S.fav.includes(m.class_nm) ? " fav" : ""}">${matchRow(m, us)}</li>`;
  }

  // ENGAGEMENT §10 L1(R14): 그날 목록이 비면 목록이 생기는 가장 가까운 경기일(찜한 경기·응원 선수 경기 포함)로 넘긴다
  function myDayAhead(us, d) {
    if (myDayList(us, d.day).list.length) return null;
    const tomorrow = F.dayKey(new Date(refNow().getTime() + 864e5));
    const nd = matchDays(allMatches().filter(m => m.status !== "종료")).find(x => x > d.day && myDayList(us, x).list.length);
    return nd === undefined ? null : { day: nd, label: nd === tomorrow ? "내일" : F.dayLabel(nd) };
  }

  function myDayCard(us, d) {
    let ahead = null;
    if (!d) { d = myDay(); if (d) { ahead = myDayAhead(us, d); if (ahead) d = ahead; } }
    if (!d) return card("나의 경기", empty("남은 경기가 없습니다."), "c-myday");
    const { list, favTotal, favShown, stars } = myDayList(us, d.day);
    const title = `${esc(d.label)} 나의 경기${stars.length ? ` · 찜 ${stars.length}` : ""} <small>${esc(favShort(" · "))}</small>`;
    let h = list.length ? `<ol class="myday">${list.map(m => myRow(m, us)).join("")}</ol>`
      : empty(S.fav.length ? "이날은 관심 종목 경기도, 우리 지역에 영향이 큰 경기도 없습니다." : "이날은 우리 지역에 영향이 큰 경기가 없습니다.");
    if (ahead) h = `<p class="note">오늘은 관심 종목·우리 지역 경기가 없어 가장 가까운 날을 보여 드립니다.</p>` + h;
    if (list.length && !stars.length) h += `<p class="note">경기 줄의 ☆ 을 누르면 "찜한 경기"로 맨 위에 모입니다(이 기기에만).</p>`;
    // R9(ENGAGEMENT §10 L2 회귀): 목록이 비면 둘째 안내를 내지 않는다
    if (list.length && S.fav.length && !favTotal) h += `<p class="note">이날 관심 종목 경기가 없어 우리 지역 경기만 보여 드립니다.</p>`;
    else if (favTotal > favShown) h += `<p class="note">관심 종목 경기 ${esc(F.num(favTotal))}개 중 우리 지역 경기를 먼저 골라 ${esc(F.num(favShown))}개를 보여 드립니다.</p>`;
    const btns = (list.length && !S.snapshotPath ? `<button class="act-btn primary" data-ics="${d.day}">${stars.length ? "찜한 경기를 캘린더에" : "캘린더에 담기"}</button>` : "")
      + (S.fav.length ? `<button class="act-btn" data-goto-fav="1">나의 종목 경기 모두 보기</button>` : "");
    if (btns) h += `<div class="btn-row">${btns}</div>`;
    return card(title, h, "c-myday");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // 캘린더에 담기(C). 경기마다 일정 하나, 설명에 우리 지역 영향과 이 화면 주소
  function saveIcs(day) {
    const us = S.sido, n = nextDay(), d = n && n.day === +day ? n : myDay();
    if (!us || !d) return;
    const link = location.origin + location.pathname + "?sido=" + encodeURIComponent(us);
    const md = myDayList(us, d.day);
    let list = md.stars.length ? md.stars : md.list;
    if (!list.length) list = (S.snap.sidos[us].watch || []).slice(0, 3).map(x => matchByKey(x.match_key)).filter(m => m && sched(m));
    const evs = list.map(m => {
      const sc = sched(m), line = myLine(m, us);
      return { uid: m.match_key + "@chejeon-live", title: "[체전 라이브] " + matchName(m), loc: m.venue || "",
        desc: (line ? line + "\n" : "") + link, start: sc.start, end: sc.end, allDay: !sc.timed, day: sc.day };
    });
    if (!evs.length) return;
    downloadBlob(new Blob([F.ics(evs, new Date())], { type: "text/calendar;charset=utf-8" }), `chejeon-${d.day}.ics`);
  }

  // ── 종목 홈(설계 14 X6): latest.class_summary·class_totals(P1). 없으면 카드·워터폴 모두 없다 ──
  // done 은 최종 풀 척도의 "끝난 세부종목 몫" 이라 레이스 탭 "확정 득점"(points_now)과 다르다 → "확정 득점" 이라 부르지 않는다.
  // 비중 분모 = Σ class_summary[us][*].exp(종목 비중을 모두 더하면 1)
  function classSum(us) {
    const cs = S.snap && S.snap.class_summary;
    return cs && us && cs[us] && typeof cs[us] === "object" ? cs[us] : null;
  }
  function classShares(us) {
    const c = classSum(us);
    if (!c) return {};
    const tot = Object.values(c).reduce((a, x) => a + Math.max(0, x.exp || 0), 0), out = {};
    for (const [k, x] of Object.entries(c)) out[k] = tot > 0 ? Math.max(0, x.exp || 0) / tot : 0;
    return out;
  }

  function classHomeCard(us, cls) {
    const c = classSum(us), x = c && c[cls];
    if (!x) return "";
    const done = Math.round(x.done || 0), exp = Math.round(x.exp || 0), rest = exp - done, sh = classShares(us)[cls] || 0;
    const nm = esc(F.hw(cls));
    const up = x.gap_up ? `위 ${esc(x.gap_up[0])} +${esc(F.num(x.gap_up[1]))}` : "종목 안 1위";
    const dn = x.gap_down ? `아래 ${esc(x.gap_down[0])} −${esc(F.num(x.gap_down[1]))}` : "";
    // 그 종목의 그날(다음 경기일) 경기: ★ 먼저, 우리 지역 경기, 셋까지(X3 한 줄 카드)
    const d = myDay();
    const ms = d ? allMatches().filter(m => m.class_nm === cls && !finished(m) && sched(m) && sched(m).day === d.day)
      .sort((a, b) => watching(b.match_key) - watching(a.match_key) || ((b.sides || []).some(sd => sd.sido === us) - (a.sides || []).some(sd => sd.sido === us))
        || ((sched(a).start - sched(b).start) || 0)).slice(0, 3) : [];
    const tot = (S.snap.class_totals || {})[cls];
    return `<section class="card c-wide c-classhome" aria-label="${nm} 종목 홈"><div class="ch-head"><h3>${nm} <small>${esc(us)}</small></h3>`
      + `<span class="ch-rank">종목 안 <b class="num">${esc(F.num(x.rank))}</b>위</span></div>`
      + `<p class="ch-sum">끝난 세부종목 <b>${esc(F.num(done))}</b>점 + 남은 기대 <b>${esc(F.num(rest))}</b>점 = 예상 <b class="num">${esc(F.num(exp))}</b>점</p>`
      + `<p class="ch-left">우리 남은 세부종목 ${esc(F.num(x.left || 0))}${tot && typeof tot.left === "number" ? ` <small>(종목 전체 ${esc(F.num(tot.left))})</small>` : ""}</p>`
      + `<p class="ch-gap">${up}${dn ? " · " + dn : ""}</p>`
      + (ms.length ? `<h4 class="sum-h">${esc(d.label)} ${nm}</h4><div class="mrows">${ms.map(m => matchRow(m, us)).join("")}</div>` : "")
      + `<p class="ch-share">${esc(us)} 득점에서 ${nm} 비중 <span class="ch-bar" role="img" aria-label="${nm} 비중 ${esc(F.pct(sh))}"><i style="width:${(sh * 100).toFixed(1)}%"></i></span> <b>${esc(F.pct(sh))}</b></p>`
      + `</section>`;
  }

  // 종목 홈(설계 15 Y2): 관심 종목이 둘 이상이면 가로 칩 띠(.ch-chips, 띠 안에서만 민다) 아래 고른 칩 한 장만 펼친다.
  // 기본 칩 = 그날(다음 경기일) 경기가 있는 첫 관심 종목, 없으면 첫 칩. "모두 펼치기 (n)" → 세로 전부, "접기". S.chHome 은 저장하지 않는다.
  // class_summary 가 없거나 그 종목이 없으면 그 칩·카드만 없다
  function classHomeCards(us) {
    const c = classSum(us);
    if (!c) return "";
    const favs = S.fav.slice(0, FAV_MAX).filter(f => c[f]);
    if (!favs.length) return "";
    const d = myDay();
    const nDay = cls => d ? allMatches().filter(m => m.class_nm === cls && !finished(m) && sched(m) && sched(m).day === d.day).length : 0;
    const st = S.chHome || {};
    const open = favs.includes(st.open) ? st.open : (favs.find(f => nDay(f) > 0) || favs[0]);
    const all = !!st.all && favs.length > 1;
    let chips = "";
    if (favs.length > 1) {
      chips = `<div class="c-wide ch-band"><div class="ch-chips" role="group" aria-label="관심 종목 홈">` + favs.map(f => {
        const on = !all && f === open, n = nDay(f);
        return `<button class="ch-chip${on ? " on" : ""}" data-chhome="${esc(f)}" aria-pressed="${on}">${esc(F.hw(f))}`
          + (n ? ` <small class="ch-dot" aria-label="${esc(d.label)} 경기 ${n}개">${n}</small>` : "") + `</button>`;
      }).join("") + `</div><button class="linkish dark ch-all" data-chall="1" aria-expanded="${all}">${all ? "접기" : `모두 펼치기 (${favs.length})`}</button></div>`;
    }
    const cards = (all ? favs : [open]).map(f => classHomeCard(us, f)).join("");
    // R12: 안내는 마지막 카드 아래 한 번
    return chips + cards + `<p class="note c-wide ch-note">끝난 세부종목 점수는 대회 전체 기준 몫이라 레이스 탭의 지금 득점과 다를 수 있습니다.</p>`;
  }

  // 효자 종목 워터폴(레이스 탭 분포 카드 아래): exp 상위 8 + 나머지, 끝난 몫 진하게·남은 기대 연하게, 관심 종목 노랑
  function classWaterfall(us) {
    const c = classSum(us);
    if (!c) return "";
    const rows = Object.entries(c).map(([k, x]) => [k, Math.round(x.done || 0), Math.round(x.exp || 0)]).filter(r => r[2] > 0).sort((a, b) => b[2] - a[2]);
    if (!rows.length) return "";
    const top = rows.slice(0, 8), rest = rows.slice(8);
    if (rest.length) top.push([`나머지 ${rest.length}종목`, rest.reduce((a, r) => a + r[1], 0), rest.reduce((a, r) => a + r[2], 0), true]);
    const mx = Math.max(...top.map(r => r[2]), 1), fav = new Set(S.fav);
    const li = top.map(([k, d, e, other]) => `<li class="wf${fav.has(k) ? " fav" : ""}${other ? " other" : ""}"><b>${esc(F.hw(k))}</b>`
      + `<span class="wf-bar" role="img" aria-label="${esc(F.hw(k))} 예상 ${esc(F.num(e))}점, 끝난 세부종목 ${esc(F.num(d))}점">`
      + `<i class="d" style="width:${(d / mx * 100).toFixed(1)}%"></i><i class="e" style="width:${(Math.max(0, e - d) / mx * 100).toFixed(1)}%"></i></span>`
      + `<span class="num">${esc(F.num(e))}</span></li>`).join("");
    return card(`효자 종목 <small>${esc(us)} 예상 득점이 큰 종목</small>`, `<ol class="wfall">${li}</ol>`
      + `<p class="note">진한 칸은 끝난 세부종목 몫, 연한 칸은 남은 기대입니다. 노랑은 관심 종목. 개최지 가산·공식 집계 보정은 종목에 나누지 않아 합이 예상 득점과 조금 다릅니다.</p>`, "c-wide c-waterfall");
  }

  // ── 사람(설계 14 X8): people.json(H1, docs/ENGAGEMENT.md §12-5). 분할이면 {split, files: {시도: {path}}, teams: {팀: [시도]}} → 시도 파일 ──
  // 18세이하부(minor)는 검색 결과에 이름을 늘어놓지 않는다(학교·팀명으로만), 이름은 경기 줄에서만. 파일이 없으면 화면에 흔적이 없다
  async function loadPeople() {
    if (S.snapshotPath || S.people) return;
    let j;
    try { j = await getJSON("data/people.json", false); } catch (e) { return; }
    if (!j || j.schema_version !== 1) return;
    const P = { byId: new Map(), multi: [], teams: j.teams || null, files: j.split ? (j.files || {}) : null, loaded: new Set() };
    const add = x => { for (const p of x.people || []) if (p && p.id) P.byId.set(p.id, p); for (const m of x.multi || []) P.multi.push(m); };
    if (j.split) {
      const want = new Set([S.sido, S.ownSido].filter(Boolean));
      for (const k of want) await loadPeopleFile(P, k, add);
    } else add(j);
    S.people = P;
    S._pk = null;
    render();
  }
  async function loadPeopleFile(P, sido, add) {
    const f = P.files && P.files[sido];
    if (!f || P.loaded.has(sido) || !safePath(f.path)) return;
    P.loaded.add(sido);
    try { add(await getJSON("data/" + f.path, false)); } catch (e) { /* 없으면 그 시도만 빠진다 */ }
  }
  function readWho() {
    const u = q.get("who"), sc = q.get("school");
    let o = null;
    try { o = JSON.parse(store(WHO_KEY) || "null"); } catch (e) { o = null; }
    // id 는 H1 의 p_ + 해시(보통 10자리). 짧은 id(합성 자료 p_a1 등)도 받는다(R11)
    const who = u !== null ? u.split(",").filter(x => /^p_[0-9A-Za-z_]{1,40}$/.test(x)).slice(0, 5) : (o && Array.isArray(o.who) ? o.who.slice(0, 5) : []);
    const school = sc !== null ? (sc.trim().slice(0, 40) || null) : (o && typeof o.school === "string" ? o.school : null);
    return { who, school };
  }
  function saveWho() {
    store(WHO_KEY, JSON.stringify({ who: S.who, school: S.school }));
    setParam("who", S.who.length ? S.who.join(",") : null);
    setParam("school", S.school || null);
  }
  function person(id) { return S.people && S.people.byId.get(id); }
  // 화면에 쓸 이름: 18세이하부는 "{소속} 선수"(경기 줄 밖에서는 이름을 쓰지 않는다)
  function personLabel(p, inMatchRow) { return p.minor && !inMatchRow ? `${p.team} 선수` : `${p.name}(${p.team})`; }
  // 경기 키 → 그 경기에 나오는 응원 선수·학교 선수 이름(경기 줄에 쓴다)
  function peopleByMatch() {
    if (!S.people) return new Map();
    if (S._pk && S._pkFor === S.who.join() + "|" + S.school) return S._pk;
    const m = new Map();
    for (const p of S.people.byId.values()) {
      if (!(S.who.includes(p.id) || (S.school && p.team === S.school))) continue;
      for (const e of p.events || []) { const a = m.get(e.k) || []; a.push(p); m.set(e.k, a); }
    }
    S._pk = m; S._pkFor = S.who.join() + "|" + S.school;
    return m;
  }
  // 찾기: 이름은 전체 일치(18세이하부 제외), 학교·팀은 부분 일치(이름 없이 "팀 · 시도 · n명")
  function searchPeople(qs) {
    const t = String(qs || "").trim();
    if (!S.people || t.length < 2) return { names: [], teams: [] };
    const names = [], teams = new Map();
    for (const p of S.people.byId.values()) {
      if (!p.minor && p.name === t) names.push(p);
      if (p.team && p.team.includes(t)) { const k = p.team + "|" + p.sido, x = teams.get(k) || { team: p.team, sido: p.sido, n: 0 }; x.n++; teams.set(k, x); }
    }
    return { names: names.slice(0, 10), teams: [...teams.values()].sort((a, b) => b.n - a.n).slice(0, 10) };
  }
  async function peopleSearchLoad(t) {
    // 분할 파일: 팀 목록(teams)으로 그 팀이 있는 시도 파일을 더 연다
    const P = S.people;
    if (!P || !P.files || !P.teams || t.length < 2) return;
    const add = x => { for (const p of x.people || []) if (p && p.id) P.byId.set(p.id, p); };
    const sidos = new Set();
    for (const [team, ss] of Object.entries(P.teams)) if (team.includes(t)) for (const s of ss) sidos.add(s);
    let more = false;
    for (const s of sidos) if (!P.loaded.has(s)) { await loadPeopleFile(P, s, add); more = true; }
    if (more) render();
  }
  function peopleSearch() {
    if (!S.people) return "";
    const r = searchPeople(S.peopleQ);
    const chosen = S.who.map(person).filter(Boolean).map(p => `<li><b>${esc(personLabel(p))}</b> <small>${esc(p.sido)}</small> <button class="linkish dark" data-who-del="${esc(p.id)}">빼기</button></li>`)
      .concat(S.school ? [`<li><b>${esc(S.school)}</b> <small>학교·팀</small> <button class="linkish dark" data-school-del="1">빼기</button></li>`] : []).join("");
    const res = r.names.map(p => `<li><button class="act-btn" data-who-add="${esc(p.id)}">${esc(p.name)} · ${esc(p.team)} · ${esc(p.sido)}</button></li>`)
      .concat(r.teams.map(x => `<li><button class="act-btn" data-school-add="${esc(x.team)}">${esc(x.team)} · ${esc(x.sido)} · ${esc(F.num(x.n))}명</button></li>`)).join("");
    return `<div class="people-search"><h4 class="sum-h">응원하는 선수·학교</h4>`
      + (chosen ? `<ul class="since">${chosen}</ul>` : "")
      + `<label class="memo"><span>선수 이름(전체) 또는 학교·팀 이름(일부)</span><input id="people-q" type="search" maxlength="20" value="${esc(S.peopleQ)}" autocomplete="off"></label>`
      + (res ? `<ul class="people-res">${res}</ul>` : S.peopleQ.trim().length >= 2 ? `<p class="note">찾은 사람·학교가 없습니다.</p>` : "")
      + `<p class="note">18세이하부 선수는 이름으로 찾지 않고 학교·팀으로 고릅니다. 고른 것은 이 기기에만 저장됩니다.</p></div>`;
  }
  // 다관왕 도전(우리 지역, 금 ≥ 1 인 사람만, H1 판정 ①): "오늘 {이름}({소속}) {n}관왕 도전 · {시각} {세부종목}". 고르지 않아도 보인다
  function multiCard(us) {
    if (!S.people) return "";
    const rows = S.people.multi.map(x => [x, person(x.id)]).filter(([x, p]) => p && p.sido === us && x.won >= 1)
      .sort((a, b) => b[0].won - a[0].won || b[0].left - a[0].left).slice(0, 3).map(([x, p]) => {
        const e = (p.events || []).find(y => y.k === x.next) || {};
        const sc = F.parseSchedule(e.t || "", null), when = sc ? `${F.dayKey(sc.start) === F.dayKey(refNow()) ? "오늘" : F.dayLabel(sc.day)}${sc.timed ? " " + F.hm(sc.start) : ""}` : "";
        return `<li class="mo"><span class="mo-tag t-gold">${esc(F.num(x.won + 1))}관왕</span><b class="mo-n">${esc(personLabel(p))} ${esc(F.num(x.won + 1))}관왕 도전</b>`
          + `<small class="mo-l">${esc([when, F.hw(e.c || ""), F.hw(e.d || "")].filter(Boolean).join(" "))}</small></li>`;
      });
    return rows.length ? card(`다관왕 도전 <small>${esc(us)}</small>`, `<ol class="moments">${rows.join("")}</ol>`, "c-multi") : "";
  }
  // 하이라이트 꼬리표 "다관왕": 우리 지역 선수의 두 번째 금 이상 세부종목(경기 키 → 종목|세부)
  function multiGoldEvents(us) {
    if (!S.people) return [];
    const out = [];
    for (const p of S.people.byId.values()) {
      if (p.sido !== us) continue;
      const golds = (p.medals || []).filter(m => m[0] === "금").map(m => String(m[1]).split("|")).filter(x => x.length >= 3).map(x => x[1] + "|" + x[2]);
      if (golds.length >= 2) out.push(...golds.slice(1));
    }
    return out;
  }

  // ── 찜한 경기(설계 14 X4, 설계 15 Y1 이름, 오늘의 질문 대체) ──
  function watchSaveable() { return !S.snapshotPath && !othersCard(); }
  function readWatch() {
    try { const o = JSON.parse(store(WATCH_KEY) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function saveWatch() {
    if (!watchSaveable()) return;
    const o = S.watch, ks = Object.keys(o);
    if (ks.length > WATCH_MAX) ks.sort((a, b) => String(o[a].t || "").localeCompare(String(o[b].t || ""))).slice(0, ks.length - WATCH_MAX).forEach(k => { delete o[k]; });
    store(WATCH_KEY, JSON.stringify(o));
  }
  function watching(key) { return !!S.watch[key]; }
  // 고를 때의 우리 쪽 확률(승패 p_win·기록 메달권)과 우리 쪽 stake 를 함께 적어 둔다(끝난 뒤 "남긴 것" 을 셀 재료)
  function toggleWatch(key) {
    if (S.watch[key]) delete S.watch[key];
    else {
      const m = allMatches().find(x => x.match_key === key);
      if (!m) return;
      const us = S.sido, sides = m.sides || [], mine = sides.find(sd => sd.sido === us), sc = sched(m);
      S.watch[key] = { t: new Date().toISOString(), p: mine ? Math.round(mine.p_win * 1000) / 1000 : null, side: mine ? us : null,
        s: mine && !m.record && typeof mine.stake === "number" ? mine.stake : null, e: evNo(), day: sc ? sc.day : null,
        n: shortMatchName(m), a: sides[0] ? sides[0].sido : null, b: sides[1] ? sides[1].sido : null, rec: !!m.record };
    }
    saveWatch();
    render();
  }
  // 결과(승자)를 기록에 남긴다: results_recent 는 72시간만 싣는다
  function settleWatch() {
    if (S.snapshotPath || !S.snap || !S.snap.results_recent) return;
    let ch = false;
    for (const [k, x] of Object.entries(S.watch)) { const w = S.snap.results_recent[k]; if (w && !x.r) { x.r = w; ch = true; } }
    if (ch) saveWatch();
  }
  function watchedOf(ev, day) { return Object.entries(S.watch).filter(([, x]) => x.e === ev && (day === undefined || x.day === day)); }
  // 찜했던 경기가 남긴 것: 끝난 ★ 의 하이라이트 묶음. 격차 = 우리 경기마다 이김 (1−p)·stake, 짐 −p·stake(만약에와 같은 셈)
  function watchedSummary(ev, day) {
    const us = S.sido, all = watchedOf(ev, day);
    const done = all.map(([k, x]) => [k, x, resultOf(k, x)]).filter(z => z[2]);
    let gap = 0, gapKnown = false, wins = 0, sur = 0;
    for (const [, x, w] of done) {
      if (x.side !== us) continue;
      if (w === us) { wins++; if (x.p !== null && x.p < 0.15) sur++; }
      if (typeof x.s === "number" && x.p !== null) { gapKnown = true; gap += w === us ? (1 - x.p) * x.s : -x.p * x.s; }
    }
    if (!done.length) return { n: all.length, done: 0, text: "" };
    // R7: 라이벌 쪽 변화를 넣지 않으니 "격차" 가 아니라 "우리 ±n점"
    const parts = [gapKnown ? `우리 ${F.signed(Math.round(gap))}점` : null, `우리 승 ${F.num(wins)}`, sur ? `깜짝 ${F.num(sur)}` : null].filter(Boolean);
    return { n: all.length, done: done.length, text: `찜했던 경기 ${F.num(done.length)}개가 남긴 것: ${parts.join(" · ")}` };
  }

  // 한 줄 카드 펼친 안의 "캘린더에 담기": 그 경기 하나
  function saveIcsOne(key) {
    const m = allMatches().find(x => x.match_key === key), sc = m && sched(m);
    if (!sc) return;
    const link = location.origin + location.pathname + (S.sido ? "?sido=" + encodeURIComponent(S.sido) : "");
    const line = S.sido ? myLine(m, S.sido) : "";
    downloadBlob(new Blob([F.ics([{ uid: m.match_key + "@chejeon-live", title: "[체전 라이브] " + matchName(m), loc: m.venue || "",
      desc: (line ? line + "\n" : "") + link, start: sc.start, end: sc.end, allDay: !sc.timed, day: sc.day }], new Date())], { type: "text/calendar;charset=utf-8" }),
      `chejeon-${sc.day}.ics`);
  }

  // ── 오늘의 질문 (G). 점수·순위·보상 없음. 고른 기록은 이 기기의 localStorage 에만 ──
  function readPicks() {
    try {
      const o = JSON.parse(store(PICK_KEY) || "{}");
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }

  function savePicks() {
    const o = S.picks, ks = Object.keys(o);
    if (ks.length > PICK_MAX) {
      ks.sort((a, b) => String(o[a].at || "").localeCompare(String(o[b].at || ""))).slice(0, ks.length - PICK_MAX).forEach(k => { delete o[k]; });
    }
    store(PICK_KEY, JSON.stringify(o));
  }

  function evNo() { return S.snap ? S.snap.event_no || (S.snap.event || {}).event_no || null : null; }

  function matchOpen(m, now) {
    const sc = sched(m);
    if (!sc || m.status === "종료") return false;
    return sc.timed ? sc.start > now : sc.day > F.dayKey(now);
  }

  // 결과: 실시간은 엔진의 최근 결과(results_recent, 본 것은 기록에 남긴다), 다시 보기는 "결과 공개" 뒤의 outcomes
  function resultOf(key, rec) {
    if (S.snapshotPath) {
      const o = showReveal() && S.outcomes.matches && S.outcomes.matches[key];
      return o ? o.winner : null;
    }
    if (rec && rec.r) return rec.r;
    return (S.snap && S.snap.results_recent && S.snap.results_recent[key]) || null;
  }

  function settlePicks() {
    if (S.snapshotPath || !S.snap || !S.snap.results_recent) return;
    let changed = false;
    for (const p of Object.values(S.picks)) {
      const w = S.snap.results_recent[p.k];
      if (w && !p.r && (w === p.a || w === p.b)) { p.r = w; changed = true; }
    }
    if (changed) savePicks();
  }

  function qCandidates(us, day, now) {
    const fav = new Set(S.fav);
    return allMatches().filter(m => !m.record && (m.sides || []).length === 2 && !m.sides.some(sd => sd.settled))
      .filter(m => { const sc = sched(m); return sc && sc.day === day && matchOpen(m, now); })
      .filter(m => m.sides[0].p_win >= 0.3 && m.sides[0].p_win <= 0.7)
      .map(m => [(us && m.sides.some(sd => sd.sido === us) ? 4 : 0) + (fav.has(m.class_nm) ? 2 : 0)
        + 2 * (m.importance || 0) + (1 - 2 * Math.abs(m.sides[0].p_win - 0.5)), m])
      .sort((a, b) => b[0] - a[0] || (a[1].match_key < b[1].match_key ? -1 : 1)).map(x => x[1]);
  }

  function doPick(key, side) {
    const m = allMatches().find(x => x.match_key === key);
    if (!m || (m.sides || []).length !== 2 || !matchOpen(m, refNow()) || resultOf(key, S.picks[key])) return;
    const [a, b] = m.sides;
    if (side !== a.sido && side !== b.sido) return;
    S.picks[key] = { k: key, e: evNo(), day: sched(m).day, a: a.sido, b: b.sido, pa: Math.round(a.p_win * 1000) / 1000,
      pick: side, n: matchName(m), c: m.class_nm || "", x: matchName(m).split(" ").slice(1).join(" "),
      w: timeLabel(m), at: new Date().toISOString() };
    savePicks();
    render();
  }

  function qItem(rec, m, now) {
    const key = rec ? rec.k : m.match_key;
    const a = rec ? rec.a : m.sides[0].sido, b = rec ? rec.b : m.sides[1].sido;
    const open = !!m && matchOpen(m, now) && !resultOf(key, rec);     // 결과가 보이면 잠근다(다시 보기의 결과 공개)
    const btn = side => { const on = !!rec && rec.pick === side;
      return `<button class="qbtn${on ? " on" : ""}" data-qk="${esc(key)}" data-qs="${esc(side)}" aria-pressed="${on}"${open ? "" : " disabled"}>${esc(side)}</button>`; };
    let h = `<div class="qbtns">${btn(a)}<span class="qvs">대</span>${btn(b)}</div>`;
    if (!rec) {
      h += `<p class="note">${open ? "한쪽을 고르면 전망을 보여 드립니다." : "경기가 시작되어 고를 수 없습니다."}</p>`;
    } else {
      h += `<p class="qline">${esc(F.josa(rec.pick, "을", "를"))} 골랐습니다. ${esc(F.modelLine(a, b, rec.pa))}</p>`;
      const win = resultOf(key, rec);
      if (win) h += `<p class="reveal">${esc(F.questionResult(rec.pick, win, win === a ? rec.pa : 1 - rec.pa))}</p>`;
      else if (open) h += `<p class="note">경기 시작 전까지 바꿀 수 있습니다.</p>`;
      else if (S.snapshotPath) h += `<p class="note">${S.replayIndex && S.replayIndex.outcomes ? "결과는 위 띠의 \"결과 공개\"를 누르면 보입니다." : "이 묶음에는 결과 자료가 없습니다."}</p>`;
      else h += `<p class="note">결과가 들어오면 여기에 표시합니다.</p>`;
    }
    const cls = rec ? rec.c : m.class_nm || "", rest = rec ? rec.x : matchName(m).split(" ").slice(1).join(" ");
    return `<li class="qitem"><p class="qh"><b>${esc(F.hw(cls))}</b> ${esc(rest)} · ${esc(rec ? rec.w : timeLabel(m))}</p>${h}</li>`;
  }

  function questionCard(us) {
    const d = myDay(), now = refNow(), ev = evNo();
    if (!LEGACY_QUESTION || !d) return "";
    const mine = Object.values(S.picks).filter(p => p.e === ev && p.day === d.day);
    const picked = new Set(mine.map(p => p.k));
    const byKey = new Map(allMatches().map(m => [m.match_key, m]));
    const cands = qCandidates(us, d.day, now).filter(m => !picked.has(m.match_key));
    const want = Math.max(0, Q_PER - mine.length) + S.qMore;
    const items = mine.map(p => qItem(p, byKey.get(p.k) || null, now)).concat(cands.slice(0, want).map(m => qItem(null, m, now)));
    if (!items.length) return "";
    const more = cands.length > want ? `<button class="act-btn" data-qmore="1">질문 더 보기</button>` : "";
    return card(`${esc(d.label === "오늘" ? "오늘" : d.label)}의 질문 <small>한쪽을 골라 전망과 견주기</small>`,
      `<p class="note">전망이 팽팽한 경기를 골랐습니다${us ? `(${esc(F.josa(us, "이", "가"))} 뛰는 경기와 관심 종목 먼저)` : ""}. 한쪽을 고르면 전망과 비교해 드리고, 경기가 끝나면 결과를 붙입니다.</p>`
      + `<ol class="qlist">${items.join("")}</ol>${more ? `<div class="btn-row">${more}</div>` : ""}`
      + `<p class="note">점수·순위·보상은 없습니다. 고른 기록은 이 기기에만 남고 어디에도 보내지 않습니다.</p>`, "c-wide c-question");
  }

  // 탭 3 의 "내가 고른 경기": 이 대회에서 고른 경기의 결과와 요약
  function pickStats(ev) {
    const ps = Object.values(S.picks).filter(p => p.e === ev);
    const done = ps.map(p => [p, resultOf(p.k, p)]).filter(x => x[1]);
    const mine = done.filter(([p, w]) => p.pick === w).length;
    const model = done.filter(([p, w]) => (p.pa > 0.5 ? p.a : p.pa < 0.5 ? p.b : null) === w).length;
    return { ps, done, mine, model };
  }

  function myPicksCard() {
    if (!LEGACY_QUESTION) return "";
    const st = pickStats(evNo());
    if (!st.ps.length) return "";
    let h = st.done.length ? `<p class="lead">${esc(F.pickSummary(st.done.length, st.mine, st.model))}</p>` : "";
    const wait = st.ps.length - st.done.length;
    if (wait) h += `<p class="note">결과를 기다리는 경기 ${esc(F.num(wait))}개.</p>`;
    const bold = st.done.filter(([p, w]) => p.pick === w).map(([p]) => [p, p.pick === p.a ? p.pa : 1 - p.pa])
      .sort((x, y) => x[1] - y[1])[0];
    if (bold && bold[1] < 0.45) {
      h += `<p class="note">전망과 가장 달랐던 선택: ${esc(bold[0].n)} — 고를 때 전망 ${esc(F.pct(bold[1]))}였던 ${esc(bold[0].pick)} 쪽을 골랐고, 결과도 ${esc(bold[0].pick)} 승.</p>`;
    }
    const rows = st.done.slice().sort((x, y) => String(y[0].at).localeCompare(String(x[0].at))).slice(0, 8)
      .map(([p, w]) => `<li><b>${esc(p.n)}</b><br><small>고른 쪽 ${esc(p.pick)} · ${esc(F.questionResult(p.pick, w, w === p.a ? p.pa : 1 - p.pa))}</small></li>`).join("");
    if (rows) h += `<ul class="surprises">${rows}</ul>`;
    h += `<p class="note">점수·순위·보상은 없습니다. 기록은 이 기기에만 있습니다.</p>`;
    return card("내가 고른 경기 <small>오늘의 질문</small>", h, "c-picks");
  }

  // ── 공유 이미지 (D). C-3 포스터 문법으로 canvas 1080×1350 에 그려 저장하거나 휴대폰 공유로 보낸다 ──
  function chosenTarget(v) {
    return (S.targetKey && (v.target_candidates || []).find(c => c.key === S.targetKey)) || v.target;
  }

  function shareFoot() {
    const t = S.snap && F.parseTime(S.snap.data_as_of);
    const cur = curPoint();
    return [(S.snapshotPath ? `다시 보기(리플레이) · ${cur ? cur.label : "지난 대회"} 시점 · ` : "") + (t ? `자료 ${F.mdhm(t)} 기준` : ""),
      "전망은 통계 추정이며 공식 순위가 아닙니다."];
  }

  // 다시 보기에서 시점 시각에 붙은 이름(D+0(10/17) 등). 이미지는 화면 밖으로 나가므로 "직전 시점" 대신 이름을 쓴다(ENGAGEMENT §9 R8)
  function pointLabel(t) {
    const named = t && points().find(x => { const u = F.parseTime(x.data_as_of); return u && Math.abs(u - t) < 60e3; });
    return named ? named.label : t ? F.md(t) : "직전 시점";
  }

  // 이미지용 짧은 경기 이름: 세부 이름과 "경기3" 꼬리를 뺀다
  function shortMatchName(m) {
    return F.hw([m.class_nm, m.kind_nm, F.hw(m.round_nm || "").replace(/경기\s*\d+$/, "")].filter(Boolean).join(" "));
  }

  // 이미지의 경기 한 줄은 "한 줄 공식"(§12-6, ENGAGEMENT §11). 이유 재료가 없는 옛 스냅샷이면 예전 문장
  function shortImpact(m, us) {
    const b = !m.light && usImpact(m, us);
    if (b) {
      const o = (m.sides || []).find(sd => sd !== b.side);
      const t = F.impactShort(us, b.side.sido, !m.record && o ? o.sido : null, usMove(m, us, b).delta, whyCtx(us), !!m.record);
      // 점수 우선(X3): 우리 승이 유리한 공식이면 끝의 "+n%p" 를 "+330점 (+n%p)" 로
      const g = gainOf(m, us);
      if (t && g && /^우리 승 /.test(t)) return t.replace(/([+−]\d+%p)$/, `+${g}점 ($1)`);
      if (t) return t;
    }
    return myLine(m, us);
  }

  // 응원 카드에 올릴 경기 하나: 그날 우리 지역이 뛰는 경기 중 영향이 가장 큰 것 → 관심 종목 첫 경기 → 꼭 볼 경기 1위(R7)
  function shareMatch(us, v) {
    const d = myDay();
    if (d) {
      const r = myDayList(us, d.day);
      const m = r.ours[0] || (S.fav.length ? r.list[0] : null);
      if (m) return [d.label, m];
    }
    const w = (v.watch || []).map(x => matchByKey(x.match_key)).filter(Boolean)[0];
    if (!w) return null;
    const sc = sched(w);
    return [sc ? F.md(sc.start) : "", w];
  }

  // 이미지의 격차 줄(R15·R16, 설계 15 Y1 말투): "서울보다 2,250점 앞서요 · D+0 이후 2,111점 좁혀짐"(작년의 나는 "이대로면 작년보다 +n점"). 변화 조각은 withMove 일 때만
  function gapLineText(us, withMove) {
    const gs = gapState(us);
    if (!gs) return null;
    const { rv, g, gap, base } = gs, R = rv.prev ? "" : F.sidoLabel(rv.key);
    const amt = n => g.unit === "개" ? `금메달 ${F.num(Math.abs(n))}개` : `${F.num(Math.abs(n))}점`;
    const head = rv.prev ? (gap === 0 ? "이대로면 작년과 같은 점수" : `이대로면 작년보다 ${F.signed(gap)}${g.unit}`)
      : gap > 0 ? `${R}보다 ${amt(gap)} 앞서요` : gap < 0 ? `${R}보다 ${amt(gap)} 뒤에 있어요` : `${F.josa(R, "과", "와")} 같은 점수예요`;
    if (!withMove || !base) return head;
    const d = gap - base.gap, lb = base.label === "어제 저녁" ? "오늘" : `${base.label.replace(/\(.*\)$/, "")} 이후`;
    return `${head} · ${lb} ${rv.prev ? (d === 0 ? "그대로" : F.signed(d) + g.unit) : F.gapMoveText(gap, d, g.unit)}`;
  }

  function shareModel(kind, us) {
    if (kind === "recap") return recapModel(us);
    if (kind === "moment") return momentModel(us);
    const s = S.snap, v = s.sidos[us], ev = (s.event && s.event.name) || "전국체육대회";
    const cur = curPoint(), nowLabel = S.snapshotPath ? (cur ? cur.label : "이 시점") : "지금";
    if (kind === "today") {
      const tb = todayTrend(us);
      const before = S.snapshotPath ? pointLabel(tb.prevPt && tb.prevPt.t) : tb.beforeLabel;
      const ch = (s.changes_daily && s.changes_daily.items) ? s.changes_daily : s.changes;
      // R15: 변동 두 줄에 하이라이트 꼬리표(큰 득점·아쉬움 등, 오늘의 하이라이트와 같은 판정)
      const tagOf = {};
      for (const m of momentFeed(us).list) if (m.event_id && !(m.event_id in tagOf)) tagOf[m.event_id] = m.tag;
      const items = ((ch && ch.items && ch.items[us]) || []).slice(0, 2).map(x => `${tagOf[x.event_id] ? tagOf[x.event_id] + " " : ""}${x.diff >= 0 ? "▲" : "▼"} ${F.signed(x.diff)}  ${F.hw(x.name)}`);
      const gl = gapLineText(us, true);
      const sur = ((ch && ch.surprises) || []).slice().sort((a, b) => (b.sido === us) - (a.sido === us) || a.prior_medal_p - b.prior_medal_p)[0];
      const st = pickStats(evNo());
      return { kind, ev, kick: before + " 이후 바뀐 것", title: us, label: v.target.label, prob: v.target.prob,
        from: tb.prevPt ? tb.prevPt.d.target_prob : null, fromLabel: before, toLabel: nowLabel,
        // R15: 격차 줄을 맨 앞에(확률 아래)
        lines: (gl ? [gl] : []).concat(items.length ? items : ["이 기간에 기대와 달라진 결과가 없습니다."]),
        // 가운데(mid)는 자리가 모자라면 "…" 로 줄인다. 앞뒤는 늘 남긴다(R5)
        extra: [sur ? { head: `${sur.medal} · ${sur.sido === us ? "" : sur.sido + " · "}`, mid: F.hw(sur.name), tail: ` — 메달 확률 ${F.wasPct(sur.prior_medal_p)} 결과` } : null,
          LEGACY_QUESTION && st.done.length ? `오늘의 질문 · 끝난 ${st.done.length}경기 중 고른 쪽과 같은 결과 ${st.mine}개, 전망과 같은 결과 ${st.model}개` : null,
          watchedSummary(evNo(), F.dayKey(refNow())).text || null].filter(Boolean),
        foot: shareFoot() };
    }
    if (kind === "dare") {
      // 격차 카드의 "도전장" 판: 상대 = 도전장 상대, 숫자는 예상 득점 차
      const them = dareTarget(us);
      if (them) {
        const a = Math.round(v.points_mean), b = Math.round(s.sidos[them].points_mean), gap = a - b;
        return { kind, ev, kick: `도전장 · ${us} 대 ${them}`, title: `${us} 대 ${them}`,
          label: gap === 0 ? "예상 득점 같음" : gap > 0 ? `${F.josa(F.sidoLabel(us), "이", "가")} 앞서 있습니다` : `${F.josa(F.sidoLabel(them), "이", "가")} 앞서 있습니다`,
          bigText: F.num(Math.abs(gap)), unit: "점 차", lines: [`${us} ${F.num(a)} · ${them} ${F.num(b)} (예상 득점)`],
          extra: [`체전 라이브에서 ${F.josa(them, "을", "를")} 응원하고 겨루기`], foot: shareFoot() };
      }
    }
    if (kind === "gap") {
      const gs = gapState(us);
      if (gs) {
        const { rv, g, gap } = gs, rm = rivalMatches(us, rv);
        return { kind, ev, kick: "라이벌 격차", title: `${us} 대 ${gs.other}`, label: gs.lead,
          bigText: F.num(Math.abs(gap)), unit: g.unit + " 차",
          lines: [`${us} ${F.num(g.a)} · ${gs.other} ${F.num(g.b)} (${g.what})`]
            .concat(gs.move ? [`${gs.base.label}보다 ${gs.move[0]}`] : []),
          extra: rm.list.map(m => { const sc = sched(m), l = rivalLine(m, us, rv);
            return { head: `${rm.d.label} ${sc && sc.timed ? F.hm(sc.start) + " " : ""}${rm.duel(m) ? "★ " : ""}`, mid: shortMatchName(m), tail: l ? " — " + l : "" }; }),
          foot: shareFoot() };
      }
    }
    const c = chosenTarget(v);
    let next = null;
    const sm = shareMatch(us, v);
    if (sm) {
      // 카드의 목표(고른 목표)와 영향도의 목표(기본 목표)가 다르면 영향 꼬리를 뺀다(DASHBOARD §13-3)
      const [lbl, m] = sm, sc = sched(m), line = c.key === v.target.key ? shortImpact(m, us) : "";
      next = { head: `${lbl} ${sc && sc.timed ? F.hm(sc.start) + " " : ""}`, mid: shortMatchName(m), tail: line ? " — " + line : "" };
    }
    return { kind, ev, kick: "우리 지역 목표", title: `${us}의 목표`, label: c.label, prob: c.prob,
      // R16: 예상 득점 줄 아래 격차 줄
      lines: [`이대로면 ${F.num(v.points_mean)}점 · 지금까지 ${F.num((s.points_now || {})[us] || 0)}점`].concat(gapLineText(us, false) ? [gapLineText(us, false)] : []),
      // 관심 종목이 10개까지라 가운데(종목 목록)를 줄일 수 있게 나눠 둔다(Y2)
      extra: [S.fav.length ? { head: "응원 종목 ", mid: S.fav.join(" · "), tail: "" } : null, next].filter(Boolean), foot: shareFoot() };
  }

  function partText(t) { return typeof t === "string" ? t : t.head + t.mid + t.tail; }

  function shareLines(md) {
    return [md.ev, md.kick, md.title, md.label, md.bigText ? md.bigText + md.unit : md.prob !== undefined ? F.pct(md.prob) : null, md.from !== undefined && md.from !== null ? `${md.fromLabel} ${F.pct(md.from)}` : null,
      ...md.lines, ...md.extra.map(partText), ...md.foot].filter(Boolean);
  }

  function wrapText(c, text, maxW) {
    const out = [];
    let cur = "";
    for (const ch of String(text)) {
      if (c.measureText(cur + ch).width > maxW && cur) {
        const sp = cur.lastIndexOf(" ");
        if (sp > cur.length * 0.5) { out.push(cur.slice(0, sp)); cur = cur.slice(sp + 1); } else { out.push(cur); cur = ""; }
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  // 한 줄에 맞춘다: 가운데(mid)를 "…" 로 줄이고, 그래도 넘치면 글자를 줄인다(최소 minPx)
  function fitOne(c, item, weight, px, minPx, family, maxW) {
    const full = partText(item);
    for (let f = px; f >= minPx; f -= 2) {
      c.font = `${weight} ${f}px ${family}`;
      if (c.measureText(full).width <= maxW) return [full, f];
    }
    if (typeof item !== "string") {
      let mid = item.mid;
      while (mid.length > 4 && c.measureText(item.head + mid + "…" + item.tail).width > maxW) mid = mid.slice(0, -1);
      return [item.head + mid.trimEnd() + "…" + item.tail, minPx];
    }
    return [full, minPx];
  }

  // 하이라이트 카드(X2): 9:16 한 장. 꼬리표 · 세부종목 · 숫자(격차 또는 사전 확률) · 기대→실제 · 오늘 헤드라인 · 고정 문구
  function momentModel(us) {
    const f = momentFeed(us), m = f.list[S.momentIdx] || f.list[0], s = S.snap;
    const ev = (s.event && s.event.name) || "전국체육대회";
    if (!m) return { kind: "moment", ev, kick: "오늘의 하이라이트", title: us, label: "확정된 결과가 아직 없어요", bigText: "", unit: "", lines: [], extra: [], foot: shareFoot() };
    const big = m.tag === "깜짝" && m.prior !== null ? { t: F.pct(m.prior), u: "경기 전 확률" } : m.gap === null ? { t: "", u: "" }
      : { t: m.gap === 0 ? "0" : F.signed(m.gap), u: f.prev ? "점 · 작년 대비" : `점 · ${F.josa(F.sidoLabel(f.rival ? f.rival.key : ""), "과", "와")} 격차` };
    return { kind: "moment", ev, kick: `${us} · ${m.tag || "결과"}`, title: m.name + (m.tag === "깜짝" && m.medal ? " " + m.medal : ""), label: f.label,
      bigText: big.t, unit: big.u, lines: [m.line], extra: [heroHeadline(us)], foot: shareFoot() };
  }

  function drawMoment(md) {
    const W = 1080, H = 1920, X = 72, MW = W - 2 * X, BAND = 170, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), drawn = [];
    const css = getComputedStyle(document.documentElement), col = (n, f) => css.getPropertyValue(n).trim() || f;
    const BG = col("--bg", "#f2e8d4"), INK = col("--ink", "#151515"), COB = col("--cobalt", "#2443d6"), SUN = col("--sun", "#f6c21c"),
      HOT = col("--hot", "#ee4322"), CREAM = col("--cream", "#fff6e4");
    const HEAD = '"Black Han Sans", "Malgun Gothic", sans-serif', NUMF = 'Anton, "Arial Narrow", sans-serif',
      BODY = 'system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    c.fillStyle = SUN; c.beginPath(); c.arc(W - 160, 930, 330, 0, Math.PI * 2); c.fill();
    c.textBaseline = "alphabetic";
    c.font = `72px ${HEAD}`; c.fillStyle = INK; c.fillText("체전", X, 160);
    c.fillStyle = HOT; c.fillText("라이브", X + c.measureText("체전").width, 160);
    c.fillStyle = INK; c.font = `600 36px ${BODY}`; c.fillText(md.ev, X, 220); drawn.push(md.ev);
    c.font = `700 40px ${BODY}`;
    const kw = c.measureText(md.kick).width + 40;
    c.fillStyle = INK; c.fillRect(X, 280, kw, 64); c.fillStyle = BG; c.fillText(md.kick, X + 20, 326); drawn.push(md.kick);
    // 세부종목 이름: 두 줄까지, 넘치면 글자를 줄인다
    let tf = 104, tl;
    for (;; tf -= 6) { c.font = `${tf}px ${HEAD}`; tl = wrapText(c, md.title, MW); if (tl.length <= 2 || tf <= 56) break; }
    c.fillStyle = INK; tl.slice(0, 3).forEach((l, i) => c.fillText(l, X, 470 + i * Math.round(tf * 1.15))); drawn.push(md.title);
    let y = 470 + tl.slice(0, 3).length * Math.round(tf * 1.15) + 20;
    c.font = `600 40px ${BODY}`; c.fillStyle = INK; c.fillText(md.label, X, y); drawn.push(md.label);
    if (md.bigText) {
      let bf = 300;
      for (; bf > 120; bf -= 10) { c.font = `${bf}px ${NUMF}`; if (c.measureText(md.bigText).width <= MW) break; }
      c.font = `${bf}px ${NUMF}`;
      c.fillStyle = INK; c.fillText(md.bigText, X + 14, 1180 + 14); c.fillStyle = HOT; c.fillText(md.bigText, X, 1180);
      c.fillStyle = INK; c.font = `56px ${HEAD}`; c.fillText(md.unit, X, 1270); drawn.push(md.bigText + md.unit);
    }
    y = 1380;
    for (const t of md.lines.concat(md.extra)) {
      c.font = `700 46px ${BODY}`;
      const ls = wrapText(c, t, MW).slice(0, 3);
      for (const l of ls) { c.fillStyle = INK; c.fillText(l, X, y); y += 62; }
      y += 16; drawn.push(t);
    }
    c.fillStyle = COB; c.fillRect(0, H - BAND, W, BAND);
    c.fillStyle = CREAM;
    md.foot.filter(Boolean).forEach((t, i) => { const [txt] = fitOne(c, t, 600, 32, 24, BODY, MW); c.fillText(txt, X, H - 100 + i * 48); drawn.push(t); });
    c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    cv.drawnItems = drawn;
    return cv;
  }

  function drawShare(md) {
    if (md.kind === "recap") return drawRecap(md);
    if (md.kind === "moment") return drawMoment(md);
    const W = 1080, H = 1350, X = 72, MW = W - 2 * X, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    const drawn = [];          // 그린 글귀(검사용): 줄여 그렸어도 하나로 센다
    const css = getComputedStyle(document.documentElement), col = (n, f) => css.getPropertyValue(n).trim() || f;
    const BG = col("--bg", "#f2e8d4"), INK = col("--ink", "#151515"), COB = col("--cobalt", "#2443d6"), SUN = col("--sun", "#f6c21c"),
      HOT = col("--hot", "#ee4322"), CREAM = col("--cream", "#fff6e4"), GOOD = col("--good", "#0b6f64"), BAD = col("--bad", "#a8321a");
    const HEAD = '"Black Han Sans", "Malgun Gothic", sans-serif', NUMF = 'Anton, "Arial Narrow", sans-serif',
      BODY = 'system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    const yb = 890, BAND = 150;   // 큰 숫자 윗선(약 yb−312)이 변화 줄(560) 아래에 오게
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    // 노랑 원은 목표 띠(410~504) 아래에서 시작한다
    c.fillStyle = SUN; c.beginPath(); c.arc(X + 250, yb - 120, 250, 0, Math.PI * 2); c.fill();
    c.textBaseline = "alphabetic";
    // 머리: 상표와 대회
    c.font = `64px ${HEAD}`; c.fillStyle = INK; c.fillText("체전", X, 136);
    c.fillStyle = HOT; c.fillText("라이브", X + c.measureText("체전").width, 136);
    c.fillStyle = INK; c.font = `600 32px ${BODY}`; c.fillText(md.ev, X, 186);
    // 꼬리표
    c.font = `700 32px ${BODY}`;
    const kw = c.measureText(md.kick).width + 32;
    c.fillStyle = INK; c.fillRect(X, 224, kw, 52); c.fillStyle = BG; c.fillText(md.kick, X + 16, 262);
    // 제목과 목표(노랑 면)
    c.fillStyle = INK; c.font = `92px ${HEAD}`; c.fillText(md.title, X, 380);
    let fs = 72;
    c.font = `${fs}px ${HEAD}`;
    while (c.measureText(md.label).width > MW - 24 && fs > 40) { fs -= 4; c.font = `${fs}px ${HEAD}`; }
    const lw = c.measureText(md.label).width;
    c.fillStyle = SUN; c.fillRect(X - 8, 410, lw + 16, fs + 22);
    c.fillStyle = INK; c.fillText(md.label, X, 410 + fs + 2);
    // 큰 숫자. 격차 카드는 확률이 아니라 "1,240 점 차"(칸에 맞게 줄인다)
    if (md.bigText) {
      let bf = 360;
      const uw = () => { c.font = `64px ${HEAD}`; return c.measureText(md.unit).width; };
      for (; bf > 120; bf -= 10) { c.font = `${bf}px ${NUMF}`; if (c.measureText(md.bigText).width + 24 + uw() <= MW) break; }
      c.font = `${bf}px ${NUMF}`;
      const bw = c.measureText(md.bigText).width;
      c.fillStyle = INK; c.fillText(md.bigText, X + 14, yb + 14);
      c.fillStyle = HOT; c.fillText(md.bigText, X, yb);
      c.fillStyle = INK; c.font = `64px ${HEAD}`; c.fillText(md.unit, X + bw + 24, yb);
    } else {
      const big = bigParts(md.prob);
      c.font = `360px ${NUMF}`;
      const bw = c.measureText(String(big.n)).width;
      c.fillStyle = INK; c.fillText(String(big.n), X + 14, yb + 14);
      c.fillStyle = HOT; c.fillText(String(big.n), X, yb);
      c.font = `130px ${NUMF}`;
      c.fillStyle = INK; c.fillText("%", X + bw + 20, yb - 176);
      c.fillStyle = HOT; c.fillText("%", X + bw + 14, yb - 182);
      if (big.q) { c.fillStyle = INK; c.font = `800 40px ${BODY}`; c.fillText(big.q, X + bw + 18, yb); }
    }
    if (md.from !== undefined && md.from !== null) {
      // 변화는 화면에 보이는 정수끼리의 차(DASHBOARD §11-12 R5)
      const d = bigParts(md.prob).n - bigParts(md.from).n;
      const delta = d === 0 ? "변화 거의 없음" : `${d > 0 ? "▲" : "▼"} ${F.pp(d / 100)}`;
      const left = `${md.fromLabel} ${F.pct(md.from)} → ${md.toLabel}`;
      let f = 40;
      for (;; f -= 2) {
        c.font = `700 ${f}px ${BODY}`; const a = c.measureText(left).width;
        c.font = `800 ${f + 4}px ${BODY}`; const b = c.measureText(delta).width;
        if (a + 24 + b <= MW || f <= 28) break;
      }
      c.font = `700 ${f}px ${BODY}`; c.fillStyle = INK; c.fillText(left, X, 560);
      const lx = X + c.measureText(left).width + 24;
      c.fillStyle = d > 0 ? GOOD : d < 0 ? BAD : INK; c.font = `800 ${f + 4}px ${BODY}`; c.fillText(delta, lx, 560);
    }
    // 아래 줄들: 44px·36px 로 시작해 바닥 띠 위에 다 들어갈 때까지 줄인다. 버리지 않는다(R5·R6)
    const top = yb + 76, bottom = H - BAND - 28;
    const layout = (lp, ep) => {
      c.font = `700 ${lp}px ${BODY}`;
      const L = md.lines.map(t => wrapText(c, t, MW).slice(0, 2));
      c.font = `600 ${ep}px ${BODY}`;
      const E = md.extra.map(t => { c.font = `600 ${ep}px ${BODY}`; return typeof t === "string" ? wrapText(c, t, MW).slice(0, 2).map(l => [l, ep]) : [fitOne(c, t, 600, ep, Math.max(28, ep - 8), BODY, MW)]; });
      const h = L.reduce((s, x) => s + x.length * Math.round(lp * 1.28), 0) + 12 + E.reduce((s, x) => s + x.length * Math.round(ep * 1.34), 0);
      return { L, E, h };
    };
    let lp = 44, ep = 36, lay = layout(lp, ep);
    while (top + lay.h > bottom && (lp > 32 || ep > 28)) { if (lp > 32) lp -= 2; if (ep > 28) ep -= 2; lay = layout(lp, ep); }
    let y = top;
    c.fillStyle = INK; c.font = `700 ${lp}px ${BODY}`;
    lay.L.forEach((ls, i) => { for (const l of ls) { c.fillText(l, X, y); y += Math.round(lp * 1.28); } drawn.push(md.lines[i]); });
    y += 12;
    lay.E.forEach((ls, i) => { for (const [l, f] of ls) { c.font = `600 ${f}px ${BODY}`; c.fillText(l, X, y); y += Math.round(ep * 1.34); } drawn.push(partText(md.extra[i])); });
    // 바닥 띠(코발트)
    c.fillStyle = COB; c.fillRect(0, H - BAND, W, BAND);
    c.fillStyle = CREAM;
    md.foot.filter(Boolean).forEach((t, i) => {
      const [txt] = fitOne(c, t, 600, 30, 24, BODY, MW);
      c.fillText(txt, X, H - 92 + i * 44); drawn.push(t);
    });
    c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    cv.drawnItems = drawn;
    return cv;
  }

  // 결산 카드 그림(§6-6 6): 함께한 날 큰 숫자 → 여정 띠(●○◐)·그날 목표 확률·작은 꺾은선 → 숫자 줄 → 바닥 띠. 색·글꼴은 drawShare 와 같은 C-3 토큰
  function drawRecap(md) {
    const W = 1080, H = 1350, X = 72, MW = W - 2 * X, BAND = 150, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), drawn = [];
    const css = getComputedStyle(document.documentElement), col = (n, f) => css.getPropertyValue(n).trim() || f;
    const BG = col("--bg", "#f2e8d4"), INK = col("--ink", "#151515"), COB = col("--cobalt", "#2443d6"), SUN = col("--sun", "#f6c21c"),
      HOT = col("--hot", "#ee4322"), CREAM = col("--cream", "#fff6e4");
    const HEAD = '"Black Han Sans", "Malgun Gothic", sans-serif', NUMF = 'Anton, "Arial Narrow", sans-serif',
      BODY = 'system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    const yb = 660;
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    c.fillStyle = SUN; c.beginPath(); c.arc(X + 150, yb - 110, 124, 0, Math.PI * 2); c.fill();
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    // 머리: 상표·대회·꼬리표(지금까지 / 제n회 결산)
    c.font = `64px ${HEAD}`; c.fillStyle = INK; c.fillText("체전", X, 136);
    c.fillStyle = HOT; c.fillText("라이브", X + c.measureText("체전").width, 136);
    c.fillStyle = INK; c.font = `600 32px ${BODY}`; c.fillText(md.ev, X, 186);
    c.font = `700 32px ${BODY}`;
    const kw = c.measureText(md.kick).width + 32;
    c.fillStyle = INK; c.fillRect(X, 224, kw, 52); c.fillStyle = BG; c.fillText(md.kick, X + 16, 262);
    // 제목과 "○○과 함께한 7일 중"(노랑 면)
    let tf = 84;
    c.font = `${tf}px ${HEAD}`;
    while (c.measureText(md.title).width > MW && tf > 48) { tf -= 4; c.font = `${tf}px ${HEAD}`; }
    c.fillStyle = INK; c.fillText(md.title, X, 370);
    let lf = 52;
    c.font = `${lf}px ${HEAD}`;
    while (c.measureText(md.label).width > MW - 24 && lf > 32) { lf -= 4; c.font = `${lf}px ${HEAD}`; }
    const lw = c.measureText(md.label).width;
    c.fillStyle = SUN; c.fillRect(X - 8, 400, lw + 16, lf + 22);
    c.fillStyle = INK; c.fillText(md.label, X, 400 + lf + 2);
    // 큰 숫자: 함께한 날
    c.font = `210px ${NUMF}`;
    const bw = c.measureText(md.bigText).width;
    c.fillStyle = INK; c.fillText(md.bigText, X + 12, yb + 12);
    c.fillStyle = HOT; c.fillText(md.bigText, X, yb);
    c.fillStyle = INK; c.font = `96px ${HEAD}`; c.fillText(md.unit, X + bw + 22, yb);
    // 여정 띠: 칸 이름 · 표식 · 그날 목표 확률 · 작은 꺾은선. 축은 값 범위(최소−5%p ~ 최대+5%p, 0~1 로 자름) × 90px(W4 검토 5):
    // 0~1 고정이면 46→40→47 이 3px 차라 선으로 읽히지 않는다
    const cells = md.cells || [], cw = cells.length ? MW / cells.length : MW;
    const pv = cells.filter(cl => cl.prob !== null).map(cl => cl.prob);
    const lo = pv.length ? Math.max(0, Math.min(...pv) - 0.05) : 0, hi = pv.length ? Math.min(1, Math.max(...pv) + 0.05) : 1;
    const cx = i => X + cw * (i + 0.5), py = p => 908 - (hi > lo ? (p - lo) / (hi - lo) : 0.5) * 90;
    c.textAlign = "center";
    cells.forEach((cl, i) => {
      c.globalAlpha = cl.before ? 0.35 : cl.state === "future" ? 0.5 : 1;
      c.fillStyle = INK; c.font = `700 ${cells.length > 8 ? 22 : 26}px ${BODY}`; c.fillText(cl.label, cx(i), 712);
      c.beginPath(); c.arc(cx(i), 746, 17, 0, Math.PI * 2);
      if (cl.state === "on") { c.fillStyle = COB; c.fill(); }
      else if (cl.state === "today") {
        c.fillStyle = HOT; c.beginPath(); c.arc(cx(i), 746, 17, Math.PI / 2, Math.PI * 1.5); c.fill();
        c.beginPath(); c.arc(cx(i), 746, 17, 0, Math.PI * 2);
      }
      c.strokeStyle = INK; c.lineWidth = 3; c.stroke();
      if (cl.prob !== null) { c.fillStyle = INK; c.font = `28px ${NUMF}`; c.fillText(F.pct(cl.prob), cx(i), 796); }
      c.globalAlpha = 1;
    });
    const pts = cells.map((cl, i) => cl.prob === null ? null : [cx(i), py(cl.prob)]).filter(Boolean);
    if (pts.length >= 2) {
      c.strokeStyle = HOT; c.lineWidth = 6; c.lineJoin = "round"; c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
      c.fillStyle = INK; for (const [x, y] of pts) { c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); }
    }
    c.textAlign = "left";
    // 숫자 줄: 바닥 띠 위에 다 들어갈 때까지 줄인다. 버리지 않는다. 긴 항목(깜짝 하이라이트)이 ep−8 에서도 한 줄에 안 들어가면
    // 머리(head) 한 줄 + 가운데·꼬리(mid·tail) 한 줄로 나눈다(W4 검토 5). 나눠 그려도 한 항목으로 센다
    const top = 962, bottom = H - BAND - 28;
    const rowsOf = (t, ep) => {
      const minF = Math.max(24, ep - 8);
      if (typeof t !== "string" && t.head.trim()) {
        c.font = `600 ${minF}px ${BODY}`;
        if (c.measureText(partText(t)).width > MW) {
          return [[t.head.trimEnd(), ep], fitOne(c, { head: "", mid: t.mid.trimStart(), tail: t.tail }, 600, ep, minF, BODY, MW)];
        }
      }
      return [fitOne(c, t, 600, ep, minF, BODY, MW)];
    };
    const layout = ep => md.extra.map(t => rowsOf(t, ep));
    let ep = 38, rows = layout(ep);
    const nRows = () => rows.reduce((s, r) => s + r.length, 0);
    while (top + (nRows() - 1) * Math.round(ep * 1.34) > bottom && ep > 26) { ep -= 2; rows = layout(ep); }
    let y = top;
    rows.forEach((rs, i) => {
      for (const [txt, f] of rs) { c.font = `600 ${f}px ${BODY}`; c.fillStyle = INK; c.fillText(txt, X, y); y += Math.round(ep * 1.34); }
      drawn.push(partText(md.extra[i]));
    });
    // 바닥 띠(코발트)
    c.fillStyle = COB; c.fillRect(0, H - BAND, W, BAND);
    c.fillStyle = CREAM;
    md.foot.filter(Boolean).forEach((t, i) => {
      const [txt] = fitOne(c, t, 600, 30, 24, BODY, MW);
      c.fillText(txt, X, H - 92 + i * 44); drawn.push(t);
    });
    c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    cv.drawnItems = drawn;
    return cv;
  }

  // 공유 입구 주소(§6-7): 지금 페이지 기준 g/<slug>/, 관심 종목은 &fav= 로, 직접 고른 라이벌은 &rival= 로(받는 사람도 같은 격차를 본다)
  function entryUrl(us) {
    const u = new URL("g/" + (SLUG[us] || "all") + "/", location.origin + location.pathname);
    if (us && S.fav.length) u.searchParams.set("fav", S.fav.join(","));
    const rv = us && S.snap && rivalOf(us);
    if (rv && !rv.auto) u.searchParams.set("rival", rv.key);
    return u.toString();
  }

  // ── 도전장(설계 14 X5) ──
  // 상대 = 지금 라이벌(라이벌 바꾸기 목록에서 고른다). 라이벌이 "작년의 나" 면 예상 득점이 바로 위인 지역(1위면 바로 아래)
  function dareTarget(us) {
    const rv = rivalOf(us);
    if (rv && !rv.prev) return rv.key;
    const ord = Object.keys(S.snap.sidos).sort((a, b) => S.snap.sidos[b].points_mean - S.snap.sidos[a].points_mean), i = ord.indexOf(us);
    return ord[i > 0 ? i - 1 : 1] || null;
  }
  // 받는 사람은 상대 지역 화면(입구 g/<상대>/)을 열고 라이벌이 내 지역으로 맞춰진다. 입구 페이지는 sido 를 자기 지역으로 덮으므로 상대의 입구를 쓴다
  function dareUrl(us, them) {
    const u = new URL("g/" + (SLUG[them] || "all") + "/", location.origin + location.pathname);
    u.searchParams.set("rival", us);
    u.searchParams.set("dare", us);
    return u.toString();
  }
  function dareText(us, them) {
    const v = S.snap.sidos, gap = Math.abs(Math.round(v[us].points_mean) - Math.round(v[them].points_mean));
    return `${us} 대 ${them}. 지금 격차 ${F.num(gap)}점 — 체전 라이브에서 ${F.josa(them, "을", "를")} 응원하고 겨루기`;
  }
  async function sendDare() {
    const us = S.sido;
    if (!us || !S.snap) return;
    const them = dareTarget(us);
    if (!them) return;
    const text = dareText(us, them), url = dareUrl(us, them);
    if (navigator.share) {
      try { await navigator.share({ title: `도전장 · ${us} 대 ${them}`, text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text + "\n" + url); S.copied = "도전장 주소를 복사했습니다. 메신저에 붙여 넣으세요."; }
    catch (e) { S.copied = "복사하지 못했습니다. 이 주소를 직접 복사하세요: " + url; }
    render();
  }
  // "서울로·부산으로": 받침이 없거나 ㄹ 이면 "로"
  function withRo(w) {
    const c = String(w).charCodeAt(String(w).length - 1), j = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
    return w + (j === 0 || j === 8 ? "로" : "으로");
  }
  function dareButton(us) {
    if (!us || S.snapshotPath || !S.snap || !S.snap.sidos[us]) return "";
    const them = dareTarget(us);
    return them ? `<button class="act-btn" data-dare="1" title="${esc(us)} 대 ${esc(them)}">도전장 보내기</button>` : "";
  }

  function evShort() { const n = evNo(); return n ? `제${n}회 전국체전` : "전국체전"; }

  // 공유 문구 템플릿(§6-7). 금지어·확률 표기 검사 대상(tests/site_check.js)
  function shareText(kind, us) {
    const s = S.snap, v = s.sidos[us], name = F.sidoLabel(us);
    if (kind === "today") {
      const tb = todayTrend(us), st = dayState(S.day);
      const { items } = changeItems(us), top = items.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
      return `오늘 ${name}의 목표 확률 ` + (tb.prevPt ? `${F.pct(tb.prevPt.d.target_prob)} → ${F.pct(v.target.prob)}` : F.pct(v.target.prob)) + "."
        + (top ? ` ${F.hw(top.name)} ${F.signed(top.diff)}점.` : "") + ` — 체전 라이브${st.k !== null ? " D+" + st.k : ""}`;
    }
    if (kind === "gap") {
      const gs = gapState(us);
      if (gs) {
        const m = rivalMatches(us, gs.rv).list.length, other = gs.rv.prev ? "작년" : F.sidoLabel(gs.rv.key), n = F.num(Math.abs(gs.gap)) + gs.g.unit;
        if (gs.gap === 0) return `${name}, ${F.josa(other, "과", "와")} ${F.josa(gs.g.what, "이", "가")} 같아요. 격차를 움직일 경기 ${m}개 — 체전 라이브`;
        return gs.gap < 0
          ? `${name}, ${F.josa(other, "과", "와")} ${n} 차. ${gs.rv.prev ? "작년을 넘어설" : "뒤집을"} 경기 ${m}개 — 체전 라이브`
          : `${name}, ${other}보다 ${n} 앞서요. 격차를 움직일 경기 ${m}개 — 체전 라이브`;
      }
    }
    if (kind === "dare") { const them = dareTarget(us); return them ? dareText(us, them) : ""; }
    if (kind === "moment") {
      const md = momentModel(us);
      return `${name} · ${md.kick.split(" · ").pop()} ${md.title}${md.bigText ? ` ${md.bigText}${md.unit.startsWith("점") ? "점" : " " + md.unit}` : ""} — 체전 라이브`;
    }
    if (kind === "recap") {
      const md = recapModel(us), n = evNo();
      return `나의 ${n ? `제${n}회 ` : ""}전국체전 · ${F.josa(name, "과", "와")} 함께한 ${md.n}일 — 체전 라이브`;
    }
    return `나는 ${F.josa(name, "을", "를")} 응원해요. ${evShort()} ${name}의 전망과 오늘 볼 경기 — 체전 라이브`;
  }

  async function shareLink(text0, url0) {
    const us = S.sido;
    if (!us || !S.snap) return;
    const text = text0 || shareText("cheer", us), url = url0 || entryUrl(us);
    if (navigator.share) {
      try { await navigator.share({ title: "체전 라이브", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text + "\n" + url); S.copied = "주소를 복사했습니다. 메신저에 붙여 넣으세요."; }
    catch (e) { S.copied = "복사하지 못했습니다. 이 주소를 직접 복사하세요: " + url; }
    render();
  }

  async function shareImage(kind) {
    const us = S.sido;
    if (!us || !S.snap || !S.snap.sidos[us]) return;
    try { await Promise.all([document.fonts.load('64px "Black Han Sans"'), document.fonts.load("64px Anton")]); } catch (e) { /* 시스템 글꼴로 */ }
    const cv = drawShare(shareModel(kind, us));
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    if (!blob) return;
    const name = `chejeon-${["today", "gap", "recap", "moment", "dare"].includes(kind) ? kind : "cheer"}.png`;
    const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      // 그림과 함께 문구·입구 주소를 보낸다(메신저에 따라 문구만 남기도 한다)
      const text = shareText(kind, us) + "\n" + (kind === "dare" ? dareUrl(us, dareTarget(us)) : entryUrl(us));
      try { await navigator.share({ files: [file], title: "체전 라이브", text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    downloadBlob(blob, name);
  }

  // 검사용(tests/site_check.js): 라이벌 자동 선정을 임의 스냅샷으로
  window.ChejeonRival = { auto: (snap, us) => { const o = S.snap; S.snap = snap; try { return rivalAuto(us); } finally { S.snap = o; } } };

  // 검사용(tests/site_check.js, scripts 의 헤드라인 찍기): 지역마다 오늘 탭 헤드라인과 그 재료
  window.ChejeonHero = {
    headline: us => (S.snap && S.snap.sidos[us] ? heroHeadline(us) : ""),
    ctx: us => (S.snap && S.snap.sidos[us] ? heroCtx(us, dayState(S.day)) : null),
    // state 를 주면 그 시간대로 가정해 만든다(검토용: 다시 보기는 늘 저녁이라)
    all: state => (S.snap ? SIDOS.filter(k => S.snap.sidos[k]).map(k => [k, heroHeadline(k, dayState(state || S.day))]) : []),
  };

  // 검사용(tests/site_check.js): 알림 설정 시트 펼치기
  window.ChejeonPush = { open: () => { S.pushSheet = true; render(); }, on: () => pushConfigured() };

  // 검사용(tests/site_check.js): 그날 나의 경기 키 순서
  window.ChejeonMyDay = day => (S.sido && S.snap ? myDayList(S.sido, day).list.map(m => m.match_key) : []);

  // 검사용(tests/site_check.js): 선수·학교 찾기(18세이하부 규칙)
  window.ChejeonPeople = { search: t => { const r = searchPeople(t); return { names: r.names.map(p => p.name), teams: r.teams.map(x => x.team) }; }, loaded: () => !!S.people };

  // 검사용(tests/site_check.js): 종목 비중(합 1)
  window.ChejeonClass = { shares: us => classShares(us || S.sido), names: () => (S.snap ? classNames() : []) };

  // 검사용(tests/site_check.js): 이미지 글귀와 그리기
  window.ChejeonShare = {
    lines: kind => (S.sido && S.snap ? shareLines(shareModel(kind, S.sido)) : []),
    text: kind => (S.sido && S.snap ? [shareText(kind, S.sido), kind === "dare" ? dareUrl(S.sido, dareTarget(S.sido)) : entryUrl(S.sido)] : []),
    draw: kind => { const cv = drawShare(shareModel(kind, S.sido)); return [cv.width, cv.height]; },
    canvas: kind => drawShare(shareModel(kind, S.sido)),
    // 모델의 글귀 수와 실제로 그린 글귀 수(줄였어도 하나로 센다). 다르면 무언가 버려진 것(ENGAGEMENT §9 R5)
    drawnCount: kind => { const md = shareModel(kind, S.sido);
      const head = md.kind === "moment" ? 4 + (md.bigText ? 1 : 0) : 0;     // 하이라이트 카드는 대회·꼬리표·제목·라벨·큰 숫자도 센다
      return [head + md.lines.length + md.extra.length + md.foot.filter(Boolean).length, drawShare(md).drawnItems.length]; },
  };

  // ── 진입 화면(설계 15 Y3, docs/ENTRY.md §2 Y3·§6): 지역 → 목표 → 종목 → 놓치지 않으려면 → 응원 카드 ─────────
  // 지역이 없는 첫 방문만 연다(?sido=·?snapshot=·from=card·기기에 고른 지역이 있거나 끝낸 기록(chejeon.entry.done)이 있으면 건너뜀, ?entry=1 은 언제나). 머리(상표·도움말)만 남기고
  // 탭 막대·본문을 가린다. 상표를 누르면 확인 없이 오늘 탭. 역대 자료(history.json)가 없으면 그래프·횟수·추천 칩·띠 없이 같은 흐름
  const ENTRY_KEY = "chejeon.entry";
  // 타일 지도 5×5(null = 빈 칸, aria-hidden). 실제 경계 SVG 는 108회(§5)
  const TILE_MAP = [["인천", "서울", "경기", "강원", null], ["충남", "세종", "충북", "경북", null], ["전북", "대전", null, "대구", null],
    ["광주", "전남", "경남", "부산", "울산"], ["제주", null, null, null, null]];

  // 역대 자료(D1 계약, docs/ARCHITECTURE.md "설계 15 D1"). 101회는 events 에 없다(칸 없음), 102회는 순위·득점 null(선 끊김·분모 제외)
  async function loadHistory() {
    if (S.historyTried) return;
    S.historyTried = true;
    try {
      const v = await getJSON("data/history.json", false);
      if (v && v.schema_version === 1 && v.sidos && Array.isArray(v.events)) { S.historyRaw = v; applyHistory(); if (S.entry || ((S.tab === "race" || S.tab === "today") && S.snap)) render(); }
    } catch (e) { /* 파일이 없으면 그 카드·줄만 없다 */ }
  }
  // 다시 보기에서는 스냅샷 회차 미만만 쓴다(106회 리플레이면 105회까지가 "작년"). 그 회차 결과(미래 정보)가 이력·진입·퀴즈에 새지 않게.
  // best 는 자른 순위에서 다시 센다. hosts 는 그대로(개최지는 미리 정해져 있다). 실시간(107)은 자를 것이 없다
  function trimHistory(H, n) {
    const keep = e => +e < n, pick = o => Object.fromEntries(Object.entries(o || {}).filter(([e]) => keep(e)));
    const sidos = {};
    for (const [k, x] of Object.entries(H.sidos)) {
      const ranks = pick(x.ranks), rs = Object.entries(ranks).filter(([, r]) => r && r[0] !== null && r[0] !== undefined);
      const br = rs.length ? Math.min(...rs.map(([, r]) => r[0])) : null;
      sidos[k] = Object.assign({}, x, { ranks, top_classes: pick(x.top_classes), hosted: (x.hosted || []).filter(keep),
        best: br === null ? null : { rank: br, events: rs.filter(([, r]) => r[0] === br).map(([e]) => +e).sort((a, b) => a - b) } });
    }
    return Object.assign({}, H, { events: H.events.filter(keep), sidos, class_top: pick(H.class_top) });
  }
  function applyHistory() {
    const H = S.historyRaw;
    if (!H) return;
    const n = S.snapshotPath ? evNo() : null;
    const key = n || 0;
    if (S._histKey === key && S.history) return;
    S._histKey = key;
    S.history = n ? trimHistory(H, n) : H;
  }
  function hist(k) { return S.history && S.history.sidos ? S.history.sidos[k] || null : null; }
  function lastEv() { return S.history && S.history.events.length ? S.history.events[S.history.events.length - 1] : null; }
  function histYear(ev) { const h = S.history && S.history.hosts && S.history.hosts[String(ev)]; return h ? h.year : null; }
  // 그 지역의 회차 줄(101 없음, 세종은 93부터). rank·pts 는 102회에 null
  function histRows(k) {
    const h = hist(k);
    if (!h) return [];
    return S.history.events.filter(ev => h.ranks[String(ev)]).map(ev => { const r = h.ranks[String(ev)]; return { ev, rank: r[0], pts: r[1], gold: r[2] }; });
  }
  function lastRank(k) {
    const v = S.snap && S.snap.sidos[k];
    if (v && v.prev && v.prev.rank) return v.prev.rank;
    const h = hist(k), r = h && lastEv() && h.ranks[String(lastEv())];
    return r && r[0] ? r[0] : null;
  }
  function entryHost() {
    const e = S.snap && S.snap.event;
    if (e && e.host_sido) return e.host_sido;
    const n = evNo() || (lastEv() ? lastEv() + 1 : null), h = n && S.history && S.history.hosts && S.history.hosts[String(n)];
    return h ? h.sido : null;
  }

  function entryTiles(sel, attr, off) {
    const host = entryHost();
    const cells = TILE_MAP.flat().map(k => {
      if (!k) return `<span class="tile tile-0" aria-hidden="true"></span>`;
      const r = lastRank(k), on = sel === k, dis = off === k;
      return `<button class="tile${on ? " on" : ""}" ${attr}="${esc(k)}" aria-pressed="${on}"${dis ? " disabled" : ""}>`
        + `${k === host ? `<i class="tile-host">개최</i>` : ""}<b>${esc(k)}</b>${r ? `<small>작년 ${r}위</small>` : ""}</button>`;
    }).join("");
    return `<div class="tiles" role="group" aria-label="17개 시도">${cells}</div>`;
  }

  // 고른 칸 아래 한 줄: "부산 · 작년 2위(개최지) · 올해 목표 … n%" + 역대 최고
  function entryLine(k) {
    const v = S.snap && S.snap.sidos[k], h = hist(k), r = lastRank(k);
    const parts = [k];
    if (r) parts.push(`작년 ${r}위${h && lastEv() && (h.hosted || []).includes(lastEv()) ? "(개최지)" : ""}`);
    if (v) parts.push(`올해 목표 ${v.target.label} ${F.pct(v.target.prob)}`);
    let best = "";
    const sm = histSummary(k, null);     // 이력 카드(Y4)와 같은 요약
    // Y3-R6: 역대 최고가 꼴찌(17위)면 순위 대신 함께한 횟수
    if (sm && sm.best && sm.best.rank >= 17) best = `${sm.from}회(${sm.fromYear})부터 체전 ${sm.ranks.filter(p => p.v !== null).length}번`;
    else if (sm && sm.best) best = `역대 최고 ${sm.best.rank}위` + (sm.best.ev ? `(${sm.best.ev}회·${sm.best.year}${sm.best.n > 1 ? ` 외 ${sm.best.n - 1}번` : ""})` : "");
    return `<p class="en-line"><b>${esc(parts.join(" · "))}</b>${best ? `<small>${esc(best)}</small>` : ""}</p>`;
  }

  function entryScene1() {
    const k = S.entryPick, r2 = S.entryRival;
    const list = SIDOS.slice().sort((a, b) => a.localeCompare(b, "ko"));
    // Y3-R13: 대회 한 줄(자료가 있을 때)
    const ev = S.snap && S.snap.event, sd = ev && dayOf(ev.start_date), ed = ev && dayOf(ev.end_date);
    let h = sd && ev.host_sido ? `<p class="en-sub">${Math.floor(sd / 100) % 100}/${sd % 100} ${esc(ev.host_sido)}에서 개막, 17개 시도가 ${ed ? dayDiff(ed, sd) + 1 : 7}일 동안 겨뤄요</p>` : "";
    h += S.entryList
      ? `<div class="chooser" role="group" aria-label="17개 시도">${list.map(s => `<button class="pick-sido${k === s ? " on" : ""}" data-tile="${esc(s)}" aria-pressed="${k === s}">${esc(s)}</button>`).join("")}</div>`
      : entryTiles(k, "data-tile");
    h += `<p class="en-alt"><button class="linkish dark" data-entry-list="1">${S.entryList ? "지도로 고르기" : "목록으로 고르기"}</button></p>`;
    if (k) {
      h += entryLine(k) + `<div class="btn-row"><button class="act-btn primary" data-entry-go="1">${esc(k)} 응원하기</button></div>`;
      h += `<p class="en-alt"><button class="linkish dark" data-entry-more="1" aria-expanded="${!!S.entryMore}">또 하나 있다면? (고향·사는 곳)</button></p>`;
      if (S.entryMore) {
        h += entryTiles(r2, "data-tile2", k)
          + (r2 ? `<p class="note">${esc(F.josa(r2, "은", "는"))} 라이벌 자리에 둘게요. 레이스 탭에서 바꿀 수 있어요.</p>`
            + `<div class="btn-row"><button class="act-btn primary" data-entry-go="1">${esc(k)} 응원하기</button></div>` : `<p class="note">하나를 더 고르면 라이벌 자리에 둬요.</p>`);
      }
    } else h += `<p class="note">칸을 누르면 작년 순위와 올해 목표가 보여요.</p>`;
    h += `<p class="en-alt en-none"><button class="linkish dark" data-entry-done="1">지역 없이 볼게요</button></p>`;
    return card("어느 지역을 응원하세요?", h, "c-wide c-entry c-entry1");
  }

  // ── 장면 2 목표 카드 ──
  // 꼬마 선그래프(120×32, 3px 코발트 선, 끝점 주홍). vals = [{ev, v|null}], null 은 선을 끊는다(102회). inv: 순위(1 이 위)
  function miniLine(vals, opt) {
    const W = 120, H = 32, P = 4, nums = vals.map(x => x.v).filter(v => v !== null && v !== undefined);
    if (nums.length < 2) return "";
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (opt.ref !== null && opt.ref !== undefined) { lo = Math.min(lo, opt.ref); hi = Math.max(hi, opt.ref); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const dx = (W - 2 * P) / (vals.length - 1), x = i => (P + i * dx).toFixed(1);
    const y = v => (opt.inv ? P + (v - lo) / (hi - lo) * (H - 2 * P) : H - P - (v - lo) / (hi - lo) * (H - 2 * P)).toFixed(1);
    let d = "", pen = false, last = null;
    vals.forEach((p, i) => {
      if (p.v === null || p.v === undefined) { pen = false; return; }
      d += (pen ? "L" : "M") + x(i) + " " + y(p.v) + " "; pen = true; last = i;
    });
    const ref = opt.ref !== null && opt.ref !== undefined ? `<line class="mini-ref" x1="${P}" x2="${W - P}" y1="${y(opt.ref)}" y2="${y(opt.ref)}"/>` : "";
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.label)}">${ref}`
      + `<path class="mini-l" d="${d.trim()}"/><circle class="mini-e" cx="${x(last)}" cy="${y(vals[last].v)}" r="3.5"/></svg>`;
  }
  // 그래프 aria-label: "88회 7위 … 106회 2위 · 102회 순위 없음 · 101회(2020)는 열리지 않았어요"
  function miniLabel(vals, unit, gap) {
    const ok = vals.filter(p => p.v !== null && p.v !== undefined);
    if (!ok.length) return "";
    const f = p => `${p.ev}회 ${unit === "점" ? F.signed(p.v) + "점" : p.v + unit}`;
    return `${f(ok[0])} … ${f(ok[ok.length - 1])}` + (gap && vals.some(p => p.ev === 102 && p.v === null) ? ` · 102회 ${gap}` : "")
      + (vals.length && vals[0].ev < 101 ? " · 101회(2020)는 열리지 않았어요" : "");
  }
  // "이 목표를 이룬 적 n번 (88회 이후 17회 중)". 순위로 세는 것은 102 를 분자·분모에서 뺀다(§6)
  function achievedLine(rows, ok) {
    if (!rows.length) return "";
    const n = rows.filter(ok).length;
    return `이 목표를 이룬 적 ${n}번 <small>(${rows[0].ev}회 이후 ${rows.length}회 중)</small>`;
  }
  // 그 회차에 금메달 수 상위 3 안이었나(동률은 같은 자리)
  function goldTop3(k, ev) {
    const all = Object.values(S.history.sidos).map(h => (h.ranks[String(ev)] || [])[2]).filter(g => typeof g === "number");
    const g = (hist(k).ranks[String(ev)] || [])[2];
    return typeof g === "number" && all.filter(x => x > g).length < 3;
  }

  function entryGoals(k) {
    const v = S.snap && S.snap.sidos[k];
    if (!v) return [];
    const cands = v.target_candidates || [], has = key => cands.find(c => c.key === key) || null;
    const first = (...ks) => ks.map(has).find(Boolean) || null;
    const r = v.prev && v.prev.rank, best = hist(k) && hist(k).best ? hist(k).best.rank : null;
    const rows = histRows(k), ranked = rows.filter(p => p.rank !== null && p.rank !== undefined);
    const rankVals = rows.map(p => ({ ev: p.ev, v: p.rank }));
    const out = [], used = new Set();
    const push = g => { if (g && g.c && !used.has(g.c.key)) { used.add(g.c.key); out.push(g); } };
    const rankGraph = (ref, title) => rows.length ? miniLine(rankVals, { inv: true, ref, label: `${k} ${title} 순위 추이: ` + miniLabel(rankVals, "위", "순위 없음") }) : "";
    if (r) {
      const up = r > 1 ? first(`rank_le_${r - 1}`, `top${r - 1}`, "beat_prev_points") : first("beat_prev_points");
      // Y3-R3: 작년 1위는 "작년 점수 넘기", 이룬 적은 앞 회차와 견줄 수 있는 회차만(득점 null 인 102 제외 → 89회 이후 16회)
      const pairs = ranked.filter(p => p.pts !== null).map((p, i, a) => i ? Object.assign({}, p, { before: a[i - 1].pts }) : null).filter(Boolean);
      if (up) push({ id: "up", title: up.key === "beat_prev_points" && r === 1 ? "작년 점수 넘기" : "작년보다 위로", c: up, graph: rankGraph(r, "작년보다 위로"),
        done: up.key === "beat_prev_points" && r === 1 ? achievedLine(pairs, p => p.pts > p.before) : achievedLine(ranked, p => p.rank < r) });
      // Y3-R1: 작년 1위면 rank1. Y3-R6: 역대 최고가 꼴찌면 지키기 카드 없음
      const keep = best !== null && best >= 17 ? null : r === 1 ? first("rank1", "top1", "rank_le_1") : first(`top${r}`, `rank_le_${r}`);
      if (keep) push({ id: "keep", title: best === r ? "작년 자리 지키기 (역대 최고예요)" : "작년 자리 지키기", c: keep, graph: rankGraph(r, "작년 자리"),
        done: achievedLine(ranked, p => p.rank <= r) });
    }
    if (best && best !== r && best < 17) {
      const bc = best === 1 ? first("rank1", "top1", "rank_le_1") : first(`top${best}`, `rank_le_${best}`);
      if (bc) push({ id: "best", title: "역대 최고", c: bc, graph: rankGraph(best, "역대 최고"), done: achievedLine(ranked, p => p.rank === best) });
    }
    // 라이벌 앞서기: 목표는 그대로, 라이벌만 고른다(장면 1 의 두 번째 지역 또는 자동 라이벌). 작년의 나면 카드 없음
    const rk = S.entryRival || rivalAuto(k);
    if (rk && rk !== "prev" && S.snap.sidos[rk]) {
      const rr = histRows(rk), by = {};
      for (const p of rr) by[p.ev] = p;
      const both = rows.filter(p => by[p.ev]);
      const diff = both.map(p => ({ ev: p.ev, v: p.pts !== null && by[p.ev].pts !== null ? Math.round(p.pts - by[p.ev].pts) : null }));
      const cmp = both.filter(p => p.rank !== null && by[p.ev].rank !== null);
      out.push({ id: "rival", rival: rk, title: `${rk} 앞서기`, c: null,
        graph: both.length ? miniLine(diff, { ref: 0, label: `${F.josa(k, "과", "와")} ${rk}의 종합득점 차: ` + miniLabel(diff, "점", "순위 없음") }) : "",
        done: cmp.length ? `${esc(rk)}보다 위였던 적 ${cmp.filter(p => p.rank < by[p.ev].rank).length}번 <small>(${cmp[0].ev}회 이후 ${cmp.length}회 중)</small>` : "" });
    }
    const md = has("medal_top3");
    if (md && md.prob >= 0.01 && md.prob <= 0.99) {
      const gv = rows.map(p => ({ ev: p.ev, v: p.gold }));
      push({ id: "medal", title: "메달 순위 3위 안", c: md,
        graph: rows.length ? miniLine(gv, { label: `${k} 금메달 수 추이: ` + miniLabel(gv, "개") }) : "",
        done: rows.length ? `금메달 수 3위 안이었던 적 ${rows.filter(p => goldTop3(k, p.ev)).length}번 <small>(${rows[0].ev}회 이후 ${rows.length}회 중)</small>` : "" });
    }
    // Y3-R6: 사실상 정해진 목표(1% 이하·99% 이상)는 카드로 묻지 않는다. Y3-R2: 첫 카드는 늘 지금 가장 가까운 목표(v.target)
    // R8(재확인): 기본 목표와 같은 키의 카드는 빼고 첫 카드가 그 목표를 맡는다(안내 "그대로 두면 첫 카드" 와 맞게)
    const keepOut = out.filter(g => !g.c || (g.c.prob > 0.01 && g.c.prob < 0.99 && g.c.key !== v.target.key));
    return [{ id: "now", title: "지금 가장 가까운 목표", c: v.target, graph: rankGraph(r || null, "지금"), done: "" }].concat(keepOut);
  }

  function entryScene2() {
    const k = S.sido, v = S.snap && S.snap.sidos[k];
    if (!v) return card("올해 목표는?", `<p class="note">${S.snap ? "이 지역의 올해 전망이 아직 없어요." : "올해 전망을 받는 중이에요."} 건너뛰면 기본 목표로 볼게요.</p>`, "c-wide c-entry c-entry2");
    const goals = entryGoals(k), cur = chosenTarget(v);
    // 고른(기본은 지금) 목표 키가 다른 카드에도 있으면 그 카드만 on, 없으면 첫 카드
    const dup = goals.some(g => g.id !== "now" && g.c && g.c.key === cur.key);
    const isOn = g => !g.rival && g.c && g.c.key === cur.key && (g.id !== "now" || !dup);
    const cards = goals.map(g => `<button class="goal${isOn(g) ? " on" : ""}" data-goal="${esc(g.id)}" aria-pressed="${!!isOn(g)}">`
      + `<b class="goal-t">${esc(g.title)}</b>`
      + (g.c ? `<small class="goal-p">${esc(g.c.label)} · 올해 지금 ${esc(F.pct(g.c.prob))}</small>` : `<small class="goal-p">목표는 그대로 · 라이벌 ${esc(g.rival)}</small>`)
      + (g.graph || "") + (g.done ? `<small class="goal-d">${g.done}</small>` : "") + `</button>`).join("");
    const notes = S.history ? `<p class="note">101회(2020)는 코로나19로 열리지 않았어요. 102회(2021)는 종합순위를 매기지 않았어요.</p>` : "";
    const h = hist(k), hostLast = h && lastEv() && (h.hosted || []).includes(lastEv());
    return card("올해 목표는?", `<p class="note">하나 고르면 올해 내내 그 목표로 봐요. 그대로 두면 첫 카드예요.${hostLast ? " 작년은 개최지라 점수가 컸어요." : ""}</p>`
      + (cards ? `<div class="goals">${cards}</div>` : "") + notes, "c-wide c-entry c-entry2");
  }

  // ── 장면 3 좋아하는 종목(최대 10). 추천 5 = 작년 효자 종목(history top_classes, 역대 이름이 정본 — §6 R3) ──
  function entryRec(k) {
    const h = hist(k), ev = lastEv();
    return h && ev && h.top_classes && h.top_classes[String(ev)] ? h.top_classes[String(ev)].slice(0, 5).map(x => x[0]) : [];
  }
  // 고른 종목이 작년 득점에서 차지한 몫: Σ 고른 종목 class_total(history 상위 8 안) ÷ 작년 종합득점. 자료가 없으면 null
  function entryFavShare(k, fav) {
    const h = hist(k), ev = lastEv(), r = h && ev && h.ranks[String(ev)];
    if (!r || !r[1] || !h.top_classes || !h.top_classes[String(ev)]) return null;
    // Y3-R5: 분자는 추천 효자 종목(상위 5) 중 고른 것만
    const rec = h.top_classes[String(ev)].slice(0, 5).filter(x => fav.includes(x[0]));
    if (!rec.length) return null;
    return { share: rec.reduce((a, x) => a + x[1], 0) / r[1], n: rec.length };
  }
  function entryScene3() {
    const k = S.sido, draft = S.favDraft || S.fav.slice(), rec = entryRec(k);
    const chip = (nm, cls) => { const on = draft.includes(nm);
      return `<button class="chip${cls}${on ? " on" : ""}" data-efav="${esc(nm)}" aria-pressed="${on}"${!on && draft.length >= FAV_MAX ? " disabled" : ""}>${esc(F.hw(nm))}</button>`; };
    const all = S.snap ? classNames().filter(n => !rec.includes(n)) : [];
    const sh = entryFavShare(k, draft), more = S.entryAll;
    let h = `<p class="note">고른 종목의 경기를 "나의 경기"로 모아 드려요. 고르지 않아도 돼요. <span class="fav-n">${draft.length}/${FAV_MAX}</span></p>`;
    if (rec.length) h += `<h4 class="sum-h">${esc(k)} 효자 종목 <small>작년 득점이 큰 종목</small></h4><div class="chips en-rec" role="group" aria-label="${esc(k)} 효자 종목">${rec.map(n => chip(n, " rec")).join("")}</div>`;
    if (sh) h += `<p class="en-share">효자 종목 ${sh.n}개가 작년 ${esc(k)} 득점의 <b>${esc(F.pct(sh.share))}</b>`
      + `<span class="en-bar" role="img" aria-label="작년 득점의 ${esc(F.pct(sh.share))}"><i style="width:${(Math.min(1, sh.share) * 100).toFixed(1)}%"></i></span></p>`;
    // Y3-R7: 단추는 띠 바로 아래, 모든 종목은 접어 둔다
    h += `<div class="btn-row"><button class="act-btn primary" data-entry-fav="save"${draft.length ? "" : " disabled"}>이 종목으로 보기</button>`
      + `<button class="act-btn" data-entry-fav="none">종목 없이 보기</button></div>`;
    if (all.length) h += `<p class="en-alt"><button class="linkish dark" data-entry-all="1" aria-expanded="${!!more}">${more ? "다른 종목 접기" : `다른 종목도 고르기 (${all.length})`}</button></p>`
      + (more ? `<div class="chips fav-chips" role="group" aria-label="다른 종목">${all.map(n => chip(n, "")).join("")}</div>` : "");
    return card(`좋아하는 종목은? <small>최대 ${FAV_MAX}개</small>`, h, "c-wide c-entry c-entry3");
  }

  function entryScene4() {
    return returnCard("entry") + (S.people ? card("응원하는 선수·학교", peopleSearch(), "c-wide c-entry") : "")
      + `<div class="btn-row c-wide"><button class="act-btn link" data-entry-next="1">괜찮아요, 나중에</button></div>`;
  }

  // ── 마지막 응원 카드 ──
  function entryCardParts(k) {
    const v = S.snap && S.snap.sidos[k], t = v ? chosenTarget(v) : null, rv = v ? rivalOf(k) : null;
    return { t, rv, line: [t ? `목표 ${t.label}` : null, S.fav.length ? `종목 ${S.fav.length}개` : null, rv ? `라이벌 ${rv.name}` : null].filter(Boolean).join(" · ") };
  }
  function entryShareUrl(k) {
    const u = new URL(entryUrl(k));
    if (S.targetKey) u.searchParams.set("target", S.targetKey);
    return u.toString();
  }
  function entryShareText(k) {
    const p = entryCardParts(k);
    return `나는 ${F.sidoLabel(k)} 편이에요.` + (p.t ? ` 올해 목표는 ${p.t.label}` : "") + " — 체전 라이브";
  }
  function entryScene5() {
    const k = S.sido, p = entryCardParts(k);
    return `<section class="card c-wide c-entry c-entry5 en-card" aria-label="응원 카드"><p class="kick">응원 카드</p>`
      + `<h2 class="say">이제 ${esc(k)} 편이에요.</h2><p class="en-q">오늘 꼭 볼 경기부터 볼까요?</p><p class="en-sum">${esc(p.line)}</p>`
      + (CHEER_API && S.snap && S.snap.sidos[k] ? `<p class="en-shout">${esc(shoutText(k))}</p>` : "")
      + `<div class="btn-row"><button class="act-btn primary" data-entry-done="1">오늘 화면으로</button>`
      + `<button class="act-btn" data-entry-share="1">응원 링크 공유</button></div>`
      + (S.copied ? `<p class="note" role="status">${esc(S.copied)}</p>` : "") + `</section>`;
  }

  function entryView() {
    const n = S.entry;
    const scene = n === 1 ? entryScene1() : n === 2 ? entryScene2() : n === 3 ? entryScene3() : n === 4 ? entryScene4() : entryScene5();
    const prog = n <= 4 ? `<p class="en-prog" aria-label="4단계 중 ${n}단계">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}<span>${n}/4</span></p>` : "";
    const nav = n >= 2 && n <= 4 ? `<div class="btn-row en-nav"><button class="act-btn" data-entry-back="1">뒤로</button>${n < 4 ? `<button class="act-btn" data-entry-next="1">건너뛰기</button>` : ""}</div>` : "";
    return `<div class="entry" data-scene="${n}">${prog}<div class="grid">${scene}</div>${nav}</div>`;
  }

  function entryNext() {
    S.entry = Math.min(5, (S.entry || 1) + 1);
    if (S.entry === 5) store(ENTRY_KEY, JSON.stringify({ done: true, t: new Date().toISOString() }));
    S.copied = null;
    render();
    window.scrollTo(0, 0);
  }
  function entryGo() {
    const k = S.entryPick;
    if (!k) return;
    if (S.entryRival && S.entryRival !== k) {
      const o = rivalPrefs();
      o[k] = S.entryRival;
      store(RIVAL_KEY, JSON.stringify(o));
      setParam("rival", S.entryRival);
    }
    S.entry = 2;
    setSido(k, true);
    S.favAsk = false;      // 종목은 진입 장면 3 이 묻는다
    render();
    window.scrollTo(0, 0);
  }
  function entryGoal(id) {
    const k = S.sido, v = S.snap && S.snap.sidos[k], g = v && entryGoals(k).find(x => x.id === id);
    if (g && g.c) { S.targetKey = g.c.key === v.target.key ? null : g.c.key; setParam("target", S.targetKey); }
    if (g && g.rival) {
      const o = rivalPrefs();
      if (g.rival === rivalAuto(k)) delete o[k]; else o[k] = g.rival;
      store(RIVAL_KEY, JSON.stringify(o));
      S.rivalParam = null;
      setParam("rival", o[k] || null);
    }
    entryNext();
  }
  function endEntry() {
    S.entry = null; S.favAsk = false; S.favDraft = null; S.copied = null;
    store(ENTRY_KEY, JSON.stringify({ done: true, t: new Date().toISOString() }));
    if (S.tab !== "today") setTab("today"); else { history.replaceState(null, "", location.pathname + location.search + "#today"); render(); }
    window.scrollTo(0, 0);
  }

  // 검사용(tests/site_check.js): 진입 장면, 고른 종목 몫, 응원 링크
  window.ChejeonEntry = { scene: () => S.entry, share: fav => { const x = entryFavShare(S.sido, fav || S.fav); return x ? x.share : null; }, rec: () => entryRec(S.sido),
    url: () => (S.sido && S.snap ? entryShareUrl(S.sido) : ""), text: () => (S.sido && S.snap ? entryShareText(S.sido) : "") };

  // ── 우리 지역의 체전 이력(설계 15 Y4, ENTRY §2 Y4·§6). 레이스 탭 라이벌 카드 아래 한 곳. 자료 전부 history.json, 없으면 카드 없음 ──
  // 101회는 칸 없음(events 에 없다), 102회는 순위·득점 null → 순위 선 끊김, "앞선 적"·격차는 분자·분모에서 뺀다. 소수 득점은 원값으로 뺀 뒤 반올림
  function histSummary(us, rival) {
    const h = hist(us);
    if (!h) return null;
    const rows = histRows(us);
    if (!rows.length) return null;
    const ev = lastEv(), lastRow = h.ranks[String(ev)], hosts = S.history.hosts || {};
    const yr = e => histYear(e);
    const ranked = rows.filter(p => p.rank !== null && p.rank !== undefined);
    const evs = (h.best && h.best.events) || [], be = evs[evs.length - 1];
    const hosted = (h.hosted || []).map(e => ({ ev: e, year: yr(e), rank: (h.ranks[String(e)] || [])[0] ?? null }));
    const nowEv = evNo() || ev + 1, nowHost = !!(hosts[String(nowEv)] && hosts[String(nowEv)].sido === us);
    const next = Object.keys(hosts).map(Number).filter(e => e > nowEv && hosts[String(e)].sido === us && !hosts[String(e)].cancelled).sort((a, b) => a - b)[0];
    // 매 회 꼴찌: 그 회차 순위가 있는 시도 수와 같다
    const nOf = e => Object.values(S.history.sidos).filter(x => x.ranks[String(e)] && x.ranks[String(e)][0] !== null).length;
    const allLast = ranked.length > 0 && ranked.every(p => p.rank === nOf(p.ev));
    const bestPts = rows.filter(p => p.pts !== null).reduce((a, p) => (!a || p.pts > a.pts ? p : a), null);
    const out = { from: rows[0].ev, fromYear: yr(rows[0].ev), n: ranked.length,
      best: h.best && h.best.rank ? { rank: h.best.rank, ev: be || null, year: be ? yr(be) : null, n: evs.length, events: evs.slice() } : null,
      last: lastRow ? { ev, rank: lastRow[0], hosted: (h.hosted || []).includes(ev) } : null, hosted, now: nowHost ? { ev: nowEv, year: yr(nowEv) } : null,
      next: next ? { ev: next, year: yr(next) } : null, allLast, bestPts: bestPts ? { ev: bestPts.ev, year: yr(bestPts.ev), pts: Math.round(bestPts.pts) } : null,
      ranks: rows.map(p => ({ ev: p.ev, v: p.rank })),
      top3: ((h.top_classes || {})[String(ev)] || []).slice(0, 3).map(x => [x[0], Math.round(x[1]), x[2]]), gaps: [], ahead: null, of: null, rival: null, rivalFrom: null };
    const rh = rival && rival !== us ? hist(rival) : null;
    if (rh) {
      const both = ranked.filter(p => p.pts !== null && rh.ranks[String(p.ev)] && rh.ranks[String(p.ev)][0] !== null);
      out.rival = rival;
      out.gaps = both.slice(-5).map(p => ({ ev: p.ev, v: Math.round(p.pts - rh.ranks[String(p.ev)][1]) }));
      out.ahead = both.filter(p => p.rank < rh.ranks[String(p.ev)][0]).length;
      out.of = both.length;
      out.rivalFrom = both.length ? both[0].ev : null;
    }
    return out;
  }

  // 이력 카드 머리 한 문장(Y4-R1, 해요체, 위에서부터 첫 매칭)
  function histLead(us, s) {
    if (s.now) {
      const prev = s.hosted.filter(x => x.rank !== null).pop();
      return `올해는 안방이에요. ` + (prev ? `지난 안방 ${prev.ev}회(${prev.year})엔 ${prev.rank}위였어요` : "첫 개최예요");
    }
    if (s.allLast) return `${s.from}회(${s.fromYear})에 합류한 막내예요`;
    if (s.best && s.last && s.best.n === 1 && s.best.ev === s.last.ev) return `작년 ${s.last.rank}위, ${s.from}회 이후 가장 높았어요`;
    if (s.best && s.best.n * 2 >= s.n) return `${s.n}회 중 ${s.best.n}번 ${s.best.rank}위였어요`;
    return s.best ? `역대 최고는 ${s.best.ev}회(${s.best.year})의 ${s.best.rank}위였어요` : "";
  }

  // 작년의 나가 라이벌이면 작년 종합득점에서 바로 위 시도(1위면 바로 아래)로 대체(Y4-R8)
  function histRival(us) {
    const rv = S.snap && rivalOf(us);
    if (!rv) return null;
    if (!rv.prev) return { key: rv.key, label: `라이벌 ${F.josa(rv.key, "과", "와")}` };
    const ev = lastEv(), pts = k => { const r = hist(k) && hist(k).ranks[String(ev)]; return r && r[1] !== null ? r[1] : null; };
    const me = pts(us);
    if (me === null) return null;
    const others = Object.keys(S.history.sidos).filter(k => k !== us && pts(k) !== null);
    const up = others.filter(k => pts(k) > me).sort((a, b) => pts(a) - pts(b))[0];
    const dn = others.filter(k => pts(k) < me).sort((a, b) => pts(b) - pts(a))[0];
    const k = up || dn;
    return k ? { key: k, label: `${up ? "바로 위" : "바로 아래"} ${F.josa(k, "과", "와")}` } : null;
  }

  // 최근 다섯 회 격차 막대(120×32, 0 선 위아래, 선형, 최소 3px — 크기가 아니라 앞·뒤 무늬). aria-label 에 값을 모두 적는다
  function gapBars(gs, label) {
    const W = 120, H = 32, m = Math.max(1, ...gs.map(g => Math.abs(g.v))), bw = W / gs.length;
    const bars = gs.map((g, i) => { const hh = Math.max(3, Math.abs(g.v) / m * (H / 2 - 1));
      return `<rect class="${g.v >= 0 ? "gb-up" : "gb-dn"}" x="${(i * bw + 3).toFixed(1)}" y="${(g.v >= 0 ? H / 2 - hh : H / 2).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${hh.toFixed(1)}"/>`; }).join("");
    return `<svg class="mini gbars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><line class="mini-ref" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>${bars}</svg>`;
  }

  function historyCard(us) {
    const hr = S.history ? histRival(us) : null;
    const s = histSummary(us, hr ? hr.key : null);
    if (!s) return "";
    const row = (k, v) => `<div class="hi-row"><span class="hi-k">${k}</span><span class="hi-v">${v}</span></div>`;
    let h = "";
    const lead = histLead(us, s);
    if (lead) h += `<p class="hi-lead">${esc(lead)}</p>`;
    // Y4-R3 사실 줄
    const facts = [];
    const lastTxt = s.last && s.last.rank ? `작년 <b>${s.last.rank}위</b>` : "";
    if (s.allLast) {
      if (lastTxt) facts.push(lastTxt + (s.last.hosted ? " · 개최지" : ""));
      if (s.bestPts) facts.push(`역대 최고 득점 <b>${esc(F.num(s.bestPts.pts))}점</b> <small>(${s.bestPts.ev}회·${s.bestPts.year})</small>`);
    } else if (s.best && s.last && s.best.rank === s.last.rank && s.best.events.includes(s.last.ev)) {
      facts.push(`${lastTxt} · 역대 최고${s.last.hosted ? " · 개최지" : ""}`);
    } else {
      if (s.best) facts.push(`역대 최고 <b>${s.best.rank}위</b> <small>(${s.best.n > 1 ? `${s.best.n}번` : `${s.best.ev}회·${s.best.year}`})</small>`);
      if (lastTxt) facts.push(lastTxt + (s.last.hosted ? " · 개최지" : ""));
    }
    if (facts.length) h += `<p class="hi-top">${facts.join(`<span class="hi-sep"> · </span>`)}</p>`;
    const lbl = `${us} 순위 추이: ` + miniLabel(s.ranks, "위", "순위 없음");
    h += row("순위 추이", miniLine(s.ranks, { inv: true, ref: s.last ? s.last.rank : null, label: lbl }) || "–");
    // Y4-R2·R6 개최 줄(시도 이름 없이)
    const host = s.hosted.map(x => `${x.year}(${x.ev}회)`);
    if (s.now) host.push(`올해 개최(${s.now.ev}회)`);
    if (s.next) host.push(`다음 개최 ${s.next.year}(${s.next.ev}회)`);
    h += row("개최", esc(s.hosted.length || s.now ? host.join(" · ") : ["아직 개최한 적 없어요"].concat(s.next ? [`다음 개최 ${s.next.year}(${s.next.ev}회)`] : []).join(" · ")));
    // Y4-R4 효자 종목: 종목 안 순위(4위 이상은 이름만), 득점은 title·aria
    if (s.top3.length) h += row("작년 효자 종목", s.top3.map(([n, v, r]) => `<span title="${esc(F.num(v))}점" aria-label="${esc(F.hw(n))} ${esc(F.num(v))}점${r ? ` ${r}위` : ""}">`
      + `${esc(F.hw(n))}${r && r <= 3 ? ` ${r}위` : ""}</span>`).join(" · "));
    if (s.rival && s.gaps.length) {
      const g = s.gaps, last = g[g.length - 1], glabel = `최근 ${g.length}회 ${F.josa(s.rival, "과", "와")}의 종합득점 차: ` + g.map(x => `${x.ev}회 ${F.signed(x.v)}점`).join(", ");
      const span = `(${s.rivalFrom}회 이후 ${s.of}회 중)`;
      const ahead = s.ahead === 0 ? `아직 앞선 적 없어요 <small>${span}</small>` : s.ahead === s.of ? `${s.of}회 모두 앞섰어요` : `앞선 적 <b>${s.ahead}번</b> <small>${span}</small>`;
      h += row(esc(hr.label), `${gapBars(g, glabel)} <small>${last.ev === lastEv() ? "작년" : last.ev + "회"} ${esc(F.signed(last.v))}점</small><br>${ahead}`);
    }
    // Y4-R9 101·102 각주는 카드 끝 한 줄
    h += `<p class="hi-note">101회(2020)는 코로나19로 열리지 않았고, 102회(2021)는 종합순위를 매기지 않았어요</p>`;
    return card(`${esc(us)}의 체전 이력 <small>${s.from}회(${s.fromYear})부터</small>`, h, "c-wide c-history");
  }

  // 검사용(tests/site_check.js): 이력 요약 셈
  window.ChejeonHistory = { summary: (us, rival) => histSummary(us, rival), loaded: () => !!S.history,
    lead: us => { const s = histSummary(us, null); return s ? histLead(us, s) : ""; } };

  // ── 체전 상식 퀴즈 카드(설계 15 Y5): 오늘 탭, 하루 한 문제. 보상·점수·누적 표시 없음. 다시 보기·남의 카드에서는 저장하지 않는다 ──
  const QUIZ_KEY = "chejeon.quiz", QUIZ_DAYS = 60;
  function readQuiz() {
    try { const o = JSON.parse(store(QUIZ_KEY) || "null"); return o && o.v === 1 && o.days && typeof o.days === "object" ? o : { v: 1, days: {} }; } catch (e) { return { v: 1, days: {} }; }
  }
  function quizSaveable() { return !S.snapshotPath && !othersCard(); }
  function todayQuiz(us) {
    if (!S.history || !us || !S.history.sidos || !S.history.sidos[us]) return null;
    const dk = String(F.dayKey(refNow())), rv = S.snap && rivalOf(us);
    const q = F.quiz(S.history, us, dk, { fav: S.fav, rival: rv && !rv.prev ? rv.key : null });
    return q ? Object.assign(q, { dk }) : null;
  }
  function quizPicked(q) {
    if (S.quizPick && S.quizPick.id === q.id) return S.quizPick.pick;
    if (!quizSaveable()) return null;
    const d = readQuiz().days[q.dk];
    return d && d.id === q.id ? d.pick : null;
  }
  function answerQuiz(i) {
    const q = todayQuiz(S.sido);
    if (!q || quizPicked(q) !== null) return;
    const pick = q.options[+i];
    if (pick === undefined) return;
    S.quizPick = { id: q.id, pick };
    if (quizSaveable()) {
      const o = readQuiz();
      o.days[q.dk] = { id: q.id, pick, ok: pick === q.answer };
      const ks = Object.keys(o.days).sort();
      for (const k of ks.slice(0, Math.max(0, ks.length - QUIZ_DAYS))) delete o.days[k];
      store(QUIZ_KEY, JSON.stringify(o));
    }
    render();
  }
  // "답은 {정답}이에요": 끝 글자(괄호·기호 앞의 한글) 받침으로 고른다
  function iyeyo(w) { const b = String(w).replace(/[^가-힣]+$/, ""); return w + (F.josa(b || "가", "이", "") !== (b || "가") + "이" ? "예요" : "이에요"); }
  function quizCard(us) {
    const q = todayQuiz(us);
    if (!q) return "";
    const pick = quizPicked(q), done = pick !== null;
    let h = `<p class="qz-q">${esc(q.q)}</p><div class="qz-opts" role="group" aria-label="보기">`
      + q.options.map((o, i) => `<button class="qz-o${done && o === q.answer ? " ans" : ""}${done && o === pick ? " pick" : ""}" data-quiz="${i}"${done ? " disabled" : ""}`
        + ` aria-pressed="${done && o === pick}">${esc(F.hw(o))}</button>`).join("") + `</div>`;
    if (done) {
      h += `<p class="qz-r" role="status">${pick === q.answer ? "정답이에요" : `답은 ${esc(iyeyo(F.hw(q.answer)))}`}</p><p class="note">${esc(q.note)}</p>`;
      if (q.cls) {
        const now = refNow(), day = F.dayKey(now);
        const ms = allMatches().filter(m => m.class_nm === q.cls && !finished(m) && sched(m) && sched(m).day === day)
          .sort((a, b) => sched(a).start - sched(b).start);
        h += ms.length
          ? `<p class="qz-next">오늘 ${esc(F.hw(q.cls))} ${sched(ms[0]).timed ? esc(F.hm(sched(ms[0]).start)) + " " : ""}${esc(F.shortKind(ms[0].kind_nm || ""))} ${esc(F.hw(ms[0].round_nm || ""))} <button class="linkish dark" data-quiz-go="watch">경기 보기</button></p>`
          : `<p class="qz-next">오늘은 ${esc(F.hw(q.cls))} 경기가 없어요. <button class="linkish dark" data-quiz-go="race">레이스에서 올해 전망 보기</button></p>`;
      } else h += `<p class="qz-next"><button class="linkish dark" data-quiz-go="history">${q.other ? `${esc(F.sidoLabel(us))} 이력 카드 보기` : "이력 카드 보기"}</button></p>`;     // Y5-R4
    }
    return card("오늘의 체전 상식", h, "c-wide c-quiz");
  }
  function quizGo(where) {
    // Y5-R2: 관심 종목이면 "나의 종목", 아니면 오늘 칩(전체 목록에선 말한 경기를 찾기 어렵다). 종목 단위 칩은 108회
    if (where === "watch") { const q = todayQuiz(S.sido); S.filter = q && S.fav.includes(q.cls) ? "fav" : "d1"; S.shown = PAGE; setTab("watch"); return; }
    setTab("race");
    if (where === "history") setTimeout(() => { const c = document.querySelector(".c-history"); if (c) c.scrollIntoView({ block: "start" }); }, 0);
  }
  // 검사용(tests/site_check.js)
  window.ChejeonQuiz = { today: () => todayQuiz(S.sido), saved: () => readQuiz() };

  // ── 오늘의 외침(설계 15 Y6, docs/ENTRY.md §2 Y6·§0, 계약 docs/DEPLOY.md §13-N2). 상황이 정한 숫자 없는 한 문장 + [같이 외치기] + "같이 외친 n명" ──
  // 사람이 고르는 숫자·선택지·판정어 없음. 오늘 탭에서 느낌표는 이 문장 하나. CHEER_API 가 비면 흔적 0
  const SHOUT_KEY = "chejeon.shout";
  function kstDay(ms) { return new Date((ms === undefined ? Date.now() : ms) + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ""); }
  // 다시 보기는 그 스냅샷 날짜, 그 밖은 한국 시각 오늘(N2 규칙 ①)
  function shoutDay() { return S.snapshotPath ? String(F.dayKey(refNow())) : kstDay(); }
  function shoutOn() { return !!CHEER_API && !!evNo() && !!S.sido && !!S.snap && !!S.snap.sidos[S.sido]; }
  // 보낼 수 있는 곳: 실시간·내 지역(다시 보기·남의 응원 카드는 GET 만, 규칙 ④)
  function shoutCanSend() { return shoutOn() && !S.snapshotPath && !othersCard(); }
  function shoutSent(us) {
    try { const o = JSON.parse(store(SHOUT_KEY) || "null"); return !!o && o.day === kstDay() && o.sido === us; } catch (e) { return false; }
  }
  function shoutText(us) {
    const gs = gapState(us);
    if (!gs) return `오늘도 ${F.sidoLabel(us)} 가자!`;
    if (gs.rv.prev) return "오늘 작년의 우리를 넘자!";
    const R = F.sidoLabel(gs.rv.key);
    return gs.gap < 0 ? `오늘 ${R} 따라붙자!` : gs.gap > 0 ? `오늘 ${F.josa(R, "과", "와")} 더 벌리자!` : `오늘 ${R}보다 앞서자!`;
  }
  // 보일 수: 받은 수 + 이 기기에서 방금 누른 1(낙관적). 못 받았거나 0 이면 0(숨김, 규칙 ③)
  function shoutN(us) {
    const x = S.shout;
    if (!x || x.key !== `${evNo()}|${shoutDay()}` || !x.counts) return 0;
    return (x.counts[us] || 0) + (x.bump === us ? 1 : 0);
  }
  function shoutNText(us) { const n = shoutN(us); return n > 0 ? `같이 외친 ${F.num(n)}명` : ""; }
  async function loadShout() {
    if (!shoutOn()) return;
    const day = shoutDay(), key = `${evNo()}|${day}`;
    if (S.shout && S.shout.key === key && Date.now() - S.shout.at < 30000) return;     // 30초 안 다시 받지 않는다(규칙 ②)
    const prev = S.shout && S.shout.key === key ? S.shout : null;
    S.shout = { key, counts: prev ? prev.counts : null, at: Date.now(), bump: prev ? prev.bump : null };
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const tm = ac ? setTimeout(() => ac.abort(), 3000) : null;     // 약 3초, 화면을 막지 않는다(규칙 ⑤)
    let counts = null;
    try {
      const r = await fetch(`${CHEER_API}/shout?event=${encodeURIComponent(evNo())}&day=${day}`, { cache: "default", signal: ac ? ac.signal : undefined });
      if (!r.ok) throw new Error("shout " + r.status);
      const j = await r.json();
      if (!j || typeof j.counts !== "object" || !j.counts) throw new Error("shout form");
      counts = {};
      for (const k of SIDOS) { const n = Math.floor(+j.counts[k]); counts[k] = n > 0 ? n : 0; }
    } catch (e) { counts = null; }
    if (tm) clearTimeout(tm);
    if (!S.shout || S.shout.key !== key) return;
    // 새로 받은 수에는 방금 누른 것이 이미 들어 있을 수 있다 → 받으면 낙관적 +1 을 거둔다
    S.shout.counts = counts;
    if (counts) S.shout.bump = null;
    paintShout();
  }
  function paintShout() {
    const t = shoutNText(S.sido);
    document.querySelectorAll("[data-shout-n]").forEach(e => { e.textContent = t; e.hidden = !t; });
    document.querySelectorAll("[data-shout-sep]").forEach(e => { e.hidden = !t; });
  }
  function sendShout() {
    const us = S.sido;
    if (!shoutCanSend() || shoutSent(us)) return;
    const day = kstDay(), key = `${evNo()}|${day}`;
    store(SHOUT_KEY, JSON.stringify({ day, sido: us }));
    if (!S.shout || S.shout.key !== key) S.shout = { key, counts: null, at: 0, bump: null };
    S.shout.bump = us;
    S.shout.at = Date.now();
    // 응답과 무관하게 기기에 적고 단추를 닫는다(N2 계약). text/plain 이라 OPTIONS 없이 간다
    fetch(`${CHEER_API}/shout`, { method: "POST", headers: { "Content-Type": "text/plain" }, keepalive: true,
      body: JSON.stringify({ sido: us, event: +evNo(), day }) }).catch(() => {});
    render();
  }
  // 오늘 탭 머리 바로 아래 한 줄 띠(아침·경기 중)
  function shoutBand(us) {
    if (!shoutOn()) return "";
    const n = shoutNText(us), can = shoutCanSend(), sent = can && shoutSent(us);
    return `<section class="c-wide c-shout" aria-label="오늘의 외침"><p class="sh-t">${esc(shoutText(us))}</p>`
      // Y6-R3: 누른 뒤에는 단추 자리에 "외쳤어요"(같은 날 새로 열어도, 수가 숨어도)
      + (sent ? `<span class="sh-did">외쳤어요</span>` : can ? `<button class="act-btn primary sh-b" data-shout="1">같이 외치기</button>` : "")
      + `<span class="sh-n num" data-shout-n="1" aria-live="polite"${n ? "" : " hidden"}>${esc(n)}</span></section>`;
  }
  // 저녁(다시 보기 포함): 마무리 카드 안 한 줄 "오늘의 외침 · 오늘 서울 따라붙자! · 같이 외친 1,204명". 단추 없음, 판정어 없음.
  // 격차 움직임은 붙이지 않는다(외침의 결과처럼 읽히고, 머리·하이라이트에 이미 있다, Y6-R1)
  function shoutEveLine(us) {
    if (!shoutOn()) return "";
    const n = shoutNText(us);
    return `<p class="sh-eve"><small class="sh-k">오늘의 외침</small><span class="sh-sep" aria-hidden="true">·</span><b class="sh-t">${esc(shoutText(us))}</b>`
      + `<span class="sh-sep" aria-hidden="true"${n ? "" : " hidden"} data-shout-sep="1">·</span><span class="sh-n num" data-shout-n="1"${n ? "" : " hidden"}>${esc(n)}</span></p>`;
  }

  // ── 수동 입력 경기 중 승률(설계 15 Y7, 분기 B — 상세 페이지 갱신 조사 §7). 공식 사이트가 경기 중 점수를 주지 않아 운영자가 입력한 1~2경기만 ──
  // 한 줄 카드의 승률 자리만 바꾼다. 헤드라인·격차·목표 확률·"지금" 띠·하이라이트는 건드리지 않는다. 다음이면 흔적 0:
  // 파일 없음·빈 matches·as_of 15분 지남·다시 보기·그 경기가 오늘 목록 밖(다른 날, 끝난 경기 — 결과가 우선)
  const MANUAL_STALE_MS = 15 * 60e3;
  function liveOf(m) {
    const L = S.live;
    if (!L || S.snapshotPath || !m || !m.match_key) return null;
    const at = F.parseTime(L.as_of);
    if (!at || Date.now() - at.getTime() > MANUAL_STALE_MS) return null;
    const x = L.matches[m.match_key];
    if (!x || x.form !== "set" || !Array.isArray(x.sides) || x.sides.length !== 2 || !Array.isArray(x.sets) || typeof x.p_live !== "number") return null;
    if (finished(m) || m.status === "종료") return null;
    const sc = sched(m);
    if (!sc || sc.day !== F.dayKey(new Date())) return null;
    return x;
  }
  // "부산 64% ─ 서울 36%" + 작은 글자 "세트 1-1 · 3세트 5-3 · 수동 입력"(cur 없으면 세트만). 점수는 공식 페이지 왼쪽(sides[0])이 앞
  function liveProbs(x, us) {
    const [a, b] = x.sides, wa = x.sets.filter(s => s[0] > s[1]).length, wb = x.sets.filter(s => s[1] > s[0]).length;
    const nm = (k, p) => `<b${k === us ? ' class="us"' : ""}>${esc(k)}</b> ${esc(F.pct(p))}`;
    const sub = [`세트 ${wa}-${wb}`].concat(Array.isArray(x.cur) && x.cur.length === 2 ? [`${x.sets.length + 1}세트 ${x.cur[0]}-${x.cur[1]}`] : []).join(" · ");
    // Y7-R1: 승률 쌍과 "· 수동 입력" 은 끊기지 않게 묶는다
    return `<span class="lv-main">${nm(a, x.p_live)} ─ ${nm(b, 1 - x.p_live)}</span><small class="lv-sub"> ${esc(sub)} <span class="lv-tag-w">· <span class="lv-tag">수동 입력</span></span></small>`;
  }
  // 검사용(tests/site_check.js)
  window.ChejeonLive = { of: key => { const m = allMatches().find(x => x.match_key === key); return m ? liveOf(m) : null; } };

  // ── 지역 고르기 ───────────────────────────────────────────────────────
  function chooserInner() {
    return `<div class="chooser">${SIDOS.map(s =>
      `<button class="pick-sido" data-sido="${esc(s)}">${esc(s)}</button>`).join("")}</div>`
      + `<p class="note">선택은 이 기기에 기억됩니다. 주소에 ?sido=경기 처럼 넣어 공유할 수 있습니다.</p>`;
  }

  // ── 해설 카드 (docs/DESIGN.md §7). 숫자는 전부 전망 수치에서 왔고, 문장은 코드가 검증한 것만 남아 있다 ──
  function commentaryCard(us) {
    const c = S.commentary;
    if (!c || !S.snap) return "";
    const part = us ? (c.sidos || {})[us] : c.national;
    if (!part || !part.sentences || !part.sentences.length) return "";
    const model = part.source === "model";
    const basedOn = F.parseTime(c.based_on), snapT = F.parseTime(S.snap.generated_at);
    const stale = basedOn && snapT && snapT - basedOn > 30 * 60 * 1000;
    const head = (model ? "AI 해설" : "요약") + " · 자동 생성" + (basedOn ? ` · ${esc(F.hm(basedOn))} 전망 기준` : "")
      + (stale ? ' <span class="warn">(이전 전망 기준)</span>' : "");
    // 해설 문장도 F.hw: L3 이전 엔진이 만든 해설에는 "예선경기２" 같은 전각 이름이 남아 있다(§11-14 M4, 10-05 실가동)
    return card(head, `<p class="comment">${part.sentences.map(x => esc(F.hw(x))).join(" ")}</p>`
      + `<p class="note">${model ? "이 해설은 위 전망 수치를 언어 모델이 문장으로 옮긴 것입니다. " : "이 요약은 전망 수치를 정해진 틀로 옮긴 것입니다. "}`
      + `숫자는 모두 전망 수치에서 왔습니다.</p>`, "c-comment");
  }

  // ── 레이스 탭: 목표 머리 → 트랙 → 순위 분포·메달 → 해설 → 전국(옛 탭 1 머리·트랙 + 옛 탭 4, §6-1) ──
  function renderRace(us) {
    const s = S.snap, v = us ? s.sidos[us] : null;
    if (!us) return card("어느 지역을 보시겠어요?", chooserInner(), "c-wide") + trackCard(null) + nationCards(null);
    if (!v) return empty("이 지역의 전망이 없습니다.");
    const cands = v.target_candidates || [];
    const chosen = (S.targetKey && cands.find(c => c.key === S.targetKey)) || v.target;
    const prev = v.prev && v.prev.rank ? `<p class="sub">작년(제${esc(v.prev.event_no)}회): ${esc(v.prev.rank)}위 · ${esc(F.num(v.prev.points))}점</p>` : "";
    const opts = cands.map(c => `<option value="${esc(c.key)}"${c.key === chosen.key ? " selected" : ""}>${esc(c.label)} · ${esc(F.pct(c.prob))}${c.key === v.target.key ? " (기본)" : ""}</option>`).join("");
    const note = chosen.key !== v.target.key
      ? `<p class="note">경기 카드의 이기면·지면 확률과 영향은 기본 목표(${esc(v.target.label)}) 기준입니다. 고른 목표 기준 영향도는 아직 제공하지 않습니다.</p>` : "";
    const fin = showReveal() ? S.outcomes.sidos[us] : null;
    let real = "";
    if (fin) {
      const ok = achieved(chosen.key, us, v.prev && v.prev.points);
      real = `<p class="reveal">실제: 종합 ${esc(fin.rank)}위 · ${esc(F.num(fin.points))}점`
        + (ok === null ? "" : ok ? " — 목표를 이뤘습니다" : " — 목표에 못 미쳤습니다") + officialNote() + `</p>`;
    }
    let html = homeHead(us, v, chosen, `${real}${prev}`
      + (cands.length ? `<label class="tsel">목표 바꾸기 <select id="target-select">${opts}</select></label>` : "") + note);
    html += rivalCard(us);
    html += historyCard(us);

    let trackFoot = "";
    if (fin) {
      trackFoot = `<p class="reveal">실제 득점 ${esc(F.num(fin.points))}점 `
        + (fin.points < v.points_p10 ? `(80% 범위 밖, 아래로 ${esc(F.num(v.points_p10 - fin.points))}점)`
          : fin.points > v.points_p90 ? `(80% 범위 밖, 위로 ${esc(F.num(fin.points - v.points_p90))}점)` : "(80% 범위 안)")
        + officialNote() + `</p>`;
    }
    html += trackCard(us, trackFoot);

    const rp = v.rank_probs || [];
    const k = argmax(rp);
    html += card("종합순위 전망", rankChart(rp, `${us} 종합순위 분포`)
      + `<p class="lead">${k + 1}위가 가장 가까워요(${esc(F.pct(rp[k]))})</p>`
      + `<dl class="kv"><dt>예상 득점</dt><dd><span class="num">${esc(F.num(v.points_mean))}</span><br><small class="nw">80% 범위 ${esc(F.num(v.points_p10))} ~ ${esc(F.num(v.points_p90))}</small></dd>`
      + `<dt>확정 득점</dt><dd><span class="num">${esc(F.num((s.points_now || {})[us] || 0))}</span><br><small class="nw">${confirmedNote(s)}</small></dd>`
      + `<dt>남은 세부종목</dt><dd>${esc(F.num(s.remaining_events))} <small>(전국 공통)</small></dd></dl>`, "c-rank");
    html += classWaterfall(us);

    const mm = v.medals_mean || [0, 0, 0], lo = v.medals_p10 || [], hi = v.medals_p90 || [];
    const mk = v.medal_rank_probs ? argmax(v.medal_rank_probs) : null;
    const medal = ["금", "은", "동"].map((n, i) => `<div class="medal m${i}"><span class="mn">${n}</span>`
      + `<span class="mv">${esc(F.num(mm[i]))}</span>`
      + (lo.length ? `<small>${esc(F.num(lo[i]))}~${esc(F.num(hi[i]))}</small>` : "") + `</div>`).join("");
    html += card("메달 전망 <small>(종합순위와 다른 집계)</small>", `<div class="medals">${medal}</div>`
      + (mk !== null ? `<p class="lead">메달 순위 ${mk + 1}위가 가장 가까워요(${esc(F.pct(v.medal_rank_probs[mk]))})</p>` : "")
      + `<p class="note">예상 개수와 80% 범위</p>`, "c-medal");
    html += commentaryCard(us);
    return html + nationCards(us);
  }

  function watchTop3(us) {
    const v = S.snap.sidos[us];
    const w = (v.watch || []).slice(0, 3).map(x => matchRow(matchByKey(x.match_key) || watchFallback(x), us));
    return card("오늘 꼭 볼 경기 3", w.length ? `<div class="mrows">${w.join("")}</div>` + `<button class="more" data-goto="watch">경기 더 보기</button>`
      : empty("우리 목표에 영향이 큰 남은 경기가 없습니다."), "c-watch");
  }

  // 목표 확률을 큰 숫자로. "1% 미만"·"99% 이상" 은 숫자 옆에 작은 글자로
  function bigParts(p) {
    const t = F.pct(p), m = /^(\d+)%\s*(.*)$/.exec(t);
    return m ? { n: +m[1], q: m[2] } : { n: Math.round(p * 100), q: "" };
  }

  function homeHead(us, v, chosen, more) {
    const s = S.snap;
    const left = s.remaining_events === 0 ? "모든 세부종목이 끝났습니다"
      : !s.completed_events ? `개막 전 전망입니다 · 세부종목 ${esc(F.num(s.remaining_events))}개`
        : `세부종목 ${esc(F.num(s.remaining_events))}개가 남았습니다`;
    // 처음 점과 지금의 목표 확률(같은 목표일 때만)
    const pts = timelinePoints().filter(p => p.sidos[us] && p.sidos[us].target_key === chosen.key);
    let trend = "";
    if (pts.length >= 2) {
      const a = pts[0];
      const named = points().find(x => { const t = F.parseTime(x.data_as_of); return t && Math.abs(t - a.t) < 60e3; });
      const aLabel = named ? named.label : a.completed === 0 ? "개막 전" : F.md(a.t);
      const cur = curPoint();
      trend = `<p class="trend-line">${esc(aLabel)} ${esc(F.pct(a.sidos[us].target_prob))} → `
        + `<b>${S.snapshotPath ? esc(cur ? cur.label : "이 시점") : "지금"} ${esc(F.pct(chosen.prob))}</b></p>`;
    }
    const bp = bigParts(chosen.prob);
    return `<section class="head c-head" aria-label="우리 지역 목표"><div><p class="kick">우리 지역 목표</p>`
      + `<h2 class="say">${esc(us)}의 목표 <mark>${esc(chosen.label)}</mark><small>${left}</small></h2>${trend}</div>`
      + `<div class="clock"><div class="big" role="img" aria-label="목표 확률 ${esc(F.pct(chosen.prob))}">`
      + `<span class="v" data-n="${bp.n}">${bp.n}</span><span class="u">%</span>${bp.q ? `<span class="q">${esc(bp.q)}</span>` : ""}</div>`
      + `<dl><dt>이대로면</dt><dd>${esc(F.num(v.points_mean))}점</dd><dt>지금까지</dt><dd>${esc(F.num((s.points_now || {})[us] || 0))}점</dd></dl></div>`
      + `<div class="head-more">${more}</div></section>`;
  }

  // ── 트랙: 17개 시도 레인 (docs/DASHBOARD.md §11-4) ──────────────────────
  function timelinePoints() {
    // 다시 보기에서는 그 시점 뒤의 점을 쓰지 않는다(§10-3)
    const cut = S.snapshotPath && S.snap ? F.parseTime(S.snap.data_as_of) : null;
    return ((S.timeline && S.timeline.points) || []).map(p => ({ t: F.parseTime(p.t), completed: p.completed, sidos: p.sidos || {} }))
      .filter(p => p.t && (!cut || p.t <= cut));
  }

  function laneState() {
    const s = S.snap, out = {};
    for (const [k, v] of Object.entries(s.sidos)) {
      out[k] = { m: v.points_mean, n: (s.points_now || {})[k] || 0, lo: v.points_p10, hi: v.points_p90 };
    }
    return out;
  }

  function laneOrder(st) { return Object.keys(st).sort((a, b) => st[b].m - st[a].m); }

  function trackScale(st) {
    // 재생 중에도 눈금이 움직이지 않게 지금 시점까지의 추이와 실제 득점도 넣어 한 번 정한다
    let mx = 1;
    for (const k in st) mx = Math.max(mx, st[k].hi || 0, st[k].m || 0);
    for (const p of timelinePoints()) for (const k in p.sidos) mx = Math.max(mx, p.sidos[k].points_mean || 0);
    if (showReveal()) for (const k in S.outcomes.sidos) mx = Math.max(mx, S.outcomes.sidos[k].points || 0);
    return mx * 1.04;
  }

  function pc(x, mx) { return (Math.max(0, x || 0) / mx * 100).toFixed(2) + "%"; }

  // 80% 범위 선. 아래 끝이 0 보다 작게 나와도(득점 규칙에 따라 가능) 칸 왼쪽에서 시작한다
  function rgLeft(v, mx) { return pc(v.lo, mx); }
  function rgWidth(v, mx) { return pc((v.hi || 0) - Math.max(0, v.lo || 0), mx); }

  function playScenes() {
    let pts = timelinePoints();
    if (pts.length > 12) {
      const byDay = new Map();
      for (const p of pts) byDay.set(F.dayKey(p.t), p);
      pts = [...byDay.values()];
      if (pts.length > 12) { const st = Math.ceil(pts.length / 12); pts = pts.filter((p, i) => i % st === 0 || i === pts.length - 1); }
    }
    return pts;
  }

  function trackCard(us, foot) {
    const st = laneState(), ks = laneOrder(st), mx = trackScale(st);
    const rv = showReveal() ? S.outcomes.sidos : null;
    const lanes = ks.map((k, i) => {
      const v = st[k], a = rv && rv[k];
      const sr = `${i + 1}위 ${k}, 예상 ${F.num(v.m)}점(80% 범위 ${F.num(v.lo)}~${F.num(v.hi)}점), 확정 ${F.num(v.n)}점`
        + (a ? `, 실제 ${F.num(a.points)}점` : "");
      return `<li class="lane${k === us ? " me" : ""}" data-sido="${esc(k)}" style="transform:translateY(${i * LANE_H}px)">`
        + `<span class="no" aria-hidden="true">${i + 1}</span><span class="run" aria-hidden="true">`
        + `<i class="done" style="width:${pc(v.n, mx)}"></i><i class="rg" style="left:${rgLeft(v, mx)};width:${rgWidth(v, mx)}"></i>`
        + (a ? `<i class="act" style="left:${pc(a.points, mx)};animation-delay:${i * 30}ms"></i>` : "")
        + `<i class="tag" style="--x:${pc(v.m, mx)}">${esc(k)}</i></span>`
        + `<span class="pt" aria-hidden="true">${esc(F.num(v.m))}</span><span class="sr">${esc(sr)}</span></li>`;
    }).join("");
    const canPlay = playScenes().length >= 2;
    return `<section class="track c-track" aria-label="17개 시도 종합순위 전망"><div class="thead"><h3>17개 시도 종합순위 전망</h3>`
      + (canPlay ? `<button class="play" data-play="1" aria-pressed="false" aria-label="개막부터 지금까지 다시 재생">▶</button>` : "") + `</div>`
      + `<ol class="lanes" style="height:${ks.length * LANE_H}px">${lanes}</ol>`
      + `<div class="legend" aria-hidden="true"><span><i class="k-done"></i>확정 득점</span><span><i class="k-tag"></i>예상 득점</span>`
      + `<span><i class="k-rg"></i>80% 범위</span>${rv ? `<span><i class="k-act"></i>실제 득점</span>` : ""}</div>`
      + (foot || "") + `</section>`;
  }

  // 그린 직후 직전 값에서 새 값으로 움직인다. 직전 값은 S.prev(같은 페이지) 또는 sessionStorage(시점 칩으로 새로 연 페이지)
  function animateHome() {
    const ol = document.querySelector(".lanes");
    if (!ol) return;
    const bundle = S.snapshotPath ? S.snapshotPath.replace(/[^/]*$/, "") : "live";
    const st = laneState(), mx = trackScale(st);
    const big = document.querySelector(".big .v");
    const probKey = S.sido + "|" + (S.targetKey || "");
    const prev = S.prev && S.prev.bundle === bundle ? S.prev : null;
    S.prev = { bundle, lanes: st, n: big ? +big.dataset.n : null, probKey };
    session(LANE_KEY, S.prev);
    if (S.still) return;
    const from = prev ? prev.lanes : null;
    const zero = {};
    for (const k in st) zero[k] = { m: 0, n: 0, lo: 0, hi: 0 };
    setLanes(ol, from || zero, mx, !from, true);
    void ol.offsetWidth;
    requestAnimationFrame(() => setLanes(ol, st, mx, false, false));
    if (big) countTo(big, prev && prev.probKey === probKey && prev.n ? prev.n : 1, +big.dataset.n);
  }

  // 레인에 값을 놓는다. keepOrder: 순위 자리는 그대로(첫 표시). jump: 움직이지 않고 바로
  function setLanes(ol, st, mx, keepOrder, jump) {
    const ks = laneOrder(st);
    ol.classList.toggle("jump", !!jump);
    for (const li of ol.children) {
      const k = li.dataset.sido, v = st[k];
      if (!v) continue;
      const q = c => li.querySelector(c);
      if (!keepOrder) {
        li.style.transform = `translateY(${ks.indexOf(k) * LANE_H}px)`;
        q(".no").textContent = ks.indexOf(k) + 1;
        q(".pt").textContent = F.num(v.m);
      }
      q(".tag").style.setProperty("--x", pc(v.m, mx));
      if (v.n !== undefined) q(".done").style.width = pc(v.n, mx);
      if (v.lo !== undefined) { q(".rg").style.left = rgLeft(v, mx); q(".rg").style.width = rgWidth(v, mx); }
    }
  }

  // 큰 숫자를 직전 값에서 올린다. 도는 동안에도 1~99 안에서만(§4: 확률 0·100 을 쓰지 않는다)
  function countTo(el, from, to) {
    const t0 = performance.now(), clamp = x => Math.min(99, Math.max(1, x));
    if (S.anim) cancelAnimationFrame(S.anim);
    const step = t => {
      const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? clamp(Math.round(from + (to - from) * e)) : to;
      S.anim = k < 1 ? requestAnimationFrame(step) : null;
    };
    S.anim = requestAnimationFrame(step);
  }

  // ▶ 개막부터 지금까지. timeline 에는 예상 득점만 있어 재생 중에는 이름표만 움직이고, 마지막에 지금 스냅샷을 그린다
  function playTrack() {
    stopPlay();
    const ol = document.querySelector(".lanes"), btn = document.querySelector(".play");
    if (!ol) return;
    const scenes = playScenes(), st = laneState(), mx = trackScale(st);
    const big = document.querySelector(".big .v"), us = S.sido;
    const sv = us && S.snap.sidos[us];
    const key = sv ? ((S.targetKey && (sv.target_candidates || []).find(c => c.key === S.targetKey)) || sv.target).key : null;
    const track = ol.closest(".track");
    track.classList.add("playing");
    if (btn) btn.setAttribute("aria-pressed", "true");
    const token = S.play = {};
    let last = {}, i = 0;
    const next = () => {
      if (S.play !== token) return;
      if (i < scenes.length) {
        const p = scenes[i++], sc = {};
        for (const k of Object.keys(st)) sc[k] = { m: (p.sidos[k] && p.sidos[k].points_mean) || (last[k] && last[k].m) || 0 };
        last = sc;
        setLanes(ol, sc, mx, false, S.still);
        const d = us && p.sidos[us];
        if (big && d && d.target_key === key) {
          if (S.still) big.textContent = bigParts(d.target_prob).n; else countTo(big, +big.textContent || 1, bigParts(d.target_prob).n);
        }
        S.playTimer = setTimeout(next, S.still ? 0 : 1600);
      } else {
        track.classList.remove("playing");
        setLanes(ol, st, mx, false, S.still);
        if (big) { if (S.still) big.textContent = big.dataset.n; else countTo(big, +big.textContent || 1, +big.dataset.n); }
        if (btn) btn.setAttribute("aria-pressed", "false");
        S.play = null;
      }
    };
    next();
  }

  function stopPlay() {
    S.play = null;
    if (S.playTimer) clearTimeout(S.playTimer);
    S.playTimer = null;
  }

  // ── 경기 탭 (옛 탭 2. 오늘의 질문은 오늘 탭으로 옮겼다, §6-1) ───────────────
  function matchDays(ms) {
    const days = new Set();
    for (const m of ms) { const sc = sched(m); if (sc) days.add(sc.day); }
    return [...days].sort((a, b) => a - b);
  }

  function filters(ms, now) {
    const today = F.dayKey(now);
    const days = matchDays(ms.filter(m => m.status !== "종료"));
    const d1 = days.find(d => d >= today);
    const d2 = d1 !== undefined ? days.find(d => d > d1) : undefined;
    const tomorrow = F.dayKey(new Date(now.getTime() + 864e5));
    const out = [["live", "경기 중", null]];
    if (d1 !== undefined) out.push(["d1", d1 === today ? "오늘" : F.dayLabel(d1), d1]);
    if (d2 !== undefined) out.push(["d2", d1 === today && d2 === tomorrow ? "내일" : F.dayLabel(d2), d2]);
    out.push(["all", "전체", null]);
    if (S.fav.length) out.push(["fav", "나의 종목", null]);
    const rv = S.sido && S.snap && S.snap.sidos[S.sido] ? rivalOf(S.sido) : null;
    if (rv && !rv.prev) out.push(["rival", "라이벌 경기", rv.key]);
    return out;
  }

  function renderWatch(us) {
    const s = S.snap, now = refNow();
    const ms = s.matches || [];
    if (!ms.length) return card("", empty("남은 경기가 없습니다."));
    const fs = filters(ms, now);
    if (!S.filter || !fs.find(f => f[0] === S.filter)) S.filter = fs.find(f => f[0] === "d1") ? "d1" : "all";
    const f = fs.find(x => x[0] === S.filter);
    if (f[0] === "fav") return renderFavList(us, fs);
    let list = ms.filter(m => {
      const sc = sched(m);
      if (f[0] === "live") return statusLabel(m, now)[0] === "live";
      if (f[0] === "rival") return (m.sides || []).some(sd => sd.sido === f[2]);
      if (f[2] !== null) return sc && sc.day === f[2];
      return true;
    });
    const sw = m => { const b = us && usImpact(m, us); return b ? b.v.swing : 0; };
    list = list.map(m => [sw(m), m]).sort((a, b) => b[0] - a[0] || b[1].importance - a[1].importance).map(x => x[1]);
    const chips = filterChips(fs);
    const head = f[0] === "rival" ? `<p class="note">라이벌 ${esc(f[2])}이 뛰는 남은 경기를 우리 목표에 영향이 큰 순서로 보여 줍니다.</p>`
      : `<p class="note">${us ? `${esc(us)} 목표(${esc(s.sidos[us].target.label)})를 움직이는 경기를 중요한 순으로 보여 드립니다. 우리 지역이 뛰지 않는 경기도 영향이 크면 올라옵니다. 순위는 지금 전망에서 가장 가까운 순위입니다.`
      : "지역을 고르면 그 지역 목표에 영향이 큰 순서로 정렬합니다."} 영향이 큰 경기 ${esc(F.num(ms.length))}개까지 표시합니다.</p>`;
    const shown = list.slice(0, S.shown).map(m => matchRow(m, us)).join("");
    const more = list.length > S.shown ? `<button class="more" data-more="1">더 보기 (${list.length - S.shown}개 남음)</button>` : "";
    return chips + head + (shown ? `<div class="mrows mrows-wide">${shown}</div>` + more
      : card("", empty(f[0] === "live" ? "지금 하고 있는 경기가 없습니다." : "해당하는 경기가 없습니다.")));
  }

  function filterChips(fs) {
    return `<div class="chips" role="group" aria-label="경기 범위">${fs.map(([k, label]) =>
      `<button class="chip${k === S.filter ? " on" : ""}" data-filter="${k}" aria-pressed="${k === S.filter}">${esc(label)}</button>`).join("")}</div>`;
  }

  // "나의 종목": 관심 종목의 남은 경기를 시간순으로(다음 경기일은 가벼운 목록까지)
  function renderFavList(us, fs) {
    const fav = new Set(S.fav);
    const list = allMatches().filter(m => fav.has(m.class_nm) && m.status !== "종료" && sched(m))
      .sort((a, b) => sched(a).start - sched(b).start || (b.importance || 0) - (a.importance || 0));
    const head = `<p class="note">관심 종목(${esc(S.fav.join(" · "))}) 경기를 시간순으로 보여 줍니다. `
      + `다음 경기일은 모든 경기를, 그 뒤 날짜는 영향이 큰 경기만 싣습니다.</p>`;
    const shown = list.slice(0, S.shown).map(m => matchRow(m, us)).join("");
    const more = list.length > S.shown ? `<button class="more" data-more="1">더 보기 (${list.length - S.shown}개 남음)</button>` : "";
    return filterChips(fs) + head + (shown ? `<div class="mrows mrows-wide">${shown}</div>` + more : card("", empty("관심 종목의 남은 경기가 없습니다.")));
  }

  // ── 오늘 바뀐 것(옛 탭 3): 추이 기준 점과 저녁 결산의 "더 보기" ─────────────
  function baseTime(at) {
    // 전날 22시(한국 시간, 달력상 전날). 엔진 commentary._daily_base, publish.daily_base_time 과 같다
    const k = F.dayKey(new Date(at.getTime() - 864e5));
    return new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100, 13, 0));
  }

  // "어제 저녁" 기준 점: 22시 이후 첫 timeline 점, 지금 스냅샷보다 앞선 것(엔진 commentary._timeline_base 와 같은 규칙,
  // docs/DASHBOARD.md §11-13 L1). 해설 사실 카드·"확정된 결과"(changes_daily) 와 같은 기준이 된다
  function dailyBasePoint(points, at) {
    const bt = baseTime(at);
    return points.find(p => p.t && p.t >= bt && p.t < at);
  }

  // 탭 3 추이의 기준 점들. 공유 이미지(오늘 카드)도 같은 기준을 쓴다
  function todayTrend(us) {
    const s = S.snap, v = s.sidos[us], now = refNow();
    // 다시 보기에서는 그 시점 뒤의 추이를 그리지 않는다(대회 전체 timeline.json 이어도)
    const cut = S.snapshotPath ? F.parseTime(s.data_as_of) : null;
    const all = ((S.timeline && S.timeline.points) || []).map(p => ({ t: F.parseTime(p.t), d: p.sidos && p.sidos[us], completed: p.completed }));
    const pts = all.filter(p => p.t && p.d && (!cut || p.t <= cut));
    const recent = S.snapshotPath ? pts : pts.filter(p => now - p.t <= 48 * 3600e3);
    const sameTarget = recent.filter(p => p.d.target_key === v.target.key);
    // 기준 시각은 브라우저 시계가 아니라 이 스냅샷이 만들어진 때(엔진이 해설을 만든 기준과 같게)
    const at = F.parseTime(s.generated_at) || now;
    const daily = S.snapshotPath ? null : dailyBasePoint(all, at);
    const base = daily && daily.d ? daily : null;
    const beforeLabel = S.snapshotPath ? "직전 시점" : "어제 저녁";
    // 목표가 바뀌었으면(기준 점의 목표가 다르면) 목표 확률 변화는 보이지 않는다(해설 사실 카드와 같음)
    const prevPt = S.snapshotPath ? sameTarget[sameTarget.length - 2]
      : (base && base.d.target_key === v.target.key && base.d.target_prob !== undefined && base.d.target_prob !== null ? base : null);
    const prevPts = S.snapshotPath ? recent[recent.length - 2] : (base && base.d.points_mean !== undefined ? base : null);
    return { recent, sameTarget, beforeLabel, prevPt, prevPts };
  }

  // 옛 탭 3 전체: 오늘 탭 저녁 결산의 "더 보기"(§6-2)
  function dayDetail(us) {
    const s = S.snap, v = s.sidos[us];
    let html = "";
    const { recent, sameTarget, beforeLabel, prevPt, prevPts } = todayTrend(us);
    const arrow = d => `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"}</span>`;
    // 변화량은 화면에 보이는 정수끼리 뺀다(46% 와 어제 저녁 46% 면 "변화 거의 없음", §11-14 M1. 경기 카드 R5 와 같다).
    // 예상 득점도 같은 원칙: 보이는 정수끼리, 0 이면 화살표 없이 "변화 없음"(§11-14 M2)
    const tChg = prevPt ? bigParts(v.target.prob).n - bigParts(prevPt.d.target_prob).n : null;
    let trend = `<div class="trend-row"><span class="lbl">목표 확률<small>${esc(v.target.label)}</small></span>`
      + `<span class="val"><span class="num">${esc(F.pct(v.target.prob))}</span>`
      + (prevPt ? `<em>${tChg === 0 ? "변화 거의 없음" : `${arrow(tChg)} ${esc(F.pp(tChg / 100))}`} `
        + `<small>(${beforeLabel} ${esc(F.pct(prevPt.d.target_prob))})</small></em>` : "") + `</span></div>`;
    trend += sparkline(sameTarget.map(p => ({ t: p.t, v: p.d.target_prob })), { prob: true, fmt: F.pct, label: "목표 확률 추이" });
    const pChg = prevPts ? Math.round(v.points_mean) - Math.round(prevPts.d.points_mean) : null;
    trend += `<div class="trend-row"><span class="lbl">예상 득점</span><span class="val"><span class="num">${esc(F.num(v.points_mean))}</span>`
      + (prevPts ? `<em>${pChg === 0 ? "변화 없음" : `${arrow(pChg)} ${esc(F.signed(pChg))}`}</em>` : "")
      + `</span></div>`;
    trend += sparkline(recent.map(p => ({ t: p.t, v: p.d.points_mean })), { prob: false, fmt: F.num, label: "예상 득점 추이" });
    if (recent.length < 2) trend += `<p class="note">추이는 전망이 몇 차례 갱신된 뒤 표시됩니다.</p>`;
    html += card("전망 추이", trend, "c-trend");

    if (!s.completed_events) {
      return html + card("확정된 결과", empty("아직 확정된 결과가 없습니다."));
    }
    const ch = (s.changes_daily && s.changes_daily.items) ? s.changes_daily : s.changes;
    const items = (ch && ch.items && ch.items[us]) || [];
    const since = ch && F.parseTime(ch.since);
    const sinceLabel = since ? `${F.mdhm(since)} 이후 확정된 결과` : "최근 확정된 결과";
    if (!items.length) {
      html += card(esc(sinceLabel), empty("이 기간에 우리 지역 득점이 기대와 달라진 결과가 없습니다."));
    } else {
      const sum = ch.totals && ch.totals[us] !== undefined ? ch.totals[us] : items.reduce((a, x) => a + x.diff, 0);
      const total = ch.counts && ch.counts[us] !== undefined ? ch.counts[us] : items.length;
      const rows = items.slice(0, 12).map(x => `<li><span class="cn">${esc(F.hw(x.name))}</span>`
        + `<span class="ce">기대 ${esc(F.num(x.expected))} → 실제 ${esc(F.num(x.realized))}</span>`
        + `<span class="cd ${x.diff >= 0 ? "pos" : "neg"}">${x.diff >= 0 ? "▲" : "▼"} ${esc(F.signed(x.diff))}</span></li>`).join("");
      html += card(esc(sinceLabel), `<ul class="changes">${rows}</ul>`
        + (total > 12 ? `<p class="note">외 ${total - 12}개</p>` : "")
        + `<p class="lead">합계 ${esc(F.signed(sum))}점 <small>(사전 기대 대비)</small></p>`);
    }
    const sur = ((ch && ch.surprises) || []).slice().sort((a, b) => (b.sido === us) - (a.sido === us) || a.prior_medal_p - b.prior_medal_p);
    html += card("사전 확률 대비 결과", sur.length ? `<ul class="surprises">${sur.slice(0, 10).map(x =>
      `<li><span class="mtag${x.medal === "금" ? " g" : ""}">${esc(x.medal)}</span><b>${esc(x.sido)}</b> · ${esc(F.hw(x.name))}`
      + `<br><small>직전 전망에서 메달 확률 ${esc(F.wasPct(x.prior_medal_p))} 결과</small></li>`).join("")}</ul>`
      : empty("사전 확률이 낮았던 메달은 없었습니다."));
    return html;
  }

  // ── 라이벌 (docs/UX_SCENARIOS.md §6-4, B) ─────────────────────────────────
  // 자동: 기본 목표 기준 인접 시도. 순위·메달 목표는 가장 가까운 순위(예상 득점 순, 메달 목표는 금·은·동 순)에서
  // 우리가 목표 안이면 바로 밖(N+1위), 밖이면 경계(N위)의 시도. 득점 목표(작년 대비)는 "작년의 우리"
  function rivalAuto(us) {
    const s = S.snap, v = s.sidos[us], key = v.target.key;
    if ((key === "beat_prev_points" || /^points_x/.test(key)) && v.prev && v.prev.points) return "prev";
    const medal = key === "medal_rank1" || key === "medal_top3";
    const ord = Object.keys(s.sidos).sort(medal
      ? (a, b) => { const x = s.sidos[a].medals_mean, y = s.sidos[b].medals_mean; return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); }
      : (a, b) => s.sidos[b].points_mean - s.sidos[a].points_mean);
    const pos = ord.indexOf(us) + 1;
    let n = key === "rank1" || key === "medal_rank1" ? 1 : key === "medal_top3" ? 3
      : /^top\d+$/.test(key) ? +key.slice(3) : /^rank_le_\d+$/.test(key) ? +key.split("_").pop() : null;
    if (n === null) n = Math.max(1, pos - 1);          // 모르는 목표: 바로 앞 시도
    n = Math.min(n, ord.length - 1);
    const r = pos <= n ? ord[n] : ord[n - 1];         // 안이면 N+1위, 밖이면 N위(0부터 센 자리)
    return r && r !== us ? r : ord[pos === 1 ? 1 : pos - 2];
  }

  function rivalPrefs() {
    try { const o = JSON.parse(store(RIVAL_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }

  // 지금 라이벌: 주소 ?rival= → 이 기기의 고른 값 → 자동. {key: 시도|"prev", auto, name}
  function rivalOf(us) {
    const v = S.snap && S.snap.sidos[us];
    if (!v) return null;
    const ok = r => r && ((r === "prev" && v.prev && v.prev.points) || (r !== us && S.snap.sidos[r]));
    const pick = [S.rivalParam, rivalPrefs()[us]].find(ok);
    const key = pick || rivalAuto(us);
    if (!ok(key)) return null;
    // 격차 단위는 라이벌이 자동인지와 무관하게 목표를 따른다(메달 목표면 금메달 기대 개수). "기본으로"↔직접 고름을 오가도 단위가 안 바뀐다
    return { key, auto: !pick, prev: key === "prev", name: key === "prev" ? `작년의 ${us}` : key,
      medal: key !== "prev" && /^medal_/.test(v.target.key) };
  }

  function setRival(us, r) {
    const o = rivalPrefs();
    if (r) o[us] = r; else delete o[us];
    store(RIVAL_KEY, JSON.stringify(o));
    S.rivalParam = null;
    setParam("rival", r || null);
    render();
  }

  // 격차 = 우리 − 라이벌(양수면 우리가 앞섬). 메달 목표의 자동 라이벌은 금메달 기대 개수, 나머지는 예상 득점
  function gapOf(us, rv, sidosPt) {
    const s = S.snap, v = s.sidos[us];
    if (rv.medal) return { a: v.medals_mean[0], b: s.sidos[rv.key].medals_mean[0], unit: "개", what: "금메달 기대" };
    const pt = k => sidosPt ? (sidosPt[k] && sidosPt[k].points_mean) : s.sidos[k].points_mean;
    const a = pt(us), b = rv.prev ? v.prev.points : pt(rv.key);
    return a === undefined || a === null || b === undefined || b === null ? null : { a, b, unit: "점", what: "예상 득점" };
  }

  // 어제 저녁(다시 보기는 직전 시점) 기준 점의 격차. 메달 목표는 timeline 에 메달이 없어 null
  function gapBase(us, rv) {
    if (rv.medal) return null;
    const pts = timelinePoints().filter(p => p.sidos[us] && (rv.prev || p.sidos[rv.key]));
    const at = F.parseTime(S.snap.generated_at) || refNow();
    const base = S.snapshotPath ? pts[pts.length - 2] : dailyBasePoint(pts, at);
    if (!base) return null;
    const g = gapOf(us, rv, base.sidos);
    return g ? { gap: Math.round(g.a) - Math.round(g.b), label: S.snapshotPath ? pointLabel(base.t) : "어제 저녁" } : null;
  }

  // 격차가 어떻게 움직였나(보이는 정수끼리). [문장, good|bad|""]. 어휘: 앞서다·좁히다·뒤집다(공격적인 말은 쓰지 않는다, 금지어는 tests/site_check.js)
  function gapMove(us, rv, g0, g1, unit) {
    const other = rv.prev ? "작년" : F.sidoLabel(rv.key);
    const n = x => F.num(Math.abs(x)) + unit;
    if (g0 === g1) return ["격차 변화 거의 없음", ""];
    if (g0 <= 0 && g1 > 0) return [rv.prev ? "작년 득점을 넘어섰어요" : `${F.josa(other, "을", "를")} 앞질렀어요`, "good"];
    if (g0 >= 0 && g1 < 0) return [rv.prev ? "작년 득점 아래로 내려갔어요" : `${F.josa(other, "이", "가")} 앞질렀어요`, "bad"];
    if (g1 <= 0) return Math.abs(g1) < Math.abs(g0) ? [`${n(g0 - g1)} 좁혔어요`, "good"] : [`${n(g1 - g0)} 벌어졌어요`, "bad"];
    return g1 > g0 ? [`${n(g1 - g0)} 더 앞섰어요`, "good"] : [`${n(g0 - g1)} 좁혀졌어요`, "bad"];
  }

  function gapState(us) {
    const rv = rivalOf(us);
    if (!rv) return null;
    const g = gapOf(us, rv);
    if (!g) return null;
    const gap = Math.round(g.a) - Math.round(g.b), base = gapBase(us, rv);
    const move = base ? gapMove(us, rv, base.gap, gap, g.unit) : null;
    const other = rv.prev ? `작년의 ${us}` : rv.key;
    const lead = gap === 0 ? `${us}·${other} ${g.what} 같음`
      : gap > 0 ? `${F.josa(F.sidoLabel(us), "이", "가")} ${F.num(gap)}${g.unit} 앞서 있어요`
        : rv.prev ? `작년 득점까지 ${F.num(-gap)}${g.unit} 남았어요` : `${F.josa(F.sidoLabel(rv.key), "이", "가")} ${F.num(-gap)}${g.unit} 앞서 있어요`;
    return { rv, g, gap, base, move, lead, other };
  }

  // 그 경기의 우리 목표 변화(보이는 정수 차)의 크기. 영향도가 없으면 0
  function impactAbs(m, us) {
    const b = !m.light && usImpact(m, us), t = S.snap.sidos[us].target;
    if (!b) return 0;
    const p = bigParts(t.prob).n;
    return Math.max(Math.abs(bigParts(b.v.if_win).n - p), Math.abs(bigParts(b.v.if_lose).n - p));
  }

  // 오늘(다음 경기일) 격차를 움직일 경기 셋: 우리나 라이벌이 뛰는 경기, 맞대결 먼저, 다음은 우리 영향 큰 순
  function rivalMatches(us, rv) {
    const d = myDay();
    if (!d) return { d: null, list: [] };
    const plays = (m, k) => (m.sides || []).some(sd => sd.sido === k);
    const duel = m => !rv.prev && !m.record && plays(m, us) && plays(m, rv.key);
    const all = allMatches().filter(m => { const sc = sched(m); return sc && sc.day === d.day && !finished(m); })
      .filter(m => plays(m, us) || (!rv.prev && plays(m, rv.key)));
    const list = all.map(m => [duel(m) ? 1 : 0, impactAbs(m, us), m])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || (b[2].importance || 0) - (a[2].importance || 0)).slice(0, 3).map(x => x[2]);
    return { d, list, duel };
  }

  function rivalLine(m, us, rv) {
    const sides = m.sides || [];
    if (sides.some(sd => sd.sido === us)) {
      const l = myLine(m, us);
      return !m.record && sides.length === 2 && sides.some(sd => sd.sido === rv.key) ? `맞대결 · ${l}` : l;
    }
    const sd = sides.find(x => x.sido === rv.key);
    if (!sd) return "";
    const v = sd.impact && sd.impact[us], t = S.snap.sidos[us].target;
    if (v && !m.light) {
      const d = bigParts(v.if_win).n - bigParts(t.prob).n;
      const who = F.josa(F.sidoLabel(rv.key), "이", "가") + (m.record ? " 메달이면" : " 이기면");
      return d ? `${who} 우리 목표 ${F.pp(d / 100)}` : `${who}도 우리 목표 변화 거의 없음`;
    }
    return m.record ? `${rv.key} 메달권 확률 ${F.pct(sd.p_win)}` : `${rv.key} 이길 확률 ${F.pct(sd.p_win)}`;
  }

  function rivalOptions(us, rv) {
    const v = S.snap.sidos[us], auto = rivalAuto(us);
    const autoName = auto === "prev" ? `작년의 ${us}` : auto;
    const opt = (val, label, on) => `<option value="${esc(val)}"${on ? " selected" : ""}>${esc(label)}</option>`;
    return `<label class="rsel"><span class="sr">라이벌 바꾸기</span><select id="rival-select" aria-label="라이벌 바꾸기">`
      + opt("", `기본으로 (${autoName})`, rv.auto)
      + (v.prev && v.prev.points && auto !== "prev" ? opt("prev", `작년의 ${us}`, !rv.auto && rv.prev) : "")
      + SIDOS.filter(k => k !== us && S.snap.sidos[k]).map(k => opt(k, k, !rv.auto && rv.key === k)).join("")
      + `</select></label>`;
  }

  function rivalCard(us) {
    const gs = gapState(us);
    if (!gs) return "";
    const { rv, g, gap, base, move } = gs, s = S.snap, v = s.sidos[us];
    const side = (name, val, me) => `<div class="rv-side${me ? " us" : ""}"><b>${esc(name)}</b><span class="num">${esc(F.num(val))}</span></div>`;
    let h = `<div class="rv-row" role="img" aria-label="${esc(gs.lead)}">${side(us, g.a, true)}`
      + `<div class="rv-gap"><span class="num">${esc(F.num(Math.abs(gap)))}</span><small>${esc(g.unit)} 차</small></div>`
      + side(rv.prev ? `작년의 ${us}` : rv.key, g.b, false) + `</div>`
      + `<p class="lead">${esc(gs.lead)}</p>`
      + (move ? `<p class="rv-move${move[1] ? " " + (move[1] === "good" ? "up" : "down") : ""}">${move[1] === "good" ? "▲ " : move[1] === "bad" ? "▼ " : ""}`
        + `${esc(base.label)}보다 ${esc(move[0])}</p>` : "");
    if (rv.prev) h += `<p class="note">작년(제${esc(v.prev.event_no)}회) 최종 득점 ${esc(F.num(v.prev.points))}점과 올해 예상 득점의 차입니다.</p>`;
    if (rv.medal) h += `<p class="note">메달 목표라 금메달 기대 개수로 견줍니다.</p>`;
    // 격차 추이: timeline 의 두 시도 예상 득점 차(우리 − 라이벌)
    if (!rv.medal) {
      const pts = timelinePoints().map(p => { const x = gapOf(us, rv, p.sidos); return x ? { t: p.t, v: x.a - x.b } : null; }).filter(Boolean);
      // 끝점은 지금 스냅샷(timeline 마지막 점이 더 이르면 카드의 격차와 선 끝 값이 어긋난다)
      const nowT = F.parseTime(s.generated_at);
      if (nowT && (!pts.length || pts[pts.length - 1].t < nowT)) pts.push({ t: nowT, v: g.a - g.b });
      h += sparkline(pts, { prob: false, fmt: x => F.signed(Math.round(x)), label: "격차 추이(우리 − 라이벌)" });
    }
    const { d, list, duel } = rivalMatches(us, rv);
    if (d) {
      h += `<h4 class="sum-h">${esc(d.label)} 격차를 움직일 경기</h4>`;
      h += list.length ? `<ol class="myday rv-list">${list.map(m => `<li class="my-row mr-li${duel(m) ? " duel-row" : ""}">${matchRow(m, us, { duel: duel(m) })}</li>`).join("")}</ol>` : empty(rv.prev ? "이날 우리 지역 경기가 없습니다." : `이날 ${esc(us)}·${esc(rv.key)}이 뛰는 경기가 없습니다.`);
    }
    if (v.target.key === "rank1" && s.leader_now === us && !rv.prev && s.magic_number && s.magic_number[rv.key] !== undefined) {
      const mn = s.magic_number[rv.key];
      h += `<p class="note">${mn <= 0 ? `${esc(rv.key)}보다 위 확정` : `1위 확정까지 ${esc(F.num(mn))}점`}: 선두 ${esc(us)}의 순위가 ${esc(rv.key)}에 대해 확정되기까지. 레이스 탭 아래 매직넘버 표 참고.</p>`;
    }
    h += `<div class="btn-row"><button class="act-btn" data-share="gap">격차 카드 저장</button>${dareButton(us)}`
      + `${S.snapshotPath ? "" : `<button class="act-btn" data-share="dare">도전장 카드</button>`}${cheerButton(us)}</div>`;
    h += `<p class="note">${rv.auto ? `목표(${esc(v.target.label)}) 기준으로 가장 가까운 경쟁 상대를 자동으로 골랐습니다. ` : ""}경기 영향 숫자는 라이벌과 관계없이 기본 목표 기준입니다.</p>`;
    return `<section class="card c-wide c-rival" aria-label="라이벌"><div class="rv-head"><h3>라이벌 <small>${esc(rv.auto ? "자동" : "고른 상대")}</small></h3>`
      + rivalOptions(us, rv) + `</div>${h}</section>`;
  }

  // ── 오늘 탭: 시간대 상태와 카드 순서 (docs/UX_SCENARIOS.md §6-2) ───────────
  function dayOf(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : null; }
  function dayDiff(a, b) {
    const t = d => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
    return Math.round((t(a) - t(b)) / 864e5);
  }
  // "D+2가", "D+3이": 숫자 끝 소리로 조사를 고른다(이·사·오·구 → 가, 십 → 이)
  function dJosa(k) { return k % 10 === 0 ? "이" : [2, 4, 5, 9].includes(k % 10) ? "가" : "이"; }
  function kstHour(t) { return +F.hm(t).slice(0, 2); }

  // 그날 경기 T(matches ∪ day_matches 중 그날 것)와 상태. key 를 주면 그 상태로(보고 있는 동안 고정, §6-2 움직임)
  function dayState(key) {
    const s = S.snap, now = refNow(), day = F.dayKey(now), ev = s.event || {};
    const sd = dayOf(ev.start_date), ed = dayOf(ev.end_date);
    const T = allMatches().filter(m => { const sc = sched(m); return sc && sc.day === day; });
    const left = T.filter(m => !finished(m));
    const live = left.filter(m => liveMatch(m, now));
    if (!key) {
      // 개막 전이거나, 그날 경기가 없고 끝난 세부종목도 없으면 pre. 다시 보기는 기록 시점(밤 10시)이라 늘 저녁(§6-9)
      if ((sd && day < sd) || (!T.length && !s.completed_events)) key = "pre";
      else if (S.snapshotPath || (ed && day > ed) || (T.length && !left.length) || kstHour(now) >= 21) key = "evening";
      else if (live.length) key = "live";
      else key = "morning";
    }
    return { key, now, day, sd, ed, T, left, live, k: sd && day >= sd ? dayDiff(day, sd) : null };
  }

  // 세부종목 수. 축약본 경기(event_id 있음)와 가벼운 목록(day_matches, 없음)이 섞여도 같은 세부종목을 한 번만 세도록 이름으로 묶는다
  function eventCount(ms) { return new Set(ms.map(m => F.hw([m.class_nm, m.kind_nm, m.detail_nm].join("|")))).size; }

  // 오늘 확정된 세부종목 수: 어제 저녁(22시 뒤 첫 점) 이후 늘어난 completed. 기준 점이 없으면 null
  function doneToday() {
    const s = S.snap, at = F.parseTime(s.generated_at) || refNow();
    const base = dailyBasePoint(timelinePoints(), at);
    return base && typeof base.completed === "number" ? Math.max(0, (s.completed_events || 0) - base.completed) : null;
  }

  function dayHeadline(st) {
    const s = S.snap, dl = st.k !== null ? `D+${st.k}` : null;
    if (st.key === "pre") {
      const parts = [st.sd && st.day < st.sd ? `개막 D−${dayDiff(st.sd, st.day)}` : "개막 전"];
      if (s.completed_events) parts.push(`사전경기 ${F.num(s.completed_events)}개 끝남`);
      const d = myDay();
      if (d) parts.push(d.day === st.day ? `오늘 경기 ${F.num(st.left.length)}개` : `다음 경기일 ${F.dayLabel(d.day)}`);
      return parts;
    }
    if (st.key === "evening") {
      if (s.remaining_events === 0) return ["모든 세부종목이 끝났습니다"];
      const n = doneToday();
      return [dl ? `${dl}${dJosa(st.k)} 끝났습니다` : "오늘 경기가 끝났습니다"].concat(n ? [`오늘 메달 ${F.num(n)}개 주인이 정해졌어요`] : []);
    }
    if (st.key === "live") return [`지금 ${F.num(st.live.length)}경기 하고 있어요`].concat(dl ? [dl] : []);
    const first = st.left.map(m => sched(m)).filter(sc => sc.timed && sc.start > st.now).sort((a, b) => a.start - b.start)[0];
    const n = eventCount(st.T), cnt = n ? [`오늘 걸린 메달 ${F.num(n)}개`] : [];
    if (kstHour(st.now) < 12) return [`${dl || "오늘"} 아침입니다`].concat(cnt);
    return [dl || "오늘"].concat(first ? [`다음 경기 ${F.hm(first.start)}`] : [], cnt);
  }

  function dayHead(st) {
    const [h, ...rest] = dayHeadline(st);
    const kick = { pre: "개막 전", morning: "오늘", live: "경기 중", evening: "오늘 마무리" }[st.key];
    return `<section class="c-wide c-dayhead" aria-label="오늘" data-state="${st.key}"><p class="kick">${kick}</p>`
      + `<h2 class="say">${esc(h)}${rest.length ? `<small>${esc(rest.join(" · "))}</small>` : ""}</h2></section>`;
  }

  // ── 오늘 탭 머리(설계 14 X1, docs/EXCITEMENT.md): 헤드라인 + 격차(주인공) + 목표 확률 한 줄 + "지금" 띠 ──
  // 격차·라이벌은 레이스 탭 라이벌 카드와 같은 셈(gapState). 시간대 머리말은 꼬리표 줄로 합쳤다(첫 화면 높이)
  function heroCtx(us, st) {
    const s = S.snap, v = s.sidos[us], gs = gapState(us), wc = whyCtx(us);
    const rank = wc && wc.r && wc.r[us] ? wc.r[us] : argmax(v.rank_probs || [0]) + 1;
    const rv = gs && gs.rv;
    const plays = (m, k) => (m.sides || []).some(sd => sd.sido === k);
    let duel = null, gain = null;
    if (rv && !rv.prev && (st.key === "morning" || st.key === "live")) {
      // 아직 안 끝난 것: 경기 중이거나 시작 전(시각이 지난 채 결과만 늦은 경기는 빼고, 시각이 없으면 넣는다)
      const d = st.left.filter(m => !m.record && plays(m, us) && plays(m, rv.key) && (!sched(m).timed || liveMatch(m, st.now) || sched(m).start > st.now))
        .sort((a, b) => (sched(a).start - sched(b).start))[0];
      if (d) { const sc = sched(d); duel = { time: sc.timed ? F.hm(sc.start) : null, cls: F.hw(d.class_nm) }; }
    }
    // 오늘 남은 우리 경기를 모두 이기면 지금 기대 대비 더해지는 점수: Σ(1−p)·stake(만약에 X3 와 같은 셈, §15 X1 설계와 다른 점 1)
    let sum = 0;
    for (const m of st.left) {
      if (m.record || m.light) continue;
      const mine = (m.sides || []).find(sd => sd.sido === us);
      if (mine && !mine.settled && typeof mine.stake === "number") sum += (1 - mine.p_win) * mine.stake;
    }
    gain = F.stakeText(sum);
    const mn = s.magic_number || {};
    const locked = v.target.key === "rank1" && s.leader_now === us && Object.keys(mn).length > 0 && Object.values(mn).every(x => x <= 0);
    return { state: st.key, label: v.target.label, prob: v.target.prob, locked,
      rival: rv && !rv.prev ? rv.key : null, rivalPrev: !!(rv && rv.prev), gap: gs ? gs.gap : 0, unit: gs ? gs.g.unit : "점",
      rank, medal: !!(wc && wc.kind === "medal"), duel, gain,
      k: st.k, dayChange: gs && gs.base ? gs.gap - gs.base.gap : null,
      // 다시 보기의 기준은 직전 시점("D+0(10/17)"). 헤드라인은 두 줄 안에 들도록 날짜 괄호를 뗀다
      dayLabel: gs && gs.base && gs.base.label !== "어제 저녁" ? `${gs.base.label.replace(/\(.*\)$/, "")} 이후` : "오늘",
      preDays: st.sd && st.day < st.sd ? dayDiff(st.sd, st.day) : null, prevRank: v.prev && v.prev.rank ? v.prev.rank : null,
      final: s.remaining_events === 0 };
  }

  function heroHeadline(us, st) { return F.headline(heroCtx(us, st || dayState(S.day))); }

  // "지금" 띠: 오늘 메달 주인이 정해진 수 · 경기 중 수 · 다음 결과 · n분 전 반영. 다시 보기는 "그날 끝남 n개", 개막 전은 "사전경기 k개 끝남"
  function nowBand(st) {
    const s = S.snap, parts = [];
    let bar = "";
    if (st.key === "pre") {
      parts.push(s.completed_events ? `사전경기 ${F.num(s.completed_events)}개 끝남` : "아직 끝난 경기가 없습니다");
    } else if (S.snapshotPath) {
      // 다시 보기: 직전 시점 대비 늘어난 확정 세부종목. 직전 시점이 전날 밤이면 "그날"
      const pts = timelinePoints(), b = pts[pts.length - 2], at = F.parseTime(s.data_as_of);
      if (b && typeof b.completed === "number" && at) {
        const n = Math.max(0, (s.completed_events || 0) - b.completed);
        parts.push(`${F.dayKey(new Date(at.getTime() - 864e5)) === F.dayKey(b.t) ? "그날" : esc(pointLabel(b.t)) + " 이후"} 끝남 ${F.num(n)}개`);
      } else parts.push(`확정 세부종목 ${F.num(s.completed_events || 0)}개`);
    } else {
      const done = doneToday(), left = eventCount(st.T.filter(m => !finished(m)));
      if (done !== null && done + left > 0) {
        const tot = done + left;
        bar = `<span class="pg" role="img" aria-label="오늘 메달 ${tot}개 중 ${done}개 주인이 정해짐"><i style="width:${(done / tot * 100).toFixed(1)}%"></i></span>`;
        parts.push(`오늘 메달 ${bar} ${F.num(tot)}개 중 ${F.num(done)}개 주인이 정해졌어요`);
      } else if (left) parts.push(`오늘 걸린 메달 ${F.num(left)}개`);
      if (st.live.length) parts.push(`${F.num(st.live.length)}경기 하는 중`);
      // 다음 결과: 아직 안 끝난 그날 경기 중 종료 예정이 가장 이른 것. 예정 시각이 지난 채 결과만 늦은 것은 앞으로 끝날 것이 없을 때만
      const timed = st.left.filter(m => sched(m) && sched(m).timed).sort((a, b) => sched(a).end - sched(b).end);
      const nx = timed.find(m => sched(m).end >= st.now) || timed[0];
      if (nx) parts.push(`다음 결과 ${F.hm(sched(nx).end)} ${esc(F.hw(nx.class_nm))} ${esc(F.shortKind(nx.kind_nm || ""))}`.trim());
    }
    const t = F.parseTime(s.data_as_of);
    let ago = "";
    if (t && !S.snapshotPath) {
      const mi = Math.max(0, Math.round((Date.now() - t) / 60000));
      ago = mi < 1 ? "방금 반영" : mi < 60 ? `${mi}분 전 반영` : mi < 24 * 60 ? `${Math.floor(mi / 60)}시간 전 반영` : `${F.mdhm(t)} 반영`;
    }
    return `<div class="now-band" aria-label="지금"><p><b class="nb-k">지금</b> ${parts.join(" · ")}`
      + (ago ? ` <span class="nb-ago">· ${esc(ago)}</span>` : "") + `</p></div>`;
  }

  function heroCard(us, st) {
    const v = S.snap.sidos[us], [h, ...rest] = dayHeadline(st);
    const kick = { pre: "개막 전", morning: "오늘", live: "경기 중", evening: "오늘 마무리" }[st.key];
    const gs = gapState(us);
    let row = "", dayMove = "";
    if (gs) {
      const { rv, g, gap, base } = gs;
      const side = (name, val, me) => `<div class="rv-side${me ? " us" : ""}"><b>${esc(name)}</b><span class="num">${esc(F.num(val))}</span></div>`;
      const d = base ? gap - base.gap : null;
      // 격차 변화: 전날 22시 기준 점 대비(다시 보기는 직전 시점). + 는 우리 쪽으로 움직임
      // R1: ± 대신 말(앞서면 벌림·좁혀짐, 뒤지면 따라붙음·더 벌어짐). 작년의 나는 ± 그대로
      const words = rv.prev ? (d === 0 ? "그대로" : F.signed(d) + g.unit) : F.gapMoveText(gap, d, g.unit);
      const dl = !base ? "" : `<span class="rv-day${d > 0 ? " up" : d < 0 ? " down" : ""}">${esc(base.label === "어제 저녁" ? "오늘" : base.label + " 이후")} `
        + `${d > 0 ? "▲ " : d < 0 ? "▼ " : ""}${esc(words)}</span>`;
      row = `<div class="rv-row" role="img" aria-label="${esc(gs.lead)}">${side(us, g.a, true)}`
        + `<div class="rv-gap"><span class="num">${esc(F.num(Math.abs(gap)))}</span><small>${esc(g.unit)} 차</small></div>`
        + side(rv.prev ? `작년의 ${us}` : rv.key, g.b, false) + `</div>`;
      dayMove = dl;
    }
    const { beforeLabel, prevPt } = todayTrend(us);
    const prob = `<p class="hero-p">${dayMove ? dayMove + " · " : ""}목표 ${esc(v.target.label)} <b>${esc(F.pct(v.target.prob))}</b>`
      + (prevPt ? ` <small>(${esc(beforeLabel.replace(/ 저녁$/, ""))} ${esc(F.pct(prevPt.d.target_prob))})</small>` : "")
      + ` <button class="linkish" data-goto="race" aria-label="레이스에서 자세히">레이스 →</button></p>`;
    return `<section class="c-wide c-dayhead c-hero" aria-label="오늘" data-state="${st.key}">`
      + `<p class="hero-k"><span class="kick">${kick}</span> <small>${esc([h].concat(rest).join(" · "))}</small></p>`
      + `<h2 class="hero-h">${esc(heroHeadline(us, st))}</h2>` + row + prob + nowBand(st) + `</section>`;
  }

  // 목표 확률 한 줄: 지금과 어제 저녁(다시 보기는 직전 시점). 변화는 보이는 정수끼리(§11-14 M1)
  function targetRow(us) {
    const v = S.snap.sidos[us], { beforeLabel, prevPt } = todayTrend(us);
    const arrow = d => `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"}</span>`;
    const tChg = prevPt ? bigParts(v.target.prob).n - bigParts(prevPt.d.target_prob).n : null;
    return `<div class="trend-row"><span class="lbl">목표 확률<small>${esc(v.target.label)}</small></span>`
      + `<span class="val"><span class="num">${esc(F.pct(v.target.prob))}</span>`
      + (prevPt ? `<em>${tChg === 0 ? "변화 거의 없음" : `${arrow(tChg)} ${esc(F.pp(tChg / 100))}`} `
        + `<small>(${beforeLabel} ${esc(F.pct(prevPt.d.target_prob))})</small></em>` : "") + `</span></div>`;
  }

  function changeItems(us) {
    const s = S.snap, ch = (s.changes_daily && s.changes_daily.items) ? s.changes_daily : s.changes;
    return { ch, items: (ch && ch.items && ch.items[us]) || [] };
  }

  function changeRows(items) {
    return `<ul class="changes">` + items.map(x => `<li><span class="cn">${esc(F.hw(x.name))}</span>`
      + `<span class="ce">기대 ${esc(F.num(x.expected))} → 실제 ${esc(F.num(x.realized))}</span>`
      + `<span class="cd ${x.diff >= 0 ? "pos" : "neg"}">${x.diff >= 0 ? "▲" : "▼"} ${esc(F.signed(x.diff))}</span></li>`).join("") + `</ul>`;
  }

  // 지금: 경기 중이거나 2시간 안에 시작하는 그날 경기, 우리 영향 순(§6-2)
  function nowCard(us, st) {
    const soon = st.left.filter(m => { const sc = sched(m); return sc.timed && (liveMatch(m, st.now) || (sc.start > st.now && sc.start - st.now <= 2 * 3600e3)); });
    if (!soon.length) return "";
    const sw = m => { const b = !m.light && usImpact(m, us); return b ? b.v.swing : -1; };
    const list = soon.map(m => [sw(m), m]).sort((a, b) => b[0] - a[0] || sched(a[1]).start - sched(b[1]).start).map(x => x[1]);
    const nLive = soon.filter(m => liveMatch(m, st.now)).length;
    return card(`지금 <small>경기 중 ${F.num(nLive)} · 2시간 안 시작 ${F.num(soon.length - nLive)}</small>`,
      `<div class="mrows">${list.slice(0, 5).map(m => matchRow(m, us)).join("")}</div>`
      + (list.length > 5 ? `<button class="more" data-goto-live="1">지금 하는 경기 모두 보기</button>` : ""), "c-now");
  }

  // ── 하이라이트 피드(설계 14 X2, 설계 15 Y1 이름): "들어온 결과"·결산의 "확정된 결과·사전 확률 대비 결과" 를 꼬리표 붙은 한 줄로 ──
  // 원천은 changes_daily(없으면 changes, 라벨 "직전 반영 이후"). 꼬리표 규칙은 F.moments, 격차는 그 세부종목의 (우리 − 라이벌) diff
  function momentFeed(us) {
    const { ch, items } = changeItems(us);
    const rv = rivalOf(us);
    const rivals = rv && !rv.prev ? ((ch && ch.items && ch.items[rv.key]) || []) : [];
    const medals = {}, wins = {};
    // 메달 종류: 사전 확률 대비 결과(surprises)는 F.moments 가 본다. 다시 보기에서 결과를 받았으면 그 세부종목의 메달도
    if (S.outcomes && S.outcomes.events) for (const [eid, ev] of Object.entries(S.outcomes.events)) for (const k of ["금", "은", "동"]) if ((ev[k] || []).includes(us)) medals[eid] = k;
    // 이긴 승패 경기: results_recent 의 경기 키(회차|종목|세부|경기)에서 세부종목 키(종목|세부)를 뽑는다. 다시 보기는 그 시점까지 끝난 경기
    for (const [k, w] of Object.entries(S.snap.results_recent || {})) { const p = k.split("|"); if (p.length >= 3) (wins[p[1] + "|" + p[2]] = wins[p[1] + "|" + p[2]] || []).push(w); }
    // P3: results_recent_v2(36시간)를 그 기간(since 이후) 경기로. 없으면 세부종목 단위 그대로
    const v2 = S.snap.results_recent_v2, sinceT = ch && F.parseTime(ch.since), asOfT = F.parseTime(S.snap.data_as_of);
    const matches = v2 && typeof v2 === "object" ? Object.entries(v2).map(([k, x]) => ({ k, w: x[0], l: x[1] || null, t: x[2] || null,
      name: F.shortName((x[3] || []).filter(Boolean).join(" ").replace(/경기\s*[0-9０-９]+$/, "")) }))
      // 종료 시각이 자료 시각보다 뒤인 줄은 믿지 않는다(시각을 버리고 세부종목 단위로). 106회 리플레이는 결과 변경 시각이 재생성 시각이라 모두 여기에 걸린다
      .filter(m => !m.t || !asOfT || F.parseTime(m.t) <= asOfT)
      .filter(m => !sinceT || !m.t || F.parseTime(m.t) >= sinceT) : null;
    const list = F.moments({ us, rival: rv ? rv.key : null, rivalPrev: !!(rv && rv.prev), ours: items, rivals, matches: matches && matches.length ? matches : null,
      surprises: (ch && ch.surprises) || [], medals, wins, multiGold: multiGoldEvents(us) });
    const daily = !!(S.snap.changes_daily && S.snap.changes_daily.items);
    const since = ch && F.parseTime(ch.since);
    const label = !daily ? (S.snapshotPath ? "직전 시점 이후" : "직전 반영 이후")
      : since ? (S.snapshotPath ? `${pointLabel(since)} 이후` : `${whenLabel(since)} 이후`) : "오늘";
    return { list, label, prev: !!(rv && rv.prev), rival: rv };
  }

  // 하이라이트 줄의 시각: 역대 일정처럼 날짜만 있으면 발행기가 자정으로 싣는다(P3). 그때는 시각을 쓰지 않는다
  // 설계 14 때 기기에 남은 지나온 날 꼬리표를 새 말로(설계 15 Y1). 옛 말은 금지어라 원문에 글자로 두지 않는다
  const OLD_TAG = { "\uB73B\uBC16": "깜짝", "\uBC29\uC5B4": "지켜냄" };
  const TAGCLS = { 다관왕: "t-gold", 금: "t-gold", 은: "t-medal", 동: "t-medal", 깜짝: "t-hot", 라이벌: "t-rival", 아쉬움: "t-sad", "큰 득점": "t-medal", 지켜냄: "t-plain" };
  function momentRow(m, prev, i) {
    const right = F.momentRight(m, prev), d = m.tag === "깜짝" ? 0 : m.gap || 0;
    const title = m.name + (m.tag === "깜짝" && m.medal ? " " + m.medal : "");
    return `<li class="mo">${m.tag ? `<span class="mo-tag ${TAGCLS[m.tag] || ""}">${esc(m.tag)}</span>` : `<span class="mo-tag t-none" aria-hidden="true">·</span>`}`
      + `<b class="mo-n">${esc(title)}</b>`
      + (right ? `<span class="mo-r${d > 0 ? " up" : d < 0 ? " down" : ""}">${d > 0 ? "▲ " : d < 0 ? "▼ " : ""}${esc(right)}</span>` : "")
      + (m.line || m.t ? `<small class="mo-l">${esc(m.line || "")}${m.t && F.parseTime(m.t) && !/T00:00(:00)?/.test(m.t) ? `${m.line ? " · " : ""}${esc(F.hm(F.parseTime(m.t)))}` : ""}</small>` : "")
      + (i !== undefined && !S.snapshotPath ? `<button class="mo-share" data-moment="${i}" aria-label="${esc(title)} 하이라이트 카드 공유">공유</button>`
        : i !== undefined ? `<button class="mo-share" data-moment="${i}" aria-label="${esc(title)} 하이라이트 카드 저장">저장</button>` : "")
      + `</li>`;
  }

  function momentList(us, max) {
    const f = momentFeed(us);
    const n = S.momMore ? f.list.length : Math.min(max, f.list.length);
    let h = f.list.length ? `<ol class="moments">${f.list.slice(0, n).map((m, i) => momentRow(m, f.prev, i)).join("")}</ol>`
      : `<p class="note">${S.snap.completed_events ? "이 기간에 우리 지역 득점이 기대와 달라진 결과가 없습니다." : "아직 확정된 결과가 없습니다."}</p>`;
    if (f.list.length > max) h += `<button class="more" data-mmore="1" aria-expanded="${!!S.momMore}">${S.momMore ? "접기" : `더 보기(${esc(f.label.replace(/ 이후$/, ""))} 이후 ${F.num(f.list.length)}개)`}</button>`;
    return { h, f };
  }

  // 경기 중: 오늘의 하이라이트(옛 "들어온 결과")
  function resultsCard(us) {
    const { h, f } = momentList(us, 5);
    if (!f.list.length) return "";
    return card(`오늘의 하이라이트 <small>${esc(f.label)}</small>`, h, "c-wide c-moments c-results");
  }

  // 오늘 마무리: 오늘의 하이라이트 + 질문 결과 요약 + [마무리 카드 공유] [내일 나의 경기] [더 보기]. 목표 확률 줄은 머리(X1)에 있다
  function summaryCard(us, st) {
    const { h: feed, f } = momentList(us, 5);
    let h = feed;
    const ps = Object.values(S.picks).filter(p => p.e === evNo() && p.day === st.day);
    const done = ps.map(p => [p, resultOf(p.k, p)]).filter(x => x[1]);
    if (LEGACY_QUESTION && done.length) {
      h += `<p class="lead">오늘의 질문: ${esc(F.pickSummary(done.length, done.filter(([p, w]) => p.pick === w).length,
        done.filter(([p, w]) => (p.pa > 0.5 ? p.a : p.pa < 0.5 ? p.b : null) === w).length))}</p>`;
    } else if (LEGACY_QUESTION && ps.length) {
      h += `<p class="note">오늘 고른 질문 ${F.num(ps.length)}개는 결과를 기다리고 있습니다.</p>`;
    }
    const ws = watchedSummary(evNo(), st.day);
    if (ws.text) h += `<p class="lead c-watched">${esc(ws.text)}</p>`;
    else if (ws.n) h += `<p class="note">오늘 찜한 경기 ${F.num(ws.n)}개는 결과를 기다리고 있어요.</p>`;
    h += shoutEveLine(us);
    const nd = nextDay();
    h += `<div class="btn-row"><button class="act-btn primary" data-share="today">마무리 카드 공유</button>`
      + (nd ? `<button class="act-btn" data-daynext="1" aria-expanded="${S.dayNext}">${esc(nd.label)} 나의 경기</button>` : "")
      + `<button class="act-btn" data-daymore="1" aria-expanded="${S.dayMore}">${S.dayMore ? "접기" : "더 보기"}</button></div>`;
    return card(`오늘의 하이라이트 <small>${esc(us)} · ${esc(f.label)}</small>`, h, "c-wide c-daysum c-moments");
  }

  // 오늘(다음 경기일) 남은 경기 중 놓치면 아쉬운 경기 지수가 가장 높은 것
  function hotMatch(us) {
    const d = myDay();
    if (!d) return null;
    const ms = allMatches().filter(m => { const sc = sched(m); return sc && sc.day === d.day && !finished(m) && (m.sides || []).length && !(m.sides || []).every(sd => sd.settled); });
    // R8: 우리 지역이 뛰는 경기 우선(없을 때만 남의 경기)
    // R10 보강: 우리·라이벌이 안 뛰는 남의 경기는 줄에 보이는 우리 영향이 2%p 이상일 때만 후보(팽팽하기만 한 남의 경기가 3/5 로 서지 않게)
    const rv = rivalOf(us), rk = rv && !rv.prev ? rv.key : null;
    const ours = ms.filter(m => (m.sides || []).some(sd => sd.sido === us));
    const pool = ours.length ? ours : ms.filter(m => (m.sides || []).some(sd => sd.sido === rk) || shownMove(m, us) >= 2);
    let best = null;
    for (const m of pool) { const h = heatOf(m, us); if (!best || h.score > best.h.score || (h.score === best.h.score && (m.importance || 0) > (best.m.importance || 0))) best = { m, h }; }
    return best ? Object.assign(best, { d }) : null;
  }

  // 줄에 보이는 우리 영향(%p, 결론 문장의 숫자)의 크기
  function shownMove(m, us) {
    const b = !m.light && usImpact(m, us);
    return b ? Math.abs(Math.round(usMove(m, us, b).delta * 100)) : 0;
  }

  function hotCard(us) {
    const b = hotMatch(us);
    // R10: 놓치면 아쉬운 경기 지수 2 이하면 "가장 뜨거운" 이라 부를 경기가 없다
    if (!b || b.h.level <= 2) return "";
    return card(`${esc(b.d.label === "오늘" ? "오늘" : b.d.label)} 놓치면 아쉬운 경기 <small>${b.h.level}/5</small>`,
      `<div class="mrows">${matchRow(b.m, us, { open: true, noFork: true })}</div>`, "c-wide c-hot");
  }

  // 만약에(X3): 그날 우리 지역이 뛰는 승패 경기(라이벌이 뛰는 경기 제외, 우리 쪽 stake 있음) 셋까지 이김·짐을 가정해 격차만 다시 센다.
  // 확률은 건드리지 않고 저장하지 않는다. 격차 단위가 점일 때만(메달 목표의 금메달 격차는 stake 로 셀 수 없다)
  function whatIfGames(us) {
    const d = myDay(), gs = gapState(us);
    if (!d || !gs || gs.g.unit !== "점") return null;
    const rv = gs.rv;
    const games = allMatches().filter(m => { const sc = sched(m); return sc && sc.day === d.day && !finished(m) && !m.record && !m.light; })
      .map(m => [m, (m.sides || []).find(sd => sd.sido === us)])
      .filter(([m, mine]) => mine && !mine.settled && typeof mine.stake === "number" && mine.stake >= 10 && (rv.prev || !(m.sides || []).some(sd => sd.sido === rv.key)))
      .sort((a, b) => b[1].stake - a[1].stake).slice(0, 3)
      .map(([m, mine]) => ({ m, p: mine.p_win, stake: mine.stake, pick: S.whatIf[m.match_key] || null }));
    return games.length ? { d, gs, games } : null;
  }

  function whatIfCard(us) {
    const w = whatIfGames(us);
    if (!w) return "";
    const { d, gs, games } = w, n = x => F.num(Math.round(x));
    const rows = games.map(g => {
      const m = g.m, nm = `<b>${esc(F.hw(m.class_nm))}</b> ${esc(F.shortKind(m.kind_nm || ""))}`;
      const btn = (v, t) => `<button class="wi-b${g.pick === v ? " on" : ""}" data-wi="${esc(m.match_key)}" data-wv="${v}" aria-pressed="${g.pick === v}">${t}</button>`;
      return `<li class="wi"><span class="wi-n">${nm}</span><span class="wi-bs">${btn("w", "이김")}${btn("l", "짐")}</span>`
        + `<span class="wi-v num">+${n((1 - g.p) * g.stake)} / −${n(g.p * g.stake)}</span></li>`;
    }).join("");
    const after = F.whatIf(gs.gap, games), any = games.some(g => g.pick);
    // R5·설계 15 R4: "서울보다 2,250점 앞서요 → 2,449점 앞서요 (가정)". 고른 것이 없으면 화살표 없이 지금 값만
    const R = gs.rv.prev ? "" : F.sidoLabel(gs.rv.key);
    const fmt = (x, first) => gs.rv.prev ? `${first ? "이대로면 작년보다 " : ""}${F.signed(x)}점`
      : x > 0 ? `${first ? R + "보다 " : ""}${F.num(x)}점 앞서요` : x < 0 ? `${first ? R + "보다 " : ""}${F.num(-x)}점 뒤에 있어요` : `${first ? F.josa(R, "과", "와") + " " : ""}같은 점수예요`;
    const sum = any ? `<b class="num">${esc(fmt(gs.gap, true))}</b> → <b class="num hot">${esc(fmt(after, false))}</b> <small>(가정)</small>`
      : `<b class="num">${esc(fmt(gs.gap, true))}</b> <small>(지금)</small>`;
    return card(`만약에 <small>${esc(d.label)} 우리 경기를 가정해 보기</small>`,
      `<ol class="wis">${rows}</ol><p class="wi-sum">${sum}</p>`
      // R6
      + `<p class="note">지금 전망에는 이길 가능성이 이미 들어 있어, 이기면 남은 몫만큼 오르고 지면 들어 있던 몫만큼 내립니다. 목표 확률은 셈에 넣지 않고, 고른 것은 저장하지 않습니다.</p>`, "c-wide c-whatif");
  }

  function renderToday(us) {
    const st = dayState(S.day);
    if (!us || !S.snap.sidos[us]) {
      // 지역이 없으면 헤드라인·격차 없이 시간대 머리말과 "지금" 띠만
      let html = dayHead(st).replace("</section>", nowBand(st) + "</section>");
      if (us) return html + empty("이 지역의 전망이 없습니다.");
      html += card("어느 지역을 보시겠어요?", chooserInner(), "c-wide");
      const d1 = myDay();
      const ms = d1 ? (S.snap.matches || []).filter(m => sched(m) && sched(m).day === d1.day).sort((a, b) => b.importance - a.importance) : [];
      if (ms.length) html += card(`${esc(d1.label)}의 주요 경기 <small>(모든 시도 목표에 미치는 영향 순)</small>`,
        `<div class="mrows">${ms.slice(0, 5).map(m => matchRow(m, null, { noImpact: true })).join("")}</div>`, "c-wide");
      return html;
    }
    // 머리(헤드라인·격차·"지금" 띠)는 모든 시간대 상태에서 첫 자리(설계 14 X1, 브리핑 카드를 대신한다)
    let html = heroCard(us, st);
    // 오늘의 외침(Y6): 아침·경기 중 머리 바로 아래 한 줄 띠. 저녁은 마무리 카드 안 한 줄
    if (st.key === "morning" || st.key === "live") html += shoutBand(us);
    html += S.onboard ? favCard() : favBar();
    // 그 바로 아래 가장 뜨거운 경기 한 장(펼친 상태)과 만약에(X3). 저녁에는 그날 경기가 끝났으므로 뺀다(다시 보기는 다음 경기일로)
    if (st.key !== "evening" || S.snapshotPath) html += hotCard(us) + whatIfCard(us);
    if (S.returnStep && !S.onboard && !othersCard()) html += returnCard("onboard");
    // 표(§6-2)의 순서. 저녁의 브리핑은 라이벌 줄이 있을 때만(목표 한 줄은 결산 첫 줄과 겹친다)
    const order = {
      pre: [sinceCard, u => myDayCard(u), quizCard, multiCard, classHomeCards, questionCard, watchTop3],
      morning: [sinceCard, u => myDayCard(u), quizCard, multiCard, classHomeCards, questionCard, watchTop3],
      live: [sinceCard, u => nowCard(u, st), resultsCard, quizCard, u => myDayCard(u), multiCard, classHomeCards, questionCard, watchTop3],
      evening: [sinceCard, u => summaryCard(u, st), quizCard, eveningReturn, u => (S.dayNext ? myDayCard(u, nextDay()) : ""), multiCard, classHomeCards,
        u => (S.dayMore ? dayDetail(u) : ""), watchTop3],
    }[st.key];
    for (const f of order) html += f(us);
    return html;
  }

  // ── 기기 기록 chejeon.journal 과 "지난 방문 이후" (docs/UX_SCENARIOS.md §6-3) ──────────
  // 이 기기에만 남는다. 다시 보기에서는 읽지도 쓰지도 않는다. 50KB 를 넘으면 오래된 날부터 지운다
  function readJournal() {
    try {
      const o = JSON.parse(store(JOURNAL_KEY) || "null");
      if (o && o.v === 1 && typeof o === "object") return Object.assign({ days: {}, memo: {}, return_asked: false }, o);
    } catch (e) { /* 깨진 기록은 새로 시작 */ }
    return { v: 1, last_seen: null, days: {}, return_asked: false, memo: {} };
  }

  function saveJournal() {
    if (S.snapshotPath) return;
    const j = S.journal;
    let txt = JSON.stringify(j);
    const ks = Object.keys(j.days).sort();
    while (txt.length > JOURNAL_MAX && ks.length > 1) { const k = ks.shift(); delete j.days[k]; delete j.memo[k]; txt = JSON.stringify(j); }
    store(JOURNAL_KEY, txt);
  }

  // 지금 나의 경기 중 승패 경기(결과로 다시 찾을 것). 사전 확률은 지금 값을 함께 적어 둔다
  function seenMatches(us) {
    const d = myDay();
    if (!d) return [];
    return myDayList(us, d.day).list.filter(m => !m.record && (m.sides || []).length === 2)
      .map(m => ({ k: m.match_key, n: shortMatchName(m), a: m.sides[0].sido, b: m.sides[1].sido, pa: Math.round(m.sides[0].p_win * 1000) / 1000 }));
  }

  // 열 때·자료가 갱신될 때·화면을 떠날 때. 그날 칸(여정 띠의 재료)과 last_seen 을 고친다
  function touchJournal() {
    const us = S.sido, s = S.snap;
    if (S.snapshotPath || !us || !s || !s.sidos[us]) return;
    if (othersCard()) return;      // 받은 응원 카드의 지역을 보는 중: 내 기록이 아니다
    const j = S.journal, v = s.sidos[us], now = new Date(), day = String(F.dayKey(now));
    const my = seenMatches(us), ev = evNo();
    // 그날 우리 지역 결과 중 사전 확률이 가장 낮았던 메달
    const ch = s.changes_daily && s.changes_daily.surprises ? s.changes_daily : s.changes;
    const sur = ((ch && ch.surprises) || []).filter(x => x.sido === us).sort((a, b) => a.prior_medal_p - b.prior_medal_p)[0];
    const prev = j.days[day] || {};
    // mine: 그날(오늘) 나의 경기 전부(기록 종목 포함). 끝나면 목록에서 빠지므로 모아 둔다(여정의 "오늘 나의 경기 n개 중 k개 끝남", 결산의 나의 경기 수)
    const today = myDayList(us, +day).list.map(m => m.match_key);
    j.days[day] = Object.assign(prev, { opened: true, sido: us, target_key: v.target.key, target_prob: v.target.prob,
      my_keys: [...new Set((prev.my_keys || []).concat(my.map(x => x.k)))].slice(0, 30),
      mine: [...new Set((prev.mine || []).concat(today))].slice(0, 30),
      picks: Object.values(S.picks).filter(p => p.e === ev && String(p.day) === day).length,
      watched: watchedOf(ev, +day).length,
      surprise: sur ? { name: F.hw(sur.name), medal: sur.medal, p: sur.prior_medal_p } : (prev.surprise || null),
      // 그날의 큰 하이라이트 셋(X2, 지나온 날 줄). 어제 저녁 이후 자료일 때만(직전 반영 이후뿐이면 그날 전체가 아니다)
      moments: s.changes_daily && s.changes_daily.items
        ? momentFeed(us).list.slice(0, 3).map(m => ({ t: m.tag, n: m.name, g: m.gap, p: m.prior, m: m.medal })) : (prev.moments || []) });
    if (!j.since || j.since.sido !== us) j.since = { sido: us, day };
    // 결과를 기다리는 나의 경기는 다음 방문까지 들고 간다(어제 목록의 경기도 오늘 결과로 찾는다)
    const carry = ((j.last_seen && j.last_seen.sido === us && j.last_seen.my) || []).filter(x => !resultOf(x.k) && !my.some(y => y.k === x.k));
    j.last_seen = { t: now.toISOString(), data_as_of: s.data_as_of, event: ev, sido: us, target_key: v.target.key, target_prob: v.target.prob,
      my: my.concat(carry).slice(0, 20),
      pick_keys: Object.values(S.picks).filter(p => p.e === ev && !resultOf(p.k, p)).map(p => p.k),
      watch_keys: watchedOf(ev).filter(([k, x]) => !resultOf(k, x)).map(([k]) => k).slice(0, 100) };
    saveJournal();
  }

  function whenLabel(t) {
    const now = new Date(), d = F.dayKey(t);
    if (d === F.dayKey(now)) return "오늘 " + F.hm(t);
    if (d === F.dayKey(new Date(now.getTime() - 864e5))) return "어제 " + F.hm(t);
    return F.mdhm(t);
  }

  // 지난번(이 페이지를 열기 전의 last_seen) 이후 바뀐 것. 없거나 24시간 안이면서 바뀐 것이 없으면 카드를 내지 않는다
  function sinceCard(us) {
    const ls = S.seen, s = S.snap, v = s.sidos[us];
    if (S.snapshotPath || !ls || ls.sido !== us || ls.event !== evNo()) return "";
    const t = F.parseTime(ls.t);
    if (!t) return "";
    const lines = [];
    let changed = false;
    if (ls.target_key === v.target.key) {
      const a = bigParts(ls.target_prob).n, b = bigParts(v.target.prob).n, d = b - a;
      if (d) changed = true;
      lines.push(`목표 확률 ${esc(F.pct(ls.target_prob))} → <b>${esc(F.pct(v.target.prob))}</b> `
        + (d ? `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${esc(F.pp(d / 100))}</span>` : "<small>변화 거의 없음</small>"));
    } else {
      changed = true;
      lines.push(`목표가 바뀌었습니다: 지금 ${esc(v.target.label)} ${esc(F.pct(v.target.prob))}`);
    }
    const ended = (ls.my || []).map(x => [x, resultOf(x.k)]).filter(x => x[1]);
    if (ended.length) {
      changed = true;
      // 하이라이트 한 줄 꼴(X2): 꼬리표 · 경기 · 결과(사전 확률). 꼬리표는 우리 승(사전 15% 미만이면 깜짝)·우리 패(아쉬움)·그 밖(결과)
      const rv = rivalOf(us);
      lines.push(`나의 경기 ${F.num(ended.length)}개 끝남<ol class="moments since-mo">` + ended.slice(0, 3).map(([x, w]) => {
        const pw = w === x.a ? x.pa : 1 - x.pa, mine = x.a === us || x.b === us;
        const tag = !mine ? (rv && !rv.prev && (x.a === rv.key || x.b === rv.key) ? "라이벌" : "결과") : w === us ? (pw < 0.15 ? "깜짝" : "승") : "아쉬움";
        return `<li class="mo"><span class="mo-tag ${TAGCLS[tag] || "t-plain"}">${esc(tag)}</span><b class="mo-n">${esc(x.n)}</b>`
          + `<span class="mo-r">${esc(w)} 승(사전 ${esc(F.pct(pw))})</span></li>`;
      }).join("") + `</ol>`);
    }
    const wk = (ls.watch_keys || []).filter(k => S.watch[k]).map(k => [k, S.watch[k], resultOf(k, S.watch[k])]).filter(x => x[2]);
    if (wk.length) {
      changed = true;
      lines.push(`찜했던 경기 ${F.num(wk.length)}개 결과 나옴 · 우리 승 ${F.num(wk.filter(([, x, w]) => x.side === us && w === us).length)}`);
    }
    const picks = LEGACY_QUESTION ? (ls.pick_keys || []).map(k => S.picks[k]).filter(Boolean).map(p => [p, resultOf(p.k, p)]).filter(x => x[1]) : [];
    if (picks.length) {
      changed = true;
      const same = picks.filter(([p, w]) => p.pick === w).length;
      lines.push(`오늘의 질문 ${F.num(picks.length)}개 결과 나옴 · 고른 쪽과 같은 결과 ${F.num(same)}개`);
    }
    if (!changed && new Date() - t < 864e5) return "";
    if (!changed) lines.push("그사이 전망이 거의 바뀌지 않았습니다.");
    return card(`지난번(${esc(whenLabel(t))}) 이후`, `<ul class="since">${lines.map(l => `<li>${l}</li>`).join("")}</ul>`
      + `<div class="btn-row"><button class="act-btn" data-goto="watch">오늘 경기 보기 →</button></div>`, "c-since");
  }

  // ── 돌아오기: 진입 ③ "경기를 놓치지 않으려면" 과 첫 저녁 결산 아래 한 번 더 (§1-1, §6-8 화면 쪽) ──
  function standalone() {
    return !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }

  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); }

  // ── 알림(설계 14 X7) ──
  // 켜짐: PUSH_API·VAPID_PUBLIC 이 있고, 실시간·내 지역(남의 카드 아님). 브라우저가 Push 를 못 하면 iOS 는 홈 화면 추가 안내, 그 밖은 단추 없음
  function pushConfigured() { return !!PUSH_API && !!VAPID_PUBLIC && !S.snapshotPath && !!evNo(); }
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function pushState() {
    try { const o = JSON.parse(store(PUSH_KEY) || "null"); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
  }
  function b64u(s) {
    const p = "=".repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  function pushButton() {
    if (!pushConfigured() || othersCard() || !S.sido) return "";
    const st = pushState(), on = !!(st && st.on);
    return `<button class="act-btn${on ? "" : " primary"}" data-push="open" aria-expanded="${S.pushSheet}">${on ? "알림 설정" : "알림 받기"}</button>`;
  }
  // 설정 시트: 결과·경기 전·저녁 결산 켜기/끄기, [알림 켜기/설정 저장], [알림 끄기]. iOS 에서 Push 를 못 하면(홈 화면에 추가 전) 안내만
  function pushSheet() {
    if (!S.pushSheet || !pushConfigured() || othersCard()) return "";
    if (!pushSupported()) {
      return `<div class="push-sheet" role="group" aria-label="알림"><p class="guide">${isIOS()
        ? "iPhone 은 홈 화면에 추가한 체전 라이브에서만 알림을 받을 수 있습니다. Safari 아래쪽 공유 단추(□↑) → \"홈 화면에 추가\" 뒤, 홈 화면의 체전 라이브에서 다시 \"알림 받기\"를 누르세요."
        : "이 브라우저는 알림을 받을 수 없습니다."}</p></div>`;
    }
    const st = pushState(), on = !!(st && st.on), kinds = S.pushDraft || (st && st.kinds) || PUSH_KINDS.map(k => k[0]);
    const rows = PUSH_KINDS.map(([k, t, d]) => `<li><button class="chip${kinds.includes(k) ? " on" : ""}" data-pushkind="${k}" aria-pressed="${kinds.includes(k)}">${esc(t)}</button> <small>${esc(d)}</small></li>`).join("");
    return `<div class="push-sheet" role="group" aria-label="알림 설정"><ul class="push-kinds">${rows}</ul>`
      + `<div class="btn-row"><button class="act-btn primary" data-push="save"${kinds.length && !S.pushBusy ? "" : " disabled"}>${on ? "설정 저장" : "알림 켜기"}</button>`
      + (on ? `<button class="act-btn" data-push="off"${S.pushBusy ? " disabled" : ""}>알림 끄기</button>` : "") + `</div>`
      + `<p class="note">${esc(S.sido)} 응원 지역과 관심 종목 기준으로 보냅니다. 저장하는 것은 이 기기의 알림 주소·키, 지역·종목·대회 회차뿐이고(접속 주소 없음), 폐막 7일 뒤 모두 지웁니다.</p>`
      + (S.pushMsg ? `<p class="note" role="status">${esc(S.pushMsg)}</p>` : "") + `</div>`;
  }
  async function pushSave() {
    const kinds = S.pushDraft || ((pushState() || {}).kinds) || PUSH_KINDS.map(k => k[0]);
    if (!kinds.length || S.pushBusy) return;
    S.pushBusy = true; S.pushMsg = null; render();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("permission");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC) });
      const j = sub.toJSON ? sub.toJSON() : sub;
      const r = await fetch(`${PUSH_API}/push/subscribe`, { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ sub: j, sido: S.sido, fav: S.fav.slice(0, 30), event: +evNo(), kinds }) });
      if (!r.ok) throw new Error("subscribe " + r.status);
      store(PUSH_KEY, JSON.stringify({ on: true, kinds, endpoint: j.endpoint, sido: S.sido, event: +evNo() }));
      S.pushMsg = "알림을 켰습니다."; S.pushDraft = null; markReturn();
    } catch (e) {
      S.pushMsg = e && e.message === "permission" ? "브라우저에서 알림을 허용하지 않아 켜지 못했습니다." : "알림을 켜지 못했습니다.";
    }
    S.pushBusy = false; render();
  }
  async function pushOff() {
    const st = pushState();
    S.pushBusy = true; render();
    try {
      if (st && st.endpoint) await fetch(`${PUSH_API}/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ endpoint: st.endpoint, event: +evNo() }) }).catch(() => null);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* 응답과 무관하게 기기 설정은 끈다 */ }
    store(PUSH_KEY, JSON.stringify({ on: false }));
    S.pushBusy = false; S.pushMsg = "알림을 껐습니다."; S.pushDraft = null; render();
  }

  function returnCard(where) {
    const btns = (standalone() ? "" : `<button class="act-btn primary" data-install="1">홈 화면에 추가</button>`)
      + `<button class="act-btn${standalone() ? " primary" : ""}" data-ics="return">나의 경기를 캘린더에</button>`
      + pushButton()
      + (where === "onboard" ? `<button class="act-btn link" data-return="later">괜찮아요, 나중에</button>` : "");
    const guide = !S.installGuide ? "" : `<p class="guide">${isIOS()
      ? "Safari 아래쪽 공유 단추(□↑)를 누르고 \"홈 화면에 추가\"를 고르세요."
      : "브라우저 메뉴(⋮)에서 \"홈 화면에 추가\" 또는 \"앱 설치\"를 고르세요."}</p>`;
    const lead = pushConfigured() ? "대회 7일, 이렇게 챙기세요. 알림은 켠 사람에게만 보냅니다." : "알림은 보내지 않습니다. 대회 7일, 이렇게 챙기세요.";
    return card("경기를 놓치지 않으려면", `<p class="note">${lead}</p>`
      + `<div class="btn-row">${btns}</div>${guide}${pushSheet()}`, `c-wide c-return${where === "onboard" ? " c-onboard" : ""}`);
  }

  // 남의 응원 카드를 보는 중(§6-7): 이 사람의 기록이 아니므로 돌아오기 카드를 띄우지도, return_asked 를 쓰지도 않는다
  function othersCard() { return S.fromCard && S.sido !== S.ownSido; }

  function markReturn() {
    if (S.journal.return_asked || othersCard()) return;
    S.journal.return_asked = true;
    saveJournal();
  }

  async function doInstall() {
    markReturn();
    if (S.installEvt) {
      const e = S.installEvt;
      S.installEvt = null;
      try { await e.prompt(); await e.userChoice; } catch (err) { /* 사용자가 닫음 */ }
      S.returnStep = false;
    } else {
      S.installGuide = true;     // iOS·설치 신호가 없는 브라우저: 두 줄 안내
    }
    render();
  }

  // 첫 저녁 결산 아래에서 한 번 더(③ 을 지나친 사람에게). 보여 주면 다시 묻지 않는다
  function eveningReturn() {
    if (S.snapshotPath || S.returnStep || S.returnLater || othersCard()) return "";
    if (S.journal.return_asked && !S.returnEvening) return "";
    if (!S.returnEvening) { S.returnEvening = true; markReturn(); }
    return returnCard("evening");
  }

  // ── 나의 체전 탭 (§6-6): 응원 프로필 · 여정 띠 · 오늘 한 줄 · 내가 고른 경기 · 지나온 날 · 결산 카드 · 돌아오기 ──────────
  // 기록은 전부 이 기기(journal). 다시 보기는 샘플 여정(리플레이 시점까지 모든 날을 열어 본 것으로), 남의 응원 카드를 보는 중에는 기록을 보이지 않는다.
  // 어휘: "함께한 날". 배지·스탬프·점수·등급·순위표·연속 기록 같은 말은 쓰지 않는다
  function addDays(day, n) {
    const t = new Date(Date.UTC(Math.floor(day / 10000), Math.floor(day / 100) % 100 - 1, day % 100 + n));
    return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
  }

  function shortDay(day) { return `${Math.floor(day / 100) % 100}/${day % 100}`; }

  // 이 지역으로 열어 본 날의 기록 {날: 칸}. 다시 보기·남의 카드에서는 비어 있다
  function myDays(us) {
    const out = {};
    if (S.snapshotPath || othersCard()) return out;
    for (const [d, x] of Object.entries(S.journal.days || {})) if (x && x.opened && x.sido === us) out[d] = x;
    return out;
  }

  // 여정 띠의 칸: "개막 전" 한 칸 + 개막일~폐막일. 칸마다 열어 봤는지, 오늘인지, 함께하기 전인지, 그날 목표 확률.
  // 지난 칸의 목표 확률 = 그날 저녁 값(W4 검토 1, §6-6 2): 그날 22시(한국) 이후 첫 timeline 점(다음 날 22시 전, 같은 목표 키) →
  // 없으면 그날 마지막 점(같은 목표) → 없으면 그날 기록(같은 목표). dailyBasePoint 와 같은 점이라 다음 날 "어제 저녁 n%" 와 숫자가 같다.
  // 기록은 마지막으로 연 때의 값이라 timeline 에 그날이 없을 때(7일 보존, 개막 전 칸)만 쓴다. 목표가 달랐던 날은 비운다. 오늘 칸은 지금 값
  function journey(us) {
    const s = S.snap, ev = s.event || {}, sd = dayOf(ev.start_date), ed = dayOf(ev.end_date);
    if (!sd || !ed || ed < sd || dayDiff(ed, sd) > 20) return null;
    const v = s.sidos[us], key = v.target.key, today = F.dayKey(refNow()), sample = !!S.snapshotPath;
    const days = myDays(us);
    // 함께한 첫날 = 이 지역으로 열어 본 가장 이른 날(W4 검토 6). 저장된 since 는 지역을 A→B→A 로 오가면 뒤로 밀린다
    const opened0 = Object.keys(days).map(Number);
    const since = sample ? null : opened0.length ? Math.min(...opened0)
      : S.journal.since && S.journal.since.sido === us ? +S.journal.since.day : null;
    const all = timelinePoints().filter(p => p.sidos[us]);
    const tl = all.filter(p => p.sidos[us].target_key === key);
    const recs = test => Object.keys(days).filter(d => test(+d)).sort().map(d => days[d]);
    const at22 = d => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100, 13, 0);   // 그날 22시(한국)
    const probOf = (test, last) => {
      const from = at22(last), to = at22(addDays(last, 1));
      const eve = tl.find(x => x.t >= from && x.t < to);
      if (eve) return eve.sidos[us].target_prob;
      const p = tl.filter(x => test(F.dayKey(x.t)));
      if (p.length) return p[p.length - 1].sidos[us].target_prob;
      const r = recs(test).filter(x => x.target_key === key && typeof x.target_prob === "number");
      return r.length ? r[r.length - 1].target_prob : null;
    };
    // 비운 까닭이 목표가 달라서인가(그날 다른 목표의 점·기록이 있다)
    const otherTarget = test => all.some(x => test(F.dayKey(x.t)) && x.sidos[us].target_key !== key)
      || recs(test).some(x => x.target_key && x.target_key !== key);
    const cell = (k, label, test, last) => {
      const isToday = test(today), future = k !== "pre" && k > today;
      // 오늘 칸은 지금 보고 있으니 열어 본 날이다(기록은 그리고 난 뒤 touchJournal 이 남긴다)
      const opened = sample ? !future : (isToday && !othersCard()) || recs(test).length > 0;
      const prob = future ? null : isToday ? v.target.prob : probOf(test, last);
      return { key: k, label, opened, today: isToday, future, before: !sample && since !== null && last < since,
        state: isToday ? "today" : opened ? "on" : future ? "future" : "off",
        prob, otherBlank: prob === null && !future && !isToday && otherTarget(test) };
    };
    const cells = [cell("pre", "개막 전", d => d < sd, addDays(sd, -1))];
    for (let d = sd, i = 0; d <= ed; d = addDays(d, 1), i++) cells.push(cell(d, `D+${i}`, x => x === d, d));
    return { cells, sd, ed, today, since, sample };
  }

  function journeyCard(us) {
    if (othersCard()) {
      return card("함께한 날", empty(S.ownSido ? `받은 응원 카드의 지역을 보는 중입니다. 내 지역(${esc(S.ownSido)})으로 보면 나의 체전 기록이 보입니다.`
        : "응원 지역을 고르면 그날부터 이 기기에 나의 체전 기록이 남습니다."), "c-wide c-journey");
    }
    const jr = journey(us);
    if (!jr) return "";
    const mark = { on: "●", off: "○", today: "◐", future: "○" };
    const word = { on: "열어 본 날", off: "안 본 날", today: "오늘", future: "아직 오지 않은 날" };
    const lis = jr.cells.map(c => `<li class="jr-c jr-${c.state}${c.before ? " before" : ""}">`
      + `<span class="jr-l">${esc(c.label)}</span><span class="jr-m" aria-hidden="true">${mark[c.state]}</span>`
      + `<small class="jr-p">${c.prob === null ? "" : esc(F.pct(c.prob))}</small>`
      + `<span class="sr">${esc(c.label)}: ${word[c.state]}${c.before ? " · 함께하기 전" : ""}${c.prob === null ? "" : " · 목표 확률 " + esc(F.pct(c.prob))}</span></li>`).join("");
    let note;
    if (jr.sample) note = "다시 보기: 이 시점까지 모든 날을 열어 본 것으로 그린 예시입니다.";
    else {
      const from = jr.since === null ? null : jr.since < jr.sd ? "개막 전부터 함께했습니다" : jr.since <= jr.ed ? `D+${dayDiff(jr.since, jr.sd)}부터 함께했습니다` : null;
      note = [from, jr.cells.some(c => c.before) ? "흐린 칸은 함께하기 전입니다" : null].filter(Boolean).join(" · ");
    }
    return card(`함께한 날 <small>${esc(S.snap.sidos[us].target.label)} 목표 확률</small>`,
      `<ol class="jr" style="--n:${jr.cells.length}">${lis}</ol>`
      + `<p class="note jr-key">● 열어 본 날 · ○ 안 본 날 · ◐ 오늘. 아래 숫자는 그날 저녁 목표 확률(오늘은 지금)입니다.`
      + `${jr.cells.some(c => c.otherBlank) ? " 목표가 달랐던 날은 비워 둡니다." : ""}</p>`
      + (note ? `<p class="note">${esc(note)}</p>` : ""), "c-wide c-journey");
  }

  // 오늘 나의 경기: 그날 기록에 남은 키(끝나면 목록에서 빠지므로 기기에 모아 둔다) ∪ 지금 목록. 끝남 = 결과가 있거나 남은 경기에서 사라짐
  function todayMine(us) {
    const today = F.dayKey(refNow()), j = myDays(us)[today];
    const keys = [...new Set(((j && j.mine) || []).concat(myDayList(us, today).list.map(m => m.match_key)))];
    const left = new Set(allMatches().filter(m => !finished(m)).map(m => m.match_key));
    return { keys, n: keys.length, k: keys.filter(k => resultOf(k) || !left.has(k)).length };
  }

  // 오늘 한 줄(설계 9 K): 늘 템플릿 — 목표 확률 + 어제 저녁 대비 + 나의 경기 사실. 해설 문장은 쓰지 않는다(W4 검토 3, 해설은 레이스 탭)
  function todaySay(us) {
    const v = S.snap.sidos[us], { prevPt, beforeLabel } = todayTrend(us);
    const d = prevPt ? bigParts(v.target.prob).n - bigParts(prevPt.d.target_prob).n : null;
    const say = `목표 '${v.target.label}' 확률 ${F.pct(v.target.prob)}` + (d === null ? "입니다."
      : d === 0 ? `, ${F.josa(beforeLabel, "과", "와")} 비슷합니다.` : `, ${beforeLabel}보다 ${Math.abs(d)}%p ${d > 0 ? "올랐습니다" : "내렸습니다"}.`);
    const facts = [];
    const tm = todayMine(us);
    if (tm.n) facts.push(`오늘 나의 경기 ${F.num(tm.n)}개 중 ${F.num(tm.k)}개 끝남`);
    const nd = nextDay();
    if (nd) {
      const first = myDayList(us, nd.day).list.map(m => sched(m)).filter(sc => sc && sc.timed).sort((a, b) => a.start - b.start)[0];
      if (first) facts.push(`${nd.label} 첫 경기 ${F.hm(first.start)}`);
    }
    return { say, facts };
  }

  function todayLineCard(us) {
    const { say, facts } = todaySay(us), today = F.dayKey(refNow());
    let h = `<p class="comment">${esc(say)}</p>` + (facts.length ? `<p class="lead">${esc(facts.join(" · "))}</p>` : "");
    if (!S.snapshotPath && !othersCard()) {
      const memo = (S.journal.memo || {})[today] || "";
      h += `<label class="memo"><span>내 메모 한 줄</span><input id="memo" type="text" maxlength="${MEMO_MAX}" value="${esc(memo)}" `
        + `placeholder="오늘 기억할 것 (${MEMO_MAX}자, 이 기기에만)" autocomplete="off"></label>`;
    }
    return card(`오늘 한 줄 <small>${esc(F.dayLabel(today))}</small>`, h, "c-todayline");
  }

  function saveMemo(t) {
    if (S.snapshotPath || othersCard()) return;
    const day = String(F.dayKey(refNow())), m = S.journal.memo || (S.journal.memo = {});
    t = String(t || "").trim().slice(0, MEMO_MAX);
    if (t) m[day] = t; else delete m[day];
    saveJournal();
  }

  // 지나온 날: 열어 본 날을 최근부터. 한 줄 = 날짜 · 나의 경기 n · 질문 · 그날의 깜짝 메달(사전 확률이 가장 낮았던 우리 메달) · 메모
  function pastDaysCard(us) {
    const days = myDays(us), today = F.dayKey(refNow()), ev = evNo(), sd = dayOf((S.snap.event || {}).start_date);
    const ks = Object.keys(days).map(Number).filter(d => d < today).sort((a, b) => b - a);
    if (!ks.length) return "";
    const rows = ks.map(d => {
      const x = days[d], parts = [];
      const mine = new Set((x.mine || []).concat(x.my_keys || [])).size;
      if (mine) parts.push(`나의 경기 ${F.num(mine)}`);
      const wd = watchedOf(ev, d).length || x.watched || 0;
      if (wd) parts.push(`찜했던 경기 ${F.num(wd)}`);
      const ps = LEGACY_QUESTION ? Object.values(S.picks).filter(p => p.e === ev && p.day === d) : [];
      if (ps.length) {
        const done = ps.map(p => [p, resultOf(p.k, p)]).filter(y => y[1]);
        parts.push(`질문 ${F.num(ps.length)}개 중 결과 ${F.num(done.length)}개` + (done.length ? ` · 고른 쪽과 같은 결과 ${F.num(done.filter(([p, w]) => p.pick === w).length)}개` : ""));
      }
      const sur = x.surprise ? `<br><small>깜짝 메달: ${esc(x.surprise.name)} ${esc(x.surprise.medal)} · 경기 전엔 ${esc(F.wasYo(x.surprise.p))}</small>` : "";
      const memo = (S.journal.memo || {})[d] ? `<br><small class="memo-l">“${esc(S.journal.memo[d])}”</small>` : "";
      const lbl = F.dayLabel(d) + (sd ? d < sd ? " · 개막 전" : ` · D+${dayDiff(d, sd)}` : "");
      // 그날의 하이라이트(X2): 오늘의 하이라이트와 같은 줄 꼴
      const rv = rivalOf(us);
      const mo = (x.moments || []).length ? `<ol class="moments past-mo">${x.moments.map(m => momentRow({ tag: OLD_TAG[m.t] || m.t, name: m.n, gap: m.g, prior: m.p, medal: m.m, line: "" }, !!(rv && rv.prev))).join("")}</ol>` : "";
      return `<li><b>${esc(lbl)}</b> ${esc(parts.length ? parts.join(" · ") : "열어 봄")}${sur}${mo}${memo}</li>`;
    }).join("");
    return card("지나온 날", `<ul class="since past">${rows}</ul>`, "c-past");
  }

  // 결산이 "제n회 결산" 인가: 남은 세부종목 0 이거나 폐막일 22시(한국) 뒤
  function recapFinal() {
    const ed = dayOf((S.snap.event || {}).end_date);
    const endT = ed ? new Date(Date.UTC(Math.floor(ed / 10000), Math.floor(ed / 100) % 100 - 1, ed % 100, 13)) : null;
    return S.snap.remaining_events === 0 || !!(endT && refNow() >= endT);
  }

  // 결산 카드(§6-6 6). 대회 중에는 "지금까지"(중간 결산), 모든 세부종목이 끝났거나 폐막일 22시 뒤면 "제n회 결산"
  function recapModel(us) {
    const s = S.snap, ev = evNo(), v = s.sidos[us], name = F.sidoLabel(us), jr = journey(us), sample = !!S.snapshotPath;
    const cells = jr ? jr.cells : [], evCells = cells.filter(c => c.key !== "pre");
    const n = evCells.filter(c => c.opened).length;
    const final = recapFinal();
    const days = myDays(us);
    const mine = sample ? null : new Set(Object.values(days).flatMap(x => (x.mine || []).concat(x.my_keys || []))
      .concat(othersCard() ? [] : todayMine(us).keys)).size;
    const ps = Object.values(S.picks).filter(p => p.e === ev);
    const done = ps.filter(p => resultOf(p.k, p));
    const other = done.filter(p => { const w = resultOf(p.k, p), fav = p.pa > 0.5 ? p.a : p.pa < 0.5 ? p.b : null; return fav && p.pick !== fav && p.pick === w; }).length;
    // 깜짝 메달: 함께한 날의 우리 지역 결과 중 사전 확률이 가장 낮았던 메달(다시 보기는 그 시점 자료)
    let sur = null;
    if (sample) {
      const ch = s.changes_daily && s.changes_daily.surprises ? s.changes_daily : s.changes;
      const x = ((ch && ch.surprises) || []).filter(y => y.sido === us).sort((a, b) => a.prior_medal_p - b.prior_medal_p)[0];
      if (x) sur = { day: dayOf(s.data_as_of), name: F.hw(x.name), medal: x.medal, p: x.prior_medal_p };
    } else {
      for (const [d, x] of Object.entries(days)) if (x.surprise && (!sur || x.surprise.p < sur.p)) sur = Object.assign({ day: +d }, x.surprise);
    }
    let fin = null;
    if (showReveal() && S.outcomes.sidos[us]) fin = { rank: S.outcomes.sidos[us].rank, points: S.outcomes.sidos[us].points, real: true };
    else if (s.remaining_events === 0) {
      const pn = s.points_now || {}, order = Object.keys(s.sidos).sort((a, b) => (pn[b] || 0) - (pn[a] || 0));
      fin = { rank: order.indexOf(us) + 1, points: pn[us] || 0 };
    }
    const vals = cells.filter(c => c.prob !== null).map(c => F.pct(c.prob));
    const path = vals.length > 4 ? [vals[0], "…", vals[vals.length - 2], vals[vals.length - 1]] : vals;
    const extra = [
      cells.length && cells[0].opened && !cells[0].before ? "개막 전부터 함께했습니다" : null,
      [mine !== null ? `나의 경기 ${F.num(mine)}` : null, `찜했던 경기 ${F.num(watchedOf(ev).length)}`].filter(Boolean).join(" · "),
      LEGACY_QUESTION && done.length ? `전망과 다른 쪽을 골라 결과가 같았던 선택 ${F.num(other)}` : null,
      // Y5: 함께 푼 퀴즈 수(정답 수가 아님). 다시 보기는 기기 기록을 쓰지 않는다
      !sample && Object.keys(readQuiz().days).length ? `퀴즈 ${F.num(Object.keys(readQuiz().days).length)}문제 함께` : null,
      watchedSummary(ev).text || null,
      ...S.who.map(person).filter(p => p && !sample).map(p => `응원한 선수 ${personLabel(p)} · 메달 ${F.num((p.medals || []).length)}`),
      sur ? { head: `깜짝 메달: ${sur.day ? shortDay(sur.day) + " " : ""}`, mid: sur.name, tail: ` ${sur.medal} · 경기 전엔 ${F.wasYo(sur.p)}` } : null,
      path.length >= 2 ? { head: "목표 확률 여정 ", mid: path.join(" → "), tail: "" } : null,
      fin ? `${fin.real ? "실제 " : ""}최종 종합 ${fin.rank}위 · ${fin.real ? "득점" : "딴 점수"} ${F.num(fin.points)}점` : null,
    ].filter(Boolean);
    return { kind: "recap", ev: (s.event && s.event.name) || "전국체육대회", kick: final ? `${ev ? `제${ev}회 ` : ""}결산` : "지금까지",
      title: `나의 ${ev ? `제${ev}회 ` : ""}전국체전`, label: `${F.josa(name, "과", "와")} 함께한 ${evCells.length}일 중`,
      bigText: String(n), unit: "일", n, lines: [], extra, cells, foot: shareFoot() };
  }

  // 개막 전(기기 날짜 < 개막일, 다시 보기 제외)·여정이 없을 때·남의 응원 카드를 보는 중에는 결산 단추·요약 없이 안내 한 줄과 다른 이미지만(W4 검토 2).
  // "함께한 0일" 을 만들지 않고, 남의 카드에서는 받는 사람의 질문 기록이 섞이지 않게 한다
  function recapCard(us) {
    const others = `<h4 class="sum-h">다른 이미지</h4><div class="btn-row"><button class="act-btn" data-share="cheer">응원 카드</button>`
      + `<button class="act-btn" data-share="today">오늘 카드</button></div>`;
    const sd = dayOf((S.snap.event || {}).start_date), jr = journey(us);
    const pre = !S.snapshotPath && sd && F.dayKey(new Date()) < sd;
    if (pre || !jr || othersCard()) {
      const from = `개막일${sd ? " " + shortDay(sd) : ""}부터 `;
      // 남의 응원 카드(W4 수정 검토 ①): 대회 중에 "개막일부터" 는 거짓이므로 할 일(내 지역으로 보기·지역 고르기)을 알린다
      const msg = othersCard()
        ? (S.ownSido
          ? `받은 응원 카드의 지역을 보는 중에는 결산 카드를 만들지 않습니다. 내 지역(${esc(S.ownSido)})으로 보면 ${pre ? from : ""}만들 수 있습니다.`
          : `응원 지역을 고르면 그 지역의 결산 카드를 ${pre ? from : ""}만들 수 있습니다.`)
        : `결산 카드는 ${from}만들 수 있습니다. 개막 전부터 함께한 날은 결산에 적힙니다.`;
      return card("결산 카드", `<p class="note">${msg}</p>` + others, "c-recap");
    }
    const md = recapModel(us);
    const rows = [`${md.label} ${md.n}일`].concat(md.extra.map(partText)).map(t => `<li>${esc(t)}</li>`).join("");
    return card(`결산 카드 <small>${esc(md.kick)}</small>`, `<ul class="since">${rows}</ul>`
      + `<div class="btn-row"><button class="act-btn primary" data-share="recap">나의 체전 결산 카드</button></div>`
      + `<p class="note">그림 한 장으로 저장하거나 휴대폰으로 보냅니다.${recapFinal() ? ""
        : ` 대회가 끝나면 "${esc(evNo() ? `제${evNo()}회 ` : "")}결산"으로 바뀝니다.`}</p>` + others, "c-recap");
  }

  function profileCard(us) {
    const rv = rivalOf(us);
    const prof = `<dl class="kv prof"><dt>우리 지역</dt><dd>${esc(us)}</dd><dt>관심 종목</dt><dd>${S.fav.length ? esc(S.fav.join(" · ")) : "없음"}</dd>`
      + (rv ? `<dt>라이벌</dt><dd>${esc(rv.name)} <small>${rv.auto ? "자동" : "고른 상대"}</small></dd>` : "")
      + (S.people ? `<dt>응원 선수·학교</dt><dd>${(S.who.length || S.school)
        ? esc(S.who.map(id => person(id) ? personLabel(person(id)) : id).concat(S.school ? [S.school] : []).join(" · "))
        : `<button class="linkish dark" data-people-open="1">찾기</button>`}</dd>` : "") + `</dl>`
      + `<div class="btn-row"><button class="act-btn primary" data-sharelink="1">응원 링크 공유</button>`
      + dareButton(us)
      + `<button class="act-btn" data-prof-edit="1">고치기</button>`
      + (rv ? `<button class="act-btn" data-goto="race">라이벌 바꾸기</button>` : "") + `</div>`
      + (S.copied ? `<p class="note" role="status">${esc(S.copied)}</p>` : "")
      + `<p class="note">고른 것은 이 기기에만 저장됩니다. 링크를 받은 사람은 ${esc(us)} 화면으로 바로 들어옵니다.</p>`;
    return card("응원 프로필", prof, "c-profile");
  }

  // 찜했던 경기(X4): 이 대회에서 ★ 한 경기의 결과와 남긴 것
  function watchedCard(us) {
    const ev = evNo(), all = watchedOf(ev);
    if (!all.length) return "";
    const ws = watchedSummary(ev);
    const rows = all.map(([k, x]) => [k, x, resultOf(k, x)]).sort((a, b) => (b[2] ? 1 : 0) - (a[2] ? 1 : 0) || String(b[1].t).localeCompare(String(a[1].t))).slice(0, 10)
      .map(([k, x, w]) => {
        const mine = x.side === us;
        const tag = !w ? "기다림" : !mine ? "결과" : w === us ? (x.p !== null && x.p < 0.15 ? "깜짝" : "승") : "아쉬움";
        return `<li class="mo"><span class="mo-tag ${TAGCLS[tag] || "t-plain"}">${esc(tag)}</span><b class="mo-n">${esc(x.n || k)}</b>`
          + `<span class="mo-r">${w ? esc(w) + " 승" : ""}${w && x.p !== null && mine ? `(사전 ${esc(F.pct(w === us ? x.p : 1 - x.p))})` : ""}</span></li>`;
      }).join("");
    return card(`찜했던 경기 <small>${F.num(all.length)}개</small>`, (ws.text ? `<p class="lead">${esc(ws.text)}</p>` : "")
      + `<ol class="moments">${rows}</ol><p class="note">찜한 경기는 이 기기에만 남고 어디에도 보내지 않습니다.</p>`, "c-watched-card");
  }

  function renderMine(us) {
    if (!us) return card("어느 지역을 보시겠어요?", chooserInner(), "c-wide");
    let html;
    if (S.profEdit) {
      // 고치기: 온보딩 ①② 다시. 지역을 고르면(또는 그대로 두면) 종목 고르기 카드가 이어진다
      html = card("어느 지역을 응원하세요?", chooserInner()
        + `<div class="btn-row"><button class="act-btn" data-prof-keep="1">지역은 그대로(${esc(us)})</button></div>`, "c-wide c-profedit");
    } else html = S.onboard ? favCard() : profileCard(us);
    // 남의 카드(받은 응원 카드의 지역)를 보는 중이면 "내가 고른 경기" 는 내 기기 기록이라 내지 않는다(W7 검토 고칠 것 ③)
    html += journeyCard(us) + todayLineCard(us) + (othersCard() ? "" : myPicksCard() + watchedCard(us)) + pastDaysCard(us) + recapCard(us);
    // 돌아오기(§6-6 7): 설치돼 있으면 "홈 화면에 추가" 를 숨긴다(returnCard). 다시 보기·남의 카드, 결산이 "제n회 결산" 이 된 뒤(W4 검토 7)에는 없다
    if (!S.snapshotPath && !othersCard() && !recapFinal()) html += returnCard("mine");
    return html;
  }

  // ── 전망 성적표 (다시 보기의 마지막 시점, docs/DASHBOARD.md §10-2) ─────────
  function errPct(x) {
    // 득점 오차율. 확률이 아니지만 표기 규칙(정수, 1 미만은 "1% 미만")을 같이 지킨다
    if (x === null || x === undefined) return "–";
    const v = Math.round(x);
    return v < 1 ? "1% 미만" : v + "%";
  }

  function scorecardCard() {
    const sc = S.scorecard;
    if (!sc || !isFinalPoint()) return "";
    const lbl = k => { const p = points().find(x => x.key === k); return p ? p.label : k; };
    let h = `<p class="note">대회 전부터 끝까지, 각 시점에 공개한 전망을 실제 최종 결과와 맞춰 본 것입니다`
      + (sc.official === false ? "(실제 결과는 공식 확정 전 집계)" : "") + `.</p>`;
    // 시점 이름 "D+0(10/17)" 은 괄호에서 두 줄로 나눠 낱말 중간에서 꺾이지 않게 한다
    const ptName = t => { const m = /^(.*?)\((.*)\)$/.exec(t || ""); return m ? `${esc(m[1])} <small>${esc(m[2])}</small>` : esc(t); };
    h += `<div class="tbl-wrap"><table class="tbl tbl-score"><colgroup><col class="s1"><col class="s2"><col class="s3"><col class="s4"><col class="s5"></colgroup>`
      + `<thead><tr><th>시점</th><th class="r">오차</th><th class="r">순위</th><th class="r">범위 안</th><th class="r">1위 확률</th></tr></thead><tbody>`
      + sc.points.map(p => `<tr><td>${ptName(p.label || p.key)}<br><small>확정 ${esc(F.num(p.completed_events))}</small></td>`
        + `<td class="r">${esc(errPct(p.mae_pct))}</td>`
        + `<td class="r">${esc(p.rank_exact)}/${esc(p.n_sidos)}<br><small>${esc(p.rank_within1)}</small></td>`
        + `<td class="r">${esc(p.in_range80)}/${esc(p.n_sidos)}</td><td class="r">${esc(F.pct(p.p_actual_winner))}</td></tr>`).join("")
      + `</tbody></table></div><ul class="sc-key"><li><b>오차</b>: 시도 평균 득점 오차</li>`
      + `<li><b>순위</b>: 전망 순위와 실제 순위가 같은 시도 수, 아래는 한 계단 이내</li>`
      + `<li><b>범위 안</b>: 실제 득점이 80% 범위 안에 든 시도 수</li><li><b>1위 확률</b>: 실제 1위 시도에 준 확률</li></ul>`;
    const m = sc.matches || {};
    if (m.n) {
      const src = { ledger: "경기마다 결과 직전의 마지막 전망 기준",
        replay: "날짜별로 다시 계산한 전망에서, 그 시점에 대진이 정해져 있던 경기 전부의 결과 직전 전망 기준",
        snapshots: "시점 스냅샷에 실린 경기 기준" }[m.source] || "";
      h += `<h4 class="sc-h">경기 승패</h4><p class="lead">끝난 ${esc(F.num(m.n))}경기에서 전망이 높게 본 쪽이 이긴 비율 ${esc(F.pct(m.hit))}</p>`
        + (m.baseline_hit !== null && m.baseline_hit !== undefined
          ? `<p class="note">비교: ${esc(m.baseline)}을 고르면 ${esc(F.pct(m.baseline_hit))}, 동전 던지기는 50%.</p>` : "")
        + `<div class="tbl-wrap"><table class="tbl tbl-cal"><thead><tr><th>구간(%)</th><th class="r">경기</th><th class="r">전망</th><th class="r">실제</th><th aria-hidden="true"></th></tr></thead><tbody>`
        + (m.bins || []).filter(b => b.n).map(b => `<tr><td>${Math.round(b.lo * 100)}~${Math.round(b.hi * 100)}</td>`
          + `<td class="r">${esc(F.num(b.n))}</td><td class="r">${esc(F.pct(b.mean_p))}</td><td class="r">${esc(F.pct(b.win_rate))}</td>`
          + `<td aria-hidden="true"><span class="cal"><i class="p" style="width:${(b.mean_p * 100).toFixed(1)}%"></i>`
          + `<i class="w" style="width:${(b.win_rate * 100).toFixed(1)}%"></i></span></td></tr>`).join("")
        + `</tbody></table></div><p class="note">${esc(src)}. 구간은 전망 확률 구간, 전망은 그 구간 경기의 전망 평균, 실제는 실제로 이긴 비율입니다. `
        + `전망 확률이 실제로 이긴 비율과 가까울수록 잘 맞춘 것입니다. `
        + `막대는 위가 전망 평균, 아래가 실제로 이긴 비율입니다.</p>`;
    }
    const ms = sc.misses || [];
    if (ms.length) {
      h += `<h4 class="sc-h">빗나간 것</h4><ul class="miss">` + ms.map(x => x.kind === "points"
        ? `<li><b>${esc(x.sido)}</b> · ${esc(lbl(x.point))} 예상 ${esc(F.num(x.expected))}점(80% 범위 ${esc(F.num(x.p10))}~${esc(F.num(x.p90))}) → 실제 ${esc(F.num(x.actual))}점`
          + `<br><small>${x.in_range ? "범위 안이지만 차이가 컸던 시도" : "80% 범위를 벗어났습니다"}</small></li>`
        : `<li><b>${esc(x.sido)}</b> · ${esc(F.hw(x.name))} ${esc(x.medal)}<br><small>${esc(lbl(x.point))} 전망에서 메달 확률 ${esc(F.wasPct(x.prior_p))} 결과</small></li>`).join("") + `</ul>`;
    }
    h += `<p class="note">시도·시점은 전부, 경기는 위 기준에 드는 전부를 셌습니다. 고르지 않았습니다.`
      + (m.excluded ? ` 승패를 가릴 수 없는 ${esc(F.num(m.excluded))}경기는 뺐습니다.` : "") + `</p>`;
    return card("전망 성적표", h, "c-wide c-score");
  }

  // ── 레이스 탭 아래 · 전국(옛 탭 4) ────────────────────────────────────────
  // 성적표는 따로 받으므로 아직 없으면 자리만 둔다(loadExtras 가 끼운다). 지역 해설이 위에 있으면 전국 해설은 뺀다
  function nationCards(us) {
    const s = S.snap, now = refNow();
    const rows = Object.entries(s.sidos).sort((a, b) => b[1].points_mean - a[1].points_mean);
    const sec = `<h2 class="sec-h c-wide">전국 <small>17개 시도</small></h2>`;
    let html = sec + (S.scorecard ? scorecardCard() : isFinalPoint() ? `<div id="score-slot" hidden></div>` : "")
      + (us && commentaryCard(us) ? "" : commentaryCard(null));
    const rv = showReveal() ? S.outcomes.sidos : null;
    html += card("종합순위 전망", `<table class="tbl tbl-rank${rv ? " tbl-reveal" : ""}"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4">${rv ? '<col class="c5">' : ""}</colgroup><thead><tr><th>시도</th><th class="r">예상 득점</th><th class="r">예상 순위</th><th class="r">목표 확률</th>${rv ? '<th class="r reveal-cell">실제</th>' : ""}</tr></thead><tbody>`
      + rows.map(([k, v], i) => {
        const r = argmax(v.rank_probs || [0]);
        const a = rv && rv[k];
        return `<tr${k === us ? ' class="me"' : ""}><td><span class="rk">${i + 1}</span> <b>${esc(k)}</b></td>`
          + `<td class="r">${esc(F.num(v.points_mean))}<br><small class="nw">${esc(F.num(v.points_p10))}~${esc(F.num(v.points_p90))}</small></td>`
          + `<td class="r">${r + 1}위</td><td class="r">${esc(F.pct(v.target.prob))}<br><small>${esc(v.target.label)}</small></td>`
          + (rv ? `<td class="r reveal-cell">${a ? esc(a.rank) + "위<br><small>" + (a.rank === r + 1 ? "전망과 같음" : "전망 " + (r + 1) + "위") + "</small>" : "–"}</td>` : "")
          + `</tr>`;
      }).join("") + `</tbody></table>` + (rv && S.outcomes.official === false ? `<p class="note">실제 순위는 공식 확정 전 집계입니다.</p>` : ""), "c-wide");
    html += cheerRaceCard(us);

    const mrows = Object.entries(s.sidos).sort((a, b) => argmax(a[1].medal_rank_probs || [0]) - argmax(b[1].medal_rank_probs || [0])
      || b[1].medals_mean[0] - a[1].medals_mean[0]);
    html += card("메달 전망", `<p class="note">메달 수로 종합순위를 정하지 않습니다. 종합순위는 득점으로 정합니다.</p>`
      + `<table class="tbl"><thead><tr><th>시도</th><th class="r">금</th><th class="r">은</th><th class="r">동</th><th class="r">메달 순위</th></tr></thead><tbody>`
      + mrows.map(([k, v]) => `<tr${k === us ? ' class="me"' : ""}><td><b>${esc(k)}</b></td>`
        + v.medals_mean.map(x => `<td class="r">${esc(F.num(x))}</td>`).join("")
        + `<td class="r">${argmax(v.medal_rank_probs || [0]) + 1}위</td></tr>`).join("") + `</tbody></table>`);

    const fs = filters(s.matches || [], now);
    const d1 = fs.find(f => f[0] === "d1");
    let todays = (s.matches || []).filter(m => { const sc = sched(m); return d1 && sc && sc.day === d1[2]; });
    if (!todays.length) todays = (s.matches || []).slice();
    todays.sort((a, b) => b.importance - a.importance);
    html += card(`${d1 ? esc(d1[1]) + "의" : "주요"} 경기 <small>(모든 시도 목표에 미치는 영향 순)</small>`,
      (todays.length ? `<div class="mrows">${todays.slice(0, 5).map(m => matchRow(m, null, { noImpact: true })).join("")}</div>` : empty("남은 경기가 없습니다.")));

    if (s.leader_now && s.magic_number && Object.keys(s.magic_number).length) {
      const mn = Object.entries(s.magic_number).sort((a, b) => a[1] - b[1]);
      html += card(`매직넘버 <small>(현재 선두 ${esc(s.leader_now)})</small>`,
        `<p class="note">각 시도가 남은 세부종목을 모두 1위로 끝낼 때의 최대 득점에서, ${esc(F.josa(s.leader_now, "이", "가"))} `
        + `더 얻지 못할 때의 최소 득점을 뺀 값입니다. 0 이 되면 그 시도에 대해 순위가 확정됩니다. `
        + `엔진의 득점 추정 기준이며 공식 집계와 조금 다를 수 있습니다.</p>`
        + `<table class="tbl"><tbody>${mn.map(([k, x]) => `<tr${k === us ? ' class="me"' : ""}><td>${esc(k)}</td>`
          + `<td class="r">${x <= 0 ? "확정" : esc(F.num(x)) + "점"}</td></tr>`).join("")}</tbody></table>`);
    }

    const as = Object.entries(s.assumptions || {});
    html += card("가정과 한계", `<ul class="assume"><li>과거 대회 성적과 득점 규칙으로 남은 경기를 수천 번 가상 진행한 결과입니다.</li>`
      + as.map(([k, n]) => `<li>${esc(F.assumption(k, n))}</li>`).join("")
      + `<li>확정 세부종목 ${esc(F.num(s.completed_events))}개, 남은 세부종목 ${esc(F.num(s.remaining_events))}개, 영향도를 낸 경기 ${esc(F.num(s.pending_matches))}개.</li></ul>`);
    return html;
  }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function render() {
    stopPlay();
    renderHeader();
    renderBand();
    renderTabs();
    const main = document.getElementById("main");
    main.setAttribute("aria-busy", "false");
    document.body.classList.toggle("entry-on", !!S.entry);
    if (S.entry) { main.innerHTML = entryView(); return; }
    if (!S.snap) {
      main.innerHTML = card("", empty(S.loadError || S.schemaError ? "표시할 전망이 아직 없습니다." : "전망을 불러오는 중입니다…"));
      return;
    }
    // 메모 입력 중의 다시 그리기(5분 자동 새로고침 등)는 값·초점·커서를 되살린다(W7 검토 고칠 것 ②)
    const ae = document.activeElement;
    const memoKeep = ae && ae.id === "memo" ? { v: ae.value, s: ae.selectionStart, e: ae.selectionEnd, d: ae.selectionDirection } : null;
    const us = S.sido;
    let html;
    if (S.tab === "race") html = renderRace(us);
    else if (S.tab === "watch") html = renderWatch(us);
    else if (S.tab === "mine") html = renderMine(us);
    else html = renderToday(us);
    main.innerHTML = cardLine() + `<div class="grid grid-${S.tab}">${html}</div>`;
    if (memoKeep) {
      const m = document.getElementById("memo");
      if (m) {
        m.value = memoKeep.v;
        m.focus({ preventScroll: true });
        try { m.setSelectionRange(memoKeep.s, memoKeep.e, memoKeep.d || "none"); } catch (e) { /* 고르기를 못 하는 입력 */ }
      }
    }
    if (S.tab === "race") animateHome();
  }

  // 응원 카드로 들어온 사람의 첫 줄(§6-7). 보낸 사람 이름은 없다
  function cardLine() {
    // 받은 도전장(X5): 맨 위 한 줄. [기본으로] 는 라이벌을 자동으로 되돌린다
    if (S.dare && !S.dareClosed && !S.snapshotPath && S.sido && S.sido !== S.dare) {
      return `<div class="card-line dare-line" role="note"><p>${esc(S.dare)}에서 온 도전장 · 라이벌이 ${esc(withRo(S.dare))} 맞춰졌습니다 `
        + `<button class="linkish" data-dareline="reset">기본으로</button></p><button class="card-x" data-dareline="close" aria-label="닫기">×</button></div>`;
    }
    if (!S.fromCard || S.cardClosed || S.snapshotPath) return "";
    const close = `<button class="card-x" data-cardline="close" aria-label="닫기">×</button>`;
    if (!S.ownSido) {
      return `<div class="card-line" role="note"><p>응원 카드로 들어오셨군요. <button class="linkish" data-cardline="pick">나도 응원 지역 고르기</button></p>${close}</div>`
        + (S.cardPick ? card("어느 지역을 응원하세요?", chooserInner(), "c-wide c-cardpick") : "");
    }
    if (S.sido && S.sido !== S.ownSido) {
      return `<div class="card-line" role="note"><p>${esc(S.sido)} 응원 카드 · <button class="linkish" data-cardline="own">내 지역(${esc(S.ownSido)})으로 보기</button></p>${close}</div>`;
    }
    return "";
  }

  function setSido(s, fromUser) {
    if (s && !SIDOS.includes(s)) s = null;
    if (s && fromUser && !S.favSet && !S.onboard) {
      S.favAsk = true; S.favDraft = null;     // 종목은 오늘 탭 맨 위 한 줄 띠로 묻는다(ENGAGEMENT §9 R1, 설계 13 §6-1)
      if (S.tab !== "today") { S.tab = "today"; history.replaceState(null, "", location.pathname + location.search + "#today"); }
    }
    S.sido = s;
    if (s) store("chejeon.sido", s);
    if (s && fromUser) { S.ownSido = s; S.cardPick = false; }
    // 받은 도전장의 라이벌(rival=)은 받은 화면에만. 내 지역을 직접 고르면 지운다(X5)
    if (s && fromUser && S.dare) { S.dare = null; S.rivalParam = null; setParam("rival", null); }
    setParam("sido", s);
    S.shown = PAGE;
    render();
    if (s && fromUser) touchJournal();     // 지역을 고른 날부터 여정이 시작된다(journal.since)
    loadShout();
  }

  function tabOf(h) {
    h = TAB_ALIAS[h] || h;
    return TABS.find(x => x[0] === h) ? h : "today";
  }

  function setTab(t) {
    t = tabOf(t);
    // 다른 탭에서 오늘 탭으로 들어올 때는 지금 시각으로 상태를 다시 정한다(보고 있는 동안에는 고정)
    if (t === "today" && S.tab !== "today" && S.snap) S.day = dayState().key;
    S.tab = t;
    if (location.hash !== "#" + t) history.replaceState(null, "", location.pathname + location.search + "#" + t);
    S.shown = PAGE;
    render();
    window.scrollTo(0, 0);
  }

  function bind() {
    document.getElementById("sido-select").addEventListener("change", e => setSido(e.target.value || null, true));
    document.addEventListener("click", e => {
      // 진입 화면(Y3): 상표를 누르면 확인 없이 오늘 탭
      if (S.entry && e.target.closest(".brand")) { endEntry(); return; }
      const b = e.target.closest("button");
      if (!b) return;
      if (S.entry) {
        const d = b.dataset;
        if (d.tile) { S.entryPick = d.tile; if (S.entryRival === d.tile) S.entryRival = null; render(); return; }
        if (d.tile2) { S.entryRival = d.tile2 === S.entryPick ? null : d.tile2; render(); return; }
        if (d.entryList) { S.entryList = !S.entryList; render(); return; }
        if (d.entryMore) { S.entryMore = !S.entryMore; render(); return; }
        if (d.entryAll) { S.entryAll = !S.entryAll; render(); return; }
        if (d.entryGo) { entryGo(); return; }
        if (d.goal) { entryGoal(d.goal); return; }
        if (d.efav) {
          const a = S.favDraft || S.fav.slice(), i = a.indexOf(d.efav);
          if (i >= 0) a.splice(i, 1); else if (a.length < FAV_MAX) a.push(d.efav);
          S.favDraft = a; render(); return;
        }
        if (d.entryFav) { if (d.entryFav === "save" && S.favDraft) setFav(S.favDraft); S.favDraft = null; entryNext(); return; }
        if (d.entryNext) { S.favDraft = null; entryNext(); return; }
        if (d.entryBack) { S.favDraft = null; S.entry = Math.max(1, S.entry - 1); if (S.entry === 1) S.entryPick = S.sido; render(); return; }
        if (d.entryShare) { shareLink(entryShareText(S.sido), entryShareUrl(S.sido)); return; }
        if (d.entryDone) { endEntry(); return; }
      }
      // 한 줄 카드 요약 줄 안의 ☆: 줄을 펼치지 않고 찜만 바꾼다
      if (b.dataset.watch) { e.preventDefault(); toggleWatch(b.dataset.watch); return; }
      if (b.dataset.quiz !== undefined) { answerQuiz(b.dataset.quiz); return; }
      if (b.dataset.shout) { sendShout(); return; }
      if (b.dataset.quizGo) { quizGo(b.dataset.quizGo); return; }
      // 종목 홈 칩(Y2): 한 장 고르기 · 모두 펼치기/접기
      if (b.dataset.chhome) { S.chHome = { open: b.dataset.chhome, all: false }; render(); return; }
      if (b.dataset.chall) { const a = S.chHome || {}; S.chHome = { open: a.open, all: !a.all }; render(); return; }
      if (b.dataset.play) { if (S.play) { stopPlay(); render(); } else playTrack(); }
      else if (b.dataset.tab) setTab(b.dataset.tab);
      else if (b.dataset.sido) {
        // 나의 체전 "고치기": 지역 다음에 종목 고르기를 그 자리에서 잇는다
        if (S.profEdit) { S.profEdit = false; S.onboard = true; S.favDraft = null; }
        setSido(b.dataset.sido, true);
      }
      else if (b.dataset.profEdit) { S.profEdit = true; S.onboard = false; render(); }
      else if (b.dataset.profKeep) { S.profEdit = false; S.onboard = true; S.favDraft = null; render(); }
      else if (b.id === "fav-btn") { S.onboard = !S.onboard; S.favDraft = null; if (S.tab !== "today" && S.tab !== "mine") setTab("today"); else render(); }
      else if (b.dataset.fav) {
        const d = S.favDraft || S.fav.slice(), i = d.indexOf(b.dataset.fav);
        if (i >= 0) d.splice(i, 1); else if (d.length < FAV_MAX) d.push(b.dataset.fav);
        S.favDraft = d;
        render();
      }
      else if (b.dataset.favDone) {
        if (b.dataset.favDone === "save") setFav(S.favDraft || S.fav);
        else if (b.dataset.favDone === "skip") setFav([]);
        // 처음 지역을 고른 사람: 종목 다음은 ③ "경기를 놓치지 않으려면"(§1-1)
        if (S.favAsk && !S.journal.return_asked && !S.snapshotPath && !othersCard()) S.returnStep = true;
        S.onboard = false; S.favAsk = false; S.favDraft = null;
        if (S.filter === "fav" && !S.fav.length) S.filter = null;
        render();
      }
      else if (b.dataset.favOpen) { S.onboard = true; S.favDraft = null; render(); }
      else if (b.dataset.icsOne) saveIcsOne(b.dataset.icsOne);
      else if (b.dataset.wi) { const k = b.dataset.wi, v = b.dataset.wv; if (S.whatIf[k] === v) delete S.whatIf[k]; else S.whatIf[k] = v; render(); }
      else if (b.dataset.mmore) { S.momMore = !S.momMore; render(); }
      else if (b.dataset.moment !== undefined) { S.momentIdx = +b.dataset.moment || 0; shareImage("moment"); }
      else if (b.dataset.daymore) { S.dayMore = !S.dayMore; render(); }
      else if (b.dataset.daynext) { S.dayNext = !S.dayNext; render(); }
      else if (b.dataset.gotoLive) { S.filter = "live"; setTab("watch"); }
      else if (b.dataset.gotoFav) { S.filter = "fav"; setTab("watch"); }
      else if (b.dataset.ics) {
        saveIcs(b.dataset.ics);
        if (b.dataset.ics === "return") { markReturn(); S.returnStep = false; render(); }
      }
      else if (b.dataset.install) doInstall();
      else if (b.dataset.sharelink) shareLink();
      else if (b.dataset.dare) sendDare();
      else if (b.dataset.peopleOpen) { S.onboard = true; S.favDraft = null; render(); }
      else if (b.dataset.whoAdd) { if (!S.who.includes(b.dataset.whoAdd)) S.who = S.who.concat(b.dataset.whoAdd).slice(-5); S.peopleQ = ""; saveWho(); render(); }
      else if (b.dataset.whoDel) { S.who = S.who.filter(x => x !== b.dataset.whoDel); saveWho(); render(); }
      else if (b.dataset.schoolAdd) { S.school = b.dataset.schoolAdd; S.peopleQ = ""; saveWho(); render(); }
      else if (b.dataset.schoolDel) { S.school = null; saveWho(); render(); }
      else if (b.dataset.push === "open") { S.pushSheet = !S.pushSheet; S.pushMsg = null; S.pushDraft = null; render(); }
      else if (b.dataset.push === "save") pushSave();
      else if (b.dataset.push === "off") pushOff();
      else if (b.dataset.pushkind) {
        const d = (S.pushDraft || ((pushState() || {}).kinds) || PUSH_KINDS.map(k => k[0])).slice(), k = b.dataset.pushkind, i = d.indexOf(k);
        if (i >= 0) d.splice(i, 1); else d.push(k);
        S.pushDraft = PUSH_KINDS.map(x => x[0]).filter(x => d.includes(x)); render();
      }
      else if (b.dataset.dareline) {
        S.dareClosed = true;
        if (b.dataset.dareline === "reset" && S.sido) setRival(S.sido, null); else render();
      }
      else if (b.dataset.cardline) {
        const k = b.dataset.cardline;
        if (k === "pick") { S.cardPick = !S.cardPick; render(); }
        else if (k === "own") { S.cardClosed = true; setSido(S.ownSido, false); }
        else { S.cardClosed = true; render(); }
      }
      else if (b.dataset.return) { S.returnStep = false; S.returnLater = true; render(); }
      else if (b.dataset.share) shareImage(b.dataset.share);
      else if (b.dataset.cheer) sendCheer();
      else if (b.dataset.qk) doPick(b.dataset.qk, b.dataset.qs);
      else if (b.dataset.qmore) { S.qMore += Q_PER; render(); }
      else if (b.dataset.filter) { S.filter = b.dataset.filter; S.shown = PAGE; render(); }
      else if (b.dataset.more) { S.shown += PAGE; render(); }
      else if (b.dataset.goto) setTab(b.dataset.goto);
      else if (b.dataset.reveal) {
        S.reveal = !S.reveal;
        setParam("reveal", S.reveal ? "1" : null);
        render();
        loadExtras();
      }
    });
    document.addEventListener("change", e => {
      if (e.target.id === "rival-select") setRival(S.sido, e.target.value || null);
      else if (e.target.id === "target-select") {
        const v = S.snap.sidos[S.sido];
        S.targetKey = e.target.value === v.target.key ? null : e.target.value;
        setParam("target", S.targetKey);
        render();
      }
    });
    // 메모 한 줄은 쓰는 대로 저장한다(다시 그리지 않는다)
    document.addEventListener("input", e => { if (e.target.id === "memo") saveMemo(e.target.value); });
    // 선수·학교 찾기(X8): 입력이 끝나면(변경) 결과를 다시 그린다
    document.addEventListener("change", e => {
      if (e.target.id !== "people-q") return;
      S.peopleQ = e.target.value.slice(0, 20);
      peopleSearchLoad(S.peopleQ.trim()).then(render);
    });
    window.addEventListener("hashchange", () => setTab(location.hash.slice(1)));
    // 한 줄 카드 펼침은 다시 그려도(5분 새로 고침) 그대로 둔다
    document.addEventListener("toggle", e => {
      const d = e.target;
      if (!d.classList || !d.classList.contains("mrow")) return;
      const k = d.dataset.k;
      if (d.dataset.defaultOpen) { if (d.open) S.rowClosed.delete(k); else S.rowClosed.add(k); }
      else if (d.open) S.rowOpen.add(k); else S.rowOpen.delete(k);
    }, true);
  }

  function init() {
    if (S.still) document.documentElement.classList.add("still");
    // 응원 집계가 켜져 있을 때만 도움말·하단의 응원 문구를 보인다(§6-5)
    if (CHEER_API && !S.snapshotPath) document.querySelectorAll("[data-cheer-help]").forEach(e => { e.hidden = false; });
    // 알림(X7): 켜졌을 때만 도움말 "알림" 절, 꺼졌을 때만 "서버 알림은 없습니다"
    const pushHelp = !!PUSH_API && !!VAPID_PUBLIC && !S.snapshotPath;
    document.querySelectorAll("[data-push-help]").forEach(e => { e.hidden = !pushHelp; });
    document.querySelectorAll("[data-push-off]").forEach(e => { e.hidden = pushHelp; });
    S.prev = session(LANE_KEY);
    [S.fav, S.favSet] = readFav();
    S.picks = readPicks();
    S.watch = readWatch();
    ({ who: S.who, school: S.school } = readWho());
    if (q.get("who") !== null || q.get("school") !== null) store(WHO_KEY, JSON.stringify({ who: S.who, school: S.school }));
    if (S.who.length || S.school) { setParam("who", S.who.length ? S.who.join(",") : null); setParam("school", S.school || null); }
    S.journal = readJournal();
    S.seen = S.snapshotPath ? null : S.journal.last_seen;
    // 설치 신호(Android·Chrome). manifest·서비스 워커는 W5. 화면을 떠날 때 last_seen 을 남긴다
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; });
    document.addEventListener("visibilitychange", () => { if (document.hidden) touchJournal(); });
    window.addEventListener("pagehide", touchJournal);
    const s = q.get("sido"), own = store("chejeon.sido");
    S.ownSido = SIDOS.includes(own) ? own : null;
    S.sido = SIDOS.includes(s) ? s : S.ownSido;
    // 진입 화면(Y3): 지역이 없는 첫 방문만. ?sido=·?snapshot=·from=card·기기에 고른 지역이 있거나 끝낸 기록(chejeon.entry.done)이 있으면 건너뛰고, ?entry=1 은 언제나 연다(읽고 지운다)
    const forceEntry = q.get("entry") === "1";
    const entryDone = (() => { try { const v = JSON.parse(store(ENTRY_KEY) || "null"); return !!(v && v.done); } catch (e) { return false; } })();
    if (q.get("entry") !== null) setParam("entry", null);
    if (forceEntry || (s === null && !S.snapshotPath && q.get("snapshot") === null && !S.fromCard && !S.ownSido && !entryDone)) { S.entry = 1; S.entryPick = S.sido; }
    loadHistory();
    if (S.fromCard) setParam("from", null);         // 다시 공유해도 from 이 따라가지 않게
    // 도전장(X5): 보낸 지역. 다시 공유해도 따라가지 않게 주소에서 지운다(라이벌 rival= 은 남긴다)
    const dare = q.get("dare");
    if (dare !== null) { if (SIDOS.includes(dare)) S.dare = dare; setParam("dare", null); }
    // 홈 화면에 추가(§6-8): 캐시 없는 서비스 워커. http(s) 에서만
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
    S.tab = tabOf(location.hash.slice(1));
    // 옛 해시(#home·#nation)는 새 이름으로 주소를 고친다
    if (location.hash && location.hash.slice(1) !== S.tab) history.replaceState(null, "", location.pathname + location.search + "#" + S.tab);
    bind();
    render();
    load().catch(e => { S.loadError = e; render(); });
    if (!S.snapshotPath) {
      setInterval(() => load().catch(e => { S.loadError = e; render(); }), REFRESH_MS);
      setInterval(() => { renderHeader(); renderBand(); }, 60 * 1000);   // 지연 띠는 받기 없이도 시간이 흐르면 바뀐다
    }
  }

  init();
})();
