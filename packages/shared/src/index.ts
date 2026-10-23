export const MAX_ROOM_MEMBERS = 8;
export const MAX_CHAT_LENGTH = 80;
export const BUBBLE_TTL_MS = 4000;
/** 메시지에 실어 보내는 첨부. 서버 디스크에는 남기지 않는다. */
export const MAX_CHAT_ATTACHMENTS = 3;
export const MAX_CHAT_IMAGE_DATA_URL = 140_000;
export const MAX_CHAT_FILE_DATA_URL = 100_000;
export const INVITE_CODE_LENGTH = 6;
export const FRIEND_CODE_LENGTH = 6;
export const PNG_MAX_BYTES = 128 * 1024;
export const GIF_MAX_BYTES = 512 * 1024;
export const UPLOAD_MAX_EDGE = 128;
/** 로컬 개발 서버(`npm run dev:server`). 빌드본 `npm start` 기본 포트는 3847. */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:3857";
export const APP_NAME = "MoniBuddy";
export const APP_NAME_KO = "모니버디";

export type Edge = "top" | "right" | "bottom" | "left";
export type CharMotion = "idle" | "walk";

export type PartsCharacter = {
  kind: "parts";
  layers: {
    head: string;
    body: string;
    outfit: string;
    accessory?: string;
  };
  palette?: string;
};

export type UploadCharacter = {
  kind: "upload";
  imageId: string;
  mime: "image/png" | "image/gif";
  displaySize: 32 | 64 | 80 | 128;
};

/** Bundled default GIF from apps/desktop/public/buddies/ */
export type BuddyCharacter = {
  kind: "buddy";
  id: string;
  displaySize: 32 | 64 | 80 | 128;
  /** 0=baby, 1=teen, 2=adult */
  stage: 0 | 1 | 2;
  /** Visual size multiplier (synced to peers) */
  scale: number;
};

export type Character = PartsCharacter | UploadCharacter | BuddyCharacter;

/** 오버레이 버디 최소 표시 크기 */
export const BUDDY_MIN_DISPLAY_SIZE = 80 as const;

export type GrowthStage = 0 | 1 | 2;

export const GROWTH_XP_THRESHOLDS = [0, 12, 30] as const;

export function stageFromXp(xp: number): GrowthStage {
  if (xp >= GROWTH_XP_THRESHOLDS[2]) return 2;
  if (xp >= GROWTH_XP_THRESHOLDS[1]) return 1;
  return 0;
}

export function defaultScaleForStage(stage: GrowthStage): number {
  if (stage === 0) return 0.55;
  if (stage === 1) return 0.78;
  return 1;
}

export type PathMode = "all" | "top" | "bottom" | "left" | "right";

export type CharState = {
  motion: CharMotion;
  edge: Edge;
  progress: number;
  facing: 1 | -1;
  /** 테두리 이동 속도 (progress/sec). 피어 동기화용 */
  speed?: number;
  /** 이동 가능 변. 피어 동기화용 */
  pathMode?: PathMode;
};

export type Member = {
  id: string;
  nickname: string;
  character: Character;
  state: CharState;
  offset: number;
  /** 캐릭터 위 상시 상태메시지 (피어 동기화) */
  statusMessage?: string;
};

export type ChatAttachment =
  | { kind: "link"; url: string }
  | { kind: "image"; name: string; dataUrl: string }
  | { kind: "file"; name: string; mime: string; dataUrl: string };

export function sanitizeChatAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  let images = 0;
  let files = 0;
  for (const item of raw) {
    if (out.length >= MAX_CHAT_ATTACHMENTS) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.kind === "link") {
      const url = String(row.url ?? "").trim();
      if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) continue;
      out.push({ kind: "link", url });
      continue;
    }
    if (row.kind === "image") {
      if (images >= 1) continue;
      const dataUrl = String(row.dataUrl ?? "");
      if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_CHAT_IMAGE_DATA_URL) {
        continue;
      }
      images += 1;
      out.push({
        kind: "image",
        name: String(row.name ?? "image").slice(0, 80),
        dataUrl,
      });
      continue;
    }
    if (row.kind === "file") {
      if (files >= 1) continue;
      const dataUrl = String(row.dataUrl ?? "");
      if (!dataUrl.startsWith("data:") || dataUrl.length > MAX_CHAT_FILE_DATA_URL) continue;
      files += 1;
      out.push({
        kind: "file",
        name: String(row.name ?? "file").slice(0, 80),
        mime: String(row.mime ?? "application/octet-stream").slice(0, 80),
        dataUrl,
      });
    }
  }
  return out;
}

