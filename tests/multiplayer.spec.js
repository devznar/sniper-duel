// 여러 명 대결 특성 테스트. 같은 브라우저 컨텍스트의 탭 여러 개를 가짜 PeerJS(BroadcastChannel)로 연결한다.
const { test, expect } = require('@playwright/test');
const { PAGE, SEL, openGame, inGame, pageErrors, createOnlineRoom, joinByCode, forceHit, waitResults, readResults } = require('./harness/app');

const FAST = 20;     // 봇 없는 경기
const BOT_WARP = 3;  // 봇 있는 경기 (ui.spec.js 설명 참고)

test.describe.configure({ mode: 'parallel' });

/** 탭 열기 + 테스트 끝에 스크립트 오류 검사 */
function tabs(context) {
  const opened = [];
  return {
    async open(opts) { const p = await context.newPage(); opened.push(p); await openGame(p, opts); return p; },
    check() { for (const p of opened) expect(pageErrors(p), '페이지 스크립트 오류').toEqual([]); },
  };
}

async function hostAndClient(context, { warp = 1, hostName = '방장', clientName = '참가자' } = {}) {
  const t = tabs(context);
  const host = await t.open({ name: hostName, warp });
  const code = await createOnlineRoom(host);
  const client = await t.open({ name: clientName, warp });
  await joinByCode(client, code);
  await expect(client.locator(SEL.lobby)).toBeVisible();
  await expect(host.locator(SEL.lobbyCount)).toHaveText('2 / 2');
  return { t, host, client, code };
}

const slotNames = page => page.locator(`${SEL.slots} .slot .nm`).allTextContents();

