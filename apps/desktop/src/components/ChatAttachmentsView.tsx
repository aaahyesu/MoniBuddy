import type { ChatAttachment } from "@monibuddy/shared";

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
          >
            {item.name}
          </a>
        );
      })}
    </span>
  );
}
