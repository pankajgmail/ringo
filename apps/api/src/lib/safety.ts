// Guardrails on who Ringo may dial. Launch scope is US/Canada (NANP) business numbers only.

const BLOCKED_EXACT = new Set(["911", "988", "112", "933"]);

export function checkDialable(e164: string): string | null {
  const digits = e164.replace(/\D/g, "");
  if (BLOCKED_EXACT.has(digits) || /^[2-9]11$/.test(digits)) return "Emergency and N11 numbers can't be called by Ringo";
  if (!/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return "Only US/Canada numbers are supported";
  const area = digits.slice(1, 4);
  if (area === "900" || area === "976") return "Premium-rate numbers are blocked";
  if (/^1[2-9]\d{2}555(01\d{2})$/.test(digits)) return "Fictional 555-01xx numbers can't be dialed";
  return null;
}
