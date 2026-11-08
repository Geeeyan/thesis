export function formatArrivalTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "");
  if (!match) return value || "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}
