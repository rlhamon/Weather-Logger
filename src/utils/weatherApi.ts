/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocationInfo, WeatherRecord, DailySummary } from '../types';

// Converts Celsius to Fahrenheit
export function cToF(c: number): number {
  return parseFloat(((c * 9) / 5 + 32).toFixed(1));
}

// Converts Fahrenheit to Celsius
export function fToC(f: number): number {
  return parseFloat((((f - 32) * 5) / 9).toFixed(1));
}

// Map degrees into Compass direction
export function windDegreesToCardinal(degrees: number | null): string | null {
  if (degrees === null || isNaN(degrees)) return null;
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 22.5) % 16;
  return directions[index];
}

// Map WMO codes (Open-Meteo) to human descriptions
export function mapWmoCodeToDescription(code: number | null): string {
  if (code === null) return 'Clear';
  switch (code) {
    case 0: return 'Clear Sky';
    case 1: return 'Mainly Clear';
    case 2: return 'Partly Cloudy';
    case 3: return 'Overcast';
    case 45: case 48: return 'Foggy';
    case 51: case 53: case 55: return 'Drizzle';
    case 56: case 57: return 'Freezing Drizzle';
    case 61: case 63: case 65: return 'Heavy Rain';
    case 66: case 67: return 'Freezing Rain';
    case 71: case 73: case 75: return 'Snowy';
    case 77: return 'Snow Grains';
    case 80: case 81: case 82: return 'Rain Showers';
    case 85: case 86: return 'Snow Showers';
    case 95: return 'Thunderstorm';
    case 96: case 99: return 'Thunderstorm with Hail';
    default: return 'Cloudy';
  }
}

/**
 * Geocodes a US Zip code to Lat/Lon and details.
 */
