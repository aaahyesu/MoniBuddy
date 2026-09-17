# 기본 / 보상 버디 GIF

## 기본으로 넣기 (지금 사용 중)

1. `ank_dance.gif` 처럼 파일을 이 폴더에 둡니다.
2. `manifest.json`에 등록합니다.

```json
{
  "id": "ank_dance",
  "label": "안경만두_골반춤",
  "free": true,
  "grows": true,
  "displaySize": 64,
  "stages": [
    { "stage": 0, "scale": 0.55, "file": "ank_dance", "label": "애기" },
    { "stage": 1, "scale": 0.78, "file": "ank_dance", "label": "성장" },
    { "stage": 2, "scale": 1.0, "file": "ank_dance", "label": "성체" }
  ]
}
```

성장 단계별로 다른 GIF를 쓰려면 `file`만 바꾸면 됩니다.  
예: `"file": "ank_dance_adult"` → `ank_dance_adult.gif`

## 퀘스트 보상 (파일은 나중에)

`fileReady: false` 로 등록해 두면 해금만 먼저 되고, GIF는 나중에 추가하면 됩니다.

```json
{
  "id": "reward_spark",
  "label": "스파크 (보상·파일 예정)",
  "unlock": "quest:first_room",
  "fileReady": false,
  "grows": true
}
```

파일을 넣을 때: `reward_spark.gif` 추가 후 `"fileReady": true` (또는 필드 삭제).

## 성장 XP

채팅 1회 = XP +1  
임계값: 0 → 12 → 30 (애기 / 성장 / 성체)
