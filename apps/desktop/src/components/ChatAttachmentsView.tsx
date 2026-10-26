import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="chat-img-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 확대"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="chat-img-lightbox-close"
        aria-label="닫기"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
      <img
        className="chat-img-lightbox-img"
        src={src}
        alt={alt}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function ChatAttachmentsView({
  items,
}: {
  items?: ChatAttachment[];
}) {
  const [preview, setPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  if (!items?.length) return null;
  return (
    <>
      <span className="chat-attach">
        {items.map((item, index) => {
          if (item.kind === "image") {
            const alt = item.name || "이미지";
            return (
              <button
                key={`${item.kind}-${index}`}
                type="button"
                className="chat-attach-img-btn"
                title="클릭해서 크게 보기"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview({ src: item.dataUrl, alt });
                }}
              >
                <img
                  className="chat-attach-img"
                  src={item.dataUrl}
                  alt={alt}
                />
              </button>
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
      {preview && typeof document !== "undefined"
        ? createPortal(
            <ImageLightbox
              src={preview.src}
              alt={preview.alt}
              onClose={() => setPreview(null)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
