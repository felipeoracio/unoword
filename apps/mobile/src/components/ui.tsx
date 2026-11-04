import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  type TextInputProps,
  type ViewStyle,
  type TextProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../providers/AppProvider";
export const palette = {
  light: {
    bg: "#F4F8FF",
    card: "#FFFFFF",
    text: "#0B1B4D",
    muted: "#52617F",
    line: "#DFE8F7",
    blue: "#0866FF",
  },
  dark: {
    bg: "#0B1220",
    card: "#132036",
    text: "#F0F5FF",
    muted: "#B3C1D8",
    line: "#2C3B55",
    blue: "#70AEFF",
  },
};
let manualTheme: "system" | "light" | "dark" = "system";
const themeListeners = new Set<() => void>();
export function selectTheme(value: typeof manualTheme) {
  manualTheme = value;
  themeListeners.forEach((fn) => fn());
}
export function useTheme() {
  const system = useColorScheme();
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const f = () => bump((n) => n + 1);
    themeListeners.add(f);
    return () => {
      themeListeners.delete(f);
    };
  }, []);
  return palette[
    manualTheme === "system"
      ? system === "dark"
        ? "dark"
        : "light"
      : manualTheme
  ];
}
export function Label({
  children,
  muted = false,
  size = 15,
  style,
  ...props
}: TextProps & { children: React.ReactNode; muted?: boolean; size?: number }) {
  const p = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          color: muted ? p.muted : p.text,
          fontSize: size,
          lineHeight: size * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Label
      size={29}
      style={{ fontWeight: "800", letterSpacing: -0.7, marginBottom: 10 }}
    >
      {children}
    </Label>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const p = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: p.card,
          borderColor: p.line,
          borderWidth: 1,
          borderRadius: 20,
          padding: 20,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const p = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 46,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: secondary ? p.card : "#0866FF",
        borderWidth: 1,
        borderColor: secondary ? p.line : "#0866FF",
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text
        style={{
          fontWeight: "700",
          fontSize: 15,
          color: secondary ? p.text : "#FFF",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Input(props: TextInputProps) {
  const p = useTheme();
  return (
    <TextInput
      placeholderTextColor={p.muted}
      {...props}
      style={[
        {
          color: p.text,
          backgroundColor: p.card,
          borderColor: p.line,
          borderWidth: 1,
          borderRadius: 12,
          padding: 13,
          fontSize: 16,
          minHeight: 48,
        },
        props.style,
      ]}
    />
  );
}
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}
export function Screen({
  children,
  title,
  scroll = true,
}: {
  children: React.ReactNode;
  title?: string;
  scroll?: boolean;
}) {
  const p = useTheme();
  const app = useApp();
  const [refreshing, setRefreshing] = React.useState(false);
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, minHeight: 0, backgroundColor: p.bg }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, minHeight: 0 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 20,
              gap: 18,
              width: "100%",
              maxWidth: 1150,
              alignSelf: "center",
              paddingBottom: 40,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void app.refresh().finally(() => setRefreshing(false));
                }}
                tintColor={p.blue}
              />
            }
          >
            {title && <Heading>{title}</Heading>}
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#0866FF" />
      <Label>Opening UnoWord…</Label>
    </View>
  );
}
export function ProNotice() {
  return (
    <Card>
      <Heading>Your space to write</Heading>
      <Label>
        The editor, formatting, documents, and folders are included with Pro
        Monthly and Lifetime.
      </Label>
      <Label muted>
        Existing website subscriptions are recognized automatically. Purchases
        are unavailable in this Expo Go version.
      </Label>
      <Label muted>Your Words. Your Voice. Your Story.</Label>
    </Card>
  );
}
export const styles = StyleSheet.create({
  gap: { gap: 12 },
  muted: { opacity: 0.7 },
  grow: { flex: 1 },
  title: { fontWeight: "700" },
  error: { color: "#C34545" },
});
