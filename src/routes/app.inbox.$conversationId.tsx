import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ChatWindow } from "@/components/inbox/ChatWindow";
import { useAuth } from "@/lib/auth-context";
import { useInbox } from "./app.inbox";

export const Route = createFileRoute("/app/inbox/$conversationId")({
  component: InboxConversationRoute,
});

function InboxConversationRoute() {
  const { conversationId } = useParams({ from: "/app/inbox/$conversationId" });
  const { conversations, members, patchConversation } = useInbox();
  const { user, canWrite } = useAuth();
  const navigate = useNavigate();

  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading conversation…</div>;
  }

  return (
    <ChatWindow
      conversation={conversation}
      members={members}
      userId={user?.id ?? null}
      canWrite={canWrite}
      onBack={() => navigate({ to: "/app/inbox" })}
      onConversationChanged={(patch) => patchConversation(conversation.id, patch)}
    />
  );
}
