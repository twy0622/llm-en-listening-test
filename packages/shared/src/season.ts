/** Quarterly publishing seasons are stored as YYYY-Q1..Q4. */
export function seasonForDate(date = new Date()): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

export function formatSeason(season: string | null | undefined): string {
  if (!season) return "Evergreen";
  if (season === "evergreen") return "Evergreen";
  const match = /^(\d{4})-Q([1-4])$/.exec(season);
  if (!match) return season;
  const names = ["Winter", "Spring", "Summer", "Autumn"];
  return `${names[Number(match[2]) - 1]} ${match[1]}`;
}
