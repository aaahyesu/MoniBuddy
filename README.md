# MoniBuddy (모니버디)

모니터 테두리 위를 돌아다니는 픽셀/GIF 캐릭터와 함께, 초대코드로 친구와 실시간 채팅하는 Windows 데스크톱 앱입니다.

> **프로젝트 주소:** https://github.com/aaahyesu/MoniBuddy

---

## 개요

MoniBuddy는 화면 가장자리에 작은 캐릭터(버디)를 띄워 두고, 캐릭터를 클릭해 채팅·상태메시지·방 참가 등을 할 수 있는 가벼운 오버레이 메신저입니다.

- **설정 창**: 최초 닉네임·캐릭터 설정, 프로필/퀘스트 확인
- **오버레이**: 모니터 테두리를 걷는 캐릭터 + 채팅 입력바
- **서버**: 방·채팅·캐릭터 상태 동기화 (Socket.IO)

로컬에서는 `127.0.0.1:3847` 서버를 쓰고, 친구와 쓰려면 Render 등 공용 서버 URL로 연결하면 됩니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 모니터 테두리 버디 | 화면 가장자리를 따라 이동하는 GIF/이미지 캐릭터 |
| 오버레이 채팅 | 캐릭터 클릭 → Cursor 스타일 입력바로 메시지 전송 |
| 상태메시지 | 캐릭터 위에 항상 표시되는 짧은 문구 |
| 방 만들기 / 입장 | 오버레이 `+` 메뉴에서 초대코드로 참여 |
| 이동 설정 | 자동 이동 on/off, 속도, 이동 범위(사방/상/하/좌/우) |
| 위치 드래그 | 캐릭터를 끌어 테두리 경로상 위치 변경 |
| 퀘스트·성장 | 채팅/방 참여 등으로 버디 해금·성장 단계 |
| 시스템 트레이 | 설정 창 / 오버레이 표시 토글 |

---

## 기술 스펙

### 클라이언트 (`apps/desktop`)

| 항목 | 내용 |
|------|------|
| 런타임 | [Tauri 2](https://tauri.app/) (Windows) |
| UI | React 19 + TypeScript + Vite 6 |
| 실시간 | Socket.IO Client |
| 설치본 | NSIS 설치 패키지 |
| 기본 서버 URL | `http://127.0.0.1:3847` |

### 서버 (`apps/server`)

| 항목 | 내용 |
|------|------|
| 런타임 | Node.js |
| API | Express |
| 실시간 | Socket.IO |
| 기본 포트 | `3847` (`PORT` 환경변수로 변경 가능) |
| 제한 | 방당 최대 8명, 채팅 최대 80자, 초대코드 6자 |

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
│  (설정 + 오버레이) │                    │  (방 / 채팅)    │
└─────────────────┘                    └─────────────────┘
        │
        │  localStorage로 창 간 동기화
        ▼
  설정 창 ↔ 오버레이 창
```

- **exe만**으로는 친구와 방이 연결되지 않습니다. 같은 **서버 URL**을 바라봐야 합니다.
- 오버레이의 방 만들기/입장/채팅은 설정 창 쪽 소켓으로 전달되어 서버와 통신합니다.

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
2. 모니터 테두리의 **내 캐릭터** 클릭 → 채팅 입력바
3. **`+` 메뉴**
   - 방 만들기 / 방 입장하기 (초대코드)
   - 상태메시지
   - 퀘스트 확인 / 캐릭터 변경
4. **✨**: 자동 이동, 이동 범위, 속도, 위치 옮기기
5. 채팅창 바깥 클릭 또는 캐릭터 다시 클릭 → 입력바 닫기

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

exe는 클라이언트이고, **방 서버는 별도**입니다.

간단 테스트용으로는 [Render](https://render.com) 무료 Web Service에 `apps/server`를 올리는 방식을 권장합니다.

1. 이 저장소를 GitHub에 push
2. Render에서 repo 연결 → Web Service 생성
3. 빌드/시작 예시 (모노레포 기준, 환경에 맞게 조정):

```bash
# Build
npm install && npm run build:shared && npm run build -w @monibuddy/server

# Start
npm run start -w @monibuddy/server
```

4. 환경변수 `PORT`는 Render가 주입하는 값을 사용
5. 발급된 URL을 클라이언트 `serverUrl`로 설정

> Render 무료 플랜은 약 15분 동안 트래픽이 없으면 슬립할 수 있습니다.  
> 다시 접속하면 첫 연결만 조금 느릴 수 있습니다.

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

---

## 프로젝트 링크

| 항목 | URL |
|------|-----|
| GitHub | https://github.com/aaahyesu/MoniBuddy |
| 서버 (Render 등) | _(추후 추가)_ |
