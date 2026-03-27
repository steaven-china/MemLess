export interface ProactiveTimingDecision {
  allow: boolean;
  mode?: "inject" | "prefetch";
  depth?: 1 | 2;
  reason?: "invalid_input" | "cooldown" | "inject" | "prefetch" | "idle_too_long";
}

export function proactivePolicy(
  nowUTC: number,
  lastMsgUTC: number,
  firstMsgUTC: number,
  lastTriggerUTC: number
): ProactiveTimingDecision {
  if (!isFiniteNumber(nowUTC) || !isFiniteNumber(lastMsgUTC) || !isFiniteNumber(firstMsgUTC)) {
    return { allow: false, reason: "invalid_input" };
  }

  const deltaLast = nowUTC - lastMsgUTC;
  const span = Math.max(0, lastMsgUTC - firstMsgUTC);
  const deltaTrigger = isFiniteNumber(lastTriggerUTC) ? nowUTC - lastTriggerUTC : Number.POSITIVE_INFINITY;

  if (deltaTrigger < 120) return { allow: false, reason: "cooldown" };

  if (deltaLast <= 300) {
    return { allow: true, mode: "inject", depth: span <= 1200 ? 2 : 1, reason: "inject" };
  }

  if (deltaLast <= 1800) {
    return { allow: true, mode: "prefetch", depth: 1, reason: "prefetch" };
  }

  return { allow: false, reason: "idle_too_long" };
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
