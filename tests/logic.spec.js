// 게임 규칙(순수 로직) 특성 테스트.
// 화면 없이 게임 내부 함수만 호출해서 "지금 이렇게 동작한다"를 고정해 둔다.
// 골든 스냅샷(tests/__snapshots__/logic.spec.js/*.json)은 리팩토링 전 코드로 만든 기준값이다.
// 리팩토링 후 스냅샷이 달라지면 동작이 바뀐 것이다. 일부러 규칙을 바꾼 경우에만 `npm run test:update`.
const { test, expect } = require('@playwright/test');
const { openGame, inGame, pageErrors } = require('./harness/app');

const json = v => JSON.stringify(v, null, 1);

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ page }) => {
  await openGame(page, { peer: false });
});
test.afterEach(async ({ page }) => {
  expect(pageErrors(page), '페이지 스크립트 오류').toEqual([]);
});

test.describe('상수', () => {
  test('점수 단계·배율·시간 상수', async ({ page }) => {
    const c = await inGame(page, SD => ({
      tiers: SD.TIERS.map(t => ({ name: t.name, pts: t.pts, vmin: t.vmin, vmax: t.vmax, w: t.w })),
      zooms: SD.ZOOMS, bolt: SD.BOLT, head: SD.HEAD_MULT, spread: SD.NOSCOPE_SPREAD, dur: SD.GAME_DUR, world: [SD.WORLD_W, SD.WORLD_H],
    }));
    expect(c.tiers.map(t => t.pts)).toEqual([100, 200, 350, 500]);
    expect(c.tiers.map(t => t.name)).toEqual(['느림', '보통', '빠름', '매우빠름']);
    expect(c.tiers.reduce((a, t) => a + t.w, 0)).toBeCloseTo(1, 10);
    expect(c.zooms).toEqual([1, 2.5, 5]);
    expect(c.bolt).toBe(0.9);
    expect(c.head).toBe(1.5);
    expect(c.spread).toBe(80);
    expect(c.dur).toBe(60);
    expect(c.world).toEqual([1600, 900]);
  });
});

test.describe('난수·표적 일정 (같은 시드 → 모든 플레이어에게 같은 표적)', () => {
  test('mulberry32 수열', async ({ page }) => {
    const seq = await inGame(page, SD => [1, 7, 12345, 2147483647].map(s => { const r = SD.mulberry32(s); return Array.from({ length: 8 }, () => +r().toFixed(10)); }));
    expect(json(seq)).toMatchSnapshot('mulberry32.json');
  });

  test('buildSchedule(12345, 60) 결과', async ({ page }) => {
    const list = await inGame(page, SD => SD.buildSchedule(12345, 60).map(g => {
      const o = {}; for (const [k, v] of Object.entries(g)) o[k] = typeof v === 'number' ? +v.toFixed(6) : v; return o;
    }));
    expect(json(list)).toMatchSnapshot('schedule-12345-60.json');
  });

  test('buildSchedule 성질: 시간순, 간격 0.75~1.3초, 첫 표적 0.4초', async ({ page }) => {
    const r = await inGame(page, SD => {
      const out = [];
      for (const seed of [1, 99, 424242]) {
        const s = SD.buildSchedule(seed, 60);
        out.push({ n: s.length, first: s[0].t0, last: s[s.length - 1].t0, gaps: s.slice(1).map((g, i) => g.t0 - s[i].t0),
          ids: s.map(g => g.id), tiers: s.map(g => g.tier), x0: s.map(g => [g.dir, g.x0]), same: JSON.stringify(SD.buildSchedule(seed, 60)) === JSON.stringify(s) });
      }
      return out;
    });
    for (const s of r) {
      expect(s.same).toBe(true);
      expect(s.first).toBe(0.4);
      expect(s.last).toBeLessThan(60);
      expect(s.ids).toEqual(s.ids.map((_, i) => i));
      for (const g of s.gaps) { expect(g).toBeGreaterThanOrEqual(0.75); expect(g).toBeLessThanOrEqual(1.3); }
      for (const t of s.tiers) expect([0, 1, 2, 3]).toContain(t);
      for (const [dir, x0] of s.x0) expect(x0).toBe(dir > 0 ? -70 : 1670);
    }
  });

  test('tpos / activeTargets: 시각별 표적 위치', async ({ page }) => {
    const r = await inGame(page, SD => {
      const s = SD.buildSchedule(777, 60);
      const round = p => p.map(v => +v.toFixed(4));
      const pos = s.slice(0, 5).map(g => [0, 0.5, 1, 2.5].map(a => round(SD.tpos(g, a))));
      const at = t => SD.activeTargets(s, new Set(), t).map(o => ({ id: o.id, tier: o.tier, s: +o.s.toFixed(4), x: +o.x.toFixed(3), y: +o.y.toFixed(3) }));
      const live10 = at(10);
      const deadOne = SD.activeTargets(s, new Set([live10[0].id]), 10).map(o => o.id);
      return { pos, t5: at(5), t10: live10, t30: at(30), deadOne };
    });
    expect(r.deadOne).not.toContain(r.t10[0].id);
    expect(r.deadOne.length).toBe(r.t10.length - 1);
    expect(json(r)).toMatchSnapshot('targets-777.json');
  });
});