export type ChatMessage = {
  id: string;
  memberId: string;
  nickname: string;
  text: string;
  at: number;
  /** 없으면 일반 채팅 */
  kind?: "chat" | "letter" | "egg";
  /** 편지/계란 대상 닉네임 (없으면 방 전원) */
  targetNickname?: string;
  /** 링크·이미지·파일. 서버에 저장하지 않고 수신 중인 클라이언트에만 전달 */
  attachments?: ChatAttachment[];
};

export type EffectChatParse = {
  kind: "chat" | "letter" | "egg";
  text: string;
  /** 지정 시 해당 닉만 (없으면 전원) */
  targetNickname?: string;
};

function stripTargetToken(token: string) {
  return token.replace(/^@/, "").trim().normalize("NFC");
}

/** 닉네임 동일 여부 (NFC·대소문자 무시) */
export function nicknamesEqual(a: string, b: string): boolean {
  const left = stripTargetToken(a).toLowerCase();
  const right = stripTargetToken(b).toLowerCase();
  return Boolean(left) && left === right;
}

function matchNickname(candidate: string, nicknames: string[]) {
  const key = stripTargetToken(candidate).toLowerCase();
  if (!key) return undefined;
  const entries = nicknames
    .map((n) => ({ raw: n.trim(), norm: n.trim().normalize("NFC") }))
    .filter((e) => e.norm);
  const exact = entries.find((e) => e.norm.toLowerCase() === key);
  if (exact) return exact.raw;
  // 유일한 접두/포함 매치면 허용 (한글 1글자 닉 일부 입력 포함)
  if (key.length >= 1) {
    const prefixed = entries.filter((e) =>
      e.norm.toLowerCase().startsWith(key),
    );
    if (prefixed.length === 1) return prefixed[0].raw;
    const includes = entries.filter((e) =>
      e.norm.toLowerCase().includes(key),
    );
    if (includes.length === 1) return includes[0].raw;
  }
  return undefined;
}

/**
 * `/편지 내용`, `/편지 @닉 내용`, `/계란 [닉]`
 * - `/편지 안녕 하세요` → 전원, 본문 전체
 * - `/편지 @혜수` → 대상만 지정(본문 대기) — 힌트 `→혜수`
 * - `/편지 @혜수 안녕안녕` → 대상+본문 (`@` 없는 첫 단어는 본문)
 */
export function parseEffectChat(
  raw: string,
  memberNicknames: string[] = [],
): EffectChatParse {
  const trimmed = String(raw ?? "").trim().normalize("NFC");
  const nicks = memberNicknames.map((n) => n.trim()).filter(Boolean);

  const egg = trimmed.match(/^\/(?:계란|egg)(?:\s+(@?\S+))?\s*$/i);
  if (egg) {
    if (!egg[1]) return { kind: "egg", text: "계란" };
    const token = stripTargetToken(egg[1]);
    const hit = matchNickname(token, nicks);
    return { kind: "egg", text: "계란", targetNickname: hit ?? token };
  }

  const letterBody = trimmed.match(/^\/(?:편지|letter)\s+([\s\S]*)$/i);
  if (letterBody) {
    const rest = letterBody[1].trim();
    if (!rest) return { kind: "letter", text: "" };

    const mentioned = rest.match(/^@(\S+)(?:\s+([\s\S]*))?$/);
    if (mentioned) {
      const token = stripTargetToken(mentioned[1]);
      const body = (mentioned[2] ?? "").trim();
      const hit = token ? matchNickname(token, nicks) : undefined;
      if (!token) return { kind: "letter", text: rest };
      return {
        kind: "letter",
        text: body,
        targetNickname: hit ?? token,
      };
    }

    return { kind: "letter", text: rest };
  }
  if (/^\/(?:편지|letter)\s*$/i.test(trimmed)) {
    return { kind: "letter", text: "" };
  }
  return { kind: "chat", text: trimmed };
}

/** @deprecated parseEffectChat 사용 */
export function parseLetterChat(raw: string): {
  kind: "chat" | "letter";
  text: string;
} {
  const parsed = parseEffectChat(raw);
  if (parsed.kind === "egg") return { kind: "chat", text: raw.trim() };
  return { kind: parsed.kind, text: parsed.text };
}

export function isLetterChatDraft(raw: string): boolean {
  return /^\/(?:편지|letter)(\s|$)/i.test(String(raw ?? "").trim());
}

