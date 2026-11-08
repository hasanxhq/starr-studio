/** Relative next-run time for the home header ("today 15:00", "tonight 03:00", …). */
export function phraseNextRun(at: string, now = Date.now()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfter = new Date(startOfTomorrow);
  startOfDayAfter.setDate(startOfDayAfter.getDate() + 1);
  const t = when.getTime();
  const hour = when.getHours();
  const dayPart = hour >= 18 || hour < 6 ? "tonight" : "today";
  if (t >= startOfToday.getTime() && t < startOfTomorrow.getTime()) return `${dayPart} ${time}`;
  if (t >= startOfTomorrow.getTime() && t < startOfDayAfter.getTime()) return `tomorrow ${time}`;
  const weekday = when.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} ${time}`;
}
