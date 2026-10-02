import { createContext, ReactNode, useContext } from "react";

type SyncContextValue = {
  online: boolean;
  pending: number;
  flushing: boolean;
  refresh: () => Promise<void>;
};

/**
 * Offline-only POS — tidak ada sinkronisasi ke server luar.
 * Context ini dipertahankan untuk kompatibilitas layar yang masih
 * memanggil `useSync()` namun selalu mengembalikan state statis.
 */
const SyncContext = createContext<SyncContextValue>({ online: true, pending: 0, flushing: false, refresh: async () => undefined });

export function SyncProvider({ children }: { children: ReactNode }) {
  return <SyncContext.Provider value={{ online: true, pending: 0, flushing: false, refresh: async () => undefined }}>{children}</SyncContext.Provider>;
}

export function useSync() { return useContext(SyncContext); }
