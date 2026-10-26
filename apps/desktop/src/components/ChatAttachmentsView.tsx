import type { ReactNode } from "react";
import type { ChatAttachment } from "@monibuddy/shared";
import { isTauri } from "../lib/tauri";

async function openExternalUrl(url: string) {
  const href = url.trim();
  if (!/^https?:\/\//i.test(href)) return;
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url: href });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/** 본문 속 http(s)를 클릭 가능한 링크로 */
export function ChatTextWithLinks({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(https?:\/\/[^\s]+)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[1]!;
    parts.push(
      <a
        key={`u-${i++}`}
        className="chat-attach-link inline"
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void openExternalUrl(url);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) return <>{text}</>;
  return <>{parts}</>;
}

export function ChatAttachmentsView({
  items,
}: {
  items?: ChatAttachment[];
}) {
  if (!items?.length) return null;
  return (
    <span className="chat-attach">
      {items.map((item, index) => {
        if (item.kind === "image") {
          return (
            <img
              key={`${item.kind}-${index}`}
              className="chat-attach-img"
              src={item.dataUrl}
              alt={item.name || "이미지"}
            />
          );
        }
        if (item.kind === "link") {
          return (
            <a
              key={`${item.kind}-${index}`}
              className="chat-attach-link"
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(item.url);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {item.url}
            </a>
          );
        }
        return (
          <a
            key={`${item.kind}-${index}`}
            className="chat-attach-link"
            href={item.dataUrl}
            download={item.name}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {item.name}
          </a>
        );
      })}
    </span>
  );
}
