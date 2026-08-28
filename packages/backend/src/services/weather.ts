// Open-Meteo forecast, no API key required. Uses a single fixed reference point
// (Manhattan) since candidate places span Manhattan through Long Island for a same-metro
// weekend plan — see DESIGN.md section 5 for why per-place hyperlocal forecasts aren't
// worth the complexity here.
const REFERENCE_LAT = 40.7128;
const REFERENCE_LNG = -74.006;

export interface DayForecast {
  date: string; // YYYY-MM-DD
  tempMaxF: number;
  tempMinF: number;
  precipitationProbabilityMax: number;
  weatherCode: number;
  isGoodOutdoorWeather: boolean;
}

// Open-Meteo WMO weather codes: 0-3 clear/cloudy, everything >=45 is fog/rain/snow/storm.
function isGoodOutdoor(weatherCode: number, precipProbability: number): boolean {
  return weatherCode <= 3 && precipProbability < 40;
}

export async function getForecast(dates: string[]): Promise<DayForecast[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(REFERENCE_LAT));
  url.searchParams.set("longitude", String(REFERENCE_LNG));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      weathercode: number[];
    };
  };

  const byDate = new Map<string, DayForecast>();
  data.daily.time.forEach((date, i) => {
    const weatherCode = data.daily.weathercode[i];
    const precip = data.daily.precipitation_probability_max[i];
    byDate.set(date, {
      date,
      tempMaxF: data.daily.temperature_2m_max[i],
      tempMinF: data.daily.temperature_2m_min[i],
      precipitationProbabilityMax: precip,
      weatherCode,
      isGoodOutdoorWeather: isGoodOutdoor(weatherCode, precip),
    });
  });

  return dates.map((date) => byDate.get(date)).filter((d): d is DayForecast => Boolean(d));
}
