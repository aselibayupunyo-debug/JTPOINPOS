import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme";

type ToastKind = "success" | "error" | "info";
type ToastMessage = { id: number; kind: ToastKind; title: string; description?: string };

type ToastContextValue = {
  show: (message: Omit<ToastMessage, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);

  const show = useCallback((message: Omit<ToastMessage, "id">) => {
    idRef.current += 1;
    const id = idRef.current;
    setQueue((q) => [...q, { id, ...message }]);
    setTimeout(() => setQueue((q) => q.filter((item) => item.id !== id)), 3200);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (title, description) => show({ kind: "success", title, description }),
    error: (title, description) => show({ kind: "error", title, description }),
    info: (title, description) => show({ kind: "info", title, description }),
  };

  const palette: Record<ToastKind, { bg: string; text: string }> = {
    success: { bg: colors.brandPrimary, text: colors.onBrandPrimary },
    error: { bg: colors.error, text: colors.onError },
    info: { bg: colors.surfaceInverse, text: colors.onSurfaceInverse },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 12 }]}>
        {queue.map((item) => (
          <ToastItem key={item.id} message={item} palette={palette[item.kind]} onDismiss={() => setQueue((q) => q.filter((x) => x.id !== item.id))} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastItem({ message, palette, onDismiss }: { message: ToastMessage; palette: { bg: string; text: string }; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity]);
  return (
    <Animated.View style={[styles.toast, { backgroundColor: palette.bg, opacity }]} testID={`toast-${message.kind}`}>
      <Pressable onPress={onDismiss}>
        <Text style={[styles.title, { color: palette.text }]}>{message.title}</Text>
        {message.description ? <Text style={[styles.desc, { color: palette.text }]}>{message.description}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 16, right: 16, zIndex: 999, gap: 8 },
  toast: { padding: 14, borderRadius: 14, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 12, elevation: 6 },
  title: { fontSize: 15, fontWeight: "800" },
  desc: { fontSize: 13, marginTop: 2, opacity: 0.9 },
});
