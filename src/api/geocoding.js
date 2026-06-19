// Open-Meteo geocoding — free-text place search (CORS-friendly).

export async function searchPlaces(query) {
  const q = query.trim();
  if (!q) return [];
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
    `&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding ${res.status}`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    admin1: r.admin1,
    country: r.country,
    countryCode: r.country_code,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  }));
}
