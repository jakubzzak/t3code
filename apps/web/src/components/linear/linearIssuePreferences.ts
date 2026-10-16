import type { LinearIssueSort } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "~/lib/storage";

export interface LinearIssuePreferences {
  sort: LinearIssueSort;
  stateIds: readonly string[];
  priorities: readonly (0 | 1 | 2 | 3 | 4)[];
}

export const defaultLinearIssuePreferences: LinearIssuePreferences = {
  sort: "updatedAt",
  stateIds: [],
  priorities: [],
};

export const useLinearIssuePreferences = create<{
  byProject: Record<string, LinearIssuePreferences>;
  select: (key: string, value: LinearIssuePreferences) => void;
}>()(
  persist(
    (set) => ({
      byProject: {},
      select: (key, value) => set((state) => ({ byProject: { ...state.byProject, [key]: value } })),
    }),
    {
      name: "t3code:linear-issue-preferences:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);
