import { Tabs } from "expo-router";
import { Text } from "react-native";
import { c } from "@/theme.ts";

import type { ColorValue } from "react-native";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text,
      tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border }, tabBarActiveTintColor: c.primaryText, tabBarInactiveTintColor: c.muted,
      sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: "Out Call", tabBarIcon: icon("↗") }} />
      <Tabs.Screen name="in" options={{ title: "In Call", tabBarIcon: icon("↙") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("⚙") }} />
    </Tabs>
  );
}
