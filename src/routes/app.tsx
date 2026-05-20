import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { MessageCircle, Users, Tags, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

const nav = [
  { to: "/app/conversations", label: "Conversations", icon: MessageCircle },
  { to: "/app/contacts", label: "Contacts", icon: Users },
  { to: "/app/tags", label: "Tags", icon: Tags },
] as const;

function AppLayout() {
  const { user, loading, signOut, businessId } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!businessId) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Setting up your workspace…</div>;
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <MessageCircle className="h-4 w-4" />
          </div>
          <span className="font-semibold">PulseCRM</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="px-2 pb-2 text-xs text-sidebar-foreground/60 truncate">{user.email}</div>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex w-full flex-col">
        <header className="flex items-center justify-between border-b bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <span className="font-semibold">PulseCRM</span>
          </div>
          <button onClick={() => signOut()} className="text-xs">Sign out</button>
        </header>
        <nav className="flex border-b bg-sidebar text-sidebar-foreground md:hidden">
          {nav.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex-1 px-3 py-2 text-center text-xs ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
