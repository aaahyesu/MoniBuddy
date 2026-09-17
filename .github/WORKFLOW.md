# MoniBuddy GitHub 워크플로

## 브랜치
- `main`: 배포 기준 브랜치
- 작업 브랜치: `{이슈번호}-{짧은-설명}` (예: `1-project-bootstrap`)

## 이슈
- 버그 / 기능 요청은 Issue 템플릿 사용
- 작업 시작 전 이슈를 만들고 브랜치·PR에 `#번호`로 연결

## PR
- PR 템플릿의 Summary / Test plan 작성
- `Closes #N` 으로 이슈 자동 종료
- CI(Build shared + server) 통과 후 머지

## 배포
- `main`에 server/shared 관련 변경이 push되면 Deploy workflow가 실행됨
- Render Deploy Hook URL을 repo Secret `RENDER_DEPLOY_HOOK`에 등록
