export function normalizeHm(value?: string | null) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function hmToMinutes(value?: string | null) {
  const normalized = normalizeHm(value);
  if (!normalized) return null;
  const [hourText, minuteText] = normalized.split(":");
  const hour = Number.parseInt(hourText || "", 10);
  const minute = Number.parseInt(minuteText || "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function interpolateSeriesAtMinutes(
  times: string[],
  values: Array<number | null | undefined>,
  currentMinutes: number,
) {
  const points = times
    .map((time, index) => {
      const minute = hmToMinutes(time);
      const value = values[index];
      return minute != null && value != null && Number.isFinite(Number(value))
        ? { minute, value: Number(value) }
        : null;
    })
    .filter((point): point is { minute: number; value: number } => point != null);

  if (!points.length) return null;

  const exact = points.find((point) => point.minute === currentMinutes);
  if (exact) return exact.value;

  let left: { minute: number; value: number } | null = null;
  let right: { minute: number; value: number } | null = null;

  for (const point of points) {
    if (point.minute < currentMinutes) {
      left = point;
      continue;
    }
    if (point.minute > currentMinutes) {
      right = point;
      break;
    }
  }

  if (left && right) {
    const span = right.minute - left.minute;
    if (span <= 0) return left.value;
    const ratio = (currentMinutes - left.minute) / span;
    return Number((left.value + (right.value - left.value) * ratio).toFixed(1));
  }
  if (left) return left.value;
  if (right) return right.value;
  return null;
}
