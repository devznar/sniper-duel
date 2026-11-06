// @ts-check
const { defineConfig } = require('@playwright/test');

const PORT = 4173;
// 테스트용 가짜 도메인. 127.0.0.1 / localhost 로 열면 게임이 "내 PC 전용 주소"로 판단해
// QR·초대 링크를 숨기므로, 실제 배포 사이트처럼 보이는 이름으로 연다 (브라우저가 127.0.0.1 로 연결).
const HOST = 'sniper.test';

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  // 골든 스냅샷은 OS 이름 없이 저장 (어느 OS에서 돌려도 같은 파일과 비교)
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
  use: {
    baseURL: `http://${HOST}:${PORT}/`,
    // 브라우저를 따로 내려받지 않고 설치된 Chrome 사용.
    // Chrome이 없으면 PW_CHANNEL= (빈 값)으로 실행하고 `npx playwright install chromium`
    channel: process.env.PW_CHANNEL === undefined ? 'chrome' : (process.env.PW_CHANNEL || undefined),
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] },
  },
  webServer: {
    command: `node tests/harness/server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