export async function geocodeZipcode(zipcode: string): Promise<LocationInfo> {
  const formattedZip = zipcode.trim();
  if (!/^\d{5}$/.test(formattedZip)) {
    throw new Error('Please enter a valid 5-digit ZIP code.');
  }

  // 1st Try: Zippopotam.us (Extremely clean & tailored US zip endpoint)
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${formattedZip}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.places && data.places.length > 0) {
        const place = data.places[0];
        return {
          zipcode: formattedZip,
          cityName: place['place name'],
          state: place['state'],
          stateCode: place['state abbreviation'],
          latitude: parseFloat(place['latitude']),
          longitude: parseFloat(place['longitude']),
        };
      }
    }
  } catch (err) {
    console.warn('Zippopotam failed, trying fallback Map Geocoder...', err);
  }

  // 2nd Try Fallback: Nominatim OpenStreetMap
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${formattedZip}&country=United%20States&format=json`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const place = data[0];
        const dispNameParts = place.display_name.split(', ');
        const cityName = dispNameParts[0] || 'Unknown City';
        const state = dispNameParts[dispNameParts.length - 3] || 'USA';

        return {
          zipcode: formattedZip,
          cityName: cityName,
          state: state,
          stateCode: '',
          latitude: parseFloat(place.lat),
          longitude: parseFloat(place.lon),
        };
      }
    }
  } catch (err) {
    console.error('All geocoding networks failed', err);
  }

  throw new Error(`Unable to find location data for ZIP code "${formattedZip}". Please verify internet connection or try a different ZIP.`);
}

/**
 * Fetch direct NOAA NWS Hourly Forecast (supports next 7 days in future)
 */
export async function fetchNoaaForecast(lat: number, lon: number, start: Date, end: Date, unit: 'F' | 'C'): Promise<WeatherRecord[]> {
  // NOAA recommends configuring custom accept header and contact header
  const requestHeaders = {
    'Accept': 'application/geo+json',
  };

  // Step 1: Get grid points
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: requestHeaders
  });

  if (!pointsRes.ok) {
    const errText = await pointsRes.text();
    throw new Error(`NOAA servers rejected gridpoints request: ${pointsRes.status}. ${errText || 'Please try again later.'}`);
  }

  const pointsData = await pointsRes.json();
  const hourlyForecastUrl = pointsData.properties?.forecastHourly;
  if (!hourlyForecastUrl) {
    throw new Error('NOAA Gridpoint returned but no hourly forecast URL is available for this area.');
  }

  // Step 2: Grab the hourly forecast
  const forecastRes = await fetch(hourlyForecastUrl, {
    headers: requestHeaders
  });

  if (!forecastRes.ok) {
    throw new Error(`NOAA failed to return hourly forecast data (Status ${forecastRes.status}).`);
  }

  const forecastData = await forecastRes.json();
  const periods = forecastData.properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new Error('NOAA returned forecast structure but no hourly periods coordinates.');
  }

  // Map and filter results based on selected dates
  const startMs = start.getTime();
  const endMs = end.getTime();

  const mapped: WeatherRecord[] = [];

  for (const period of periods) {
    const periodTime = new Date(period.startTime);
    const periodMs = periodTime.getTime();

    if (periodMs >= startMs && periodMs <= endMs) {
      let rawTemp = period.temperature; // Usually Fahrenheit default by NOAA NWS
      const tempUnit = period.temperatureUnit || 'F';

      // Ensure temperature is correctly converted to user's desired unit
      if (tempUnit === 'F' && unit === 'C') {
        rawTemp = fToC(rawTemp);
      } else if (tempUnit === 'C' && unit === 'F') {
        rawTemp = cToF(rawTemp);
      }

      const dStr = periodTime.toISOString().split('T')[0];
      const hStr = periodTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

      mapped.push({
        timestamp: period.startTime,
        dateStr: dStr,
        hourStr: hStr,
        temperature: parseFloat(rawTemp.toFixed(1)),
        humidity: period.relativeHumidity?.value || null,
        windSpeed: period.windSpeed || null,
        windDirection: period.windDirection || null,
        description: period.shortForecast || 'Forecast Active',
        source: 'NOAA NWS Forecast',
      });
    }
  }

  return mapped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Fetch direct NOAA Station Observations (supports last 7 days details)
 */
export async function fetchNoaaObservations(lat: number, lon: number, start: Date, end: Date, unit: 'F' | 'C'): Promise<WeatherRecord[]> {
  const requestHeaders = {
    'Accept': 'application/geo+json',
  };

  // Step 1: Find closest weather station
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: requestHeaders
  });

  if (!pointsRes.ok) {
    throw new Error(`NOAA Gridpoint failed for observations lookup (Status ${pointsRes.status}).`);
  }

  const pointsData = await pointsRes.json();
  const observationStationsUrl = pointsData.properties?.observationStations;
  if (!observationStationsUrl) {
    throw new Error('No weather observation stations listed by NOAA for these coordinates.');
  }

  // Step 2: Extract Nearest station
  const stationsRes = await fetch(observationStationsUrl, {
    headers: requestHeaders
  });

  if (!stationsRes.ok) {
    throw new Error('Unable to list surrounding atmospheric NOAA observation stations.');
  }

  const stationsData = await stationsRes.json();
  const stationFeatures = stationsData.features;
  if (!Array.isArray(stationFeatures) || stationFeatures.length === 0) {
    throw new Error('No physical atmospheric stations reported near this region.');
  }

  // Pick nearest station
  const stationId = stationFeatures[0].properties?.stationIdentifier;
  if (!stationId) {
    throw new Error('Nearest weather station has invalid identifiers.');
  }

  // Step 3: Fetch hourly observations for this station
  // NOAA offers ISO-formatted start date param
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const obsUrl = `https://api.weather.gov/stations/${stationId}/observations?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;

  const obsRes = await fetch(obsUrl, {
    headers: requestHeaders
  });

  if (!obsRes.ok) {
    throw new Error(`Station ${stationId} failed to report live records (Status ${obsRes.status}).`);
  }

  const obsData = await obsRes.json();
  const features = obsData.features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error(`No recent recordings on file at Station ${stationId} for this range.`);
  }

  const mapped: WeatherRecord[] = [];

  for (const feat of features) {
    const props = feat.properties;
    if (!props) continue;

    const time = new Date(props.timestamp);
    const tempCelsius = props.temperature?.value; // NOAA stations report raw METAR values in Celsius

    if (tempCelsius === null || tempCelsius === undefined) continue;

    let targetTemp = tempCelsius;
    if (unit === 'F') {
      targetTemp = cToF(tempCelsius);
    }

    const dStr = time.toISOString().split('T')[0];
    const hStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    // Wind converters
    const speedKmh = props.windSpeed?.value; // in km/h
    let windSpeedStr = null;
    if (speedKmh !== null && speedKmh !== undefined) {
      if (unit === 'F') {
        const speedMph = speedKmh * 0.621371;
        windSpeedStr = `${Math.round(speedMph)} mph`;
      } else {
        windSpeedStr = `${Math.round(speedKmh)} km/h`;
      }
    }

    const directionDeg = props.windDirection?.value;
    const directionCard = windDegreesToCardinal(directionDeg);

    mapped.push({
      timestamp: props.timestamp,
      dateStr: dStr,
      hourStr: hStr,
      temperature: parseFloat(targetTemp.toFixed(1)),
      humidity: props.relativeHumidity?.value ? Math.round(props.relativeHumidity.value) : null,
      windSpeed: windSpeedStr,
      windDirection: directionCard,
      description: props.textDescription || 'Measured Live',
      source: `NOAA Metar Station ${stationId}`,
    });
  }

  // Return sorted chronological list
  return mapped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Fetch NOAA Weather Model Reanalysis (Historical Archive via open meteorological systems)
 * Provides seamless 1940 - Present historical hourly data for any duration
 */