/** `/계란` 또는 `/계란 닉네임` */
export function isEggChat(raw: string): boolean {
  return /^\/(?:계란|egg)(?:\s+@?\S+)?\s*$/i.test(String(raw ?? "").trim());
}

export function isBombChatDraft(raw: string): boolean {
  return /^\/(?:폭탄|bomb)(\s|$)/i.test(String(raw ?? "").trim());
}

export function isLadderChatDraft(raw: string): boolean {
  return /^\/(?:사다리|ladder)(\s|$)/i.test(String(raw ?? "").trim());
}

export function isRouletteChatDraft(raw: string): boolean {
  return /^\/(?:룰렛|roulette)(\s|$)/i.test(String(raw ?? "").trim());
}

export function isSketchChatDraft(raw: string): boolean {
  return /^\/(?:스케치|sketch)(\s|$)/i.test(String(raw ?? "").trim());
}

export type MiniGameParse =
  | { kind: "bomb-start"; seconds: number; random: boolean }
  | { kind: "bomb-pass"; targetNickname?: string; random: boolean }
  | { kind: "ladder-open" }
  | { kind: "roulette-open" }
  | { kind: "sketch-open"; rounds: number }
  | { kind: "sketch-join" }
  | { kind: "none" };

export const SKETCH_MIN_ROUNDS = 1;
export const SKETCH_MAX_ROUNDS = 10;
export const SKETCH_DEFAULT_ROUNDS = 3;
export const SKETCH_ROUND_MS = 180_000;
export const SKETCH_REVEAL_MS = 2500;
export const SKETCH_VOTE_MS = 20_000;
/** 혼자 테스트도 가능하도록 1명. 여러 명이면 투표로 골라 참가 */
export const SKETCH_MIN_YES = 1;

/** `/폭탄 30` · `/폭탄 랜덤` · `/폭탄 넘겨 [닉]` · `/사다리` · `/룰렛` · `/스케치 3` */
export function parseMiniGameChat(raw: string): MiniGameParse {
  const trimmed = String(raw ?? "").trim().normalize("NFC");
  const bombRandom = trimmed.match(/^\/(?:폭탄|bomb)\s+(?:랜덤|random)\s*$/i);
  if (bombRandom) {
    return { kind: "bomb-start", seconds: 0, random: true };
  }
  const bombStart = trimmed.match(/^\/(?:폭탄|bomb)\s+(\d+)\s*$/i);
  if (bombStart) {
    const seconds = Math.max(5, Math.min(120, Number(bombStart[1]) || 30));
    return { kind: "bomb-start", seconds, random: false };
  }
  const bombPass = trimmed.match(
    /^\/(?:폭탄|bomb)\s+(?:넘겨|pass)(?:\s+(@?\S+))?\s*$/i,
  );
  if (bombPass) {
    if (bombPass[1]) {
      return {
        kind: "bomb-pass",
        targetNickname: stripTargetToken(bombPass[1]),
        random: false,
      };
    }
    return { kind: "bomb-pass", random: true };
  }
  if (/^\/(?:사다리|ladder)\s*$/i.test(trimmed)) {
    return { kind: "ladder-open" };
  }
  if (/^\/(?:룰렛|roulette)\s*$/i.test(trimmed)) {
    return { kind: "roulette-open" };
  }
  if (/^\/(?:스케치|sketch)\s+(?:참여|join)\s*$/i.test(trimmed)) {
    return { kind: "sketch-join" };
  }
  const sketchOpen = trimmed.match(/^\/(?:스케치|sketch)(?:\s+(\d+))?\s*$/i);
  if (sketchOpen) {
    const n = sketchOpen[1] ? Number(sketchOpen[1]) : SKETCH_DEFAULT_ROUNDS;
    const rounds = Number.isFinite(n)
      ? Math.max(SKETCH_MIN_ROUNDS, Math.min(SKETCH_MAX_ROUNDS, Math.floor(n)))
      : SKETCH_DEFAULT_ROUNDS;
    return { kind: "sketch-open", rounds };
  }
  return { kind: "none" };
}

export type BombState = {
  endsAt: number;
  durationSec: number;
  holderMemberId: string;
  holderNickname: string;
  startedByMemberId: string;
};

export type BombExplodePayload = {
  holderMemberId: string;
  holderNickname: string;
  at: number;
};

export type BombStartPayload = { seconds?: number; random?: boolean };
export type BombPassPayload = {
  random?: boolean;
  targetNickname?: string;
};

export type BombAck = { ok: true; bomb: BombState } | { ok: false; error: string };

