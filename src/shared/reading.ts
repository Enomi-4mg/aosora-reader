export function estimateRemainingMinutes(
  totalCharacters: number,
  percentage: number,
  charsPerMinute: number
): number {
  if (totalCharacters <= 0 || charsPerMinute <= 0) return 0
  return Math.max(0, Math.ceil(totalCharacters * (1 - clamp01(percentage)) / charsPerMinute))
}

export function formatReadingTime(minutes: number): string {
  if (minutes <= 0) return '残り 1分未満'
  if (minutes < 60) return `残り 約${minutes}分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `残り 約${hours}時間` : `残り 約${hours}時間${rest}分`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
