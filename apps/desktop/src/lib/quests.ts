export type QuestId = "quest:first_room" | "quest:chat_10" | "quest:grow_once";

export type QuestDef = {
  id: QuestId;
  title: string;
  description: string;
  /** reward buddy id in manifest */
  rewardBuddyId: string;
  target: number;
};

export const QUESTS: QuestDef[] = [
  {
    id: "quest:first_room",
    title: "첫 모임",
    description: "방을 한 번 만들거나 입장하세요.",
    rewardBuddyId: "reward_aha",
    target: 1,
  },
  {
    id: "quest:chat_10",
    title: "수다쟁이",
    description: "채팅을 10번 보내세요.",
    rewardBuddyId: "reward_thumbup",
    target: 10,
  },
  {
    id: "quest:grow_once",
    title: "무럭무럭",
    description: "버디를 1단계 이상 성장시키세요.",
    rewardBuddyId: "reward_annoyed",
    target: 1,
  },
];