/** rungs[row][gap] = true → gap와 gap+1 열을 가로로 연결 */
export type LadderState = {
  hostMemberId: string;
  hostNickname: string;
  names: string[];
  memberIds: string[];
  outcomes: string[];
  rungs: boolean[][];
  phase: "setup" | "running" | "done";
  /** phase=done 일 때 name → outcome */
  results?: Array<{ name: string; outcome: string }>;
};

export type LadderStartPayload = {
  memberIds: string[];
  /** 길이는 memberIds와 동일. 비우면 꽝/당첨 자동 */
  outcomes?: string[];
  mode?: "winlose" | "custom";
};

export type LadderAck =
  | { ok: true; ladder: LadderState }
  | { ok: false; error: string };

export const ROULETTE_MIN_SLOTS = 2;
export const ROULETTE_MAX_SLOTS = 8;

export type RouletteState = {
  hostMemberId: string;
  hostNickname: string;
  slots: string[];
  winnerIndex: number;
  /** 포인터(위)에 당첨 칸 중심이 오도록 한 바퀴 각도. 여러 바퀴 포함 */
  stopAngle: number;
  phase: "setup" | "spinning" | "done";
};

export type RouletteSpinPayload = { slots: string[] };

export type RouletteAck =
  | { ok: true; roulette: RouletteState }
  | { ok: false; error: string };

export type SketchCategoryId =
  | "animal"
  | "food"
  | "object"
  | "job"
  | "media";

export type SketchCategory = {
  id: SketchCategoryId;
  label: string;
  topics: string[];
};

