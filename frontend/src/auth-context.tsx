import { useRouter } from "expo-router";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiRequest, clearToken, hasPermission, Permission, saveToken, User } from "@/src/api";
import { initLocalBackend } from "@/src/local-backend";
import { storage } from "@/src/utils/storage";

type AuthContextValue = {
  user: User | null;
  booting: boolean;
  signIn: (payload: { token: string; user: User }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await apiRequest<User>("/auth/me");
      setUser(me);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Guard: initialization should not block boot longer than 5s even if
      // SQLite fails to load (common in web preview). On native builds this
      // resolves in <100ms.
      await Promise.race([
        initLocalBackend().catch(() => undefined),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (cancelled) return;
      const token = await storage.secureGet<string | null>("kasirku_auth_token", null);
      if (token) {
        await Promise.race([
          refresh(),
          new Promise((r) => setTimeout(r, 5000)),
        ]);
      }
      if (!cancelled) setBooting(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const signIn = useCallback(async ({ token, user: next }: { token: string; user: User }) => {
    await saveToken(token);
    setUser(next);
    router.replace("/(tabs)");
  }, [router]);

  const signOut = useCallback(async () => {
    await clearToken();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(() => ({
    user, booting, signIn, signOut, refresh,
    can: (permission) => hasPermission(user, permission),
  }), [user, booting, signIn, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
