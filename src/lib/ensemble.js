// Shared GFS-ensemble math: daily precip spread per member, and an overall
// forecast-confidence read. Used by the Confidence panel and the top briefing.

export function computeEnsembleDays(data) {
  const h = data?.hourly;
  if (!h?.time?.length) return [];
  const times = h.time;
  const memberKeys = Object.keys(h).filter((k) => k.startsWith('precipitation'));
  const days = {};
  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10);
    days[day] ||= {};
    for (const mk of memberKeys) {
      const v = h[mk]?.[i];
      if (typeof v === 'number') days[day][mk] = (days[day][mk] || 0) + v;
    }
  }
  return Object.entries(days).map(([day, members]) => {
    const totals = Object.values(members);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const range = max - min;
    let conf = 'high';
    if (range > 2 && range > mean * 1.5) conf = mean > 4 ? 'med' : 'low';
    if (range > 8) conf = 'low';
    if (range <= 1) conf = 'high';
    return { day, min, max, mean, range, conf, n: totals.length };
  });
}

// Overall confidence read across the first ~2 days, as a short phrase.
export function confidenceSummary(days) {
  if (!days.length) return { level: 'unknown', text: 'ensemble unavailable' };
  const near = days.slice(0, 2);
  const order = { high: 0, med: 1, low: 2 };
  const worst = near.reduce((w, d) => (order[d.conf] > order[w] ? d.conf : w), 'high');
  const text =
    worst === 'high'
      ? 'high — ensemble members are tightly clustered, so the near-term forecast is reliable'
      : worst === 'med'
        ? 'moderate — some spread among ensemble members; details (timing/amounts) are uncertain'
        : 'low — ensemble members diverge widely, so treat specifics with caution';
  return { level: worst, text };
}
