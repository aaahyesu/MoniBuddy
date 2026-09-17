/**
 * Quick Socket.IO smoke: create room, join, chat once.
 * Usage: node scripts/smoke-room.mjs
 */
import { io } from "socket.io-client";

const URL = process.env.MONIBUDDY_URL || "http://127.0.0.1:3847";

const character = {
  kind: "parts",
  layers: {
    head: "head_round",
    body: "body_basic",
    outfit: "outfit_tee",
    accessory: "none",
  },
  palette: "#6ec6ff",
};

function client(name) {
  return io(URL, { transports: ["websocket"] });
}

const a = client("a");
const b = client("b");

await Promise.all([
  new Promise((r, j) => {
    a.once("connect", r);
    a.once("connect_error", j);
  }),
  new Promise((r, j) => {
    b.once("connect", r);
    b.once("connect_error", j);
  }),
]);

const created = await new Promise((resolve) => {
  a.emit("room:create", { nickname: "Alpha", character }, resolve);
});
if (!created?.ok) throw new Error("create failed: " + JSON.stringify(created));
console.log("created", created.code);

const joined = await new Promise((resolve) => {
  b.emit(
    "room:join",
    { code: created.code, nickname: "Beta", character },
    resolve,
  );
});
if (!joined?.ok) throw new Error("join failed: " + JSON.stringify(joined));
console.log("joined members", joined.room.members.length);

const msg = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("chat timeout")), 3000);
  a.on("chat:broadcast", (m) => {
    clearTimeout(t);
    resolve(m);
  });
  b.emit("chat:send", { text: "hello monibuddy" });
});

if (msg.text !== "hello monibuddy") throw new Error("bad chat");
console.log("chat ok", msg.id);
a.close();
b.close();
process.exit(0);
