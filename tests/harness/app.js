// 테스트가 게임에 닿는 "접점"을 모두 이 파일에 모아 둔다.
// 리팩토링으로 화면 id 나 내부 함수 이름이 바뀌면, 테스트 본문이 아니라 이 파일만 고치면 된다.
//   - SEL     : 화면 요소 선택자 (DOM id)
//   - SEAM    : 게임 내부 함수·상태에 접근하는 통로 (window.__SD__)
//   - openGame: 가짜 PeerJS/Supabase/QR + 시간 가속을 깔고 게임 페이지를 연다
const { expect } = require('@playwright/test');
const { installFakes } = require('./fakes');

// 테스트할 페이지 (기본: 서비스 중인 index.html). 예) SD_PAGE=legacy/sniper-duel-legacy.html
const PAGE = process.env.SD_PAGE || 'index.html';

const SEL = {
  menu: '#menu', lobby: '#lobby', play: '#play', results: '#results', ending: '#ending', soloIntro: '#soloIntro',
  nameIn: '#nameIn', codeIn: '#codeIn', menuMsg: '#menuMsg',
  btnHost: '#btnHost', btnJoin: '#btnJoin', btnSolo: '#btnSolo', btnSoloOk: '#btnSoloOk', btnSoloCancel: '#btnSoloCancel',
  inviteBanner: '#inviteBanner', bannerCode: '#bannerCode', btnQuickJoin: '#btnQuickJoin',
  roomsCard: '#roomsCard', roomsStatus: '#roomsStatus', roomList: '#roomList',
  boardMenu: '#boardMenu', boardRes: '#boardRes',
  lobbyCode: '#lobbyCode', lobbyMsg: '#lobbyMsg', lobbyCount: '#lobbyCount', slots: '#slots',
  btnCopy: '#btnCopy', btnLeave: '#btnLeave', hostCtl: '#hostCtl', clientWait: '#clientWait', clientView: '#clientView', clientDur: '#clientDur',
  viewDesc: '#viewDesc', btnStart: '#btnStart', startHint: '#startHint',
  invite: '#invite', qrBox: '#qrBox', inviteLink: '#inviteLink', btnCopyLink: '#btnCopyLink', shareWrap: '#shareWrap', shareUrl: '#shareUrl', inviteHint: '#inviteHint',
  timer: '#timer', ranks: '#ranks', grid: '#grid', pane: '#grid .pane', btnQuit: '#btnQuit',
  btnEndSkip: '#btnEndSkip',
  resTitle: '#resTitle', resWinner: '#resWinner', resTable: '#resTable', resBtns: '#resBtns',
  rMenu: '#rMenu', rLobby: '#rLobby', rAgain: '#rAgain', rEnding: '#rEnding',
  mode: n => `[data-mode="${n}"]`, view: v => `[data-view="${v}"]`, bot: k => `[data-bot="${k}"]`,
  boardTab: (board, tab) => `[data-board="${board}"] [data-tab="${tab}"]`,
  removeBot: '[data-rm]', joinCode: code => `[data-joincode="${code}"]`,
};

// 게임 내부로 들어가는 통로. 페이지 전역(최상위 const/let/function/class)을 그대로 노출한다.
// 리팩토링 후 모듈로 바뀌면 게임 쪽에서 같은 이름으로 window.__SD__ 를 열어 주거나 이 문자열을 고친다.
const SEAM = `window.__SD__ = window.__SD__ || {
  mulberry32, buildSchedule, tpos, activeTargets, hitTest, Game, Bot, genCode, esc,
  TIERS, ZOOMS, BOLT, HEAD_MULT, NOSCOPE_SPREAD, GAME_DUR, WORLD_W, WORLD_H,
  get match() { return match; }, get net() { return net; }, get lobby() { return lobby; },
}; true;`;

const CDN = /^https?:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//;
const FAKE_SB_CONFIG = "window.SD_CONFIG={SUPABASE_URL:'https://fake-project.supabase.co',SUPABASE_ANON_KEY:'fake-anon-key'};";
const NO_SB_CONFIG = "window.SD_CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:''};";

/**
 * 게임 페이지 열기.
 * @param {import('@playwright/test').Page} page
 * @param {{warp?:number, peer?:boolean, supabase?:boolean|object, storage?:object, query?:string, name?:string, confirm?:boolean}} [opts]
 *   warp     : 시간 가속 배수 (기본 1). 60초 경기를 빨리 끝내려면 15~20
 *   peer     : 가짜 PeerJS 사용 (기본 true). false 면 PeerJS 로드 실패 = 오프라인
 *   supabase : 가짜 Supabase (기본 false = 설정 없음). { scores:[...], failSelect:'msg', failInsert:'msg' }
 *   storage  : 미리 넣어 둘 localStorage 값 { key: value }
 *   query    : 주소 뒤에 붙일 쿼리 (예: '?join=ABCDE')
 *   name     : 열자마자 닉네임 입력
 */
