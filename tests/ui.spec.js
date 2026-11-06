// 화면 흐름 특성 테스트 (혼자 하기 · 오프라인 봇 대결 · 대기실 · 랭킹 · 초대 링크).
// 네트워크(CDN, Supabase)는 모두 막고 가짜로 대체한다. 시간이 오래 걸리는 경기는 시간 가속(warp)으로 돌린다.
const { test, expect } = require('@playwright/test');
const { SEL, openGame, inGame, pageErrors, startSolo, createRoom, createOnlineRoom, waitResults, readResults, readBoard, PAGE } = require('./harness/app');

const FAST = 20; // 60초 경기 → 약 3초 (봇이 없는 경기용)
// 봇이 있는 경기는 3배까지만: 게임이 프레임당 시간 변화를 0.05초로 자르기 때문에 더 빠르면 봇이 표적을 못 따라감
const BOT_WARP = 3; // 60초 경기 → 약 20초

test.afterEach(async ({ page }) => {
  expect(pageErrors(page), '페이지 스크립트 오류').toEqual([]);
});

const records = page => page.evaluate(() => JSON.parse(localStorage.getItem('sd_records_v1') || '[]'));
const settings = page => page.evaluate(() => JSON.parse(localStorage.getItem('sd_settings') || '{}'));

test.describe('메뉴', () => {
  test('첫 화면: 메뉴만 보이고 기록 없음 안내', async ({ page }) => {
    await openGame(page, { peer: false });
    for (const s of [SEL.lobby, SEL.play, SEL.results, SEL.ending, SEL.soloIntro, SEL.inviteBanner]) await expect(page.locator(s)).toBeHidden();
    await expect(page.locator(SEL.roomsCard)).toBeHidden(); // Supabase 설정이 없으면 열린 방 카드 숨김
    await expect(page.locator(SEL.boardMenu)).toContainText('아직 기록이 없습니다');
    await expect(page.locator(SEL.boardTab('boardMenu', 'total'))).toHaveClass(/sel/);
    await expect(page).toHaveTitle('Sniper Duel');
  });

  test('닉네임: 입력하면 저장되고 새로고침해도 유지, 최대 12자', async ({ page }) => {
    await openGame(page, { peer: false });
    await page.locator(SEL.nameIn).pressSequentially('스나이퍼1234567890');
    await expect(page.locator(SEL.nameIn)).toHaveValue('스나이퍼12345678');
    expect((await settings(page)).name).toBe('스나이퍼12345678');
    await page.reload();
    await expect(page.locator(SEL.nameIn)).toHaveValue('스나이퍼12345678');
  });

  test('방 참가: 5자리가 아니면 안내', async ({ page }) => {
    await openGame(page);
    await page.fill(SEL.codeIn, 'ABCD');
    await page.click(SEL.btnJoin);
    await expect(page.locator(SEL.menuMsg)).toHaveText('방 코드 5자리를 입력하세요.');
  });

  test('방 참가: PeerJS를 못 불러오면 안내', async ({ page }) => {
    await openGame(page, { peer: false });
    await page.fill(SEL.codeIn, 'ABCDE');
    await page.locator(SEL.codeIn).press('Enter');
    await expect(page.locator(SEL.menuMsg)).toContainText('PeerJS를 불러오지 못했습니다');
  });

  test('초대 링크(?join=코드): 배너와 코드 자동 입력, 닉네임 없으면 바로 참가 대신 안내', async ({ page }) => {
    await openGame(page, { query: '?join=ab-cd9' });
    await expect(page.locator(SEL.inviteBanner)).toBeVisible();
    await expect(page.locator(SEL.bannerCode)).toHaveText('ABCD9');
    await expect(page.locator(SEL.codeIn)).toHaveValue('ABCD9');
    await expect(page.locator(SEL.nameIn)).toBeFocused();
    await page.click(SEL.btnQuickJoin);
    await expect(page.locator(SEL.menuMsg)).toHaveText('닉네임을 입력한 뒤 [바로 참가]를 누르세요.');
  });

  test('초대 링크 코드가 5자리가 아니면 배너 없음', async ({ page }) => {
    await openGame(page, { query: '?join=AB1' });
    await expect(page.locator(SEL.inviteBanner)).toBeHidden();
    await expect(page.locator(SEL.codeIn)).toHaveValue('');
  });
});

