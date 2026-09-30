# MoniBuddy GitHub 워크플로

## 커밋 메시지
형식: `[이모지][타입]#이슈번호: 내용`

예시:
- `[✨][Feat]#1: MoniBuddy 앱·서버·CI 초기 구성`
- `[🐛][Fix]#3: 오버레이 클릭 통과 수정`
- `[📝][Chore]: 저장소 초기화 (README, gitignore)`

타입 예: `Feat` / `Fix` / `Chore` / `Docs` / `Refactor`

## 브랜치
- `main`: 배포 기준 브랜치
- 작업 브랜치: `{이슈번호}-{짧은-설명}` (예: `1-project-bootstrap`)

## 이슈
- 버그 / 기능 요청은 Issue 템플릿 사용
- 작업 시작 전 이슈를 만들고 브랜치·PR·커밋에 `#번호`로 연결

## PR
- PR 템플릿의 Summary / Test plan 작성
- `Closes #N` 으로 이슈 자동 종료
- CI(Build shared + server) 통과 후 머지

## 배포

배포 시 증상·원인·수정·검증은 **[DEPLOY.md](./DEPLOY.md)** 에 버전별로 기록합니다.

### 데스크톱 설치본
- `main`에 push 되면 `Release desktop` 워크플로가 **Windows NSIS(`.exe`)** 와 **macOS DMG** 를 빌드해 GitHub Releases에 올립니다.
- Releases 탭에서
  - Windows: `MoniBuddy_*_x64-setup.exe`
  - macOS: `MoniBuddy_*_*.dmg` (유니버설, App Store 아님)
- macOS 첫 실행 시 Gatekeeper 경고 → **우클릭 → 열기** (또는 `xattr -cr /Applications/MoniBuddy.app`)

### 서버 (Render)
- 자동 배포는 `render.yaml`의 `buildFilter` 기준. `apps/server`, `packages/shared`, 루트 `package.json`/`package-lock.json`, `render.yaml`이 바뀔 때만 서버가 재시작됨
- 데스크톱만 바뀐 푸시는 서버를 재시작하지 않음
- 방과 멤버는 Turso에 저장되어, 서버가 다시 떠도 같은 코드로 재입장할 수 있음
- GitHub Actions의 `RENDER_DEPLOY_HOOK`이 비어 있으면 훅은 호출하지 않음. 재시작은 Render에 연결된 저장소 자동 배포가 담당
- Blueprint: 저장소 루트 `render.yaml` (서비스명 `monibuddy-server`)
- 공용 URL 예: `https://monibuddy-server.onrender.com`
- 설치본 기본 서버 URL은 repo Variable `MONIBUDDY_SERVER_URL`로 덮어쓸 수 있음
