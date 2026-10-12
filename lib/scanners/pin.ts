// Same rules as PinManager.isWeakPin on the agent. 6 digits, not repeating or sequential.

export function isWeakPin(pin: string): boolean {
  if (pin.length < 2) return true;
  if ([...pin].every((c) => c === pin[0])) return true;
  const digits = [...pin].map((c) => c.charCodeAt(0) - 48);
  const ascending = digits.every((d, i) => i === 0 || (digits[i - 1] + 1) % 10 === d);
  const descending = digits.every((d, i) => i === 0 || (digits[i - 1] + 9) % 10 === d);
  return ascending || descending;
}

export function isValidManagedPin(pin: string): boolean {
  return /^\d{6}$/.test(pin) && !isWeakPin(pin);
}

export function pinRejectReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN must be exactly 6 digits.";
  if (isWeakPin(pin)) {
    return "That PIN is too easy to guess (repeating or sequential). Pick another.";
  }
  return null;
}