test.describe('혼자 연습', () => {
  test('조작법 팝업: 취소 / Esc / 바깥 클릭으로 닫힘, 게임은 시작 안 함', async ({ page }) => {
    await openGame(page, { peer: false });
    const intro = page.locator(SEL.soloIntro);
    await page.click(SEL.btnSolo);
    await expect(intro).toBeVisible();
    await expect(page.locator(SEL.btnSoloOk)).toBeFocused();
    await expect(intro).toContainText('우클릭');
    await expect(intro).toContainText('좌클릭');
    await page.click(SEL.btnSoloCancel);
    await expect(intro).toBeHidden();
    await page.click(SEL.btnSolo);
    await page.keyboard.press('Escape');
    await expect(intro).toBeHidden();
    await page.click(SEL.btnSolo);
    await page.mouse.click(5, 5);
    await expect(intro).toBeHidden();
    await expect(page.locator(SEL.menu)).toBeVisible();
    expect(await inGame(page, SD => SD.match)).toBeNull();
  });

  test('시작: 화면 1칸, 카운트다운 "준비" 후 1분 타이머', async ({ page }) => {
    await openGame(page, { peer: false, name: '연습생' });
    await startSolo(page);
    await expect(page.locator(SEL.menu)).toBeHidden();
    await expect(page.locator(SEL.grid)).toHaveClass('n1');
    await expect(page.locator(SEL.pane)).toHaveCount(1);
    await expect(page.locator(`${SEL.pane}.me`)).toHaveCount(1);
    await expect(page.locator(SEL.timer)).toHaveText('준비');
    await expect(page.locator(SEL.timer)).toHaveText(/^00:(59|60)|01:00$/, { timeout: 6000 });
    await expect(page.locator(SEL.ranks)).toContainText('연습생');
    await expect(page.locator(SEL.ranks)).toContainText('(나)');
    const m = await inGame(page, SD => ({ dur: SD.match.dur, players: SD.match.players, role: SD.net.role, shared: SD.match.shared }));
    expect(m).toEqual({ dur: 60, players: [{ id: 'me', name: '연습생', bot: false }], role: 'solo', shared: false });
  });

  test('조작: 첫 클릭은 마우스 잠금만, 그다음 좌클릭 발사 · 우클릭 줌 순환 · 휠 줌 · 마우스로 조준 이동', async ({ page }) => {
    await openGame(page, { peer: false });
    await startSolo(page);
    await expect(page.locator(SEL.timer)).not.toHaveText('준비', { timeout: 6000 });
    const box = await page.locator(`${SEL.pane}.me canvas`).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const st = () => inGame(page, SD => ({ lock: document.pointerLockElement === SD.match.ownCanvas, fired: SD.match.own.fired, zi: SD.match.own.zi, ax: SD.match.own.ax, ay: SD.match.own.ay }));
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await expect.poll(st).toMatchObject({ lock: true, fired: 0 });
    // 잠금 직후 첫 클릭이 가끔 브라우저에서 무시되므로, 발사될 때까지 클릭 (짧은 간격 → 장전 0.9초 때문에 최대 1발)
    await expect.poll(async () => { await page.mouse.click(cx, cy); return (await st()).fired; }, { intervals: [100, 100, 200, 200] }).toBe(1);
    // 우클릭: 0 → 2.5배 → 5배 → 해제
    const zis = [];
    for (let i = 0; i < 3; i++) { await page.mouse.click(cx, cy, { button: 'right' }); zis.push((await st()).zi); }
    expect(zis).toEqual([1, 2, 0]);
    // 휠: 위로 굴리면 확대, 아래로 축소 (0~2 사이)
    await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100);
    expect((await st()).zi).toBe(2);
    await page.mouse.wheel(0, 100);
    expect((await st()).zi).toBe(1);
    await page.mouse.wheel(0, 100); await page.mouse.wheel(0, 100);
    expect((await st()).zi).toBe(0);
    // 발사 직후 0.9초 안에 또 쏘면 안 나감(장전)
    await page.waitForTimeout(1000);
    await page.mouse.click(cx, cy); await page.mouse.click(cx, cy);
    await expect.poll(async () => (await st()).fired).toBe(2);
    // 마우스 이동 → 조준점 이동 (월드 범위 안으로 제한)
    const before = await st();
    await page.mouse.move(cx + 120, cy + 60);
    await expect.poll(async () => (await st()).ax).toBeGreaterThan(before.ax);
    expect((await st()).ay).toBeGreaterThan(before.ay);
    for (let i = 0; i < 30; i++) await page.mouse.move(cx + 2000, cy + 2000);
    const edge = await st();
    expect(edge.ax).toBeLessThanOrEqual(1600);
    expect(edge.ay).toBeLessThanOrEqual(900);
  });

  test('끝까지: 결과 창(엔딩 없음) → 기록 저장 → 메뉴 랭킹 반영 → 다시 하기', async ({ page }) => {
    await openGame(page, { peer: false, warp: FAST, name: '솔로왕' });
    await startSolo(page);
    await waitResults(page, { skipEnding: false });
    await expect(page.locator(SEL.ending)).toBeHidden();
    await expect(page.locator(SEL.resTitle)).toHaveText('연습 결과');
    await expect(page.locator(SEL.resWinner)).toHaveText(/^총점 [\d,]+점$/);
    const rows = await readResults(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rank: 1, name: '솔로왕', score: 0, hitsFired: '0/0', acc: '0%', heads: 0, best: 0, tiers: [0, 0, 0, 0], me: true });
    await expect(page.locator(`${SEL.resTable} thead th`)).toHaveText(['순위', '플레이어', '총점', '명중/발사', '명중률', '헤드샷', '최대 연속', '느림', '보통', '빠름', '매우빠름']);
    await expect(page.locator(`${SEL.resBtns} button`)).toHaveText(['메인으로', '다시 하기']);
    const rec = await records(page);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ n: '솔로왕', s: 0, h: 0, f: 0, m: '솔로 1분' });
    expect(typeof rec[0].d).toBe('number');
    await expect(page.locator(SEL.boardRes)).toContainText('솔로왕');
    await expect(page.locator(SEL.timer)).toHaveText('00:00');

    await page.click(SEL.rAgain);
    await expect(page.locator(SEL.results)).toBeHidden();
    await expect(page.locator(SEL.play)).toBeVisible();
    await waitResults(page);
    expect(await records(page)).toHaveLength(2);
    await page.click(SEL.rMenu);
    await expect(page.locator(SEL.menu)).toBeVisible();
    expect(await readBoard(page, SEL.boardMenu)).toEqual([['1', '솔로왕', '0', '2', '0', '0', '0%']]);
  });

  test('경기 중 [나가기]: 확인하면 메뉴로, 취소하면 계속', async ({ page }) => {
    await openGame(page, { peer: false, confirm: false });
    await startSolo(page);
    await page.click(SEL.btnQuit);
    await expect(page.locator(SEL.play)).toBeVisible();
    expect(await page.evaluate(() => window.__dialogs)).toEqual([{ type: 'confirm', msg: '게임에서 나가시겠습니까?' }]);
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click(SEL.btnQuit);
    await expect(page.locator(SEL.menu)).toBeVisible();
    expect(await inGame(page, SD => SD.match)).toBeNull();
    expect(await records(page)).toEqual([]);
  });
});

