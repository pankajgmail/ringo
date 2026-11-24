import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import * as StoreReview from "expo-store-review";
import { useMutation } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { Button, Card, ErrorLine, Field, Icon, PageHeader, s, useToast } from "@/ui.tsx";
import { c } from "@/theme.ts";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const MAX = 2000;

/** Five tappable stars. Each star is a radio so screen readers announce "3 stars, Good, 3 of 5, selected". */
function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Rating" style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginVertical: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        return (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} accessibilityRole="radio"
            accessibilityState={{ checked: n === value }} accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}, ${WORDS[n]}`}
            style={({ pressed }) => ({ padding: 6, borderRadius: 12, opacity: pressed ? 0.7 : 1 })}>
            <Icon name="star" size={40} color={on ? c.amber : c.muted} fill={on ? c.amber : "none"} strokeWidth={1.6} />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function FeedbackScreen() {
  const api = useApi();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const send = useMutation({
    mutationFn: () => api.sendFeedback({
      rating, comment: comment.trim() || undefined,
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web",
      appVersion: Constants.expoConfig?.version,
    }),
    onSuccess: async () => {
      toast("check-circle", "Thanks for the feedback!");
      // Happy users get the system's rate-this-app sheet (iOS/Android decide whether to show it).
      if (rating >= 4 && Platform.OS !== "web" && (await StoreReview.isAvailableAsync().catch(() => false))) await StoreReview.requestReview().catch(() => undefined);
      if (router.canGoBack()) router.back(); else router.replace("/");
    },
  });
  const submit = () => { setTried(true); if (rating) send.mutate(); };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <PageHeader title="Send feedback" sub="Help make Ringvo better" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[s.h, { textAlign: "center" }]}>How's Ringvo working for you?</Text>
          <Stars value={rating} onChange={setRating} />
          <Text style={[s.muted, { textAlign: "center", minHeight: 20 }]} accessibilityLiveRegion="polite">
            {rating ? `${rating} of 5 · ${WORDS[rating]}` : "Tap a star to rate"}
          </Text>
          {tried && !rating ? <ErrorLine text="Please pick a rating from 1 to 5 stars." /> : null}
        </Card>
        <Card>
          <Text style={s.label}>What could be better? (optional)</Text>
          <Field label="Your comments" icon="msg" multiline value={comment} maxLength={MAX} onChangeText={setComment}
            placeholder="Tell us what you liked, what didn't work, or what you'd like Ringvo to do next" style={{ marginTop: 0 }} />
          <Text style={[s.meta, { textAlign: "right" }]}>{comment.length}/{MAX}</Text>
        </Card>
        {send.error ? <ErrorLine text={send.error instanceof Error ? send.error.message : "Couldn't send feedback. Try again."} /> : null}
        <Button title="Send feedback" icon="check" onPress={submit} busy={send.isPending} disabled={send.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
