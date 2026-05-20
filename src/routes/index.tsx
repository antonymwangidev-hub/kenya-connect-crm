import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MessageCircle, Users, Tags, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/app/conversations" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <MessageCircle className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">PulseCRM</span>
          </div>
          <Link to="/auth" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <span className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Built for Kenyan SMBs</span>
        <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-6xl">
          A WhatsApp-first CRM<br />for small businesses.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Track every customer, every message, every tag — in one clean inbox. Built for the way Kenya does business.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/auth" className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            Get started free
          </Link>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            { icon: Users, title: "Contacts", desc: "Centralize every customer in one searchable list." },
            { icon: MessageCircle, title: "Conversations", desc: "WhatsApp-style chat with inbound & outbound logs." },
            { icon: Tags, title: "Tags", desc: "Organize leads with custom tags per contact." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 text-left">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        <Zap className="mx-auto h-4 w-4" /> PulseCRM
      </footer>
    </div>
  );
}