test.describe('대기실 (오프라인: PeerJS 없음 → 봇 대결만)', () => {
  test('방 만들기: 오프라인 표시, 호스트 설정, 1명 더 필요', async ({ page }) => {
    await openGame(page, { peer: false, name: '방장' });
    await createRoom(page);
    await expect(page.locator(SEL.lobbyCode)).toHaveText('오프라인');
    await expect(page.locator(SEL.lobbyMsg)).toContainText('PeerJS를 불러오지 못해 오프라인 모드입니다');
    await expect(page.locator(SEL.btnCopy)).toBeDisabled();
    await expect(page.locator(SEL.invite)).toBeHidden();
    await expect(page.locator(SEL.hostCtl)).toBeVisible();
    await expect(page.locator(SEL.clientWait)).toBeHidden();
    await expect(page.locator(SEL.lobbyCount)).toHaveText('1 / 2');
    await expect(page.locator(`${SEL.slots} .slot`)).toHaveCount(4);
    await expect(page.locator(`${SEL.slots} .slot`).nth(0)).toContainText('방장 (나)');
    await expect(page.locator(`${SEL.slots} .slot`).nth(0)).toContainText('호스트');
    await expect(page.locator(`${SEL.slots} .slot`).nth(1)).toContainText('빈 자리');
    await expect(page.locator(`${SEL.slots} .slot`).nth(2)).toHaveClass(/off/);
    await expect(page.locator(SEL.btnStart)).toBeDisabled();
    await expect(page.locator(SEL.startHint)).toHaveText('1명 더 필요합니다 — 친구를 초대하거나 봇을 추가하세요.');
    await expect(page.locator(SEL.mode(2))).toHaveClass(/sel/);
    await expect(page.locator(SEL.view('split'))).toHaveClass(/sel/);
    await expect(page.locator(SEL.viewDesc)).toContainText('2·3·4분할');
  });

  test('봇 추가·제거, 인원 설정, 화면 모드 전환', async ({ page }) => {
    await openGame(page, { peer: false, name: '방장' });
    await createRoom(page);
    await page.click(SEL.bot('easy'));
    await expect(page.locator(`${SEL.slots} .slot`).nth(1)).toContainText('BOT 알파');
    await expect(page.locator(`${SEL.slots} .slot`).nth(1)).toContainText('봇 · 쉬움');
    await expect(page.locator(SEL.btnStart)).toBeEnabled();
    await expect(page.locator(SEL.startHint)).toHaveText('준비 완료! 게임을 시작하세요.');
    for (const k of ['easy', 'normal', 'hard']) await expect(page.locator(SEL.bot(k))).toBeDisabled();

    await page.click(SEL.mode(4));
    await expect(page.locator(SEL.lobbyCount)).toHaveText('2 / 4');
    await page.click(SEL.bot('normal'));
    await page.click(SEL.bot('hard'));
    await expect(page.locator(`${SEL.slots} .slot .nm`)).toHaveText(['방장 (나)', 'BOT 알파', 'BOT 브라보', 'BOT 찰리']);
    await expect(page.locator(`${SEL.slots} .slot .tg`)).toHaveText(['호스트', '봇 · 쉬움', '봇 · 보통', '봇 · 어려움']);
    for (const n of [2, 3]) await expect(page.locator(SEL.mode(n))).toBeDisabled();

    // 가운데 봇 제거 → 이름이 비면 다음에 추가하는 봇이 그 이름을 다시 씀
    await page.locator(SEL.removeBot).nth(1).click();
    await expect(page.locator(`${SEL.slots} .slot .nm`).nth(2)).toHaveText('BOT 찰리');
    await expect(page.locator(SEL.lobbyCount)).toHaveText('3 / 4');
    await page.click(SEL.bot('easy'));
    await expect(page.locator(`${SEL.slots} .slot .nm`).nth(3)).toHaveText('BOT 브라보');
    const ids = await inGame(page, SD => SD.lobby.players.map(p => [p.id, p.skill, p.skillKey]));
    expect(ids).toEqual([['H', undefined, undefined], ['B1', 0.4, 'easy'], ['B3', 0.86, 'hard'], ['B4', 0.4, 'easy']]);

    await page.click(SEL.view('shared'));
    await expect(page.locator(SEL.view('shared'))).toHaveClass(/sel/);
    await expect(page.locator(SEL.mode(3))).toHaveText('3인');
    await expect(page.locator(SEL.viewDesc)).toContainText('먼저 맞힌 사람만 점수');
    await page.click(SEL.view('split'));
    await expect(page.locator(SEL.mode(3))).toHaveText('3인 (3분할)');

    await page.click(SEL.btnLeave);
    await expect(page.locator(SEL.menu)).toBeVisible();
  });

  test('분할 화면 봇 2명 대결: 3분할 → 엔딩 → 결과 → 엔딩 다시 보기 → 대기실로', async ({ page }) => {
    test.setTimeout(90_000);
    await openGame(page, { peer: false, warp: BOT_WARP, name: '방장' });
    await createRoom(page);
    await page.click(SEL.mode(3));
    await page.click(SEL.bot('hard'));
    await page.click(SEL.bot('hard'));
    await page.click(SEL.btnStart);
    await expect(page.locator(SEL.play)).toBeVisible();
    await expect(page.locator(SEL.grid)).toHaveClass('n3');
    await expect(page.locator(SEL.pane)).toHaveCount(3);
    await expect(page.locator(`${SEL.pane}.me`)).toHaveCount(1);
    await expect(page.locator(`${SEL.ranks} .chip`)).toHaveCount(3);

    await expect(page.locator(SEL.ending)).toBeVisible({ timeout: 40_000 });
    await expect(page.locator(SEL.results)).toBeHidden();
    await page.click(SEL.btnEndSkip);
    await expect(page.locator(SEL.results)).toBeVisible();
    await expect(page.locator(SEL.resTitle)).toHaveText('경기 결과');
    const rows = await readResults(page);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map(r => r.score)).toEqual(rows.map(r => r.score).slice().sort((a, b) => b - a));
    expect(rows.map(r => r.name).sort()).toEqual(['BOT 브라보', 'BOT 알파', '방장']);
    const me = rows.find(r => r.name === '방장');
    expect(me.me).toBe(true);
    for (const r of rows.filter(r => r.name.startsWith('BOT'))) expect(r.tags).toContain('BOT');
    expect(rows.filter(r => r.name.startsWith('BOT')).some(r => r.score > 0)).toBe(true); // 어려움 봇은 1분 동안 뭐라도 맞힘
    await expect(page.locator(SEL.resWinner)).toContainText(`🏆 우승: ${rows[0].name}`);
    await expect(page.locator(`${SEL.resBtns} button`)).toHaveText(['엔딩 다시 보기', '메인으로', '대기실로 (다시 대결)']);

    // 기록은 사람만 저장
    const rec = await records(page);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ n: '방장', m: '3인 1분' });

    await page.click(SEL.rEnding);
    await expect(page.locator(SEL.ending)).toBeVisible();
    await expect(page.locator(SEL.results)).toBeHidden();
    await expect(page.locator(SEL.results)).toBeVisible({ timeout: 10_000 }); // 9초(가속) 뒤 자동으로 결과
    await expect(page.locator(SEL.ending)).toBeHidden();

    await page.click(SEL.rLobby);
    await expect(page.locator(SEL.lobby)).toBeVisible();
    await expect(page.locator(SEL.results)).toBeHidden();
    await expect(page.locator(`${SEL.slots} .slot .nm`)).toHaveText(['방장 (나)', 'BOT 알파', 'BOT 브라보', '—']);
    await expect(page.locator(SEL.lobbyCount)).toHaveText('3 / 3');
    expect(await inGame(page, SD => SD.match)).toBeNull();
  });

  test('하나의 화면 공유 모드: 화면 1칸, 봇이 맞힌 표적은 모두에게서 사라짐', async ({ page }) => {
    test.setTimeout(90_000);
    await openGame(page, { peer: false, warp: BOT_WARP, name: '방장' });
    await createRoom(page);
    await page.click(SEL.view('shared'));
    await page.click(SEL.bot('hard'));
    await page.click(SEL.btnStart);
    await expect(page.locator(SEL.grid)).toHaveClass('n1');
    await expect(page.locator(SEL.pane)).toHaveCount(1);
    expect(await inGame(page, SD => SD.match.shared)).toBe(true);
    // 봇이 맞힌 표적 → 공유 dead 집합에 들어가고, 내 Game 의 blocked 와 같은 집합
    await expect.poll(() => inGame(page, SD => SD.match && SD.match.gd ? SD.match.gd.size : 0), { timeout: 15_000 }).toBeGreaterThan(0);
    const r = await inGame(page, SD => {
      const bot = [...SD.match.local.entries()].find(([id]) => id !== 'H')[1];
      return { same: SD.match.own.blocked === SD.match.gd && bot.blocked === SD.match.gd, allIn: bot.deadList.every(id => SD.match.gd.has(id)) };
    });
    expect(r).toEqual({ same: true, allIn: true });
    await waitResults(page);
    expect((await readResults(page)).length).toBe(2);
  });
});

