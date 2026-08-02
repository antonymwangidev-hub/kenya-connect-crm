import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Business = { id: string; name: string; onboarded_at: string | null; logo_url: string | null };
export type MemberRole = "admin" | "agent" | "viewer";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  businessId: string | null;
  business: Business | null;
  role: MemberRole | null;
  isOwner: boolean;
  canWrite: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshBusiness: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadBusiness = async (uid: string) => {
    // 1) A business the user owns.
    const { data: owned } = await supabase
      .from("businesses")
      .select("id,name,onboarded_at,logo_url")
      .eq("owner_id", uid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (owned) {
      setBusiness(owned as Business);
      setRole("admin");
      setIsOwner(true);
      return;
    }

    // 2) Otherwise, a business the user is a team member of (shared inbox).
    await supabase.rpc("claim_membership").then(() => {}, () => {});
    const { data: membership } = await supabase
      .from("business_members")
      .select("role,business:businesses!inner(id,name,onboarded_at,logo_url)")
      .eq("user_id", uid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membership?.business) {
      setBusiness(membership.business as unknown as Business);
      setRole((membership.role as MemberRole) ?? "agent");
      setIsOwner(false);
      return;
    }

    setBusiness(null);
    setRole(null);
    setIsOwner(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadBusiness(s.user.id), 0);
      } else {
        setBusiness(null);
        setRole(null);
        setIsOwner(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadBusiness(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user,
    session,
    businessId: business?.id ?? null,
    business,
    role,
    isOwner,
    canWrite: role === "admin" || role === "agent",
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    refreshBusiness: async () => { if (user) await loadBusiness(user.id); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
