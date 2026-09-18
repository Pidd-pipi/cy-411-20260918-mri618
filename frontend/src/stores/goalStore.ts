import { create } from 'zustand';
import { applyGoalAdjustment, createGoal, fetchGoals, GoalAdjustmentPayload, GoalPayload } from '../api/goal';
import { Goal } from '../types/entities';

interface GoalStore {
  goals: Goal[];
  loading: boolean;
  load: () => Promise<void>;
  add: (payload: GoalPayload) => Promise<void>;
  adjust: (id: number, payload: GoalAdjustmentPayload) => Promise<void>;
}

export const useGoalStore = create<GoalStore>((set, get) => ({
  goals: [],
  loading: false,
  async load() {
    set({ loading: true });
    const goals = await fetchGoals();
    set({ goals, loading: false });
  },
  async add(payload) {
    await createGoal(payload);
    await get().load();
  },
  async adjust(id, payload) {
    await applyGoalAdjustment(id, payload);
    await get().load();
  }
}));