test.describe('명중 판정 hitTest', () => {
  test('머리·몸통·빗나감 경계', async ({ page }) => {
    const r = await inGame(page, SD => {
      const o = (s) => ({ x: 500, y: 500, s });
      const cases = {};
      for (const s of [1, 1.5]) {
        cases[s] = {
          headCenter: SD.hitTest(o(s), 500, 500 - 50 * s),
          headEdge: SD.hitTest(o(s), 500 + 13 * s, 500 - 50 * s),
          headOut: SD.hitTest(o(s), 500 + 13.5 * s, 500 - 50 * s),
          bodyCenter: SD.hitTest(o(s), 500, 500),
          bodyLeft: SD.hitTest(o(s), 500 - 18 * s, 500),
          bodyRightOut: SD.hitTest(o(s), 500 + 18.5 * s, 500),
          bodyTop: SD.hitTest(o(s), 500, 500 - 36 * s),
          bodyBottom: SD.hitTest(o(s), 500, 500 + 62 * s),
          belowFeet: SD.hitTest(o(s), 500, 500 + 63 * s),
          far: SD.hitTest(o(s), 900, 100),
        };
      }
      return cases;
    });
    for (const s of ['1', '1.5']) {
      expect(r[s]).toEqual({
        headCenter: 'head', headEdge: 'head', headOut: null, bodyCenter: 'body', bodyLeft: 'body',
        bodyRightOut: null, bodyTop: 'body', bodyBottom: 'body', belowFeet: null, far: null,
      });
    }
  });
});

