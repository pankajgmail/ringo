import { Platform } from "react-native";
import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from "expo-contacts";
import * as LegacyContacts from "expo-contacts/legacy";
import { toE164 } from "./format.ts";

/** One dialable entry: a contact can appear several times, once per phone number. */
export type PhoneContact = { key: string; name: string; number: string; label?: string };

export type ContactsResult =
  | { status: "ok"; contacts: PhoneContact[]; limited: boolean }
  | { status: "denied"; canAsk: boolean }
  | { status: "unsupported" };

const FIELDS = [ContactField.FULL_NAME, ContactField.GIVEN_NAME, ContactField.FAMILY_NAME, ContactField.PHONES] as const;

function tidyLabel(l?: string) {
  if (!l) return undefined;
  const t = l.replace(/^_\$!<(.+)>!\$_$/, "$1").toLowerCase(); // iOS stores "_$!<Mobile>!$_"
  return t || undefined;
}

type Raw = { id: string; name: string; phones: { number?: string; label?: string }[] };

/**
 * New API. No sortOrder: in expo-contacts 58 iOS decodes "userDefault" as "useDefault", so passing
 * ContactsSortOrder.UserDefault makes every iOS call throw. We sort by name ourselves below.
 */
async function readNext(): Promise<Raw[]> {
  const rows = await Contact.getAllDetails(FIELDS);
  return rows.map((r) => ({ id: r.id, name: (r.fullName || [r.givenName, r.familyName].filter(Boolean).join(" ")).trim(), phones: r.phones ?? [] }));
}

/** Older API, kept as a fallback in case the new one fails on a device. */
async function readLegacy(): Promise<Raw[]> {
  const F = LegacyContacts.Fields;
  const { data } = await LegacyContacts.getContactsAsync({ fields: [F.Name, F.FirstName, F.LastName, F.PhoneNumbers] });
  return data.map((r) => ({ id: r.id ?? r.name, name: (r.name || [r.firstName, r.lastName].filter(Boolean).join(" ")).trim(), phones: r.phoneNumbers ?? [] }));
}

/** Reads every contact that has a phone number, on the device only. Nothing is uploaded. */
async function readAll(): Promise<PhoneContact[]> {
  let rows: Raw[];
  try { rows = await readNext(); } catch (e) {
    try { rows = await readLegacy(); } catch { throw e; }
  }
  const out: PhoneContact[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const p of r.phones) {
      const number = p.number?.trim();
      if (!number) continue;
      const k = `${r.id}|${toE164(number)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, name: r.name || number, number, label: tidyLabel(p.label) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Loads the phone's contacts after asking for permission.
 * Web: there's no contact list, so it opens the browser Contact Picker (Chrome on Android) with multi-select.
 */
export async function loadContacts(): Promise<ContactsResult> {
  if (Platform.OS === "web") {
    const nav = navigator as Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> } };
    if (!nav.contacts?.select) return { status: "unsupported" };
    const picked = await nav.contacts.select(["name", "tel"], { multiple: true });
    const contacts = picked.flatMap((c, i) => (c.tel?.[0] ? [{ key: `web${i}|${c.tel[0]}`, name: c.name?.[0] || c.tel[0], number: c.tel[0] }] : []));
    return { status: "ok", contacts, limited: true };
  }
  let perm = await getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await requestPermissionsAsync();
  if (!perm.granted) return { status: "denied", canAsk: perm.canAskAgain };
  return { status: "ok", contacts: await readAll(), limited: perm.accessPrivileges === "limited" };
}

/** iOS 18+ "limited access": lets the user share more contacts with RingVo, then reloads the list. */
export async function shareMoreContacts(): Promise<PhoneContact[]> {
  await Contact.presentAccessPicker();
  return readAll();
}
