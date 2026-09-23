# MoniBuddy (모니버디)

모니터 테두리 위를 돌아다니는 픽셀/GIF 캐릭터와 함께, 초대코드·친구 코드로 실시간 채팅하는 Windows 데스크톱 앱입니다.

> **프로젝트 주소:** https://github.com/aaahyesu/MoniBuddy

---

## 개요

MoniBuddy는 화면 가장자리에 작은 캐릭터(버디)를 띄워 두고, 캐릭터를 클릭해 채팅·상태메시지·방 참가·친구 초대 등을 할 수 있는 가벼운 오버레이 메신저입니다.

- **설정 창**: 닉네임·캐릭터·오버레이 단축키, 친구 목록, 퀘스트/프로필
- **오버레이**: 모니터 테두리를 걷는 캐릭터 + 채팅 입력바 + 말풍선
- **서버**: 방·채팅·캐릭터 상태·친구 presence 동기화 (Socket.IO)

로컬에서는 `127.0.0.1:3847` 서버를 쓰고, 친구와 쓰려면 Render 등 공용 서버 URL로 연결하면 됩니다.

---

## 주요 기능

### 오버레이 · 버디

| 기능 | 설명 |
|------|------|
| 모니터 테두리 버디 | 화면 가장자리(상/하/좌/우)를 따라 걷는 GIF/이미지 캐릭터 |
| 다른 앱 위 표시 | 오버레이가 다른 창 위에 항상 위에 표시 |
| 클릭 통과 | 패널이 닫혀 있을 때는 클릭이 아래 앱으로 통과 (캡처·작업에 방해 최소화) |
| 닉네임 표시 | 방에 있는 상대 캐릭터 위에 닉네임 표시 |
| 시스템 트레이 | 트레이에서 설정 창 / 오버레이 표시 토글 |

### 채팅 · 상태메시지

| 기능 | 설명 |
|------|------|
| 오버레이 채팅 | 캐릭터 클릭 → 입력바로 메시지 전송 (최대 80자) |
| 말풍선 | 보낸/받은 채팅이 캐릭터 옆 말풍선으로 약 2초 표시 (새 메시지면 교체) |
| 상태메시지 | 캐릭터 위에 항상 표시되는 짧은 문구 (피어와 동기화) |

### 방 · 초대코드

| 기능 | 설명 |
|------|------|
| 방 만들기 / 입장 | 오버레이 `+` 메뉴에서 6자 초대코드로 참여 |
| 방당 인원 | 최대 8명 |
| 실시간 동기화 | 멤버 캐릭터·위치·채팅·상태메시지를 Socket.IO로 동기화 |

### 친구

| 기능 | 설명 |
|------|------|
| 친구 코드 | 기기마다 고유 친구 코드 발급 (설정 창에서 복사) |
| 친구 추가 / 삭제 | 상대 코드로 추가, 목록에서 삭제 |
| 온라인 / 오프라인 | 서버에 연결된 친구 presence 표시 |
| 방 초대 | 내가 방에 있을 때 온라인 친구에게 초대 → 수락 시 같은 방 입장 |

### 이동 · 위치 고정

| 기능 | 설명 |
|------|------|
| 자동 이동 | on/off, 속도 조절 |
| 이동 범위 | 사방 / 상 / 하 / 좌 / 우 |
| 테두리 드래그 | 캐릭터를 끌어 테두리 경로상 위치 변경 |
| 위치 고정하기 | 화면 **어디든** 드래그 후 확인 → 이 기기에만 고정 (서버/상대에게는 안 보냄) |
| 고정 해제하기 | 다시 테두리 자동 이동으로 복귀 |
| 상대 위치 고정 | 위치 고정 모드에서 상대 캐릭터도 이 화면에만 원하는 곳에 둘 수 있음 |

### 화면 캡처 연동 (Windows)

| 기능 | 설명 |
|------|------|
| 캡처 중 정지 | Win+Shift+S 등 영역 선택 중에는 버디가 걷지 않고 그 자리에 멈춤 |
| 캡처에 포함 | 캡처 동안 캐릭터가 화면에 보여 스크린샷에 포함됨 |
| 캡처 후 양보 | 캡처가 끝나면 잠시 오버레이를 내려 Windows 캡처 보드/토스트가 가려지지 않게 함 |

### 단축키 · 프로필

