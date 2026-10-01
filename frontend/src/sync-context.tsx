import NetInfo from "@react-native-community/netinfo";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { flushQueue, pendingSyncCount } from "@/src/api";

type SyncContextValue = {
  online: boolean;
  pending: number;
  flushing: boolean;
  refresh: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue>({ online: true, pending: 0, flushing: false, refresh: async () => undefined });

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const flushing_ref = useRef(false);

  const refresh = useCallback(async () => {
    setPending(await pendingSyncCount());
  }, []);

  const run = useCallback(async () => {
    if (flushing_ref.current) return;
    const count = await pendingSyncCount();
    setPending(count);
    if (!count) return;
    flushing_ref.current = true;
    setFlushing(true);
    try {
      const result = await flushQueue();
      if (result.sent) setPending(await pendingSyncCount());
    } finally {
      flushing_ref.current = false;
      setFlushing(false);
    }
  }, []);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const next = !!state.isConnected;
      setOnline(next);
      if (next) run();
    });
    refresh();
    const timer = setInterval(() => { if (online) run(); }, 30000);
    return () => { sub(); clearInterval(timer); };
  }, [online, run, refresh]);

  return <SyncContext.Provider value={{ online, pending, flushing, refresh }}>{children}</SyncContext.Provider>;
}

export function useSync() { return useContext(SyncContext); }