export const SKETCH_CATEGORIES: SketchCategory[] = [
  {
    id: "animal",
    label: "동물",
    topics: [
      "고양이",
      "강아지",
      "토끼",
      "펭귄",
      "코끼리",
      "기린",
      "판다",
      "햄스터",
      "돌고래",
      "여우",
      "사자",
      "호랑이",
      "곰",
      "늑대",
      "다람쥐",
      "고슴도치",
      "너구리",
      "수달",
      "하마",
      "악어",
      "뱀",
      "도마뱀",
      "거북이",
      "개구리",
      "올챙이",
      "상어",
      "고래",
      "문어",
      "오징어",
      "해파리",
      "불가사리",
      "게",
      "가재",
      "새우",
      "조개",
      "달팽이",
      "지렁이",
      "나비",
      "잠자리",
      "무당벌레",
      "개미",
      "벌",
      "메뚜기",
      "매미",
      "거미",
      "전갈",
      "독수리",
      "올빼미",
      "까마귀",
      "참새",
      "비둘기",
      "앵무새",
      "백조",
      "오리",
      "닭",
      "병아리",
      "공작",
      "플라밍고",
      "타조",
      "갈매기",
      "두루미",
      "원숭이",
      "고릴라",
      "캥거루",
      "코알라",
      "나무늘보",
      "낙타",
      "알파카",
      "얼룩말",
      "사슴",
      "순록",
      "멧돼지",
      "하이에나",
      "치타",
      "표범",
      "스컹크",
      "두더지",
      "박쥐",
      "코뿔소",
      "염소",
      "양",
      "소",
      "말",
      "돼지",
      "쥐",
      "물개",
      "바다사자",
      "북극곰",
      "범고래",
      "가오리",
      "해마",
      "금붕어",
      "카멜레온",
      "고라니",
      "딱따구리",
      "제비",
      "까치",
      "용",
      "유니콘",
      "페가수스",
    ],
  },
  {
    id: "food",
    label: "음식",
    topics: [
      "김밥",
      "피자",
      "치킨",
      "수박",
      "아이스크림",
      "라면",
      "케이크",
      "사과",
      "햄버거",
      "떡볶이",
      "초밥",
      "삼겹살",
      "갈비",
      "불고기",
      "비빔밥",
      "된장찌개",
      "김치찌개",
      "부대찌개",
      "감자탕",
      "삼계탕",
      "냉면",
      "짜장면",
      "짬뽕",
      "탕수육",
      "군만두",
      "호빵",
      "붕어빵",
      "핫도그",
      "어묵",
      "순대",
      "감자튀김",
      "치즈스틱",
      "샌드위치",
      "크로와상",
      "도넛",
      "마카롱",
      "푸딩",
      "초콜릿",
      "쿠키",
      "와플",
      "팬케이크",
      "타코",
      "부리또",
      "스테이크",
      "스파게티",
      "리조또",
      "오믈렛",
      "계란프라이",
      "베이컨",
      "소시지",
      "치즈",
      "바게트",
      "볶음밥",
      "카레",
      "우동",
      "소바",
      "쌀국수",
      "팟타이",
      "딤섬",
      "돈가스",
      "타코야키",
      "오코노미야키",
      "라멘",
      "보쌈",
      "족발",
      "곱창",
      "육개장",
      "간장게장",
      "새우튀김",
      "고등어구이",
      "오징어볶음",
      "제육볶음",
      "닭갈비",
      "찜닭",
      "김치전",
      "파전",
      "호떡",
      "송편",
      "떡국",
      "칼국수",
      "수제비",
      "비빔국수",
      "쫄면",
      "잡채",
      "김치",
      "샐러드",
      "딸기",
      "바나나",
      "포도",
      "오렌지",
      "레몬",
      "키위",
      "망고",
      "파인애플",
      "복숭아",
      "체리",
      "아보카도",
      "토마토",
      "당근",
      "고구마",
    ],
  },
  {
    id: "object",
    label: "물건",
    topics: [
      "우산",
      "안경",
      "시계",
      "연필",
      "가방",
      "전화기",
      "의자",
      "열쇠",
      "칫솔",
      "카메라",
      "노트북",
      "마우스",
      "키보드",
      "모니터",
      "헤드폰",
      "리모컨",
      "텔레비전",
      "냉장고",
      "전자레인지",
      "세탁기",
      "청소기",
      "선풍기",
      "에어컨",
      "전등",
      "촛불",
      "가위",
      "숟가락",
      "젓가락",
      "포크",
      "접시",
      "컵",
      "물병",
      "텀블러",
      "냄비",
      "프라이팬",
      "주전자",
      "도마",
      "다리미",
      "옷걸이",
      "책상",
      "소파",
      "침대",
      "베개",
      "이불",
      "커튼",
      "거울",
      "빗",
      "헤어드라이어",
      "수건",
      "빗자루",
      "망치",
      "드라이버",
      "톱",
      "테이프",
      "스테이플러",
      "자",
      "지우개",
      "볼펜",
      "형광펜",
      "붓",
      "팔레트",
      "스케치북",
      "책",
      "지도",
      "지구본",
      "나침반",
      "망원경",
      "돋보기",
      "손전등",
      "배터리",
      "충전기",
      "자물쇠",
      "지갑",
      "동전",
      "지폐",
      "여권",
      "달력",
      "모래시계",
      "온도계",
      "줄자",
      "금고",
      "선물상자",
      "리본",
      "풍선",
      "트로피",
      "메달",
      "왕관",
      "반지",
      "목걸이",
      "모자",
      "헬멧",
      "장갑",
      "목도리",
      "벨트",
      "운동화",
      "구두",
      "부츠",
      "배낭",
      "캐리어",
      "유모차",
    ],
  },
  {
    id: "job",
    label: "직업",
    topics: [
      "의사",
      "요리사",
      "경찰",
      "소방관",
      "가수",
      "화가",
      "선생님",
      "우주비행사",
      "농부",
      "운동선수",
      "간호사",
      "약사",
      "치과의사",
      "수의사",
      "한의사",
      "응급구조사",
      "판사",
      "검사",
      "변호사",
      "형사",
      "경호원",
      "군인",
      "조종사",
      "승무원",
      "선장",
      "잠수부",
      "어부",
      "사냥꾼",
      "목수",
      "배관공",
      "전기공",
      "용접공",
      "정비사",
      "건축가",
      "광부",
      "고고학자",
      "과학자",
      "화학자",
      "물리학자",
      "생물학자",
      "천문학자",
      "기상학자",
      "프로그래머",
      "게임개발자",
      "웹디자이너",
      "그래픽디자이너",
      "영상편집자",
      "영화감독",
      "배우",
      "성우",
      "무용수",
      "발레리나",
      "작곡가",
      "피아니스트",
      "기타리스트",
      "드러머",
      "바이올리니스트",
      "DJ",
      "래퍼",
      "아이돌",
      "모델",
      "패션디자이너",
      "미용사",
      "메이크업아티스트",
      "사진작가",
      "기자",
      "아나운서",
      "작가",
      "소설가",
      "시인",
      "만화가",
      "웹툰작가",
      "일러스트레이터",
      "번역가",
      "통역사",
      "사서",
      "큐레이터",
      "관광가이드",
      "바리스타",
      "소믈리에",
      "제빵사",
      "파티시에",
      "영양사",
      "셰프",
      "웨이터",
      "바텐더",
      "점원",
      "캐셔",
      "회계사",
      "세무사",
      "은행원",
      "택배기사",
      "우체부",
      "배달원",
      "택시운전사",
      "버스기사",
      "트럭운전사",
      "환경미화원",
      "경비원",
      "정원사",
    ],
  },
  {
    id: "media",
    label: "애니·게임",
    topics: [
      "피카츄",
      "슈퍼마리오",
      "젤다",
      "토토로",
      "스폰지밥",
      "마인크래프트",
      "포켓몬",
      "원피스",
      "별의커비",
      "이상해씨",
      "파이리",
      "꼬부기",
      "뮤",
      "이브이",
      "잠만보",
      "메타몽",
      "루이지",
      "피치공주",
      "쿠파",
      "요시",
      "키노피오",
      "동키콩",
      "링크",
      "소닉",
      "테일즈",
      "팩맨",
      "테트리스",
      "류",
      "춘리",
      "슬라임",
      "아리",
      "티모",
      "야스오",
      "징크스",
      "트레이서",
      "겐지",
      "디바",
      "쿠키런",
      "브롤스타즈",
      "앵그리버드",
      "동물의숲",
      "스플래툰",
      "유희왕",
      "아구몬",
      "나루토",
      "사스케",
      "카카시",
      "손오공",
      "베지터",
      "프리저",
      "루피",
      "조로",
      "나미",
      "상디",
      "쵸파",
      "에이스",
      "에렌예거",
      "미카사",
      "리바이",
      "곤",
      "킬루아",
      "히소카",
      "야가미라이토",
      "류크",
      "엘",
      "사이타마",
      "미도리야",
      "올마이트",
      "탄지로",
      "네즈코",
      "젠이츠",
      "이노스케",
      "렌고쿠",
      "고죠사토루",
      "아냐",
      "로이드",
      "요르",
      "덴지",
      "파워",
      "히나타",
      "카게야마",
      "강백호",
      "서태웅",
      "정대만",
      "코난",
      "괴도키드",
      "세일러문",
      "건담",
      "에반게리온",
      "아스카",
      "센",
      "하쿠",
      "가오나시",
      "하울",
      "소피",
      "키키",
      "포뇨",
      "나우시카",
      "알라딘",
      "지니",
    ],
  },
];