test.describe('점수 계산 Game.fire', () => {
  // 움직이지 않는 표적을 직접 만들어 정확히 조준 (줌 0 + 난수 0 이면 흔들림·탄퍼짐 없음)
  const fixture = `(SD, targets) => {
    const sched = targets.map((t, i) => Object.assign({ id: i, t0: 0, tier: 0, v: 0, y0: 600, s: 1, dir: 1, A: 0, w: 1, B: 0, w2: 1, ph: 0, x0: 400, life: 1000 }, t));
    const g = new SD.Game(sched);
    const zero = () => 0;
    const shoot = (t, x, y) => { g.zi = 0; g.ax = x; g.ay = y; return g.fire(t, zero); };
    return { g, shoot };
  }`;

  test('연속 명중 보너스 +10%씩 최대 +50%, 5점 단위 반올림', async ({ page }) => {
    const r = await inGame(page, (SD, fx) => {
      const tg = Array.from({ length: 8 }, (_, i) => ({ tier: 3, x0: 100 + i * 150 }));
      const { g, shoot } = eval(fx)(SD, tg);
      const pts = tg.map((t, i) => shoot(i, t.x0, 600).pts);
      return { pts, score: g.score, hits: g.hits, fired: g.fired, streak: g.streak, best: g.best, th: g.th };
    }, fixture);
    expect(r.pts).toEqual([500, 550, 600, 650, 700, 750, 750, 750]);
    expect(r.score).toBe(5250);
    expect(r).toMatchObject({ hits: 8, fired: 8, streak: 8, best: 8, th: [0, 0, 0, 8] });
  });

  test('헤드샷 ×1.5, 단계별 점수, 반올림 (350×1.5×1.1=577.5 → 580)', async ({ page }) => {
    const r = await inGame(page, (SD, fx) => {
      const tg = [{ tier: 0, x0: 100 }, { tier: 2, x0: 300 }, { tier: 1, x0: 500 }, { tier: 3, x0: 700 }];
      const { g, shoot } = eval(fx)(SD, tg);
      const a = shoot(0, 100, 550);   // 머리 (y0 - 50)
      const b = shoot(1, 300, 550);   // 머리, 연속 2
      const miss = shoot(2, 1500, 100);
      const c = shoot(3, 500, 600);   // 몸통, 연속 끊김 후 1
      const d = shoot(4, 700, 550);   // 머리, 연속 2
      return { shots: [a, b, miss, c, d], score: g.score, heads: g.heads, hits: g.hits, fired: g.fired, best: g.best, streak: g.streak, th: g.th };
    }, fixture);
    expect(r.shots.map(s => [s.hit, s.head, s.pts])).toEqual([[1, 1, 150], [1, 1, 580], [0, 0, 0], [1, 0, 200], [1, 1, 825]]);
    expect(r).toMatchObject({ score: 1755, heads: 3, hits: 4, fired: 5, best: 2, streak: 2, th: [1, 1, 1, 1] });
  });

  test('장전 0.9초: 그 전엔 발사 안 됨(null), 발사 수도 그대로', async ({ page }) => {
    const r = await inGame(page, (SD, fx) => {
      const { g, shoot } = eval(fx)(SD, [{ x0: 1500 }]);
      const out = [shoot(0, 100, 100), shoot(0.5, 100, 100), shoot(0.899, 100, 100), shoot(0.9, 100, 100)];
      return { out: out.map(s => s && s.t), fired: g.fired, ready: [g.ready(1.79), g.ready(1.81)] };
    }, fixture);
    expect(r.out).toEqual([0, null, null, 0.9]);
    expect(r.fired).toBe(2);
    expect(r.ready).toEqual([false, true]);
  });

  test('맞힌 표적은 다시 맞지 않고, 겹치면 가까운(y 큰) 표적이 먼저 맞음', async ({ page }) => {
    const r = await inGame(page, (SD, fx) => {
      const { g, shoot } = eval(fx)(SD, [{ x0: 400, y0: 600 }, { x0: 400, y0: 620 }]);
      const a = shoot(0, 400, 610), b = shoot(1, 400, 610), c = shoot(2, 400, 610);
      return { hits: [a, b, c].map(s => s.hit), dead: g.deadList, streak: g.streak };
    }, fixture);
    expect(r.dead).toEqual([1, 0]);
    expect(r.hits).toEqual([1, 1, 0]);
    expect(r.streak).toBe(0);
  });

  test('줌 없이 쏘면 탄이 퍼짐 (난수 0.5 → 왼쪽으로 80×√0.5)', async ({ page }) => {
    const s = await inGame(page, SD => {
      const g = new SD.Game([]); g.zi = 0; g.ax = 800; g.ay = 500;
      return g.fire(1, () => 0.5);
    });
    expect(s).toEqual({ x: Math.round(800 - 80 * Math.sqrt(0.5)), y: 500, t: 1, hit: 0, head: 0, pts: 0 });
  });

  test('줌 상태에선 조준점이 흔들리고(sway), 발사 후 자동으로 줌 해제', async ({ page }) => {
    const r = await inGame(page, SD => {
      const g = new SD.Game([]); g.swSeed = 3; g.ax = 800; g.ay = 500;
      const sw0 = g.sway(2); g.zi = 1; const sw1 = g.sway(2); g.zi = 2; const sw2 = g.sway(2);
      g.zi = 2; const shot = g.fire(2, () => 0);
      return { sw0, sw1: sw1.map(v => +v.toFixed(6)), sw2: sw2.map(v => +v.toFixed(6)), shot, ziAfter: g.zi };
    });
    expect(r.sw0).toEqual([0, 0]);
    expect(r.sw2[0]).toBeCloseTo(r.sw1[0] * 1.5, 5);
    expect(r.sw2[1]).toBeCloseTo(r.sw1[1] * 1.5, 5);
    expect(r.shot.x).toBe(Math.round(800 + r.sw2[0]));
    expect(r.shot.y).toBe(Math.round(500 + r.sw2[1]));
    expect(r.ziAfter).toBe(0);
  });

  test('발사 기록은 1.5초 지난 것부터 지워짐', async ({ page }) => {
    const r = await inGame(page, SD => {
      const g = new SD.Game([]); g.ax = 100; g.ay = 100;
      for (const t of [0, 1, 2, 3]) g.fire(t, () => 0);
      return g.shots.map(s => s.t);
    });
    expect(r).toEqual([2, 3]);
  });

  test('공유 화면: 남이 먼저 맞힌(blocked) 표적은 못 맞히고, 내가 맞히면 blocked 에도 추가', async ({ page }) => {
    const r = await inGame(page, (SD, fx) => {
      const { g, shoot } = eval(fx)(SD, [{ x0: 300 }, { x0: 900 }]);
      g.blocked = new Set([0]);
      const a = shoot(0, 300, 600), b = shoot(1, 900, 600);
      return { a: a.hit, b: b.hit, blocked: Array.from(g.blocked), dead: g.deadList };
    }, fixture);
    expect(r).toEqual({ a: 0, b: 1, blocked: [0, 1], dead: [1] });
  });
});

