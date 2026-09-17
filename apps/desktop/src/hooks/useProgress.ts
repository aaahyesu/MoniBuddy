import { useCallback, useEffect, useMemo, useState } from "react";
import { stageFromXp } from "@monibuddy/shared";
import { QUESTS, type QuestId } from "../lib/quests";

const KEY = "monibuddy.progress.v1";

export type ProgressState = {
  /** buddy ids unlocked (includes free ones after first load) */
  unlocked: string[];
  /** questId -> progress count */
  questProgress: Record<string, number>;
  /** completed quest ids */
  completedQuests: string[];
  /** buddyId -> xp */
  growthXp: Record<string, number>;
  /** toast-like notices */
  lastUnlocks: string[];
};

function empty(): ProgressState {
  return {
    unlocked: [],
    questProgress: {},
    completedQuests: [],
    growthXp: {},
    lastUnlocks: [],
  };
}

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

function save(state: ProgressState) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("monibuddy:progress", { detail: state }));
}

export function useProgress(freeBuddyIds: string[]) {
  const [state, setState] = useState<ProgressState>(load);

  useEffect(() => {
    setState((prev) => {
      const unlocked = new Set([...prev.unlocked, ...freeBuddyIds]);
      const next = { ...prev, unlocked: Array.from(unlocked) };
      save(next);
      return next;
    });
  }, [freeBuddyIds]);

  const persist = useCallback((updater: (p: ProgressState) => ProgressState) => {
    setState((prev) => {
      const next = updater(prev);
      save(next);
      return next;
    });
  }, []);

  const isUnlocked = useCallback(
    (buddyId: string) => state.unlocked.includes(buddyId),
    [state.unlocked],
  );

  const getXp = useCallback(
    (buddyId: string) => state.growthXp[buddyId] ?? 0,
    [state.growthXp],
  );

  const addGrowthXp = useCallback(
    (buddyId: string, amount = 1) => {
      persist((prev) => {
        const before = prev.growthXp[buddyId] ?? 0;
        const after = before + amount;
        const grew = stageFromXp(after) > stageFromXp(before);
        const questProgress = { ...prev.questProgress };
        const completedQuests = [...prev.completedQuests];
        const unlocked = new Set(prev.unlocked);

        if (grew) {
          questProgress["quest:grow_once"] = Math.max(questProgress["quest:grow_once"] ?? 0, 1);
        }

        // auto-complete quests & unlock rewards
        const lastUnlocks: string[] = [];
        for (const q of QUESTS) {
          const prog = questProgress[q.id] ?? 0;
          if (prog >= q.target && !completedQuests.includes(q.id)) {
            completedQuests.push(q.id);
            if (!unlocked.has(q.rewardBuddyId)) {
              unlocked.add(q.rewardBuddyId);
              lastUnlocks.push(q.rewardBuddyId);
            }
          }
        }

        return {
          ...prev,
          growthXp: { ...prev.growthXp, [buddyId]: after },
          questProgress,
          completedQuests,
          unlocked: Array.from(unlocked),
          lastUnlocks,
        };
      });
    },
    [persist],
  );

  const trackQuest = useCallback(
    (questId: QuestId, amount = 1) => {
      persist((prev) => {
        const questProgress = {
          ...prev.questProgress,
          [questId]: (prev.questProgress[questId] ?? 0) + amount,
        };
        const completedQuests = [...prev.completedQuests];
        const unlocked = new Set(prev.unlocked);
        const lastUnlocks: string[] = [];

        for (const q of QUESTS) {
          const prog = questProgress[q.id] ?? 0;
          if (prog >= q.target && !completedQuests.includes(q.id)) {
            completedQuests.push(q.id);
            if (!unlocked.has(q.rewardBuddyId)) {
              unlocked.add(q.rewardBuddyId);
              lastUnlocks.push(q.rewardBuddyId);
            }
          }
        }

        return {
          ...prev,
          questProgress,
          completedQuests,
          unlocked: Array.from(unlocked),
          lastUnlocks,
        };
      });
    },
    [persist],
  );

  const clearLastUnlocks = useCallback(() => {
    persist((prev) => ({ ...prev, lastUnlocks: [] }));
  }, [persist]);

  const questView = useMemo(
    () =>
      QUESTS.map((q) => ({
        ...q,
        progress: state.questProgress[q.id] ?? 0,
        done: state.completedQuests.includes(q.id),
      })),
    [state.questProgress, state.completedQuests],
  );

  return {
    state,
    isUnlocked,
    getXp,
    addGrowthXp,
    trackQuest,
    questView,
    clearLastUnlocks,
  };
}
