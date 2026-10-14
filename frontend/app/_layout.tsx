import { QueryClientProvider } from "@tanstack/react-query";
import { activateKeepAwakeAsync, useKeepAwake } from "expo-keep-awake";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState, LogBox } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth-context";
import { SyncProvider } from "@/src/sync-context";
import { ToastProvider } from "@/src/toast";

LogBox.ignoreAllLogs(true);

const KEEP_AWAKE_TAG = "JTPOIN_ALWAYS_ON";

export default function RootLayout() {
  // Jaga layar HP tetap menyala selama aplikasi dibuka.
  // Pakai hook SEBAGAI fallback utama.
  useKeepAwake(KEEP_AWAKE_TAG);

  // Pakai API imperatif juga + listener AppState utk memastikan wake-lock
  // aktif kembali setiap kali app masuk ke foreground. Ini melindungi
  // dari kasus-kasus langka di mana hook kehilangan status setelah
  // navigation/remount atau transisi background→foreground.
  useEffect(() => {
    let mounted = true;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const sub = AppState.addEventListener("change", (state) => {
      if (!mounted) return;
      if (state === "active") {
        activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      }
    });
    return () => {
      mounted = false;
      sub.remove();
      // Jangan panggil deactivateKeepAwake di cleanup — biar wake-lock
      // lepas natural saat aplikasi benar-benar berhenti. Deactivate di
      // sini bisa salah release saat RootLayout re-render.
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <ToastProvider>
              <SyncProvider>
                <AuthProvider>
                  <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="login" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="product-form" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="purchase" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="returns" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="cashflow" />
                    <Stack.Screen name="debts" />
                    <Stack.Screen name="operators" />
                    <Stack.Screen name="operator-form" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="customers" />
                    <Stack.Screen name="contact-form" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="suppliers" />
                    <Stack.Screen name="history" />
                    <Stack.Screen name="settings" />
                    <Stack.Screen name="receipt" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="parked" />
                    <Stack.Screen name="categories" />
                    <Stack.Screen name="payment-methods" />
                    <Stack.Screen name="transaction-settings" />
                    <Stack.Screen name="backup" />
                    <Stack.Screen name="invoice" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="barcode-print" />
                    <Stack.Screen name="shifts" />
                    <Stack.Screen name="promos" />
                    <Stack.Screen name="lan-sync" />
                    <Stack.Screen name="tailscale-guide" />
                    <Stack.Screen name="activation" />
                    <Stack.Screen name="technicians" />
                    <Stack.Screen name="technician-report" />
                  </Stack>
                </AuthProvider>
              </SyncProvider>
            </ToastProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