test.describe('대기실', () => {
  test('코드를 직접 입력해 참가 → 양쪽 대기실이 같은 내용', async ({ context, baseURL }) => {
    const { t, host, client, code } = await hostAndClient(context);
    await expect(client.locator(SEL.menuMsg)).toHaveText('');
    await expect(client.locator(SEL.lobbyCode)).toHaveText(code);
    await expect(client.locator(SEL.hostCtl)).toBeHidden();
    await expect(client.locator(SEL.clientWait)).toBeVisible();
    await expect(client.locator(SEL.clientView)).toHaveText('분할 화면 (각자 화면을 나눠서 보기)');
    await expect(client.locator(SEL.clientDur)).toHaveText('1분');
    await expect(client.locator(SEL.inviteLink)).toHaveValue(`${baseURL}${PAGE}?join=${code}`);
    expect((await slotNames(host)).slice(0, 2)).toEqual(['방장 (나)', '참가자']);
    expect((await slotNames(client)).slice(0, 2)).toEqual(['방장', '참가자 (나)']);
    await expect(host.locator(`${SEL.slots} .slot .tg`).nth(1)).toHaveText('참가자');
    await expect(client.locator(`${SEL.slots} .slot .tg`).nth(0)).toHaveText('호스트');
    await expect(host.locator(SEL.btnStart)).toBeEnabled();

    // 호스트가 설정을 바꾸면 참가자 화면에도 반영
    await host.click(SEL.view('shared'));
    await expect(client.locator(SEL.clientView)).toHaveText('하나의 화면 공유 (같은 대상을 먼저 맞히면 득점)');
    await host.click(SEL.mode(3));
    await expect(client.locator(SEL.lobbyCount)).toHaveText('2 / 3');
    await host.click(SEL.bot('normal'));
    await expect(client.locator(`${SEL.slots} .slot .nm`).nth(2)).toHaveText('BOT 알파');
    await expect(client.locator(SEL.removeBot)).toHaveCount(0); // 참가자는 봇 제거 버튼 없음
    t.check();
  });

  test('초대 링크로 열고 [바로 참가]', async ({ context }) => {
    const t = tabs(context);
    const host = await t.open({ name: '방장' });
    const code = await createOnlineRoom(host);
    const client = await t.open({ name: '링크손님', query: `?join=${code.toLowerCase()}` });
    await expect(client.locator(SEL.inviteBanner)).toBeVisible();
    await client.locator(SEL.nameIn).press('Enter'); // 배너가 떠 있으면 닉네임 칸 Enter = [바로 참가]
    await expect(client.locator(SEL.lobby)).toBeVisible();
    await expect(client.locator(SEL.inviteBanner)).toBeHidden();
    await expect(host.locator(`${SEL.slots} .slot .nm`).nth(1)).toHaveText('링크손님');
    t.check();
  });

  test('없는 방 코드 → 방을 찾을 수 없음', async ({ context }) => {
    const t = tabs(context);
    const client = await t.open({ name: '손님' });
    await joinByCode(client, 'ZZZZ2');
    await expect(client.locator(SEL.menuMsg)).toHaveText('방을 찾을 수 없습니다. 코드를 확인하세요.');
    await expect(client.locator(SEL.menu)).toBeVisible();
    expect(await inGame(client, SD => [SD.net.role, SD.net.peer])).toEqual([null, null]);
    t.check();
  });

  test('참가자가 늘면 인원 설정이 자동으로 늘고, 5번째는 거절', async ({ context }) => {
    const t = tabs(context);
    const host = await t.open({ name: '방장' });
    const code = await createOnlineRoom(host);
    for (let i = 1; i <= 3; i++) {
      const c = await t.open({ name: '손님' + i });
      await joinByCode(c, code);
      await expect(c.locator(SEL.lobby)).toBeVisible();
      await expect(host.locator(SEL.lobbyCount)).toHaveText(`${i + 1} / ${Math.max(2, i + 1)}`);
    }
    expect(await slotNames(host)).toEqual(['방장 (나)', '손님1', '손님2', '손님3']);
    await expect(host.locator(SEL.mode(4))).toHaveClass(/sel/);
    for (const k of ['easy', 'normal', 'hard']) await expect(host.locator(SEL.bot(k))).toBeDisabled();
    const fifth = await t.open({ name: '손님4' });
    await joinByCode(fifth, code);
    await expect(fifth.locator(SEL.menuMsg)).toHaveText('방이 가득 찼습니다 (최대 4인).');
    await expect(fifth.locator(SEL.menu)).toBeVisible();
    await expect(host.locator(SEL.lobbyCount)).toHaveText('4 / 4');
    t.check();
  });

  test('경기 중인 방에 참가하면 거절', async ({ context }) => {
    const t = tabs(context);
    const host = await t.open({ name: '방장' });
    const code = await createOnlineRoom(host);
    await host.click(SEL.bot('easy'));
    await host.click(SEL.btnStart);
    await expect(host.locator(SEL.play)).toBeVisible();
    const late = await t.open({ name: '지각생' });
    await joinByCode(late, code);
    await expect(late.locator(SEL.menuMsg)).toHaveText('이미 게임이 진행 중입니다.');
    await expect(late.locator(SEL.menu)).toBeVisible();
    t.check();
  });

  test('참가자가 [나가기] 하거나 탭을 닫으면 대기실 목록에서 빠짐', async ({ context }) => {
    const t = tabs(context);
    const host = await t.open({ name: '방장' });
    const code = await createOnlineRoom(host);
    const a = await t.open({ name: '나갈사람' });
    await joinByCode(a, code);
    const b = await t.open({ name: '닫을사람' });
    await joinByCode(b, code);
    await expect(host.locator(SEL.lobbyCount)).toHaveText('3 / 3');
    await a.click(SEL.btnLeave);
    await expect(a.locator(SEL.menu)).toBeVisible();
    await expect(host.locator(SEL.lobbyCount)).toHaveText('2 / 3');
    expect((await slotNames(host)).slice(0, 2)).toEqual(['방장 (나)', '닫을사람']);
    await b.close();
    await expect(host.locator(SEL.lobbyCount)).toHaveText('1 / 3');
    t.check();
  });

  test('방장이 나가면 참가자에게 알림 후 메뉴로', async ({ context }) => {
    const { t, host, client } = await hostAndClient(context);
    await host.click(SEL.btnLeave);
    await expect(host.locator(SEL.menu)).toBeVisible();
    await expect(client.locator(SEL.menu)).toBeVisible();
    expect(await client.evaluate(() => window.__dialogs)).toEqual([{ type: 'alert', msg: '호스트와의 연결이 끊어졌습니다.' }]);
    t.check();
  });
});

