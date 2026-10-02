import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_FILE_DATA_URL,
  MAX_CHAT_IMAGE_DATA_URL,
  sanitizeChatAttachments,
  type ChatAttachment,
} from "@monibuddy/shared";

export function canAddAttachment(
  current: ChatAttachment[],
  next: ChatAttachment,
): boolean {
  if (current.length >= MAX_CHAT_ATTACHMENTS) return false;
  if (next.kind === "image" && current.some((a) => a.kind === "image")) return false;
  if (next.kind === "file" && current.some((a) => a.kind === "file")) return false;
  return true;
}

export function attachmentLabel(item: ChatAttachment): string {
  if (item.kind === "link") return item.url;
  if (item.kind === "image") return item.name || "이미지";
  return item.name || "파일";
}

export function fileFromBase64(name: string, mime: string, base64: string): File {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime || "application/octet-stream" });
}

export async function imageFileToAttachment(file: File): Promise<ChatAttachment> {
  if (file.type === "image/gif" && file.size <= 80_000) {
    const dataUrl = await readDataUrl(file);
    if (dataUrl.length > MAX_CHAT_IMAGE_DATA_URL) {
      throw new Error("이미지가 너무 커요");
    }
    return { kind: "image", name: file.name || "image.gif", dataUrl };
  }
  const dataUrl = await compressToJpeg(file);
  if (dataUrl.length > MAX_CHAT_IMAGE_DATA_URL) {
    throw new Error("이미지가 너무 커요");
  }
  return { kind: "image", name: file.name || "image.jpg", dataUrl };
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > 70_000) throw new Error("파일은 70KB 이하만 보낼 수 있어요");
  const dataUrl = await readDataUrl(file);
  if (dataUrl.length > MAX_CHAT_FILE_DATA_URL) {
    throw new Error("파일이 너무 커요");
  }
  return {
    kind: "file",
    name: file.name || "file",
    mime: file.type || "application/octet-stream",
    dataUrl,
  };
}

export function linkToAttachment(raw: string): ChatAttachment {
  const url = raw.trim();
  const [item] = sanitizeChatAttachments([{ kind: "link", url }]);
  if (!item) throw new Error("http 또는 https 주소만 보낼 수 있어요");
  return item;
}

export type AttachCommand = {
  pick: "image" | "file" | "link";
  url: string;
  caption: string;
  letter: boolean;
  letterTo?: string;
};

/** `/사진` `/파일` `/링크 URL` 과 `/편지 @닉 /사진` 형태 */
export function parseAttachCommand(raw: string): AttachCommand | null {
  const text = String(raw ?? "").trim().normalize("NFC");
  const letter = text.match(
    /^\/(?:편지|letter)(?:\s+@(\S+))?\s+\/(사진|이미지|image|파일|file|링크|link)(?:\s+([\s\S]+))?$/i,
  );
  const plain = text.match(
    /^\/(사진|이미지|image|파일|file|링크|link)(?:\s+([\s\S]+))?$/i,
  );
  const hit = letter
    ? { letter: true, letterTo: letter[1], cmd: letter[2] ?? "", rest: letter[3] ?? "" }
    : plain
      ? { letter: false, letterTo: undefined, cmd: plain[1] ?? "", rest: plain[2] ?? "" }
      : null;
  if (!hit) return null;
  const cmd = hit.cmd.toLowerCase();
  if (cmd === "링크" || cmd === "link") {
    const parts = hit.rest.trim().match(/^(https?:\/\/\S+)(?:\s+([\s\S]+))?$/i);
    return {
      pick: "link",
      url: parts?.[1] ?? "",
      caption: (parts?.[2] ?? (parts ? "" : hit.rest)).trim().slice(0, 80),
      letter: hit.letter,
      letterTo: hit.letterTo,
    };
  }
  return {
    pick: cmd === "파일" || cmd === "file" ? "file" : "image",
    url: "",
    caption: hit.rest.trim().slice(0, 80),
    letter: hit.letter,
    letterTo: hit.letterTo,
  };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("파일을 읽지 못했어요"));
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했어요"));
    reader.readAsDataURL(file);
  });
}

function compressToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxEdge = 360;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("이미지를 줄이지 못했어요"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없어요"));
    };
    img.src = url;
  });
}