test.describe('랭킹 (이 브라우저 기록)', () => {
  const recs = [
    { n: 'A', s: 1000, h: 5, f: 10, m: '솔로 1분', d: Date.UTC(2026, 0, 2, 3, 4) },
    { n: 'B', s: 3000, h: 9, f: 10, m: '2인 1분', d: Date.UTC(2026, 0, 3, 5, 6) },
    { n: 'A', s: 2500, h: 6, f: 12, m: '2인 1분', d: Date.UTC(2026, 0, 4, 7, 8) },
    { n: '<i>x</i>', s: 10, h: 0, f: 0, m: '솔로 1분', d: Date.UTC(2026, 0, 5, 9, 10) },
  ];
  test('누적 총점 / 최고 점수 탭, 내 닉네임 강조, 이스케이프', async ({ page }) => {
    await openGame(page, { peer: false, storage: { sd_records_v1: recs, sd_settings: { name: 'A' } } });
    expect(await readBoard(page, SEL.boardMenu)).toEqual([
      ['1', 'A', '3,500', '2', '2,500', '1,750', '50%'],
      ['2', 'B', '3,000', '1', '3,000', '3,000', '90%'],
      ['3', '<i>x</i>', '10', '1', '10', '10', '0%'],
    ]);
    await expect(page.locator(`${SEL.boardMenu} tr.me`)).toHaveCount(1);
    await expect(page.locator(`${SEL.boardMenu} tr.me`)).toContainText('A');
    await expect(page.locator(`${SEL.boardMenu} i`)).toHaveCount(0);

    await page.click(SEL.boardTab('boardMenu', 'best'));
    await expect(page.locator(SEL.boardTab('boardMenu', 'best'))).toHaveClass(/sel/);
    const best = await readBoard(page, SEL.boardMenu);
    expect(best.map(r => r.slice(0, 5))).toEqual([
      ['1', 'B', '3,000', '90%', '2인 1분'],
      ['2', 'A', '2,500', '50%', '2인 1분'],
      ['3', 'A', '1,000', '50%', '솔로 1분'],
      ['4', '<i>x</i>', '10', '0%', '솔로 1분'],
    ]);
    for (const r of best) expect(r[5]).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
    await expect(page.locator(`${SEL.boardMenu} tr.me`)).toHaveCount(2);
  });

  test('최대 15개까지만 표시, 기록은 최대 800개까지 보관', async ({ page }) => {
    const many = Array.from({ length: 800 }, (_, i) => ({ n: 'P' + (i % 20), s: i, h: 1, f: 1, m: '솔로 1분', d: 1 }));
    await openGame(page, { peer: false, warp: FAST, name: 'NEW', storage: { sd_records_v1: many } });
    await expect(page.locator(`${SEL.boardMenu} tbody tr`)).toHaveCount(15);
    await page.click(SEL.boardTab('boardMenu', 'best'));
    await expect(page.locator(`${SEL.boardMenu} tbody tr`)).toHaveCount(15);
    await startSolo(page);
    await waitResults(page);
    const rec = await records(page);
    expect(rec).toHaveLength(800);
    expect(rec[0].s).toBe(1);              // 가장 오래된 것 하나가 밀려남
    expect(rec[799].n).toBe('NEW');
  });
});

