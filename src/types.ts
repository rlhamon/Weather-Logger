/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LocationInfo {
  zipcode: string;
  cityName: string;
  state: string;
  stateCode: string;
  latitude: number;
  longitude: number;
}

export type WeatherUnit = 'F' | 'C';

export type WeatherDataSource = 'AUTO' | 'NOAA_FORECAST' | 'NOAA_OBSERVATIONS' | 'NOAA_HISTORICAL';

export interface WeatherRecord {
  timestamp: string; // ISO 8601 string
  dateStr: string;   // YYYY-MM-DD
  hourStr: string;   // HH:00
  temperature: number; // Value in Fahrenheit or Celsius depending on current state
  humidity: number | null; // relative humidity percentage
  windSpeed: string | null; // e.g. "12 mph" or "19 km/h"
  windDirection: string | null; // e.g. "NNE"
  description: string; // "Sunny", "Partly Cloudy" etc.
  source: string; // e.g. "NOAA Forecast Live", "NOAA Station KDCA"
}

export interface DailySummary {
  dateStr: string;
  minTemp: number;
  maxTemp: number;
  avgTemp: number;
  avgHumidity: number | null;
  recordsCount: number;
}
