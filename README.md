# 🎯 Sniper Duel — 저격 에임 트레이너 (온라인 1~4인 대결)

움직이는 대상을 스코프(우클릭)로 조준해 맞히는 저격 연습 게임입니다.
최대 4명이 실시간으로 대결하며 **분할 화면** 또는 **하나의 화면 공유** 모드를 고를 수 있습니다.

| 구성 | 역할 |
|---|---|
| **GitHub** | 코드 저장소 |
| **Vercel** | `https://○○○.vercel.app` 주소로 게임 배포 → QR 코드/초대 링크가 어디서나 작동 |
| **Supabase** | 🌐 전체 랭킹(모든 플레이어 점수 저장) · 🌐 실시간 열린 방 목록 |
| PeerJS (P2P) | 게임 중 실시간 조준·점수 공유 (무료, Supabase 한도 사용 안 함) |

```
sniper-duel/
├─ index.html            게임 본체 (이 파일 하나로도 동작)
├─ config.js             Supabase 주소/공개 키 설정
├─ vercel.json           Vercel 배포 설정
├─ supabase/schema.sql   Supabase에서 한 번 실행할 SQL (점수 테이블 + 보안 규칙)
└─ local-server/         (선택) 인터넷 없이 같은 와이파이에서 할 때 쓰는 PC 서버
```

---

## 1단계. Supabase 준비 (약 5분)

1. <https://supabase.com> 에 로그인 → **New project** (Region: Northeast Asia (Seoul) 추천)
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query**
3. `supabase/schema.sql` 내용을 전부 붙여넣고 **Run** → `Success` 확인
4. 왼쪽 아래 **Project Settings → API** 에서 두 값을 복사
   - **Project URL** (예: `https://abcdefghijk.supabase.co`)
   - **anon public** 키 (`eyJ...` 로 시작하는 긴 문자열)
5. `config.js` 를 열어 붙여넣기

```js
window.SD_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'
};
```

> ⚠️ **service_role** 키는 절대 넣지 마세요. anon 키는 브라우저에 공개돼도 되는 키이고,
> 보안 규칙(RLS) 때문에 점수 **조회와 등록만** 가능하며 수정·삭제는 막혀 있습니다.

## 2단계. GitHub에 올리기 (git 설치 없이 웹으로)

1. <https://github.com/new> → Repository name: `sniper-duel` → **Public** → **Create repository**
2. 생성된 페이지에서 **uploading an existing file** 클릭
3. 이 폴더의 파일/폴더를 **모두 드래그해서** 올리기 (`index.html`, `config.js`, `vercel.json`, `.vercelignore`, `supabase`, `local-server`, `README.md`)
   - `.vercelignore` 처럼 점으로 시작하는 파일이 탐색기에서 안 보이면: 탐색기 **보기 → 숨긴 항목** 체크
4. **Commit changes**

## 3단계. Vercel로 배포 (약 2분)

1. <https://vercel.com> → **Continue with GitHub** 로 로그인
2. **Add New… → Project** → `sniper-duel` 저장소 **Import**
3. Framework Preset: **Other** (빌드 설정은 모두 비워 둠) → **Deploy**
4. 완료되면 `https://sniper-duel-○○○.vercel.app` 주소가 생깁니다 → 이 주소를 친구들에게 공유!

이후 GitHub에서 파일을 수정(연필 아이콘 → Commit)하면 Vercel이 **자동으로 다시 배포**합니다.

## 플레이 방법

- **방 만들기** → 대기실의 **QR 코드 / 초대 링크** 공유 → 친구가 열고 닉네임 입력 → **바로 참가**
- 또는 메인 화면 **🌐 지금 열린 방** 목록에서 **참가** 클릭
- 방장이 화면 모드(분할 / 하나의 화면 공유) · 인원(2~4) 선택, 빈자리는 봇으로 채울 수 있음 (모든 경기 **1분** 고정)
- 조작: **우클릭** 스코프(2.5배 → 5배 → 해제), **좌클릭** 발사, **휠** 배율, **Esc** 마우스 잠금 해제
- 점수: 대상 속도별 100 / 200 / 350 / 500점, 헤드샷 ×1.5, 연속 명중 보너스 최대 +50%
- 경기가 끝나면 1등은 왕관, 나머지는 뿅망치 엔딩 🔨

## 테스트

리팩토링 전 동작을 고정해 둔 자동 테스트가 `tests/`에 있습니다. Node.js와 Chrome이 필요합니다.

```bash
npm install
npm test
```

자세한 내용은 [`tests/README.md`](tests/README.md)를 보세요.

## 참고 / 한계

- 실시간 대결은 P2P(WebRTC)입니다. 회사·학교 방화벽이 P2P를 막으면 접속이 안 될 수 있습니다
  (이 경우 휴대폰 핫스팟 등 다른 네트워크에서 시도).
- 전체 랭킹은 로그인 없이 닉네임으로 저장됩니다. 같은 닉네임은 같은 사람으로 합산됩니다.
- Supabase 무료 플랜은 1주일간 접속이 없으면 프로젝트가 일시정지될 수 있습니다 (대시보드에서 Restore).
- 인터넷 없이 같은 와이파이에서만 하려면 `local-server/게임서버_실행.bat` 실행.
