const CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  80: "rain showers", 81: "rain showers", 82: "violent showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

export async function weather(city: string) {
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then((r) => r.json()) as { results?: { name: string; country: string; latitude: number; longitude: number }[] };
  const hit = geo.results?.[0];
  if (!hit) throw new Error(`unknown city: ${city}`);
  const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,wind_speed_10m,weather_code`).then((r) => r.json()) as { current: { temperature_2m: number; wind_speed_10m: number; weather_code: number } };
  const c = wx.current;
  const sky = CODES[c.weather_code] ?? "unknown sky";
  return {
    city: hit.name,
    country: hit.country,
    temperatureC: c.temperature_2m,
    windKmh: c.wind_speed_10m,
    condition: sky,
    spoken: `${hit.name}: ${Math.round(c.temperature_2m)} degrees, ${sky}, wind ${Math.round(c.wind_speed_10m)} km/h.`,
  };
}
