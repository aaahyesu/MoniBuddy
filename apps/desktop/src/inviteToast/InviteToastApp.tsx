import { useEffect, useState } from "react";
import type { FriendInviteRecvPayload } from "@monibuddy/shared";
import {
  PENDING_INVITE_EVENT,
  PENDING_INVITE_KEY,
  readPendingInvite,
  writeInviteAction,
} from "../lib/overlayBridge";
import { invokeSafe } from "../lib/tauri";

export function InviteToastApp() {
  useEffect(() => {
    document.body.classList.add("invite-toast-body");
    document.body.classList.remove("settings-body", "overlay-body");
  }, []);

  const [invite, setInvite] = useState<FriendInviteRecvPayload | null>(() =>
    readPendingInvite(),
  );

  useEffect(() => {
    const sync = () => {
      const next = readPendingInvite();
      setInvite(next);
      if (!next) {
        void invokeSafe("hide_invite_toast");
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PENDING_INVITE_KEY || e.key == null) sync();
    };
    window.addEventListener(PENDING_INVITE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(sync, 400);
    return () => {
      window.removeEventListener(PENDING_INVITE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);

  const nick = (invite?.fromNickname || "").trim() || "친구";

  const onAccept = () => {
    writeInviteAction("accept");
    void invokeSafe("toggle_overlay", { visible: true });
    void invokeSafe("hide_invite_toast");
  };

  const onDismiss = () => {
    writeInviteAction("dismiss");
    void invokeSafe("hide_invite_toast");
  };

  if (!invite) {
    return <div className="invite-toast-root" />;
  }

  return (
    <div className="invite-toast-root">
      <div className="invite-toast-card">
        <p className="invite-toast-brand">MoniBuddy</p>
        <p className="invite-toast-text">
          <strong>{nick}</strong>님에게 초대가 왔습니다
        </p>
        <p className="invite-toast-code">{invite.roomCode}</p>
        <div className="invite-toast-actions">
          <button type="button" className="invite-toast-btn accept" onClick={onAccept}>
            입장
          </button>
          <button type="button" className="invite-toast-btn dismiss" onClick={onDismiss}>
            거절
          </button>
        </div>
      </div>
    </div>
  );
}