export async function fetchHistoricalBackup(lat: number, lon: number, start: Date, end: Date, unit: 'F' | 'C'): Promise<WeatherRecord[]> {
  const startFmt = start.toISOString().split('T')[0];
  const endFmt = end.toISOString().split('T')[0];

  const tempUnitParam = unit === 'F' ? 'fahrenheit' : 'celsius';
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startFmt}&end_date=${endFmt}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&temperature_unit=${tempUnitParam}&wind_speed_unit=mph&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Historical NOAA archive fetch failed (Status ${res.status}).`);
  }

  const data = await res.json();
  const hourly = data.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error('Historical service completed but returned empty atmospheric structures.');
  }

  const mapped: WeatherRecord[] = [];
  const times = hourly.time;
  const temps = hourly.temperature_2m;
  const humidities = hourly.relative_humidity_2m;
  const windSpeeds = hourly.wind_speed_10m;
  const windDirections = hourly.wind_direction_10m;
  const codes = hourly.weather_code;

  for (let i = 0; i < times.length; i++) {
    const rawTime = times[i];
    const timeDate = new Date(rawTime);
    const dStr = rawTime.split('T')[0];
    const hStr = rawTime.split('T')[1] || '00:00';

    const tempVal = temps[i];
    if (tempVal === null || tempVal === undefined) continue;

    const windSpeedVal = windSpeeds[i];
    const speedStr = windSpeedVal !== null ? `${Math.round(windSpeedVal)} mph` : null;

    const windDirVal = windDirections[i];
    const cardinalDir = windDegreesToCardinal(windDirVal);

    mapped.push({
      timestamp: timeDate.toISOString(),
      dateStr: dStr,
      hourStr: hStr,
      temperature: tempVal,
      humidity: humidities ? humidities[i] : null,
      windSpeed: speedStr,
      windDirection: cardinalDir,
      description: mapWmoCodeToDescription(codes ? codes[i] : null),
      source: 'NOAA Reanalysis Archive',
    });
  }

  return mapped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Computes elegant daily summaries for spreadsheet exporting (Sheet 1)
 */
export function calculateDailySummaries(records: WeatherRecord[]): DailySummary[] {
  const groups: { [date: string]: WeatherRecord[] } = {};

  for (const r of records) {
    if (!groups[r.dateStr]) {
      groups[r.dateStr] = [];
    }
    groups[r.dateStr].push(r);
  }

  const summaries: DailySummary[] = [];

  for (const [dateStr, recs] of Object.entries(groups)) {
    const temps = recs.map(r => r.temperature);
    const max = Math.max(...temps);
    const min = Math.min(...temps);
    const avg = parseFloat((temps.reduce((sum, val) => sum + val, 0) / temps.length).toFixed(1));

    const validHumids = recs.map(r => r.humidity).filter((h): h is number => h !== null);
    const avgHumid = validHumids.length > 0 
      ? Math.round(validHumids.reduce((s, h) => s + h, 0) / validHumids.length) 
      : null;

    summaries.push({
      dateStr,
      minTemp: min,
      maxTemp: max,
      avgTemp: avg,
      avgHumidity: avgHumid,
      recordsCount: recs.length,
    });
  }

  return summaries.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}
