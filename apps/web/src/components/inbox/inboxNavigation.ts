import type { EnvironmentId, InboxNotification } from "@t3tools/contracts";
import { create } from "zustand";
export const useInboxNavigation = create<{
  tab: "chats" | "inbox";
  revealId: string | null;
  revealed: { environmentId: EnvironmentId; notification: InboxNotification } | null;
}>(() => ({ tab: "chats", revealId: null, revealed: null }));
