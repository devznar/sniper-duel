// 온라인 기능(Supabase) 특성 테스트: 전체 랭킹 · 점수 등록 · 실시간 열린 방 목록.
// 실제 Supabase 로는 요청이 나가지 않는다. tests/harness/fakes.js 의 가짜 클라이언트가 응답한다.
const { test, expect } = require('@playwright/test');
const { SEL, openGame, inGame, pageErrors, startSolo, createRoom, createOnlineRoom, forceHit, waitResults, readResults, readBoard } = require('./harness/app');

const FAST = 20;
test.describe.configure({ mode: 'parallel' });

const SCORES = [
  { name: '김', score: 1000, hits: 4, fired: 8, mode: '솔로 1분', created_at: '2026-03-04T05:06:00Z' },
  { name: '이', score: 3000, hits: 9, fired: 10, mode: '2인 1분', created_at: '2026-03-05T05:06:00Z' },
  { name: '김', score: 2500, hits: 6, fired: 8, mode: '3인 1분', created_at: '2026-03-06T05:06:00Z' },
];
const sbCalls = page => page.evaluate(() => window.__sbCalls);

function tabs(context) {
  const opened = [];
  return {
    async open(opts) { const p = await context.newPage(); opened.push(p); await openGame(p, opts); return p; },
    check() { for (const p of opened) expect(pageErrors(p), '페이지 스크립트 오류').toEqual([]); },
  };
}

test.describe('전체 랭킹', () => {
  test.afterEach(async ({ page }) => { expect(pageErrors(page)).toEqual([]); });

  test('Supabase 설정이 있으면: 클라이언트 생성(세션 저장 안 함) · 누적/최고 점수 표', async ({ page }) => {
    // 랭킹의 '내 줄' 강조는 표를 그릴 때의 닉네임 기준 → 저장된 닉네임으로 시작
    await openGame(page, { supabase: { scores: SCORES }, storage: { sd_settings: { name: '김' } } });
    const calls = await sbCalls(page);
    expect(calls[0]).toEqual({ op: 'createClient', url: 'https://fake-project.supabase.co', key: 'fake-anon-key' });
    await expect(page.locator(`${SEL.boardMenu} tbody tr`)).toHaveCount(2);
    expect(await readBoard(page, SEL.boardMenu)).toEqual([
      ['1', '김', '3,500', '2', '2,500', '1,750', '63%'],
      ['2', '이', '3,000', '1', '3,000', '3,000', '90%'],
    ]);
    await expect(page.locator(`${SEL.boardMenu} tr.me`)).toContainText('김');
    expect(calls.find(c => c.table === 'leaderboard_total')).toMatchObject({ op: 'select', cols: 'name,total,games,best,hits,fired' });

    await page.click(SEL.boardTab('boardMenu', 'best'));
    await expect(page.locator(`${SEL.boardMenu} tbody tr`)).toHaveCount(3);
    const best = await readBoard(page, SEL.boardMenu);
    expect(best.map(r => r.slice(0, 5))).toEqual([
      ['1', '이', '3,000', '90%', '2인 1분'], ['2', '김', '2,500', '75%', '3인 1분'], ['3', '김', '1,000', '50%', '솔로 1분'],
    ]);
    expect((await sbCalls(page)).find(c => c.table === 'scores' && c.op === 'select')).toMatchObject({ cols: 'name,score,hits,fired,mode,created_at' });
  });

  test('기록이 없으면 온라인 안내 문구', async ({ page }) => {
    await openGame(page, { supabase: true });
    await expect(page.locator(SEL.boardMenu)).toContainText('아직 온라인 기록이 없습니다');
  });

  test('불러오기 실패 → 오류 문구 (이 브라우저 기록으로 대체하지 않음: 현재 동작)', async ({ page }) => {
    await openGame(page, { supabase: { failSelect: 'paused project' }, storage: { sd_records_v1: [{ n: '로컬', s: 5, h: 1, f: 1, m: '솔로 1분', d: 1 }] } });
    await expect(page.locator(SEL.boardMenu)).toContainText('전체 랭킹을 불러오지 못했습니다: paused project');
    await expect(page.locator(SEL.boardMenu)).toContainText('config.js 와 Supabase SQL 설정을 확인하세요.');
    await expect(page.locator(SEL.boardMenu)).not.toContainText('로컬');
  });

  test('혼자 연습이 끝나면 내 점수를 등록하고 랭킹을 새로 불러옴', async ({ page }) => {
    await openGame(page, { supabase: true, warp: FAST, name: '솔로왕' });
    await startSolo(page);
    const shot = await forceHit(page);
    await waitResults(page);
    const me = (await readResults(page))[0];
    expect(me.score).toBe(shot.pts);
    await expect.poll(async () => (await sbCalls(page)).filter(c => c.op === 'insert')).toHaveLength(1);
    const ins = (await sbCalls(page)).find(c => c.op === 'insert');
    expect(ins.table).toBe('scores');
    expect(ins.row).toEqual({ name: '솔로왕', score: shot.pts, hits: 1, fired: 1, heads: 0, best_streak: 1, mode: '솔로 1분', duration: 60, players: 1 });
    await expect(page.locator(SEL.boardRes)).toContainText('솔로왕');
  });

  test('봇과 대결하면 사람(나) 점수만 등록, 인원 수 포함', async ({ page }) => {
    await openGame(page, { supabase: true, peer: false, warp: FAST, name: '방장' });
    await createRoom(page);
    await page.click(SEL.mode(3));
    await page.click(SEL.bot('easy'));
    await page.click(SEL.bot('easy'));
    await page.click(SEL.btnStart);
    await waitResults(page);
    await expect.poll(async () => (await sbCalls(page)).filter(c => c.op === 'insert').length).toBe(1);
    const ins = (await sbCalls(page)).find(c => c.op === 'insert');
    expect(ins.row).toMatchObject({ name: '방장', mode: '3인 1분', duration: 60, players: 3 });
  });

  test('점수 등록이 실패해도 결과 화면은 정상 (오류는 콘솔에만)', async ({ page }) => {
    await openGame(page, { supabase: { failInsert: 'rls' }, warp: FAST, name: '실패' });
    const warns = [];
    page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
    await startSolo(page);
    await waitResults(page);
    await expect(page.locator(SEL.resTitle)).toHaveText('연습 결과');
    await expect.poll(() => warns.some(w => w.includes('점수 등록 실패'))).toBe(true);
  });
});

