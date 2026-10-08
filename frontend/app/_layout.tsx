import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth-context";
import { SyncProvider } from "@/src/sync-context";
import { ToastProvider } from "@/src/toast";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
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
