import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Tabs, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import { useApi } from "@/api.ts";
import { LOGO_XML, LOGO_RATIO } from "@/brand.ts";
import { Grad, Icon, IconBtn, type IconName } from "@/ui.tsx";
import { c } from "@/theme.ts";

const TABS: Record<string, { label: string; icon: IconName }> = { index: { label: "Out Call", icon: "out" }, in: { label: "In Call", icon: "in" } };

/** App bar from the prototype: wordmark + tagline + settings gear, then the Out / In segmented tabs. */
function AppBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const api = useApi();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const incomplete = !!me.data && !(me.data.name && me.data.phoneVerified);
  const current = state.routes[state.index]?.name;
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: Math.max(14, insets.top), paddingBottom: 10, backgroundColor: c.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View accessibilityRole="header" accessibilityLabel="Ringo. Never wait on hold again.">
          <SvgXml xml={LOGO_XML} height={34} width={34 * LOGO_RATIO} />
          <Text style={{ marginTop: 5, fontSize: 12, fontWeight: "600", letterSpacing: 0.2, color: c.primaryText }}>
            Never wait <Text style={{ color: c.amber, fontWeight: "800" }}>on hold again.</Text>
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconBtn icon="star" label="Send feedback" onPress={() => router.push("/feedback")} />
          <IconBtn icon="gear" label={incomplete ? "Settings, profile incomplete" : "Settings"} dot={incomplete} onPress={() => router.push("/settings")} />
        </View>
      </View>
      <View style={st.tabs} accessibilityRole="tablist">
        {state.routes.filter((r) => TABS[r.name]).map((r) => {
          const on = r.name === current;
          const t = TABS[r.name]!;
          return (
            <Pressable key={r.key} onPress={() => navigateToTab(r.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}
              style={[st.tab, on && { overflow: "hidden" }]}>
              {on ? <Grad style={StyleSheet.absoluteFill as ViewStyle} /> : null}
              <Icon name={t.icon} size={18} color={on ? "#fff" : c.muted} />
              <Text style={{ color: on ? "#fff" : c.muted, fontWeight: "700", fontSize: 14 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <AppBar {...p} />} screenOptions={{ headerShown: false, tabBarPosition: "top", sceneStyle: { backgroundColor: c.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Out Call" }} />
      <Tabs.Screen name="in" options={{ title: "In Call" }} />
    </Tabs>
  );
}

const st = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 4, marginTop: 12, backgroundColor: c.field, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 4 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 10 },
});
