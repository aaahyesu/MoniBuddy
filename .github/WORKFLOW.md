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

### 데스크톱 설치본 (exe)
- `main`에 push 되면 `Release desktop` 워크플로가 Windows NSIS 설치본을 빌드하고 GitHub Releases에 올립니다.
- Releases 탭에서 `MoniBuddy_*_x64-setup.exe` 다운로드

### 서버 (Render)
- `main`에 server/shared 관련 변경이 push되면 Deploy workflow가 실행됨
- Render Deploy Hook URL을 repo Secret `RENDER_DEPLOY_HOOK`에 등록
- Blueprint: 저장소 루트 `render.yaml` (서비스명 `monibuddy-server`)
- 공용 URL 예: `https://monibuddy-server.onrender.com`
- 설치본 기본 서버 URL은 repo Variable `MONIBUDDY_SERVER_URL`로 덮어쓸 수 있음