test.describe('실시간 열린 방 목록', () => {
  test('방을 만들면 다른 사람 메뉴에 실시간 표시 → [참가]로 입장 → 인원 갱신', async ({ context }) => {
    const t = tabs(context);
    const viewer = await t.open({ supabase: true });
    await expect(viewer.locator(SEL.roomsCard)).toBeVisible();
    await expect(viewer.locator(SEL.roomsStatus)).toHaveText('0개 · 실시간');
    await expect(viewer.locator(SEL.roomList)).toContainText('지금 열린 방이 없습니다');
    expect((await sbCalls(viewer)).filter(c => c.op === 'track').map(c => c.payload)).toEqual([{ viewer: 1 }]);

    const host = await t.open({ supabase: true, name: '방장' });
    const code = await createOnlineRoom(host);
    await expect(viewer.locator(SEL.roomsStatus)).toHaveText('1개 · 실시간');
    const room = viewer.locator(`${SEL.roomList} .room`);
    await expect(room).toHaveCount(1);
    await expect(room).toContainText(`방장의 방 · ${code}`);
    await expect(room).toContainText('1/2명 · 1분 · 분할 화면');
    await expect(viewer.locator(SEL.joinCode(code))).toHaveText('참가');
    await expect(viewer.locator(SEL.joinCode(code))).toBeEnabled();
    // 내 방은 내 목록에 안 보임
    await expect(host.locator(`${SEL.roomList} .room`)).toHaveCount(0);
    const tracked = (await sbCalls(host)).filter(c => c.op === 'track').map(c => c.payload);
    expect(tracked[tracked.length - 1]).toMatchObject({ code, host: '방장', count: 1, max: 2, dur: 60, view: 'split', playing: false });

    // 닉네임 없이 [참가] → 안내만
    await viewer.click(SEL.joinCode(code));
    await expect(viewer.locator(SEL.menuMsg)).toHaveText('닉네임을 입력한 뒤 다시 [참가]를 누르세요.');
    await expect(viewer.locator(SEL.codeIn)).toHaveValue(code);
    await viewer.fill(SEL.nameIn, '구경꾼');
    await viewer.click(SEL.joinCode(code));
    await expect(viewer.locator(SEL.lobby)).toBeVisible();
    await expect(host.locator(SEL.lobbyCount)).toHaveText('2 / 2');

    // 세 번째 사람에게는 가득 찬 방으로 보임
    const third = await t.open({ supabase: true });
    await expect(third.locator(SEL.joinCode(code))).toHaveText('가득 참');
    await expect(third.locator(SEL.joinCode(code))).toBeDisabled();
    await expect(third.locator(`${SEL.roomList} .room`)).toContainText('2/2명');

    // 공유 화면으로 바꾸고 시작 → 목록에 '게임 중'
    await host.click(SEL.view('shared'));
    await expect(third.locator(`${SEL.roomList} .room`)).toContainText('하나의 화면 공유');
    await host.click(SEL.btnStart);
    await expect(third.locator(SEL.joinCode(code))).toHaveText('게임 중');
    await expect(third.locator(SEL.joinCode(code))).toBeDisabled();

    // 방장이 메뉴로 나가면 목록에서 사라짐
    await host.click(SEL.btnQuit);
    await expect(third.locator(`${SEL.roomList} .room`)).toHaveCount(0);
    t.check();
  });

  test('Supabase 설정이 없으면 열린 방 카드 숨김, 랭킹은 이 브라우저 기록', async ({ page }) => {
    await openGame(page, { supabase: false });
    await expect(page.locator(SEL.roomsCard)).toBeHidden();
    await expect(page.locator(SEL.boardMenu)).toContainText('아직 기록이 없습니다. 게임을 플레이하면 순위가 기록됩니다.');
    expect(pageErrors(page)).toEqual([]);
  });
});