test.describe('초대 QR · 링크', () => {
  test('웹 주소로 열면: 초대 링크 = 현재 주소?join=코드, QR 생성', async ({ page, baseURL }) => {
    await openGame(page, { name: '방장' });
    const code = await createOnlineRoom(page);
    await expect(page.locator(SEL.lobbyMsg)).toContainText('친구에게 방 코드를 알려주세요');
    await expect(page.locator(SEL.btnCopy)).toBeEnabled();
    await expect(page.locator(SEL.invite)).toBeVisible();
    await expect(page.locator(SEL.shareWrap)).toBeHidden();
    const link = `${baseURL}${PAGE}?join=${code}`;
    await expect(page.locator(SEL.inviteLink)).toHaveValue(link);
    await expect(page.locator(SEL.btnCopyLink)).toHaveText('링크 복사');
    await expect(page.locator(`${SEL.qrBox} svg`)).toHaveAttribute('data-fake-qr', encodeURIComponent(link));
    await expect(page.locator(`${SEL.qrBox} svg`)).toHaveAttribute('aria-label', '방 참가 QR 코드');
    await expect(page.locator(SEL.inviteHint)).toContainText('스캔하거나 링크를 열면 방 코드가 자동 입력됩니다');
  });

  test('내 PC 전용 주소(127.0.0.1)로 열면: QR 없음 → 공유 주소를 입력하면 QR 생성(설정에 저장)', async ({ page }) => {
    await openGame(page, { name: '방장' });
    await page.goto(`http://127.0.0.1:4173/${PAGE}`);
    await page.fill(SEL.nameIn, '방장');
    const code = await createOnlineRoom(page);
    await expect(page.locator(SEL.invite)).toBeVisible();
    await expect(page.locator(SEL.shareWrap)).toBeVisible();
    await expect(page.locator(SEL.inviteLink)).toHaveValue(`방 코드: ${code}`);
    await expect(page.locator(SEL.btnCopyLink)).toHaveText('코드 복사');
    await expect(page.locator(SEL.qrBox)).toBeHidden();
    await expect(page.locator(SEL.inviteHint)).toContainText('내 PC에서만 열리는 주소');
    await page.fill(SEL.shareUrl, 'https://example.github.io/sniper-duel/?x=1#top');
    await expect(page.locator(SEL.inviteLink)).toHaveValue(`https://example.github.io/sniper-duel/?join=${code}`);
    await expect(page.locator(`${SEL.qrBox} svg`)).toBeVisible();
    expect((await settings(page)).shareUrl).toBe('https://example.github.io/sniper-duel/?x=1#top');
  });

  // http 테스트 주소는 보안 컨텍스트가 아니라서 navigator.clipboard 가 없다 (LAN 서버와 같은 상황)
  test('[코드 복사]·[링크 복사]: 결과를 대기실 메시지로 알림 (http 주소)', async ({ page }) => {
    await openGame(page, { name: '방장' });
    const code = await createOnlineRoom(page);
    await page.click(SEL.btnCopy);
    // 현재 동작: [코드 복사]는 navigator.clipboard 만 써서 http 에서는 복사 못 하고 코드만 보여 줌 (docs/smells.md 참고)
    await expect(page.locator(SEL.lobbyMsg)).toHaveText(`방 코드: ${code}`);
    await page.click(SEL.btnCopyLink);
    await expect(page.locator(SEL.lobbyMsg)).toHaveText(new RegExp(`^초대 링크가 복사되었습니다: .*\\?join=${code}$`));
  });
});
