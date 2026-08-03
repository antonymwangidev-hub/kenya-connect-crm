import { createContext, useContext } from "react";
import type { InboxConversation, TeamMember } from "./inbox-types";

export type InboxCtx = {
  conversations: InboxConversation[];
  members: TeamMember[];
  patchConversation: (id: string, patch: Partial<InboxConversation>) => void;
  reload: () => void;
};

// Lives outside the route file on purpose: route modules are code-split, so a
// context created inside one is a different instance than the one the split
// component chunk imports.
export const InboxContext = createContext<InboxCtx | null>(null);

export function useInbox() {
  const v = useContext(InboxContext);
  if (!v) throw new Error("useInbox must be used inside the inbox layout");
  return v;
}
