import { createFriendCode } from "@monibuddy/shared";

const KEY = "monibuddy.device.v1";

export type DeviceIdentity = {
  userId: string;
  friendCode: string;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function readDeviceIdentity(): DeviceIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;
      if (parsed.userId && parsed.friendCode) {
        return {
          userId: String(parsed.userId).slice(0, 40),
          friendCode: String(parsed.friendCode).trim().toUpperCase().slice(0, 8),
        };
      }
    }
  } catch {
    /* ignore */
  }
  const next: DeviceIdentity = {
    userId: randomId(),
    friendCode: createFriendCode(),
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function writeDeviceIdentity(next: DeviceIdentity) {
  localStorage.setItem(KEY, JSON.stringify(next));
}