test.describe('경기', () => {
  test('분할 화면 (사람 2 + 봇 1): 상태 공유 → 같은 결과표 → 방장이 대기실로 가면 참가자도 따라감', async ({ context }) => {
    test.setTimeout(120_000);
    const { t, host, client } = await hostAndClient(context, { warp: BOT_WARP });
    await host.click(SEL.mode(3));
    await host.click(SEL.bot('hard'));
    await host.click(SEL.btnStart);
    for (const p of [host, client]) {
      await expect(p.locator(SEL.play)).toBeVisible();
      await expect(p.locator(SEL.grid)).toHaveClass('n3');
      await expect(p.locator(SEL.pane)).toHaveCount(3);
    }
    // 내 칸이 항상 첫 칸
    await expect(client.locator(SEL.pane).first()).toHaveClass(/me/);
    const same = await Promise.all([host, client].map(p => inGame(p, SD => ({ seed: SD.match.seed, n: SD.match.sched.length, dur: SD.match.dur }))));
    expect(same[0]).toEqual(same[1]);

    // 참가자가 하나 맞히면 → 호스트 화면(상단 순위)에도 점수가 보임
    const shot = await forceHit(client);
    expect(shot.pts).toBeGreaterThan(0);
    await expect.poll(() => inGame(host, SD => { const s = SD.match.remote.get([...SD.match.remote.keys()][0]); return s ? s.sc : 0; })).toBeGreaterThanOrEqual(shot.pts);
    await expect(host.locator(SEL.ranks)).toContainText('참가자');

    await waitResults(host, { timeout: 60_000 });
    await waitResults(client, { timeout: 60_000 });
    const [hr, cr] = [await readResults(host), await readResults(client)];
    const strip = rows => rows.map(r => ({ rank: r.rank, name: r.name, score: r.score, hitsFired: r.hitsFired, tiers: r.tiers }));
    expect(strip(cr)).toEqual(strip(hr));
    const clientOwn = await inGame(client, SD => SD.match.own.score);
    expect(hr.find(r => r.name === '참가자').score).toBe(clientOwn);
    expect(hr.find(r => r.name === '방장').me).toBe(true);
    expect(cr.find(r => r.name === '참가자').me).toBe(true);
    await expect(client.locator(SEL.resBtns)).toContainText('호스트가 대기실로 돌아가면 자동으로 이동합니다.');
    await expect(client.locator(`${SEL.resBtns} button`)).toHaveText(['엔딩 다시 보기', '나가기']);

    await host.click(SEL.rLobby);
    await expect(host.locator(SEL.lobby)).toBeVisible();
    await expect(client.locator(SEL.lobby)).toBeVisible();
    await expect(client.locator(SEL.results)).toBeHidden();
    expect(await slotNames(client)).toEqual(['방장', '참가자 (나)', 'BOT 알파', '—']);
    t.check();
  });

  test('하나의 화면 공유: 화면 1칸, 남이 맞힌 표적은 내 화면에서도 사라짐', async ({ context }) => {
    const { t, host, client } = await hostAndClient(context, { warp: 1 });
    await host.click(SEL.view('shared'));
    await host.click(SEL.btnStart);
    for (const p of [host, client]) {
      await expect(p.locator(SEL.grid)).toHaveClass('n1');
      await expect(p.locator(SEL.pane)).toHaveCount(1);
    }
    const shot = await forceHit(client);
    // 호스트 쪽: 공유 dead 집합에 들어가고, 호스트의 Game 도 그 표적을 못 맞힘
    await expect.poll(() => inGame(host, (SD, id) => SD.match.gd.has(id) && SD.match.own.dq().has(id), shot.id)).toBe(true);
    // 반대로 호스트가 맞힌 표적도 참가자 쪽에서 사라짐
    const hostShot = await forceHit(host);
    await expect.poll(() => inGame(client, (SD, id) => SD.match.gd.has(id), hostShot.id)).toBe(true);
    await host.click(SEL.btnQuit);
    t.check();
  });

  test('참가자가 경기 중에 끊기면 "끊김" 표시, 호스트는 기다리지 않고 결과', async ({ context }) => {
    const { t, host, client } = await hostAndClient(context, { warp: FAST });
    await host.click(SEL.btnStart);
    await expect(client.locator(SEL.play)).toBeVisible();
    await client.close();
    await expect.poll(() => inGame(host, SD => [...SD.match.remote.values()].some(s => s.dc))).toBe(true);
    await waitResults(host);
    const rows = await readResults(host);
    expect(rows.find(r => r.name === '참가자').tags).toContain('끊김');
    expect(rows.find(r => r.name === '방장').tags).not.toContain('끊김');
    t.check();
  });
});