export type SketchVote = "yes" | "no";

export type SketchStrokePoint = { x: number; y: number };

export type SketchStroke = {
  id: string;
  color: string;
  width: number;
  points: SketchStrokePoint[];
};

export type SketchScore = {
  memberId: string;
  nickname: string;
  score: number;
};

export type SketchState = {
  hostMemberId: string;
  hostNickname: string;
  totalRounds: number;
  roundIndex: number;
  phase: "voting" | "drawing" | "roundReveal" | "done";
  categoryId: SketchCategoryId | null;
  votes: Array<{ memberId: string; nickname: string; vote: SketchVote }>;
  playerIds: string[];
  drawerMemberId: string | null;
  drawerNickname: string | null;
  /** drawing 중에도 Sync에 포함. UI는 출제자·공개 후에만 표시 */
  topic: string | null;
  strokes: SketchStroke[];
  /** 라운드(그리기) 종료 시각 */
  endsAt: number | null;
  /** 찬반 투표 마감 시각 (voting) */
  voteEndsAt: number | null;
  winnerMemberId: string | null;
  winnerNickname: string | null;
  endReason: "guess" | "reveal" | "timeout" | null;
  /** 이번 사이클에서 이미 출제한 사람 (랜덤 로테이션) */
  drawnMemberIds: string[];
  /** 정답 +1 누적. 종료 시 점수순 표시 */
  scores: SketchScore[];
};

/** 높은 점수 순. 동점이면 닉 가나다 */
export function rankSketchScores(scores: SketchScore[] | null | undefined): SketchScore[] {
  return [...(scores ?? [])].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nickname.localeCompare(b.nickname, "ko");
  });
}

export type SketchOpenPayload = { rounds?: number };
export type SketchVotePayload = { vote: SketchVote };
export type SketchStartPayload = { categoryId: SketchCategoryId };
export type SketchStrokePayload = { stroke: SketchStroke };

export type SketchAck =
  | { ok: true; sketch: SketchState }
  | { ok: false; error: string };