test.describe('봇 AI (난수 고정 → 항상 같은 결과)', () => {
  const simulate = `(SD, o) => {
    const orig = Math.random; Math.random = SD.mulberry32(999);
    try {
      const sched = SD.buildSchedule(o.seed, SD.GAME_DUR);
      const shared = o.skills.length > 1 && o.shared ? new Set() : null;
      const bots = o.skills.map((k, i) => {
        const g = new SD.Game(sched); g.auto = true; if (shared) g.blocked = shared;
        return new SD.Bot(g, k, (o.seed ^ ((i + 1) * 99991)) >>> 0);
      });
      const dt = 1 / 60;
      for (let i = 0; i * dt < SD.GAME_DUR; i++) for (const b of bots) b.update(i * dt, dt);
      return bots.map(b => ({ score: b.g.score, hits: b.g.hits, fired: b.g.fired, heads: b.g.heads, best: b.g.best, th: b.g.th, kills: b.g.deadList.length }));
    } finally { Math.random = orig; }
  }`;

  for (const [key, v] of [['easy', 0.4], ['normal', 0.62], ['hard', 0.86]]) {
    test(`봇 ${key} 혼자 60초`, async ({ page }) => {
      const r = await inGame(page, (SD, a) => eval(a.simulate)(SD, { seed: 2024, skills: [a.v] }), { simulate, v });
      expect(r[0].fired).toBeGreaterThan(0);
      expect(json(r[0])).toMatchSnapshot(`bot-${key}-2024.json`);
    });
  }

  // 주의: 지금 코드에서는 '쉬움' 봇이 '보통' 봇보다 평균 점수가 높다 (쉬움은 거의 다 맞히고, 보통은 머리를 노리다 빗나감).
  // 의도와 다를 수 있지만 "현재 동작"이므로 그대로 고정한다. 봇 밸런스를 일부러 고치면 스냅샷을 갱신할 것.
  test('봇 난이도별 평균 점수 (시드 4개)', async ({ page }) => {
    const avg = await inGame(page, (SD, simulate) => {
      const sum = [0, 0, 0];
      for (const seed of [11, 22, 33, 44]) [0.4, 0.62, 0.86].forEach((k, i) => { sum[i] += eval(simulate)(SD, { seed, skills: [k] })[0].score; });
      return { easy: sum[0] / 4, normal: sum[1] / 4, hard: sum[2] / 4 };
    }, simulate);
    expect(avg.hard).toBeGreaterThanOrEqual(avg.normal);
    expect(json(avg)).toMatchSnapshot('bot-skill-averages.json');
  });

  test('공유 화면 봇 3명: 같은 표적을 두 명이 맞히지 않음', async ({ page }) => {
    const r = await inGame(page, (SD, simulate) => eval(simulate)(SD, { seed: 31337, skills: [0.4, 0.62, 0.86], shared: true }), simulate);
    expect(json(r)).toMatchSnapshot('bots-shared-31337.json');
    const kills = r.reduce((a, b) => a + b.kills, 0);
    const hits = r.reduce((a, b) => a + b.hits, 0);
    expect(kills).toBe(hits);
  });
});

test.describe('작은 도구 함수', () => {
  test('genCode: 헷갈리는 글자(I, O, 0, 1) 없는 5자리', async ({ page }) => {
    const codes = await inGame(page, SD => Array.from({ length: 300 }, () => SD.genCode()));
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(new Set(codes).size).toBeGreaterThan(290);
  });

  test('esc: HTML 특수문자 이스케이프', async ({ page }) => {
    const r = await inGame(page, SD => [SD.esc(`<img src=x onerror="a('b')">&`), SD.esc(42), SD.esc('')]);
    expect(r).toEqual(['&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;', '42', '']);
  });
});