| 기능 | 설명 |
|------|------|
| 오버레이 단축키 | 설정 창에서 글로벌 단축키 지정 → 오버레이 표시/숨김 토글 |
| 온보딩 | 최초 실행 시 닉네임 · 캐릭터 선택 |
| 프로필 편집 | 로비에서 이름 · 캐릭터 · 단축키 재설정 |

### 퀘스트 · 성장 · 캐릭터

| 기능 | 설명 |
|------|------|
| 퀘스트 | 첫 방 참여, 채팅 10회, 성장 1회 등 달성 시 보상 버디 해금 |
| 성장 | 활동 XP로 baby → teen → adult 단계 · 크기 변화 |
| 기본 버디 | `ank_dance`, `ank_listening`, `ank_sleep` 등 번들 GIF |
| 커스텀 추가 | `apps/desktop/public/buddies/` + `manifest.json`에 등록 |

### 자동 업데이트

| 기능 | 설명 |
|------|------|
| 업데이트 확인 | 설치본(v0.1.6+) 실행 시 새 버전 확인 |
| 미러 | Render `…/desktop/latest.json`을 먼저 보고, 실패 시 GitHub Releases로 폴백 |

---

## 기술 스펙

### 클라이언트 (`apps/desktop`)

| 항목 | 내용 |
|------|------|
| 런타임 | [Tauri 2](https://tauri.app/) (Windows) |
| UI | React 19 + TypeScript + Vite 6 |
| 실시간 | Socket.IO Client |
| 단축키 | tauri-plugin-global-shortcut |
| 설치본 | NSIS 설치 패키지 |
| 기본 서버 URL | `http://127.0.0.1:3847` |

### 서버 (`apps/server`)

| 항목 | 내용 |
|------|------|
| 런타임 | Node.js |
| API | Express |
| 실시간 | Socket.IO |
| 기본 포트 | `3847` (`PORT` 환경변수로 변경 가능) |
| 제한 | 방당 최대 8명, 채팅 최대 80자, 초대코드 6자, 친구 코드 6자 |

### 공통 (`packages/shared`)

타입·상수·이벤트 이름 등 클라이언트/서버 공유 패키지.

### 모노레포 구조

```text
pixel-border-chat/
├── apps/
│   ├── desktop/     # Tauri + React 클라이언트
│   └── server/      # Express + Socket.IO 서버
├── packages/
│   └── shared/      # 공유 타입·상수
└── package.json     # npm workspaces
```

---

## 아키텍처

```text
┌─────────────────┐     Socket.IO      ┌─────────────────┐
│  MoniBuddy exe  │ ◄───────────────► │  MoniBuddy 서버 │
│  (설정 + 오버레이) │                    │  (방 / 채팅 / 친구) │
└─────────────────┘                    └─────────────────┘
        │
        │  localStorage로 창 간 동기화
        ▼
  설정 창 ↔ 오버레이 창
```

- **exe만**으로는 친구와 방이 연결되지 않습니다. 같은 **서버 URL**을 바라봐야 합니다.
- 오버레이의 방 만들기/입장/채팅은 설정 창 쪽 소켓으로 전달되어 서버와 통신합니다.
- 친구 presence·초대도 같은 서버 세션을 사용합니다.

---

## 요구 사항 (개발)

- Node.js 20+ 권장
- Windows (Tauri 데스크톱 빌드)
- Rust / Visual Studio Build Tools (Tauri 네이티브 빌드용)
- npm

---

## 로컬 실행

### 1) 의존성

```bash
npm install
npm run build:shared
```

### 2) 서버 (터미널 1)

```bash
npm run dev:server
```

→ `http://127.0.0.1:3847`

### 3) 데스크톱 앱 (터미널 2)

```bash
npm run dev:desktop
```

설정 창과 모니터 오버레이가 함께 뜹니다.

### UI만 브라우저로 확인 (선택)

```bash
npm run dev:server
npm run dev:ui
```

- 설정: http://localhost:1420/
- 오버레이 미리보기: http://localhost:1420/?mode=overlay

브라우저 두 탭은 localStorage로만 연결되므로, **실제 사용 플로우는 `dev:desktop`을 권장**합니다.

---

## 사용 방법 (요약)

1. **최초 실행**: 닉네임 → 캐릭터 선택
2. 설정 창 **프로필**에서 오버레이 단축키(선택) 지정
3. 모니터 테두리의 **내 캐릭터** 클릭 → 채팅 입력바
4. **`+` 메뉴**
   - 방 만들기 / 방 입장하기 (초대코드)
   - 상태메시지
   - 퀘스트 확인 / 캐릭터 변경
5. **✨ 이동 메뉴**
   - 자동 이동, 이동 범위, 속도
   - 위치 고정하기 / 고정 해제하기
6. **친구** (설정 창 로비)
   - 내 친구 코드 공유 → 서로 추가
   - 온라인 친구에게 현재 방 초대
7. 채팅창 바깥 클릭 또는 캐릭터 다시 클릭 → 입력바 닫기

---

## 설치본 빌드

```bash
npm run build:shared
npm run tauri:build
```

설치 파일 위치:

```text
apps/desktop/src-tauri/target/release/bundle/nsis/
```

로컬에서 설치본을 쓰려면 서버(`npm run dev:server` 또는 배포 서버)가 켜져 있어야 합니다.

---

## 서버 배포 (친구와 함께 쓰기)

exe는 클라이언트이고, **방·친구 서버는 별도**입니다.

간단 테스트용으로는 [Render](https://render.com) 무료 Web Service에 `apps/server`를 올리는 방식을 권장합니다.

1. 이 저장소를 GitHub에 push
2. Render → **New → Blueprint** 로 repo 연결 (`render.yaml` 사용)  
   또는 Web Service를 수동 생성
3. 빌드/시작 (Blueprint에 이미 포함):

```bash
# Build
npm install && npm run build:shared && npm run build -w @monibuddy/server

# Start
npm run start -w @monibuddy/server
```

4. 환경변수 `PORT`는 Render가 주입하는 값을 사용
5. 서비스 URL 예: `https://monibuddy-server.onrender.com`  
   - GitHub repo **Variable** `MONIBUDDY_SERVER_URL`에 넣으면 설치본 빌드에 반영됩니다
6. Deploy Hook URL을 GitHub Secret `RENDER_DEPLOY_HOOK`에 넣으면  
   `main`에 `apps/server/**` 또는 `packages/shared/**` 변경이 push될 때 자동 재배포

> Render 무료 플랜은 약 15분 동안 트래픽이 없으면 슬립할 수 있습니다.  
> 다시 접속하면 첫 연결만 조금 느릴 수 있습니다.

### Windows 설치본 자동 릴리즈

`main`에 push 하면 GitHub Actions가 `.exe` 설치본을 빌드해 [Releases](https://github.com/aaahyesu/MoniBuddy/releases)에 올립니다.

설치본(v0.1.6+)은 실행 시 업데이트를 확인합니다.  
회사망에서 GitHub가 막혀도 되도록 **Render 서버**(`https://monibuddy-server.onrender.com/desktop/latest.json`)를 먼저 보고, 실패 시 GitHub Releases로 폴백합니다.  
서명용 Secret `TAURI_SIGNING_PRIVATE_KEY`가 리포에 있어야 릴리즈 아티팩트에 `.sig` / `latest.json`이 포함됩니다.

> 자동 업데이트가 처음 들어간 버전·프록시 주소가 바뀐 버전은 한 번 수동 설치해야 이후부터 자동 반영됩니다.

---

## 기본 캐릭터(버디) 추가

폴더: `apps/desktop/public/buddies/`

1. 이미지 파일 추가 (`*.gif` / `*.jpg` / `*.png`)
2. `manifest.json`에 등록 (`ext` 필드 포함)

기본 제공 예:

- `ank_dance` — 안경만두 골반춤
- `ank_listening` — 안경만두 노래듣기
- `ank_sleep` — 안경만두 쿨쿨

---

## npm 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev:server` | 개발 서버 |
| `npm run dev:desktop` | Tauri 앱 개발 실행 |
| `npm run dev:ui` | Vite UI만 실행 |
| `npm run build:shared` | shared 패키지 빌드 |
| `npm run tauri:build` | Windows 설치본 빌드 |
| `npm run smoke` | 룸 스모크 테스트 |

---

## 라이선스 / 기여

_(추후 추가)_

기여·커밋·PR·배포 규칙은 [`.github/WORKFLOW.md`](.github/WORKFLOW.md)를 참고하세요.

---

## 프로젝트 링크

| 항목 | URL |
|------|-----|
| GitHub | https://github.com/aaahyesu/MoniBuddy |
| 서버 (Render) | https://monibuddy-server.onrender.com |
| Releases (exe) | https://github.com/aaahyesu/MoniBuddy/releases |
