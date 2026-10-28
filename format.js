/* 표기 규칙 (docs/DASHBOARD.md §4). 화면의 모든 숫자·문장은 여기 함수로만 만든다.
   브라우저에서는 window.Fmt, node 에서는 require 로 쓴다 (tests/site_check.js 가 규칙을 검사). */
(function (root) {
  "use strict";

  const TZ = "Asia/Seoul";

  // 확률: 정수 %. 1% 미만, 99% 이상. 0% 와 100% 는 쓰지 않는다.
  function pct(p) {
    if (p === null || p === undefined || Number.isNaN(p)) return "–";
    if (p < 0.01) return "1% 미만";
    if (p > 0.99) return "99% 이상";
    return Math.round(p * 100) + "%";
  }

  // 확률 변화: "+13%p", "−4%p". 1%p 가 안 되면 "1%p 미만".
  function pp(d) {
    if (d === null || d === undefined || Number.isNaN(d)) return "–";
    const v = Math.round(Math.abs(d) * 100);
    if (v < 1) return "1%p 미만";
    return (d > 0 ? "+" : "−") + v + "%p";
  }

  function num(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "–";
    return Math.round(x).toLocaleString("ko-KR");
  }

  function signed(x) {
    const v = Math.round(x);
    if (v === 0) return "0";
    return (v > 0 ? "+" : "−") + Math.abs(v).toLocaleString("ko-KR");
  }

  // 경기·종목 이름의 전각 영숫자·기호를 반각으로("Ｋ４－５００Ｍ" → "K4-500M", "예선경기６" → "예선경기6").
  // 해설 엔진 commentary.hw 와 같은 NFKC. 자료는 바꾸지 않고 화면에 낼 때만 쓴다(docs/DASHBOARD.md §11-14 M4)
  function hw(s) {
    if (s === null || s === undefined) return "";
    return String(s).normalize("NFKC");
  }

  // 받침 유무로 조사를 고른다: josa("경기", "이", "가") → "경기가"
  function josa(word, withFinal, without) {
    const s = String(word || "");
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return s + ((c - 0xac00) % 28 ? withFinal : without);
    return s + withFinal + "(" + without + ")";
  }

  function parseTime(iso) {
    if (!iso) return null;
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? null : t;
  }

  const _parts = {};
  function kstParts(t) {
    const f = _parts.f || (_parts.f = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      weekday: "short", hourCycle: "h23",
    }));
    const o = {};
    for (const p of f.formatToParts(t)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, hh: o.hour, mm: o.minute, wd: o.weekday };
  }

  const WD = { Sun: "일", Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };

  function hm(t) { const p = kstParts(t); return p.hh + ":" + p.mm; }
  function md(t) { const p = kstParts(t); return p.m + "/" + p.d + "(" + WD[p.wd] + ")"; }
  function mdhm(t) { return md(t) + " " + hm(t); }
  function dayKey(t) { const p = kstParts(t); return p.y * 10000 + p.m * 100 + p.d; }

  // 경기 일정 문자열 (한국 시간) → {start, end, day}
  //   "2026/10/18 13:30 ~ 15:30" (실시간 사이트), "10월20일" (역대 대회, 연도 없음 → year 인자)
  function parseSchedule(s, year) {
    let m = /(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?(?:\s*~\s*(\d{1,2}):(\d{2}))?/.exec(s || "");
    if (!m) {
      const k = /(\d{1,2})월\s*(\d{1,2})일(?:\s+(\d{1,2}):(\d{2}))?/.exec(s || "");
      if (!k || !year) return null;
      m = [k[0], String(year), k[1], k[2], k[3], k[4]];
    }
    const mk = (h, mi) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +h - 9, +mi));
    const start = mk(m[4] || 0, m[5] || 0);
    let end = m[6] ? mk(m[6], m[7]) : new Date(start.getTime() + 2 * 3600e3);
    if (end < start) end = new Date(start.getTime() + 2 * 3600e3);
    return { start, end, day: +m[1] * 10000 + +m[2] * 100 + +m[3], timed: !!m[4] };
  }

  function dayLabel(day) {
    const t = new Date(Date.UTC(Math.floor(day / 10000), Math.floor(day / 100) % 100 - 1, day % 100, 3));
    return md(t);
  }

  // 자료 나이 → 상태 (§3)
  function freshness(dataAsOf, now) {
    const t = parseTime(dataAsOf);
    if (!t) return "unknown";
    const age = (now - t) / 60000;
    if (age <= 20) return "ok";
    if (age <= 120) return "late";
    return "stopped";
  }

  // 지역 "경기" 는 문장 안에서 match 로 읽히므로 "경기도" 로 쓴다(§12-10 R9). 표·칸의 짧은 이름은 그대로
  function sidoLabel(x) { return x === "경기" ? "경기도" : x; }

  // 화면에 보이는 정수(%). "1% 미만" 은 1, "99% 이상" 은 99 (app.js bigParts 와 같다)
  function shownPct(p) {
    const m = /^(\d+)%/.exec(pct(p));
    return m ? +m[1] : Math.round(p * 100);
  }

  // 영향 문장에 넣을 숫자(DASHBOARD §13-2). 엔진의 delta(이기면 − 지면)가 아니라 "지금 대비" 화면 정수 차.
  // v = {if_win, if_lose, delta}(side 승리 기준), prob = 지금 목표 확률(기본 목표).
  // 반환 delta 는 문장 함수가 받는 side 기준 부호 그대로: 우리 경기·기록경기는 "side 가 이기면(메달이면)" 의 변화,
  // 우리가 상대면 "우리가 이기면" 의 변화를 side 기준으로 뒤집은 값, 남의 경기는 유리한 쪽이 이길 때의 변화
  // (그것이 0 이면 불리한 쪽이 이길 때 잃는 폭). lose = side 가 질 때의 변화(우리 경기의 "이기면 그대로, 지면 −n" 용).
  function impactMove(us, side, other, v, prob, record) {
    if (prob === null || prob === undefined || v.if_win === undefined || v.if_lose === undefined) return { delta: v.delta, lose: null };
    const now = shownPct(prob), w = (shownPct(v.if_win) - now) / 100, l = (shownPct(v.if_lose) - now) / 100;
    if (side === us || record) return { delta: w, lose: l };
    if (other === us) return { delta: -l, lose: -w };
    const a = v.delta >= 0 ? w : -l, b = v.delta >= 0 ? -l : w;
    return { delta: Math.round(a * 100) !== 0 ? a : b, lose: null };
  }

  // 경기 영향 문장. side = 영향을 계산한 쪽(이길 때 기준), other = 상대(없으면 기록경기)
  // 문장은 항상 "우리에게 유리한 결과" 를 말한다. 우리 지역이 뛰는 경기면 "이기면 +n%p".
  // delta 는 impactMove 의 지금 대비 변화(§13). lose 는 우리 경기에서 질 때의 변화(없어도 된다)
  function impactSentence(us, side, other, delta, lose) {
    if (Math.round(Math.abs(delta) * 100) < 1) {
      if (side === us && lose !== undefined && lose !== null && Math.round(lose * 100) <= -1)
        return "이기면 목표 확률은 지금 그대로, 지면 " + pp(lose);
      return "어느 쪽이 이겨도 우리 목표 확률은 거의 같습니다";
    }
    if (side === us) return delta > 0 ? "우리 지역이 이기면 목표 확률 " + pp(delta)
      : "우리 지역이 이겨도 목표 확률이 오르지 않습니다(" + pp(delta) + ")";
    const good = delta > 0 ? side : other;
    if (!good) return josa(sidoLabel(side), "이", "가") + " 지는 쪽이 우리에게 유리(" + pp(-delta) + ")";
    if (good === us) return "우리 지역이 이기면 목표 확률 " + pp(Math.abs(delta));
    return josa(sidoLabel(good), "이", "가") + " 이기는 쪽이 우리에게 유리(" + pp(Math.abs(delta)) + ")";
  }

  // "1% 미만" + 이었던 / "38%" + 였던
  function wasPct(p) {
    const t = pct(p);
    return t + (/[미만이상]$/.test(t) ? "이었던" : "였던");
  }

  // 대화층 꼬리(설계 15 Y1): "12%였어요" / "1% 미만이었어요"
  function wasYo(p) {
    const t = pct(p);
    return t + (/[미만이상]$/.test(t) ? "이었어요" : "였어요");
  }

  function recordSentence(us, side, delta) {
    const who = side === us ? "우리 지역" : sidoLabel(side);
    const r = Math.round(Math.abs(delta) * 100);
    if (r < 1) return josa(who, "이", "가") + " 메달을 따도 우리 목표 확률은 거의 같습니다";
    return josa(who, "이", "가") + " 메달이면 우리 목표 확률 " + pp(delta)
      + (delta > 0 ? " (유리)" : " (불리)");
  }

  // ── 영향 문장 2단: 결론 줄 아래 이유 줄, 카드 이미지는 한 줄 공식 (docs/DASHBOARD.md §12) ──
  // 이유 줄은 엔진이 이미 낸 값(가장 가까운 순위, 목표선, 목표 확률, 남은 점수)만 쓴다. 확률을 다시 계산하지 않는다.
  // engine/commentary.py impact_ctx·impact_why·impact_short 와 글자까지 같다(tests/test_commentary.py)

  function _argmax(a) {
    let k = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
    return k;
  }

  // 스냅샷 → 우리 지역 기본 목표 기준 ctx. rank_probs 가 없는 옛 스냅샷이면 null(이유 줄 없음, §12-2)
  function impactCtx(snap, us) {
    const sidos = (snap && snap.sidos) || {}, v = sidos[us];
    if (!v || !v.target || !v.target.key) return null;
    const key = v.target.key;
    let kind = "rank", k = null;
    if (key === "rank1") k = 1;
    else if (/^top\d+$/.test(key)) k = +key.slice(3);
    else if (/^rank_le_\d+$/.test(key)) k = +key.split("_").pop();
    else if (key === "medal_rank1") { kind = "medal"; k = 1; }
    else if (key === "medal_top3") { kind = "medal"; k = 3; }
    else if (/^points_x/.test(key) || key === "beat_prev_points") kind = "points";
    else return null;
    const field = kind === "medal" ? "medal_rank_probs" : "rank_probs";
    const r = {};
    for (const [s, x] of Object.entries(sidos)) if (x[field] && x[field].length) r[s] = _argmax(x[field]) + 1;
    if (!r[us]) return null;
    let gap = null;
    if (kind === "points") {
      const pv = (v.prev && v.prev.points) || 0;
      const goal = key === "beat_prev_points" ? pv : pv * parseFloat(key.slice(8));
      gap = Math.round(goal - ((snap.points_now || {})[us] || 0));
    }
    return { kind, k, r, prob: v.target.prob, label: v.target.label || "", gap };
  }

  // 상황 판정(§12-3). 우리가 뛰는 경기는 우리 쪽 기준으로 뒤집는다. 우리 경기인데 영향이 1%p 가 안 되면 5 가 아니라 6
  function _impactCase(us, side, other, delta, ctx, record) {
    if (other === us && side !== us) { other = side; side = us; delta = -delta; }
    const r = ctx.r, near = x => !!x && r[x] !== undefined && Math.abs(r[x] - r[us]) <= 2;
    const flat = Math.round(Math.abs(delta) * 100) < 1;
    const o = { side, other, delta, near };
    if (side === us) return Object.assign(o, { n: delta > 0 && !flat ? 1 : 6 });
    if (flat) return Object.assign(o, { n: 5 });
    if (record) return Object.assign(o, { n: 4 });
    o.good = delta > 0 ? side : other;
    o.bad = delta > 0 ? other : side;
    o.n = other && r[o.good] !== undefined && r[o.bad] !== undefined && near(o.good) && near(o.bad) ? 3 : 2;
    return o;
  }

  function _withRo(p) { return p + (/[미만이상]$/.test(p) ? "으로" : "로"); }

  // 우리 쪽 stake 를 이유 줄 숫자로(DASHBOARD §12-8 5). 유효숫자 2자리 정수 half-up, 10 미만·없음은 null.
  // toPrecision 은 145·125 에서 Python 과 갈리므로 정수 산술로 한다(commentary.py stake_text 와 글자 일치)
  function stakeText(stake) {
    if (stake === null || stake === undefined || Number.isNaN(stake)) return null;
    const n = Math.round(stake);
    if (n < 10) return null;
    const k = Math.pow(10, String(n).length - 2);
    return num(Math.floor((n + Math.floor(k / 2)) / k) * k);
  }

  function impactWhy(us, side, other, delta, ctx, record, stake) {
    if (!ctx || !ctx.r || ctx.r[us] === undefined) return "";
    const c = _impactCase(us, side, other, delta, ctx, record);
    const r = ctx.r, ru = r[us], k = ctx.k, pts = ctx.kind === "points";
    const u = ctx.kind === "medal" ? "메달 순위 " : "";
    const where = x => r[x] === ru ? `우리와 ${u}${r[x]}위를 다투는`
      : r[x] === ru - 1 ? `우리 바로 위 ${u}${r[x]}위인`
      : r[x] === ru + 1 ? `우리 바로 아래 ${u}${r[x]}위인`
      : r[x] < ru ? `우리 위 ${u}${r[x]}위인` : `우리 아래 ${u}${r[x]}위인`;
    const nm = sidoLabel, eun = x => josa(x, "은", "는"), ga = x => josa(x, "이", "가");
    const label = eun(ctx.label);
    // R5: 엔진이 확인하지 않은 원인(대진)을 단정하지 않는다
    const tangled = "우리 점수와 직접 관계는 없는 경기입니다. 남은 경기 흐름이 얽혀 전망에 생긴 차이입니다.";
    const still = pts ? `이 경기 점수로는 ${ctx.label} 전망이 움직이지 않습니다.` : `이 경기 점수로는 목표선 ${k}위가 움직이지 않습니다.`;
    switch (c.n) {
      case 1: {
        // §12-8: 우리 쪽 기대 득점 차(stake). 승패 경기·메달 목표 아님·10점 이상일 때만
        const st = record || ctx.kind === "medal" ? null : stakeText(stake);
        // R4: 남은 점수를 "바로 줄입니다" 는 한 경기 몫에 비해 과장
        if (pts && st) return ctx.gap > 0 ? `${ctx.label}까지 ${num(ctx.gap)}점 남았고, 이기면 이 종목 기대 득점 약 ${st}점만큼 가까워집니다.`
          : `${label} 이미 넘었고, 이기면 이 종목 기대 득점 약 ${st}점이 그 여유를 넓힙니다.`;
        if (pts) return ctx.gap > 0 ? `${ctx.label}까지 ${num(ctx.gap)}점 남았고, 이 경기 점수가 그 몫만큼 줄입니다.`
          : `${label} 이미 넘었고, 이 점수가 그 여유를 넓힙니다.`;
        // R1: 상대가 가까운 경쟁자면 맞대결. R2·R15: 그 외는 가장 가까운 순위와 목표선 한 문장
        if (!record && c.other && c.near(c.other)) {
          const o = eun(nm(c.other));
          return st ? `상대 ${o} ${where(c.other)} 지역입니다. 맞대결이라 우리가 이기면 이 종목 기대 득점 약 ${st}점을 가져오고 ${o} 못 얻습니다.`
            : `상대 ${o} ${where(c.other)} 지역입니다. 맞대결이라 우리가 얻는 만큼 ${o} 못 얻습니다.`;
        }
        const head = st ? `이기면 이 종목에서 기대 득점 약 ${st}점을 더 가져옵니다. ` : "";
        return head + (ru <= k ? `지금 ${u}${ru}위 자리로 목표선 ${k}위 안이고, 이 점수가 자리를 지킵니다.`
          : `지금 ${u}${ru}위 자리, 목표선 ${k}위까지 이 점수로 올라섭니다.`);
      }
      case 6:
        if (ctx.prob >= 0.95) return `${label} 이미 ${_withRo(pct(ctx.prob))} 굳어 있어 이 경기 점수가 더 필요하지 않습니다.`;
        if (ctx.prob <= 0.05) return `${label} 이미 ${_withRo(pct(ctx.prob))} 멀어져 이 경기로는 닿지 않습니다.`;
        if (pts && ctx.gap > 0) return `이 경기 점수로는 남은 ${num(ctx.gap)}점이 크게 줄지 않습니다.`;
        return still;
      case 5:
        if (pts) return still;
        if (!c.near(c.side) && !c.near(c.other)) return c.other ? "두 지역 모두 우리 순위 싸움과 떨어져 있습니다."
          : `${eun(nm(c.side))} 우리 순위 싸움과 떨어져 있습니다.`;
        return still;
      case 4: {
        if (pts) return tangled;
        if (r[c.side] === undefined) return "";
        const x = nm(c.side);
        if (c.delta < 0) return `${eun(x)} ${where(c.side)} 지역입니다. 메달 점수 하나가 그대로 격차가 됩니다.`;
        // 가까운 지역의 메달이 우리에게 유리한 드문 경우: "싸움 밖" 이라 하면 사실과 어긋난다
        return c.near(c.side) ? `${eun(x)} ${where(c.side)} 지역이지만, ${ga(x)} 메달을 가져가면 다른 경쟁 지역에 돌아갈 점수가 줄어듭니다.`
          : `${eun(x)} 우리 순위 싸움 밖입니다. ${ga(x)} 메달을 가져가면 경쟁 지역에 돌아갈 점수가 줄어듭니다.`;
      }
      case 3: {
        if (pts) return tangled;
        const g = nm(c.good), b = nm(c.bad);
        const dg = Math.abs(r[c.good] - ru), db = Math.abs(r[c.bad] - ru);
        if (r[c.good] === r[c.bad]) return `둘 다 우리와 가까운 ${u}${r[c.bad]}위 경쟁자입니다. ${ga(b)} 가져갈 때 우리 확률이 더 떨어집니다.`;
        if (dg > db) return `둘 다 우리 경쟁자지만 ${eun(b)} ${where(c.bad)} 지역이고 ${eun(g)} ${u}${r[c.good]}위로 더 멉니다. 점수가 먼 쪽으로 가는 게 덜 아픕니다.`;
        // R8
        return `둘 다 우리 경쟁자입니다. ${eun(b)} ${u}${r[c.bad]}위, ${eun(g)} ${u}${r[c.good]}위이고, ${ga(b)} 가져갈 때 우리 확률이 더 떨어집니다.`;
      }
      default: {   // 2
        if (pts) return tangled;
        if (!c.bad) return r[c.side] === undefined ? "" : `${eun(nm(c.side))} ${where(c.side)} 지역이고, 상대는 아직 정해지지 않았습니다.`;
        if (r[c.bad] === undefined) return "";
        const b = nm(c.bad), rb = r[c.bad];
        // R6: 우리 순위·목표선·상대 위치로 네 갈래
        return `${eun(b)} ${where(c.bad)} 지역입니다. `
          + (rb > ru ? `${ga(b)} 점수를 가져가면 우리를 따라붙습니다.`
            : rb === ru ? `${ga(b)} 가져가면 우리를 앞설 수 있습니다.`
            : ru > k ? `${ga(b)} 여기서 점수를 못 가져가면 목표선 ${k}위가 우리 쪽으로 가까워집니다.`
            : `${ga(b)} 여기서 점수를 못 가져가면 우리 ${u}${ru}위 자리가 더 단단해집니다.`);
      }
    }
  }

  // 카드 이미지의 경기 한 줄(§12-6). 결론과 이유를 등식 하나로. ctx 가 없으면 "" (부르는 쪽이 예전 문장으로)
  function impactShort(us, side, other, delta, ctx, record) {
    if (!ctx || !ctx.r || ctx.r[us] === undefined) return "";
    const c = _impactCase(us, side, other, delta, ctx, record);
    const gain = pp(Math.abs(c.delta)), pts = ctx.kind === "points", nm = sidoLabel;
    switch (c.n) {
      case 1:
        // R3: 가까운 경쟁자와의 맞대결은 상황 2 와 같은 꼴. 득점 목표는 순위 비유(빈손)를 쓰지 않는다
        if (!record && !pts && c.other && c.near(c.other)) return `우리 승 = ${nm(c.other)} 빈손 = 우리 ${gain}`;
        return (record ? "우리 메달" : "우리 승") + " = 우리 점수. " + gain;
      case 6: return ctx.prob >= 0.95 ? "이미 잠근 문. 이겨도 " + pp(c.delta) : "이기면 좋지만 숫자는 그대로.";
      case 5: return "우리 싸움 밖의 경기. 그냥 즐기세요.";
      case 4:
        if (pts) return `${nm(c.side)} 메달 = 우리 ${pp(c.delta)}`;
        return c.delta < 0 ? `${nm(c.side)} 메달 = ${ctx.k}위 줄다리기 한 발 밀림. ${pp(c.delta)}` : `${nm(c.side)} 메달 = 경쟁자 몫 감소. ${pp(c.delta)}`;
      default:
        if (!c.bad) return `${nm(c.side)} 승 = 우리 ${gain}`;
        if (!c.good) return `${nm(c.bad)} 패 = 우리 ${gain}`;
        if (pts) return `${nm(c.good)} 승 = 우리 ${gain}`;
        if (c.n === 3 && Math.abs(ctx.r[c.good] - ctx.r[us]) > Math.abs(ctx.r[c.bad] - ctx.r[us]))
          return `가까운 경쟁자보다 먼 쪽에게. ${nm(c.good)} 승 ${gain}`;
        return `${nm(c.good)} 승 = ${nm(c.bad)} 빈손 = 우리 ${gain}`;
    }
  }

  // ── 설계 14(docs/EXCITEMENT.md) ──
  // 종별 줄임: "여자일반부" → "여일반", "남자18세이하부" → "남18", "남자대학부" → "남대학". 한 줄 카드·"지금" 띠의 좁은 자리에만
  function shortKind(k) {
    return hw(k).replace(/^(남|여)자/, "$1").replace(/(\d+)세이하부/, "$1").replace(/일반부$/, "일반").replace(/대학부$/, "대학").trim();
  }

  // 헤드라인(X1, 규칙 문장, LLM 아님). 위에서부터 첫 매칭. 숫자는 전부 ctx(=latest·timeline 값)에서 온다. 60자 이내.
  // ctx = {state, label, prob, locked, rival, rivalPrev, gap(우리 − 라이벌, 정수), unit("점"|"개"), rank, medal,
  //        duel: {time, cls} | null, gain(오늘 남은 우리 경기의 (1−p)·stake 합, 문자열) | null, k(D+k), dayChange, dayLabel("오늘"|"D+0(10/17) 이후"), preDays, prevRank, final}
  // 시간대 상태(개막 전·저녁)는 순위 문장(3·4·5)보다 먼저 본다: 3·4·5 가 늘 맞아 6 이 나올 자리가 없기 때문이다
  // 격차 변화의 ± 를 말로(R1): 우리가 앞서면(지금 격차 ≥ 0) "n점 벌림 / n점 좁혀짐", 뒤지면 "n점 따라붙음 / n점 더 벌어짐". 숫자는 늘 양수.
  // gap = 지금 격차(우리 − 라이벌), change = 기준 점 대비 격차 변화(+ 면 우리 쪽으로). 0 이면 "격차 그대로". unit "개" 면 금메달
  function gapMoveText(gap, change, unit) {
    const d = Math.round(change);
    if (d === 0) return "격차 그대로";
    const n = unit === "개" ? `금메달 ${num(Math.abs(d))}개` : `${num(Math.abs(d))}점`;
    if (gap >= 0) return d > 0 ? `${n} 벌림` : `${n} 좁혀짐`;
    return d > 0 ? `${n} 따라붙음` : `${n} 더 벌어짐`;
  }

  // 설계 15 Y1(docs/ENTRY.md §1-2 헤드라인 템플릿): "친구 같은 캐스터" 해요체. 한 문장에 숫자 하나, 느낌표 없음.
  // engine/push.headline 과 글자까지 같아야 한다(tests/test_site.py HeadlineParityTests)
  function headline(c) {
    const R = sidoLabel(c.rival || "");
    const amt = n => c.unit === "개" ? `금메달 ${num(Math.abs(n))}개` : `${num(Math.abs(n))}점`;
    const sAmt = n => c.unit === "개" ? `금메달 ${signed(n)}개` : `${signed(n)}점`;
    const rk = "지금 " + (c.medal ? "메달 순위 " : "") + c.rank + "위 자리";
    const same = c.unit === "개" ? "같은 금메달 수" : "같은 점수";
    const hasRival = !!c.rival || !!c.rivalPrev;
    const wa = josa(R, "과", "와");
    // 1. 사실상 확정(매직넘버가 모두 0 이면 "확정")
    if (c.prob >= 0.99) {
      const st = c.locked ? "확정" : "사실상 확정";
      // 작년의 나: 괄호 안 득점은 뺀다(같은 말 두 번 하지 않는다)
      if (c.rivalPrev) return `${c.label.replace(/\s*\([^)]*\)/g, "")} ${st} · ` + (c.gap === 0 ? "작년과 같은 점수" : `작년보다 ${sAmt(c.gap)}`);
      if (!hasRival) return `${c.label}, ${st}이에요`;
      return `${c.label}, ${st}이에요. ${wa}는 ` + (c.gap === 0 ? same : `${amt(c.gap)} 차`);
    }
    // 6. 개막 전·저녁. 시간대 문장은 순위 문장(2~5)보다 먼저 본다: 3·4·5 가 늘 맞아 6 이 나올 자리가 없기 때문이다
    if (c.state === "pre") {
      return (c.preDays ? `개막 D−${c.preDays}. ` : "개막 전. ") + (c.prevRank ? `작년 ${c.prevRank}위, ` : "") + `올해 목표는 ${c.label}`;
    }
    if (c.state === "evening") {
      if (!hasRival) return `${rk}예요`;
      const lb = c.dayLabel || "오늘";
      const has = c.dayChange !== null && c.dayChange !== undefined;
      // 작년의 나: 움직인 것은 우리 예상 득점이라 ± 그대로. 라이벌: gapMoveText 네 말
      if (c.rivalPrev) return (c.gap === 0 ? "이대로면 작년과 같은 점수" : `이대로면 작년보다 ${sAmt(c.gap)}`)
        + (has ? `. ${lb} ` + (Math.round(c.dayChange) === 0 ? "그대로" : sAmt(c.dayChange)) : "");
      const pos = c.gap > 0 ? `${R}보다 ${amt(c.gap)} 앞서요` : c.gap < 0 ? `${R}보다 ${amt(c.gap)} 뒤에 있어요` : `${wa} ${josa(same, "이에요", "예요")}`;
      return pos + (has ? `. ${lb} ${gapMoveText(c.gap, c.dayChange, c.unit)}` : "");
    }
    if (!hasRival) return `${rk}예요`;
    // 2. 오늘 라이벌과 맞대결
    if (c.duel && !c.rivalPrev) return `오늘 ${c.duel.time ? c.duel.time + " " : ""}${c.duel.cls}에서 ${wa} 맞대결. 지금 ` + (c.gap === 0 ? same : `${amt(c.gap)} 차`);
    // 5. 작년의 나
    if (c.rivalPrev) return c.gap === 0 ? "이대로면 작년과 같은 점수예요" : josa(`이대로면 작년보다 ${sAmt(c.gap)}`, "이에요", "예요");
    // 3·4. 앞서요·뒤에 있어요
    if (c.gap > 0) return `${rk}. ${josa(R, "이", "가")} ${amt(c.gap)} 뒤에서 따라와요`;
    if (c.gap < 0) return `${R}보다 ${amt(c.gap)} 뒤에 있어요. ` + (c.gain && c.unit !== "개" ? `오늘 다 이기면 최대 ${c.gain}점 더` : rk);
    return `${wa} ${josa(same, "이에요", "예요")}. ${rk}`;
  }

  // 세부종목 이름 줄임(하이라이트 피드·좁은 줄): "검도 여자일반부 단체전" → "검도 여일반 단체전"
  function shortName(n) {
    return hw(n).replace(/(남|여)자(?=\d|일반|대학|고등|중학)/g, "$1").replace(/(\d+)세이하부/g, "$1").replace(/일반부/g, "일반").replace(/대학부/g, "대학").replace(/\s+/g, " ").trim();
  }

  // 하이라이트 피드(X2): 확정된 세부종목을 꼬리표가 붙은 하이라이트로. 위에서부터 첫 매칭:
  //   깜짝(우리 메달, 사전 확률 < 15%) → 금·은·동(메달 종류를 아는 우리 세부종목) → 아쉬움(우리 diff ≤ −100) → 큰 득점(우리 diff ≥ +100, 메달 종류 모름, R4)
  //   → 지켜냄(우리가 이긴 승패 경기가 있는 세부종목, diff 작음) → 꼬리표 없음. 라이벌 세부종목(우리 줄에 없는 것, |diff| ≥ 50)은 "라이벌".
  // gap = 그 세부종목의 (우리 diff − 라이벌 diff). 라이벌이 작년의 나면 우리 diff. 사전 확률 줄만 있는 깜짝(우리 diff 상위 밖)은 gap 없음.
  // inp = {us, rival, rivalPrev, ours: [{event_id, name, expected, realized, diff}], rivals: [...], surprises: [{sido, event_id, name, medal, prior_medal_p}],
  //        medals: {event_id: "금"|"은"|"동"}, wins: {event_id: [이긴 시도…]}, multiGold: [event_id…](X8 다관왕),
  //        matches: [{k, w, l, t, name}](P3 results_recent_v2, 있으면 경기 단위 라이벌·지켜냄·시각)}
  function moments(inp) {
    const us = inp.us, rv = inp.rivalPrev ? null : inp.rival, out = [];
    const rd = {};
    for (const x of inp.rivals || []) rd[x.event_id] = x.diff;
    const sur = {};
    for (const x of inp.surprises || []) if (x.sido === us && !(x.event_id in sur)) sur[x.event_id] = x;
    const medals = inp.medals || {}, wins = inp.wins || {};
    const won = (eid, k) => (wins[eid] || []).includes(k);
    const seen = new Set();
    // P3 results_recent_v2 를 세부종목(종목|세부, 경기 키 둘째·셋째 칸)으로 묶는다. 시각 순
    const byEvent = {};
    for (const m of (inp.matches || []).slice().sort((p, q) => String(p.t || "").localeCompare(String(q.t || "")))) {
      const k = String(m.k).split("|"), eid = k.length >= 3 ? k[1] + "|" + k[2] : null;
      if (eid) (byEvent[eid] = byEvent[eid] || []).push(m);
    }
    for (const x of inp.ours || []) {
      seen.add(x.event_id);
      const sp = sur[x.event_id], md = medals[x.event_id] || (sp && sp.medal) || null;
      // 다관왕(X8): 우리 지역 선수의 두 번째 금 이상인 세부종목(inp.multiGold). 깜짝보다 뒤, 금·은·동보다 앞
      const multi = (inp.multiGold || []).includes(x.event_id);
      const tag = sp && sp.prior_medal_p < 0.15 ? "깜짝" : multi ? "다관왕" : md ? md : x.diff <= -100 ? "아쉬움" : x.diff >= 100 ? "큰 득점" : won(x.event_id, us) ? "지켜냄" : "";
      // P3 경기 단위(inp.matches 가 있을 때): 그 세부종목에서 우리가 뛴 가장 늦은 경기의 종료 시각, 지켜냄는 우리가 이긴 경기 이름·상대로
      const ms = (byEvent[x.event_id] || []).filter(m => m.w === us || m.l === us);
      const last = ms[ms.length - 1], wonM = ms.filter(m => m.w === us).pop();
      const tag2 = inp.matches ? ((tag === "지켜냄" || tag === "") && wonM ? "지켜냄" : tag === "지켜냄" ? "" : tag) : tag;
      out.push({ tag: tag2, event_id: x.event_id, name: tag2 === "지켜냄" && wonM ? wonM.name : shortName(x.name), medal: md, prior: sp ? sp.prior_medal_p : null,
        gap: Math.round(x.diff - (rv && rd[x.event_id] !== undefined ? rd[x.event_id] : 0)), t: last ? last.t : null,
        line: (tag2 === "깜짝" && sp ? `경기 전엔 ${wasYo(sp.prior_medal_p)} · ` : "") + (tag2 === "지켜냄" && wonM && wonM.l ? `상대 ${wonM.l} · ` : "") + `기대 ${num(x.expected)}점 → ${num(x.realized)}점` });
    }
    for (const sp of Object.values(sur)) {
      if (seen.has(sp.event_id) || !(sp.prior_medal_p < 0.15)) continue;
      seen.add(sp.event_id);
      out.push({ tag: "깜짝", event_id: sp.event_id, name: shortName(sp.name), medal: sp.medal, prior: sp.prior_medal_p, gap: null, line: `경기 전엔 ${wasYo(sp.prior_medal_p)} · ${sp.medal}메달` });
    }
    // 라이벌: P3 경기가 있으면 경기 단위(라이벌이 뛴 승패 경기, 우리 경기 아님). 격차는 그 세부종목 라이벌 diff 의 반대를 가장 늦은 경기 줄에만
    const rvSeen = new Set();
    if (rv && inp.matches) for (const [eid, ms] of Object.entries(byEvent)) {
      if (seen.has(eid)) continue;
      // 라이벌 세부종목 diff 가 작으면(|d| < 50, 또는 상위 25 밖이라 모름) 경기 줄도 내지 않는다(세부종목 단위 때와 같은 문턱)
      if (rd[eid] === undefined || Math.abs(rd[eid]) < 50) continue;
      const rm = ms.filter(m => (m.w === rv || m.l === rv) && m.w !== us && m.l !== us);
      rm.forEach((m, i) => {
        const lastOne = i === rm.length - 1, d = rd[eid];
        out.push({ tag: "라이벌", event_id: eid, name: m.name, medal: null, prior: null, t: m.t,
          gap: lastOne && d !== undefined ? -Math.round(d) : null, right: m.w === rv ? `${rv} 승` : `${rv} 패`,
          line: `${m.w === rv ? `${rv} 승` : `${rv} 패`}${(m.w === rv ? m.l : m.w) ? ` · 상대 ${m.w === rv ? m.l : m.w}` : ""}${lastOne && d !== undefined ? ` · 세부종목 예상보다 ${signed(d)}점` : ""}` });
      });
      if (rm.length) rvSeen.add(eid);
    }
    if (rv) for (const x of inp.rivals || []) {
      if (seen.has(x.event_id) || rvSeen.has(x.event_id) || Math.abs(x.diff) < 50) continue;
      out.push({ tag: "라이벌", event_id: x.event_id, name: shortName(x.name), medal: null, prior: null, gap: -Math.round(x.diff),
        line: `${rv} 기대 ${num(x.expected)}점 → ${num(x.realized)}점${won(x.event_id, rv) ? " · 승" : ""}` });
    }
    // 시각이 있으면(P3) 깜짝(사전 확률 낮은 순, 기록경기라 대개 시각이 없다) → 시각 역순 → 시각 없는 줄 |격차| 큰 순
    if (out.some(m => m.t)) return out.sort((a, b) => (b.tag === "깜짝") - (a.tag === "깜짝") || (a.tag === "깜짝" && b.tag === "깜짝" ? a.prior - b.prior : 0)
      || (b.t ? 1 : 0) - (a.t ? 1 : 0) || String(b.t || "").localeCompare(String(a.t || "")) || Math.abs(b.gap || 0) - Math.abs(a.gap || 0));
    return out.sort((a, b) => (b.tag === "깜짝") - (a.tag === "깜짝") || (a.tag === "깜짝" ? a.prior - b.prior : 0)
      || Math.abs(b.gap || 0) - Math.abs(a.gap || 0));
  }

  // 하이라이트 줄 오른쪽 칸(설계 15 Y1): 깜짝은 "경기 전엔 n%였어요", 그 밖은 라이벌과의 점수 차 변화 "+265점"(작년의 나면 "우리 +265점")
  function momentRight(m, rivalPrev) {
    // 깜짝은 아래 줄(line)에 "경기 전엔 n%였어요" 가 있다(설계 15 §1-2). 줄이 없는 곳(지나온 날)만 오른쪽 칸에
    if (m.tag === "깜짝" && m.prior !== null) return m.line ? "" : "경기 전엔 " + wasYo(m.prior);
    if (m.gap === null || m.gap === undefined) return m.right || "";
    const w = rivalPrev ? "우리 " : "";
    return m.gap === 0 ? `${w}그대로` : `${w}${signed(m.gap)}점`;
  }

  // 놓치면 아쉬운 경기(X3, 설계 15 Y1 에서 옛 이름을 바꿈): 팽팽함 × 0.4 + 우리 쪽 크기 × 0.4 + 라이벌 맞대결 × 0.2, 0~1 을 5단계로 등분(1~5).
  //   팽팽함: 승패 1 − |p − 0.5|·2, 기록 1 − (메달권 1위 − 2위 확률). 크기: c.size(0~1, 부르는 쪽이 정한다 — R8: 우리 쪽 (1−p)·stake / 그날 최대,
  //   없으면 우리 영향 |Δ%p| / 그날 최대. importance 는 전국 중요도라 쓰지 않는다). 라이벌: 우리·라이벌 모두 뛰면 1, 한쪽만 0.5. c = {us, rival, size}
  function heat(m, c) {
    const sides = m.sides || [], ps = sides.map(sd => sd.p_win || 0).sort((a, b) => b - a);
    const tight = m.record ? (ps.length >= 2 ? 1 - (ps[0] - ps[1]) : 0) : sides.length >= 1 ? 1 - Math.abs((sides[0].p_win || 0) - 0.5) * 2 : 0;
    const size = c.size || 0;
    const plays = k => !!k && sides.some(sd => sd.sido === k);
    const rv = plays(c.us) && plays(c.rival) ? 1 : plays(c.us) || plays(c.rival) ? 0.5 : 0;
    const score = 0.4 * Math.max(0, Math.min(1, tight)) + 0.4 * Math.max(0, Math.min(1, size)) + 0.2 * rv;
    return { score, level: Math.min(5, Math.floor(score * 5) + 1) };
  }

  // 만약에(X3): 오늘 우리 경기를 이기거나 진다고 가정한 격차. 지금 기대값 대비 증분이라 이기면 (1−p)·stake, 지면 −p·stake.
  // 확률은 다시 계산하지 않는다. games = [{p, stake, pick: "w"|"l"|null}]
  function whatIf(gap, games) {
    let d = 0;
    for (const g of games) if (g.pick === "w") d += (1 - g.p) * g.stake; else if (g.pick === "l") d -= g.p * g.stake;
    return Math.round(gap + d);
  }

  // ── 오늘의 질문(docs/ENGAGEMENT.md G). 점수·순위·보상 없이 "고른 쪽"과 "전망이 높게 본 쪽"만 말한다 ──
  // a·b 두 시도, pa = a 의 승리 확률(고를 때의 전망)
  function modelLine(a, b, pa) {
    if (Math.round(Math.abs(pa - 0.5) * 100) < 1) return "전망은 두 쪽을 거의 같게 봤습니다(" + pct(0.5) + ").";
    const hi = pa > 0.5 ? a : b, p = Math.max(pa, 1 - pa);
    return "전망은 " + hi + " 쪽을 " + (p < 0.6 ? "조금 " : "") + "높게 봤습니다(" + pct(p) + ").";
  }

  // 결과 문장. pWinner = 고를 때 전망에서 이긴 쪽의 승리 확률. 결과는 "사전 확률 n%였던 결과" 로만 서술한다
  function questionResult(pick, winner, pWinner) {
    // 승패는 시도에만 붙이고, 사람의 선택에는 "같다/다르다" 만 쓴다(ENGAGEMENT §9 R3)
    return "결과: " + winner + " 승 — 사전 확률 " + wasPct(pWinner) + " 결과. 고른 쪽과 " + (pick === winner ? "같습니다." : "다릅니다.");
  }

  // 내 기록 요약. n 끝난 경기, mine 결과가 고른 쪽과 같았던 수, model 결과가 전망이 높게 본 쪽과 같았던 수
  function pickSummary(n, mine, model) {
    return "끝난 " + n + "경기 중 결과가 고른 쪽과 같았던 경기 " + mine + "개, 전망이 높게 본 쪽과 같았던 경기 " + model + "개.";
  }

  // ── 캘린더 파일(.ics, RFC 5545). 서버 없이 화면에서 만든다(docs/ENGAGEMENT.md C) ──
  function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
  function icsUTC(t) { return t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function icsDay(day, plus) {
    const t = new Date(Date.UTC(Math.floor(day / 10000), Math.floor(day / 100) % 100 - 1, day % 100 + (plus || 0)));
    return t.toISOString().slice(0, 10).replace(/-/g, "");
  }
  // 한 줄 75바이트(UTF-8)를 넘으면 접는다
  function icsFold(line) {
    const out = [];
    let cur = "", n = 0;
    for (const ch of line) {
      const b = ch.codePointAt(0) < 0x80 ? 1 : ch.codePointAt(0) < 0x800 ? 2 : ch.codePointAt(0) < 0x10000 ? 3 : 4;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  // events: [{uid, title, desc, loc, start: Date, end: Date, allDay, day}]
  function ics(events, now) {
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ChejeonLive//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    for (const e of events) {
      L.push("BEGIN:VEVENT", "UID:" + icsText(e.uid), "DTSTAMP:" + icsUTC(now));
      if (e.allDay) L.push("DTSTART;VALUE=DATE:" + icsDay(e.day), "DTEND;VALUE=DATE:" + icsDay(e.day, 1));
      else L.push("DTSTART:" + icsUTC(e.start), "DTEND:" + icsUTC(e.end));
      L.push("SUMMARY:" + icsText(e.title));
      if (e.loc) L.push("LOCATION:" + icsText(e.loc));
      if (e.desc) L.push("DESCRIPTION:" + icsText(e.desc));
      L.push("END:VEVENT");
    }
    L.push("END:VCALENDAR");
    return L.map(icsFold).join("\r\n") + "\r\n";
  }

  const ASSUMPTION_TEXT = {
    "기록경기 출전명단 없음 → 17개 시도 참가 가정": n => "출전 명단이 아직 없는 기록경기 " + n + "개는 17개 시도가 모두 출전한다고 가정했습니다.",
    "과거 자료 부족(보수적 추정) 세부종목": n => "과거 자료가 적은 세부종목 " + n + "개는 시도 간 전력 차를 작게 잡았습니다(보수적 추정).",
    "시범 세부종목 → 채점 제외": n => "시범 세부종목 " + n + "개는 종합득점에 넣지 않았습니다.",
    "리그 세부종목 미구현 → 제외": n => "리그 방식 세부종목 " + n + "개는 아직 계산에 넣지 않았습니다.",
    "기록경기 역대 득점 없음 → 동일 강도": n => "과거 득점 기록이 없는 기록경기 " + n + "개는 시도 간 전력을 같다고 두었습니다.",
    "역대 승패 없음 → 동일 강도": n => "과거 승패 기록이 없는 세부종목 " + n + "개는 시도 간 전력을 같다고 두었습니다.",
    "토너먼트 참가 시도 미확정 → 제외": n => "대진이 정해지지 않은 토너먼트 " + n + "개는 계산에서 뺐습니다.",
    "공식 집계 반영(공인 세부종목 수)": n => "끝난 세부종목 중 공식 집계에 반영된 " + n + "개는 대한체육회 공식 득점으로 고정했습니다.",
    "공식 메달 수와 엔진 집계 불일치": n => "공식 메달 수와 이 전망의 메달 집계가 " + n + "개 다릅니다(공인 지연 또는 집계 방식 차이).",
    "공식 집계 없음 → 재구성 불확실성 반영": n => "공식 득점이 아직 없어 끝난 세부종목 " + n + "개의 득점을 추정했고, 그 오차만큼 범위를 넓혔습니다.",
    "토너먼트 대진표 반영": n => "토너먼트 " + n + "개는 공식 대진표대로 남은 경기를 진행했습니다.",
    "토너먼트 대진표 없음 → 생존 시도 순위 근사": n => "대진표를 아직 받지 못한 토너먼트 " + n + "개는 남은 시도들의 순위로 근사했습니다.",
    "토너먼트 대진표 불일치 → 생존 시도 순위 근사": n => "대진표와 경기 결과가 맞지 않는 토너먼트 " + n + "개는 남은 시도들의 순위로 근사했습니다.",
  };

  function assumption(key, n) {
    const f = ASSUMPTION_TEXT[key];
    return f ? f(n) : key + " (" + n + "개)";
  }

  // ── 체전 상식 퀴즈(설계 15 Y5, docs/ENTRY.md §2 Y5·§6). 하루 한 문제, 씨앗 = 날짜 + 시도, 전부 history.json 에서. 경기 결과를 묻지 않는 지식 문제 ──
  // 101회는 events 에 없어 뽑히지 않는다. Q1·Q7 은 102회(순위·득점 없음)를 뽑지 않는다
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function strHash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const REGION = { 서울: "수도", 인천: "수도", 경기: "수도", 강원: "강원", 대전: "충청", 세종: "충청", 충북: "충청", 충남: "충청",
    광주: "호남", 전북: "호남", 전남: "호남", 부산: "영남", 대구: "영남", 울산: "영남", 경북: "영남", 경남: "영남", 제주: "제주" };
  const QUIZ_TYPES = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"];
  function dayIndex(dk) { const y = Math.floor(dk / 10000), m = Math.floor(dk / 100) % 100, d = dk % 100; return Math.floor(Date.UTC(y, m - 1, d) / 864e5); }

  // H = history.json, ctx = {fav: [종목], rival: 시도|null, type: "Q1".."Q7"(검사용 강제)}. 반환 {id, type, q, options[4], answer, note, cls?, event?} | null
  function quiz(H, sido, dk, ctx) {
    ctx = ctx || {};
    if (!H || !H.sidos || !H.sidos[sido] || !Array.isArray(H.events) || !H.events.length) return null;
    // 유형마다 따로 씨앗(날짜|시도|유형): 어느 유형이 되는지 먼저 다 셀 수 있게(Y5-R1)
    let rnd = null;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const last = H.events[H.events.length - 1], hosts = H.hosts || {}, yr = e => (hosts[String(e)] || {}).year;
    const R = (k, e) => (H.sidos[k] && H.sidos[k].ranks[String(e)]) || null;
    const ranked = (k, e) => { const r = R(k, e); return !!r && r[0] !== null && r[1] !== null; };
    const sidos = Object.keys(H.sidos), L = sidoLabel, me = L(sido), eun = x => josa(x, "은", "는");
    // ±1·±2 순위 보기(1~n 안). 모자라면 ±3
    const rankOpts = (ans, n) => {
      const c = shuffle([ans - 1, ans + 1, ans - 2, ans + 2].filter(x => x >= 1 && x <= n)).slice(0, 3);
      for (const x of [ans + 3, ans - 3, ans + 4, ans - 4]) if (c.length < 3 && x >= 1 && x <= n) c.push(x);
      return c.map(x => x + "위");
    };
    const nOf = e => sidos.filter(k => ranked(k, e)).length;
    const rivalOr = () => {
      if (ctx.rival && ctx.rival !== sido && H.sidos[ctx.rival]) return ctx.rival;
      const a = R(sido, last);
      if (!a || a[1] === null) return null;
      const os = sidos.filter(k => k !== sido && ranked(k, last));
      return os.filter(k => R(k, last)[1] > a[1]).sort((x, y) => R(x, last)[1] - R(y, last)[1])[0]
        || os.filter(k => R(k, last)[1] < a[1]).sort((x, y) => R(y, last)[1] - R(x, last)[1])[0] || null;
    };
    // 최근 3회 중 하나(Y5-R8). 작년이면 "작년", 아니면 "제n회(연도)"
    const when = e => e === last ? "작년" : `제${e}회(${yr(e)})`;
    const make = {
      Q1: () => {
        const evs = H.events.filter(e => e !== last && e !== 102 && ranked(sido, e));
        // Y5-R6: 순위가 늘 같았으면(세종 17위) 문제가 되지 않는다
        if (!evs.length || new Set(evs.map(e => R(sido, e)[0])).size < 2) return null;
        const e = pick(evs), r = R(sido, e);
        return { q: `제${e}회(${yr(e)}) 전국체전에서 ${eun(me)} 종합 몇 위였을까요?`, answer: r[0] + "위", wrong: rankOpts(r[0], nOf(e)), event: e, num: true,
          note: `제${e}회 ${eun(me)} ${r[0]}위였어요. 종합득점 ${num(r[1])}점.` };
      },
      Q2: () => {
        const evs = H.events.filter(e => hosts[String(e)] && hosts[String(e)].sido && !hosts[String(e)].cancelled);
        if (!evs.length) return null;
        const e = pick(evs), host = hosts[String(e)].sido, rg = REGION[host];
        const pool = shuffle(sidos.filter(k => k !== host && REGION[k] !== rg && R(k, e)));
        const wrong = [], used = new Set();
        for (const k of pool) if (wrong.length < 3 && !used.has(REGION[k])) { wrong.push(k); used.add(REGION[k]); }
        for (const k of pool) if (wrong.length < 3 && !wrong.includes(k)) wrong.push(k);
        return { q: `제${e}회(${yr(e)}) 전국체전은 어디서 열렸을까요?`, answer: L(host), wrong: wrong.map(L), event: e, note: `제${e}회(${yr(e)})는 ${L(host)}에서 열렸어요.` };
      },
      Q3: () => {
        const ct = (H.class_top || {})[String(last)] || {};
        const favs = (ctx.fav || []).filter(c => ct[c] && ct[c].length);
        const mine = ((H.sidos[sido].top_classes || {})[String(last)] || []).map(x => x[0]).filter(c => ct[c] && ct[c].length);
        if (!favs.length && !mine.length) return null;
        const cls = pick(favs.length ? favs : mine);
        const top = ct[cls], wrong = top.slice(1, 3);
        for (const k of shuffle(sidos.filter(k => !top.includes(k) && R(k, last)))) if (wrong.length < 3) wrong.push(k);
        return { q: `작년 ${hw(cls)}에서 종목 득점 1위는 어느 지역이었을까요?`, answer: L(top[0]), wrong: wrong.map(L), cls,
          note: `작년 ${hw(cls)} 종목 득점은 ` + top.map((k, i) => `${L(k)} ${i + 1}위`).join(", ") + "였어요." };
      },
      Q4: () => {
        const cands = sidos.filter(k => k !== sido && H.sidos[k].best && H.sidos[k].best.rank);
        const t = ctx.rival && ctx.rival !== sido && H.sidos[ctx.rival] ? ctx.rival : cands.length ? pick(cands) : null;
        const b = t && H.sidos[t].best;
        if (!b || !b.rank) return null;
        const from = H.events.find(e => R(t, e));
        const evs = b.events || [], e1 = evs[evs.length - 1];
        return { q: `${josa(L(t), "이", "가")} ${from}회 이후 가장 높이 오른 종합 순위는 몇 위였을까요?`, answer: b.rank + "위", wrong: rankOpts(b.rank, 17), other: t, num: true,
          note: `${L(t)}의 역대 최고는 ${b.rank}위예요` + (evs.length > 1 ? `(${evs.length}번, 가장 최근 ${e1}회).` : evs.length ? `(${e1}회, ${yr(e1)}).` : ".") };
      },
      Q5: () => {
        const evs = H.events.slice(-3).filter(e => { const r = R(sido, e); return r && typeof r[2] === "number" && r[2] >= 4; });
        if (!evs.length) return null;
        const e = pick(evs), r = R(sido, e), g = r[2], w = [];
        for (const x of [Math.round(g * 0.8), Math.round(g * 0.9), Math.round(g * 1.15), g + 3, g - 3, g + 6, g - 6]) if (w.length < 3 && x >= 0 && x !== g && !w.includes(x)) w.push(x);
        return { q: `${when(e)} ${me} 금메달은 몇 개였을까요?`, answer: g + "개", wrong: w.map(x => x + "개"), num: true, event: e,
          note: `${when(e)} ${eun(me)} 금 ${g} · 은 ${r[3]} · 동 ${r[4]}개를 땄어요.` };
      },
      Q6: () => {
        const tcs = H.sidos[sido].top_classes || {};
        const evs = H.events.slice(-3).filter(e => (tcs[String(e)] || []).length >= 4);
        if (!evs.length) return null;
        const e = pick(evs), tc = tcs[String(e)];
        return { q: `${when(e)} ${me} 득점에서 가장 큰 종목은 무엇이었을까요?`, answer: tc[0][0], wrong: tc.slice(1, 4).map(x => x[0]), cls: tc[0][0], event: e,
          note: `${when(e)} ${me} 득점은 ${hw(tc[0][0])} ${num(tc[0][1])}점이 가장 컸어요.` };
      },
      Q7: () => {
        const rv = rivalOr(), a = R(sido, last), b = rv && R(rv, last);
        if (!rv || !a || !b || a[1] === null || b[1] === null) return null;
        const r100 = x => Math.round(x / 100) * 100, d = Math.abs(a[1] - b[1]), ans = r100(d);
        if (ans < 300) return null;
        const w = [];
        for (const x of [r100(d * 0.5), r100(d * 1.5), r100(d * 2), ans + 300, ans - 300]) if (w.length < 3 && x > 0 && x !== ans && !w.includes(x)) w.push(x);
        return { q: `작년 ${josa(me, "과", "와")} ${L(rv)}의 종합득점 차는 약 몇 점이었을까요?`, answer: `약 ${num(ans)}점`, wrong: w.map(x => `약 ${num(x)}점`), other: rv, num: true,
          note: `작년 ${me} ${num(a[1])}점, ${L(rv)} ${num(b[1])}점이었어요.` };
      },
    };
    const numOf = s => +String(s).replace(/[^\d]/g, "");
    const build = t => {
      rnd = mulberry32(strHash(dk + "|" + sido + "|" + t));
      const x = make[t]();
      if (!x) return null;
      const opts = [x.answer].concat(x.wrong.slice(0, 3));
      if (opts.length !== 4 || new Set(opts).size !== 4) return null;
      // Y5-R5: 숫자 보기는 오름차순, 종목·시도 보기는 섞는다
      const out = { id: `${dk}|${sido}|${t}`, type: t, q: x.q, options: x.num ? opts.slice().sort((p, q) => numOf(p) - numOf(q)) : shuffle(opts), answer: x.answer, note: x.note };
      if (x.cls) out.cls = x.cls;
      if (x.event) out.event = x.event;
      if (x.other) out.other = x.other;
      return out;
    };
    if (ctx.type) return build(ctx.type);
    // Y5-R1: 되는 유형 목록 A 를 먼저 만들고 날짜로 돈다(A 가 n 개면 n 일 안에 같은 유형이 다시 나오지 않는다)
    const A = QUIZ_TYPES.map(build).filter(Boolean);
    return A.length ? A[(dayIndex(+dk) + strHash(sido)) % A.length] : null;
  }

  const api = { wasPct, wasYo, pct, pp, num, signed, hw, josa, parseTime, hm, md, mdhm, dayKey, dayLabel, parseSchedule, freshness,
    impactSentence, recordSentence, impactMove, shownPct, sidoLabel, impactCtx, impactWhy, impactShort, stakeText, assumption, ASSUMPTION_TEXT, shortKind, shortName, gapMoveText, headline, moments, momentRight, heat, whatIf, modelLine, questionResult, pickSummary, ics, quiz };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Fmt = api;
})(typeof window !== "undefined" ? window : this);
