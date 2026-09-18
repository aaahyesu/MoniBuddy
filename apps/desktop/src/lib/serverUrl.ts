/** 프로덕션(렌더) 기본 서버 — GitHub vars / Vite env 로 덮어쓸 수 있음 */
export const PRODUCTION_SERVER_URL = "https://monibuddy-server.onrender.com";

export function resolveDefaultServerUrl(): string {
  const fromEnv = (import.meta.env.VITE_MONIBUDDY_SERVER_URL as string | undefined)?.trim();
  // CI에서 vars 미설정 시 빈 문자열이 들어올 수 있음 → 무시
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  // 배포/설치본은 공용 서버, 로컬 개발은 localhost
  if (import.meta.env.PROD) return PRODUCTION_SERVER_URL;
  return "http://127.0.0.1:3847";
}