export function normalizeSketchGuess(raw: string): string {
  return String(raw ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    // 제로폭·구두점 제거 후 공백 제거 (고양이! / 고 양 이 도 매칭)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function sketchCategoryById(
  id: SketchCategoryId | null | undefined,
): SketchCategory | undefined {
  if (!id) return undefined;
  return SKETCH_CATEGORIES.find((c) => c.id === id);
}

/** rungs[row][gap] = true → gap와 gap+1 열을 가로로 연결.
 *  columns>=2 이면 가로줄 합계 최소 5개(가능하면)를 보장. */
export function generateLadderRungs(
  columns: number,
  rows = 10,
): boolean[][] {
  const n = Math.max(1, columns);
  const gaps = Math.max(0, n - 1);
  const rowCount = Math.max(1, rows);
  const rungs: boolean[][] = [];

  const canPlace = (line: boolean[], gap: number) => {
    if (gap < 0 || gap >= line.length) return false;
    if (line[gap]) return false;
    if (gap > 0 && line[gap - 1]) return false;
    if (gap < line.length - 1 && line[gap + 1]) return false;
    return true;
  };

  for (let row = 0; row < rowCount; row++) {
    const line: boolean[] = Array.from({ length: gaps }, () => false);
    if (gaps === 0) {
      rungs.push(line);
      continue;
    }
    let skipNext = false;
    for (let gap = 0; gap < gaps; gap++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (Math.random() < 0.72) {
        line[gap] = true;
        skipNext = true;
      }
    }
    rungs.push(line);
  }

  if (gaps === 0) return rungs;

  const countRungs = () =>
    rungs.reduce((n, line) => n + line.filter(Boolean).length, 0);

  // 최소 5개 가로줄 (행·간격이 부족하면 가능한 최대)
  const minRungs = Math.min(5, gaps * rowCount);
  let guard = 0;
  while (countRungs() < minRungs && guard++ < 200) {
    const ri = Math.floor(Math.random() * rowCount);
    const gi = Math.floor(Math.random() * gaps);
    const line = rungs[ri]!;
    if (!canPlace(line, gi)) continue;
    line[gi] = true;
  }

  // 그래도 모자라면 위에서부터 강제 배치
  if (countRungs() < minRungs) {
    for (let ri = 0; ri < rowCount && countRungs() < minRungs; ri++) {
      for (let gi = 0; gi < gaps && countRungs() < minRungs; gi++) {
        if (canPlace(rungs[ri]!, gi)) rungs[ri]![gi] = true;
      }
    }
  }

  return rungs;
}

/** 각 시작 열의 최종 열 인덱스 */
export function resolveLadderPaths(
  columns: number,
  rungs: boolean[][],
): number[] {
  const ends: number[] = [];
  for (let start = 0; start < columns; start++) {
    let col = start;
    for (const row of rungs) {
      if (col > 0 && row[col - 1]) col -= 1;
      else if (col < columns - 1 && row[col]) col += 1;
    }
    ends.push(col);
  }
  return ends;
}

/** 시작 열 → 각 가로줄 통과 후 열 (연출용) */
export function traceLadderPath(
  startCol: number,
  columns: number,
  rungs: boolean[][],
): Array<{ col: number; row: number }> {
  const points: Array<{ col: number; row: number }> = [
    { col: startCol, row: 0 },
  ];
  let col = startCol;
  for (let ri = 0; ri < rungs.length; ri++) {
    const row = rungs[ri]!;
    if (col > 0 && row[col - 1]) col -= 1;
    else if (col < columns - 1 && row[col]) col += 1;
    points.push({ col, row: ri + 1 });
  }
  return points;
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export type RoomSnapshot = {
  code: string;
  members: Member[];
};

export const SocketEvents = {
  RoomCreate: "room:create",
  RoomJoin: "room:join",
  RoomLeave: "room:leave",
  RoomError: "room:error",
  MemberSync: "member:sync",
  ChatSend: "chat:send",
  ChatBroadcast: "chat:broadcast",
  CharState: "char:state",
  MemberProfile: "member:profile",
  PresenceHello: "presence:hello",
  FriendAdd: "friend:add",
  FriendRemove: "friend:remove",
  FriendSync: "friend:sync",
  FriendInvite: "friend:invite",
  FriendInviteRecv: "friend:invite-recv",
  FriendPresence: "friend:presence",
  FriendGroupCreate: "friend:group-create",
  FriendGroupRename: "friend:group-rename",
  FriendGroupDelete: "friend:group-delete",
  FriendGroupAssign: "friend:group-assign",
  RoomNotice: "room:notice",
  GuideMarkSeen: "guide:markSeen",
  BombStart: "bomb:start",
  BombPass: "bomb:pass",
  BombSync: "bomb:sync",
  BombExplode: "bomb:explode",
  LadderOpen: "ladder:open",
  LadderStart: "ladder:start",
  LadderSync: "ladder:sync",
  LadderCancel: "ladder:cancel",
  RouletteOpen: "roulette:open",
  RouletteSpin: "roulette:spin",
  RouletteSync: "roulette:sync",
  RouletteCancel: "roulette:cancel",
  SketchOpen: "sketch:open",
  SketchVote: "sketch:vote",
  SketchJoin: "sketch:join",
  SketchCategory: "sketch:category",
  SketchStart: "sketch:start",
  SketchStroke: "sketch:stroke",
  SketchClear: "sketch:clear",
  SketchReveal: "sketch:reveal",
  SketchSync: "sketch:sync",
  SketchCancel: "sketch:cancel",
} as const;

export type FriendGroup = {
  id: string;
  name: string;
  sortOrder: number;
};

export type FriendInfo = {
  userId: string;
  friendCode: string;
  nickname: string;
  character: Character;
  online: boolean;
  /** 내 목록 전용 — 여러 그룹에 속할 수 있음 (빈 배열 = 미분류) */
  groupIds: string[];
};

export type FriendListPayload = {
  friends: FriendInfo[];
  groups: FriendGroup[];
};

export type PresenceHelloPayload = {
  userId: string;
  friendCode: string;
  nickname: string;
  character: Character;
};

export type PresenceHelloAck =
  | {
      ok: true;
      userId: string;
      friendCode: string;
      friends: FriendInfo[];
      groups: FriendGroup[];
      /** DB에 가이드 이미 봄 여부 — 없으면 false로 취급 */
      guideSeen: boolean;
    }
  | { ok: false; error: string };

export type GuideMarkSeenAck = { ok: true } | { ok: false; error: string };

export type FriendAddPayload = {
  friendCode: string;
};

export type FriendAddAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendRemovePayload = {
  userId: string;
};

export type FriendRemoveAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendGroupCreatePayload = {
  name: string;
};

export type FriendGroupRenamePayload = {
  groupId: string;
  name: string;
};

export type FriendGroupDeletePayload = {
  groupId: string;
};

export type FriendGroupAssignPayload = {
  friendUserId: string;
  /** 소속시킬 그룹 id 목록 (빈 배열 = 미분류) */
  groupIds: string[];
};

export type FriendGroupAck =
  | { ok: true; friends: FriendInfo[]; groups: FriendGroup[] }
  | { ok: false; error: string };

export type FriendInvitePayload = {
  toUserId: string;
  roomCode: string;
};

export type FriendInviteAck =
  | { ok: true }
  | { ok: false; error: string };

export type FriendInviteRecvPayload = {
  fromUserId: string;
  fromNickname: string;
  roomCode: string;
  at: number;
};

export type RoomNoticePayload = {
  type: "member-join" | "member-leave";
  nickname: string;
  memberId: string;
  at: number;
};

export type FriendPresencePayload = {
  userId: string;
  online: boolean;
  nickname?: string;
  character?: Character;
};

export type RoomCreatePayload = {
  nickname: string;
  character: Character;
  statusMessage?: string;
};

export type RoomJoinPayload = {
  code: string;
  nickname: string;
  character: Character;
  statusMessage?: string;
};

export type RoomCreateAck =
  | { ok: true; code: string; memberId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type RoomJoinAck =
  | { ok: true; memberId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type ChatSendPayload = {
  text: string;
  attachments?: ChatAttachment[];
};

export type CharStatePayload = {
  state: CharState;
};

export type MemberProfilePayload = {
  statusMessage?: string;
};

export const PART_CATALOG = {
  head: ["head_round", "head_square", "head_cat"],
  body: ["body_basic", "body_tall", "body_round"],
  outfit: ["outfit_tee", "outfit_hoodie", "outfit_cape"],
  accessory: ["none", "acc_hat", "acc_scarf", "acc_glasses"],
} as const;

export function defaultPartsCharacter(): PartsCharacter {
  return {
    kind: "parts",
    layers: {
      head: "head_round",
      body: "body_basic",
      outfit: "outfit_tee",
      accessory: "none",
    },
    palette: "#6ec6ff",
  };
}

export function defaultCharState(offset = 0): CharState {
  return {
    motion: "walk",
    edge: "top",
    progress: Math.min(0.95, Math.max(0, offset)),
    facing: 1,
    speed: 0.011,
    pathMode: "all",
  };
}

export function createInviteCode(length = INVITE_CODE_LENGTH): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function createFriendCode(length = FRIEND_CODE_LENGTH): string {
  return createInviteCode(length);
}