async function openGame(page, opts = {}) {
  const o = { warp: 1, peer: true, supabase: false, ...opts };
  page.on('pageerror', e => { (page.__errors = page.__errors || []).push(String(e && e.stack || e)); });
  // 외부 CDN 은 모두 막고(빈 스크립트) 가짜로 대체, 실제 Supabase 로는 절대 요청이 나가지 않게
  await page.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked in tests */' }));
  await page.route(/supabase\.co/, r => r.abort());
  await page.route(/\/config\.js(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: o.supabase ? FAKE_SB_CONFIG : NO_SB_CONFIG }));
  await page.addInitScript(installFakes, { warp: o.warp, peer: o.peer, supabase: o.supabase, storage: o.storage, confirm: o.confirm });
  await page.goto(PAGE + (o.query || ''));
  await expect(page.locator(SEL.menu)).toBeVisible();
  // 내부 이름이 다른 페이지(SD_PAGE)라도 화면만 쓰는 테스트는 돌 수 있게, 통로 연결 실패는 inGame 에서 알린다
  await page.evaluate(SEAM).catch(() => {});
  if (o.name != null) await page.fill(SEL.nameIn, o.name);
  return page;
}

/** 페이지에서 일어난 처리되지 않은 예외 목록 */
const pageErrors = page => page.__errors || [];

/** 게임 내부 상태 읽기: fn 은 (SD) => 값 형태로, 페이지 안에서 실행된다 */
async function inGame(page, fn, arg) {
  await page.evaluate(SEAM).catch(e => { throw new Error('게임 내부 통로(SEAM) 연결 실패 — tests/harness/app.js 의 SEAM 이름을 확인하세요: ' + e.message); });
  return page.evaluate(([src, a]) => (0, eval)('(' + src + ')')(window.__SD__, a), [fn.toString(), arg]);
}

/* ---------------- 자주 쓰는 동작 ---------------- */
async function startSolo(page) {
  await page.click(SEL.btnSolo);
  await expect(page.locator(SEL.soloIntro)).toBeVisible();
  await page.click(SEL.btnSoloOk);
  await expect(page.locator(SEL.play)).toBeVisible();
}

async function createRoom(page) {
  await page.click(SEL.btnHost);
  await expect(page.locator(SEL.lobby)).toBeVisible();
}

/** 가짜 PeerJS 로 방을 만들고 방 코드가 화면에 뜰 때까지 기다린 뒤 코드를 돌려준다 */
async function createOnlineRoom(page) {
  await createRoom(page);
  await expect(page.locator(SEL.lobbyCode)).toHaveText(/^[A-Z0-9]{5}$/);
  return (await page.locator(SEL.lobbyCode).textContent()).trim();
}

async function joinByCode(page, code) {
  await page.fill(SEL.codeIn, code);
  await page.click(SEL.btnJoin);
}

/** 경기 중 내 조준점을 화면 안의 표적 몸통에 정확히 맞추고 쏜다 (명중할 때까지 재시도). 맞힌 발사 기록을 돌려준다 */
async function forceHit(page, { timeout = 20_000 } = {}) {
  let shot = null;
  await expect.poll(async () => {
    shot = await inGame(page, SD => {
      const m = SD.match; if (!m || m.ended) return null;
      const t = (performance.now() - m.startPerf) / 1000, g = m.own;
      if (t < 0 || t >= m.dur || !g.ready(t)) return null;
      const o = SD.activeTargets(m.sched, g.dq(), t).find(o => o.x > 100 && o.x < SD.WORLD_W - 100);
      if (!o) return null;
      g.zi = 0; g.ax = o.x; g.ay = o.y;
      const s = g.fire(t, () => 0);
      return s && s.hit ? Object.assign({ id: g.deadList[g.deadList.length - 1] }, s) : null;
    });
    return shot;
  }, { timeout, intervals: [50] }).not.toBeNull();
  return shot;
}

/** 결과 창이 열릴 때까지 기다림 (여럿이면 엔딩을 건너뜀) */
async function waitResults(page, { skipEnding = true, timeout = 30_000 } = {}) {
  const ending = page.locator(SEL.ending), results = page.locator(SEL.results);
  await expect.poll(async () => (await ending.isVisible()) || (await results.isVisible()), { timeout }).toBe(true);
  // 그사이 엔딩이 저절로 끝났을 수도 있으니 버튼 클릭은 실패해도 넘어간다
  if (skipEnding && await ending.isVisible()) await page.locator(SEL.btnEndSkip).click({ timeout: 3000 }).catch(() => {});
  await expect(results).toBeVisible({ timeout });
}

/** 결과표를 [{rank, name, score, hitsFired, acc, heads, best, tiers[4], tags}] 로 읽기 */
async function readResults(page) {
  return page.locator(`${SEL.resTable} tbody tr`).evaluateAll(rows => rows.map(tr => {
    const td = Array.from(tr.querySelectorAll('td')).map(t => t.textContent.trim());
    const nameCell = tr.querySelectorAll('td')[1];
    const tags = Array.from(nameCell.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
    const name = Array.from(nameCell.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return {
      rank: Number(td[0]), name, score: Number(td[2].replace(/,/g, '')), hitsFired: td[3], acc: td[4],
      heads: Number(td[5]), best: Number(td[6]), tiers: td.slice(7, 11).map(Number), me: tr.classList.contains('me'), tags,
    };
  }));
}

/** 랭킹 표를 2차원 텍스트 배열로 읽기 */
async function readBoard(page, sel) {
  return page.locator(`${sel} tbody tr`).evaluateAll(rows => rows.map(tr => Array.from(tr.querySelectorAll('td')).map(t => t.textContent.trim())));
}

module.exports = {
  PAGE, SEL, SEAM, openGame, pageErrors, inGame,
  startSolo, createRoom, createOnlineRoom, joinByCode, forceHit, waitResults, readResults, readBoard,
};
