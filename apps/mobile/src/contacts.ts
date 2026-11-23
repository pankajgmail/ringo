import { Platform } from "react-native";
import * as Contacts from "expo-contacts";

export type PickedContact = { name: string; number: string };

/**
 * Opens the phone's contact picker and returns one contact with a phone number.
 * Native: system picker (expo-contacts). Web: the browser Contact Picker API, which only
 * Chrome on Android supports; elsewhere returns "unsupported" so the UI can say so.
 */
export async function pickContact(): Promise<PickedContact | null | "unsupported"> {
  if (Platform.OS === "web") {
    const nav = navigator as Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> } };
    if (!nav.contacts?.select) return "unsupported";
    const [c] = await nav.contacts.select(["name", "tel"], { multiple: false });
    if (!c?.tel?.[0]) return null;
    return { name: c.name?.[0] ?? c.tel[0], number: c.tel[0] };
  }
  const c = await Contacts.presentContactPickerAsync();
  const tel = c?.phoneNumbers?.find((p) => p.number)?.number;
  if (!c || !tel) return null;
  return { name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || tel, number: tel };
}
