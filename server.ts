import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import XLSX from "xlsx";

// Configure port
const PORT = 3000;

// Configuration persistence path
const CONFIG_FILE = path.join(process.cwd(), "noaa_service_config.json");

// System Service Logs (maximum 100 entries)
interface ServiceLog {
  time: string;
  text: string;
  type: "info" | "success" | "err";
}
let serviceLogs: ServiceLog[] = [];

function addServiceLog(text: string, type: "info" | "success" | "err" = "info") {
  const timeStr = new Date().toLocaleTimeString();
  const dateStr = new Date().toLocaleDateString();
  const timestamp = `${dateStr} ${timeStr}`;
  
  // Console logging
  if (type === "err") {
    console.error(`[BACKGROUND SERVICE] [${timestamp}] ${text}`);
  } else {
    console.log(`[BACKGROUND SERVICE] [${timestamp}] ${text}`);
  }

  serviceLogs.unshift({ time: timestamp, text, type });
  if (serviceLogs.length > 100) {
    serviceLogs.pop();
  }
}

// Default Configuration Structure
interface AppConfig {
  zipcode: string;
  unit: "F" | "C";
  autoExport: boolean;
  exportFormat: "xlsx" | "csv";
  customDirectoryPath: string;
  pollingIntervalHours: number;
  useTemplate: boolean;
  templateFileName: string;
  templateFileBase64: string;
  templateStartRow: number;
  templateSheetName: string;
  templateMappings: any;
}

const DEFAULT_CONFIG: AppConfig = {
  zipcode: "90210",
  unit: "F",
  autoExport: false,
  exportFormat: "xlsx",
  customDirectoryPath: "",
  pollingIntervalHours: 6,
  useTemplate: false,
  templateFileName: "",
  templateFileBase64: "",
  templateStartRow: 2,
  templateSheetName: "Sheet1",
  templateMappings: {}
};

// Retrieve configuration helper
function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    addServiceLog(`Failed reading config file: ${(err as any).message}`, "err");
  }
  return DEFAULT_CONFIG;
}

// Save configuration helper
function saveConfig(updated: Partial<AppConfig>) {
  try {
    const current = loadConfig();
    const merged = { ...current, ...updated };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
    return merged;
  } catch (err) {
    addServiceLog(`Failed writing configuration to disk: ${(err as any).message}`, "err");
    throw err;
  }
}

// Helper to convert base64 to buffer
function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

// Weather utilities replicates
function cToF(c: number): number {
  return parseFloat(((c * 9) / 5 + 32).toFixed(1));
}

function fToC(f: number): number {
  return parseFloat((((f - 32) * 5) / 9).toFixed(1));
}

function windDegreesToCardinal(degrees: number | null): string | null {
  if (degrees === null || isNaN(degrees)) return null;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 22.5) % 16;
  return directions[index];
}

function mapWmoCodeToDescription(code: number | null): string {
  if (code === null) return "Clear";
  switch (code) {
    case 0: return "Clear Sky";
    case 1: return "Mainly Clear";
    case 2: return "Partly Cloudy";
    case 3: return "Overcast";
    case 45: case 48: return "Foggy";
    case 51: case 53: case 55: return "Drizzle";
    case 56: case 57: return "Freezing Drizzle";
    case 61: case 63: case 65: return "Heavy Rain";
    case 66: case 67: return "Freezing Rain";
    case 71: case 73: case 75: return "Snowy";
    case 77: return "Snow Grains";
    case 80: case 81: case 82: return "Rain Showers";
    case 85: case 86: return "Snow Showers";
    case 95: return "Thunderstorm";
    case 96: case 99: return "Thunderstorm with Hail";
    default: return "Cloudy";
  }
}

// NOAA Fetch engine designed to run headlessly in background service
async function performBackgroundFetch(): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.customDirectoryPath) {
    throw new Error("No custom output directory path configured inside the background service.");
  }

  // Ensure absolute or relative target directory exists
  const targetDir = path.resolve(cfg.customDirectoryPath);
  if (!fs.existsSync(targetDir)) {
    addServiceLog(`Directories do not exist at: ${targetDir}. Spinning up recursive folder structures...`, "info");
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const formattedZip = cfg.zipcode.trim();
  addServiceLog(`Polling background weather update for ZIP code: ${formattedZip}...`, "info");

  // Geocode
  let lat = 34.0901;
  let lon = -118.4065;
  let cityName = "Beverly Hills";
  let stateCode = "CA";

  try {
    const geoRes = await fetch(`https://api.zippopotam.us/us/${formattedZip}`);
    if (geoRes.ok) {
      const geoData: any = await geoRes.json();
      if (geoData?.places?.length > 0) {
        const place = geoData.places[0];
        lat = parseFloat(place.latitude);
        lon = parseFloat(place.longitude);
        cityName = place["place name"];
        stateCode = place["state abbreviation"];
        addServiceLog(`Geocoded ${formattedZip} directly: ${cityName}, ${stateCode} (${lat}, ${lon})`, "info");
      }
    }
  } catch (err: any) {
    addServiceLog(`Primary geocoding warning: ${err.message}. Using default coordinates.`, "info");
  }

  // Define date span (Retrieve observations from past 48 hours to ensure full archive capturing)
  const now = new Date();
  const past48 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  
  // 1st Priority Fetch Station Observations (Last 48 hours real data to files)
  let weatherRecords: any[] = [];
  let sourceLabel = "NOAA Station Observations";
  
  try {
    addServiceLog(`Requesting station coordinates from NOAA Grid Point mapper...`, "info");
    const gridRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { "Accept": "application/geo+json", "User-Agent": "NOAA-Desktop-Windows-Service-Utility" }
    });
    
    if (gridRes.ok) {
      const gridData: any = await gridRes.json();
      const stationsUrl = gridData.properties?.observationStations;
      if (stationsUrl) {
        const stationsRes = await fetch(stationsUrl, {
          headers: { "Accept": "application/geo+json", "User-Agent": "NOAA-Desktop-Windows-Service-Utility" }
        });
        if (stationsRes.ok) {
          const stationsData: any = await stationsRes.json();
          const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
          if (stationId) {
            const obsUrl = `https://api.weather.gov/stations/${stationId}/observations?start=${encodeURIComponent(past48.toISOString())}&end=${encodeURIComponent(now.toISOString())}`;
            addServiceLog(`Fetching observations from native meteorology station: ${stationId}...`, "info");
            const obsRes = await fetch(obsUrl, {
              headers: { "Accept": "application/geo+json", "User-Agent": "NOAA-Desktop-Windows-Service-Utility" }
            });
            if (obsRes.ok) {
              const obsData: any = await obsRes.json();
              const features = obsData.features || [];
              for (const feat of features) {
                const props = feat.properties;
                if (!props || props.temperature?.value === null) continue;
                
                const time = new Date(props.timestamp);
                let targetTemp = props.temperature.value;
                if (cfg.unit === "F") {
                  targetTemp = cToF(targetTemp);
                }

                // Wind calculations inside backend service
                const speedKmh = props.windSpeed?.value;
                let windSpeedStr = null;
                if (speedKmh !== null && speedKmh !== undefined) {
                  windSpeedStr = cfg.unit === "F" ? `${Math.round(speedKmh * 0.621371)} mph` : `${Math.round(speedKmh)} km/h`;
                }

                weatherRecords.push({
                  timestamp: props.timestamp,
                  dateStr: time.toISOString().split("T")[0],
                  hourStr: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
                  temperature: parseFloat(targetTemp.toFixed(1)),
                  humidity: props.relativeHumidity?.value ? Math.round(props.relativeHumidity.value) : null,
                  windSpeed: windSpeedStr,
                  windDirection: windDegreesToCardinal(props.windDirection?.value),
                  description: props.textDescription || "Measured Live",
                  source: `NOAA Metar Station ${stationId}`
                });
              }
            }
          }
        }
      }
    }
  } catch (stationErr: any) {
    addServiceLog(`NOAA Station Observation fetching failed: ${stationErr.message}. Attempting reanalysis backup...`, "info");
  }

  // Backup fallback: Reanalysis API
  if (weatherRecords.length === 0) {
    try {
      addServiceLog(`Triggering Open-Meteo NOAA reanalysis backup fetch...`, "info");
      const startFmt = past48.toISOString().split("T")[0];
      const endFmt = now.toISOString().split("T")[0];
      const tempUnitParam = cfg.unit === "F" ? "fahrenheit" : "celsius";
      const backupUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startFmt}&end_date=${endFmt}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&temperature_unit=${tempUnitParam}&wind_speed_unit=mph&timezone=auto`;
      
      const res = await fetch(backupUrl);
      if (res.ok) {
        const data: any = await res.json();
        const hourly = data.hourly || {};
        const times = hourly.time || [];
        const temps = hourly.temperature_2m || [];
        const humidities = hourly.relative_humidity_2m || [];
        const windSpeeds = hourly.wind_speed_10m || [];
        const windDirs = hourly.wind_direction_10m || [];
        const codes = hourly.weather_code || [];

        for (let i = 0; i < times.length; i++) {
          const rawTime = times[i];
          const timeDate = new Date(rawTime);
          if (temps[i] === null || temps[i] === undefined) continue;

          weatherRecords.push({
            timestamp: timeDate.toISOString(),
            dateStr: rawTime.split("T")[0],
            hourStr: rawTime.split("T")[1] || "00:00",
            temperature: temps[i],
            humidity: humidities[i] || null,
            windSpeed: windSpeeds[i] !== null ? `${Math.round(windSpeeds[i])} mph` : null,
            windDirection: windDegreesToCardinal(windDirs[i]),
            description: mapWmoCodeToDescription(codes[i]),
            source: "NOAA Reanalysis Archive"
          });
        }
        sourceLabel = "NOAA Reanalysis Archive Backup";
      }
    } catch (backErr: any) {
      addServiceLog(`Fallback service error: ${backErr.message}`, "err");
      throw new Error(`Cloud weather services are currently unreachable. Cannot pull weather reports.`);
    }
  }

  if (weatherRecords.length === 0) {
    throw new Error("Pushed successfully to servers but no raw hourly observation logs could be derived for this ZIP.");
  }

  // Sort chrono
  weatherRecords.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Filename generator
  const dateStamp = now.toISOString().split("T")[0];
  const fileExt = cfg.exportFormat === "csv" ? "csv" : "xlsx";
  const finalFilename = `NOAA_Import_${formattedZip}_${dateStamp}.${fileExt}`;
  const fullOutputPath = path.join(targetDir, finalFilename);

  // 2. Export Generation
  if (cfg.useTemplate && cfg.templateFileBase64) {
    // Populate excel custom template on backend
    addServiceLog(`Processing weather spreadsheet output using custom Excel template pattern...`, "info");
    const templateBuffer = base64ToBuffer(cfg.templateFileBase64);
    const workbook = XLSX.read(templateBuffer, { type: "buffer" });
    
    const sheetName = cfg.templateSheetName || workbook.SheetNames[0] || "Sheet1";
    let worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      worksheet = XLSX.utils.json_to_sheet([]);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    const startRowIndex = cfg.templateStartRow - 1; // Convert 1-indexed to 0-indexed row
    const mappings = cfg.templateMappings || {};

    weatherRecords.forEach((record, index) => {
      const currentRow = startRowIndex + index;

      // Map parameters to columns
      if (mappings.timestamp) {
        const cellRef = `${mappings.timestamp}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.timestamp };
      }
      if (mappings.date) {
        const cellRef = `${mappings.date}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.dateStr };
      }
      if (mappings.time) {
        const cellRef = `${mappings.time}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.hourStr };
      }
      if (mappings.temp) {
        const cellRef = `${mappings.temp}${currentRow + 1}`;
        worksheet[cellRef] = { t: "n", v: record.temperature };
      }
      if (mappings.humidity) {
        const cellRef = `${mappings.humidity}${currentRow + 1}`;
        worksheet[cellRef] = { t: "n", v: record.humidity || "" };
      }
      if (mappings.windSpeed) {
        const cellRef = `${mappings.windSpeed}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.windSpeed || "" };
      }
      if (mappings.windDir) {
        const cellRef = `${mappings.windDir}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.windDirection || "" };
      }
      if (mappings.desc) {
        const cellRef = `${mappings.desc}${currentRow + 1}`;
        worksheet[cellRef] = { t: "s", v: record.description };
      }
    });

    // Write back populated file directly to Windows disk
    XLSX.writeFile(workbook, fullOutputPath);
  } else {
    // Generate Standard Excel or CSV
    addServiceLog(`Writing normal standardized sheet format to disk...`, "info");
    const workbook = XLSX.utils.book_new();

    // Mapping rows for sheet injection
    const rawDataRows = weatherRecords.map((r, i) => ({
      ID: i + 1,
      Timestamp: r.timestamp,
      "Date (YYYY-MM-DD)": r.dateStr,
      "Hour (HH:MM)": r.hourStr,
      [`Temp (°${cfg.unit})`]: r.temperature,
      "Humidity (%)": r.humidity,
      "Wind Speed": r.windSpeed,
      "Wind Direction": r.windDirection,
      Condition: r.description,
      DataSource: r.source
    }));

    if (cfg.exportFormat === "csv") {
      const csvSheet = XLSX.utils.json_to_sheet(rawDataRows);
      XLSX.utils.book_append_sheet(workbook, csvSheet, "Data");
      XLSX.writeFile(workbook, fullOutputPath, { bookType: "csv" });
    } else {
      // Create Daily Summary Sheet as well
      const tempLabel = `Temp (°${cfg.unit})`;
      const dailyGroups: { [date: string]: any[] } = {};
      weatherRecords.forEach(r => {
        if (!dailyGroups[r.dateStr]) dailyGroups[r.dateStr] = [];
        dailyGroups[r.dateStr].push(r);
      });

      const dailySummaryRows = Object.entries(dailyGroups).map(([dateStr, items]) => {
        const temps = items.map(t => t.temperature);
        const max = Math.max(...temps);
        const min = Math.min(...temps);
        const avg = parseFloat((temps.reduce((s, x) => s + x, 0) / temps.length).toFixed(1));
        const humidities = items.map(h => h.humidity).filter(h => h !== null) as number[];
        const avgHumid = humidities.length > 0 ? Math.round(humidities.reduce((s, h) => s + h, 0) / humidities.length) : null;

        return {
          "Summary Date": dateStr,
          [`Min ${tempLabel}`]: min,
          [`Max ${tempLabel}`]: max,
          [`Average ${tempLabel}`]: avg,
          "Avg Humidity (%)": avgHumid,
          "Hours Sampled": items.length
        };
      });

      const summarySheet = XLSX.utils.json_to_sheet(dailySummaryRows);
      const detailSheet = XLSX.utils.json_to_sheet(rawDataRows);

      XLSX.utils.book_append_sheet(workbook, summarySheet, "Daily Weather Summary");
      XLSX.utils.book_append_sheet(workbook, detailSheet, "Hourly Observations");

      // Save directly to physical file path on Windows
      XLSX.writeFile(workbook, fullOutputPath);
    }
  }

  addServiceLog(`Direct-to-disk background export completed successfully! Saved file size: approx ${weatherRecords.length} records. Path: "${fullOutputPath}"`, "success");
  return fullOutputPath;
}

// Background poll timer instance
let backgroundTimerId: NodeJS.Timeout | null = null;

function rearmBackgroundPollingService() {
  if (backgroundTimerId) {
    clearInterval(backgroundTimerId);
    backgroundTimerId = null;
  }

  const cfg = loadConfig();
  if (cfg.autoExport) {
    const hours = Math.max(1, cfg.pollingIntervalHours);
    addServiceLog(`Background scheduler armed! Polling interval currently set to: ${hours} hour(s).`, "info");
    
    // Trigger initial immediate fetch on boot/settings reload
    setTimeout(async () => {
      try {
        await performBackgroundFetch();
      } catch (err: any) {
        addServiceLog(`PWA background startup poll error: ${err.message}`, "err");
      }
    }, 5000);

    const msInterval = hours * 60 * 60 * 1000;
    backgroundTimerId = setInterval(async () => {
      try {
        await performBackgroundFetch();
      } catch (err: any) {
        addServiceLog(`PWA background recurring polling failed: ${err.message}`, "err");
      }
    }, msInterval);
  } else {
    addServiceLog("Background scheduled data polling is currently suspended (Auto-Download check box is disabled).", "info");
  }
}

// Start the Express Server
async function startServer() {
  const app = express();
  
  // Parse JSON payloads
  app.use(express.json({ limit: "50mb" }));

  // Arm initial background processes
  addServiceLog("NOAA Weather Broker Core Node online.", "success");
  rearmBackgroundPollingService();

  // API 1: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", serviceLogs: serviceLogs.slice(0, 5) });
  });

  // API 2: Load Active Config
  app.get("/api/config", (req, res) => {
    res.json(loadConfig());
  });

  // API 3: Update and Synchronize config
  app.post("/api/config", (req, res) => {
    try {
      const updated = saveConfig(req.body);
      addServiceLog(`Configuration updated via server endpoints. Reloading services...`, "info");
      rearmBackgroundPollingService();
      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API 4: Test local directory write permission right from server
  app.post("/api/test-disk-write", async (req, res) => {
    try {
      const cfg = loadConfig();
      if (!cfg.customDirectoryPath) {
        return res.status(400).json({ success: false, error: "Please enter a directory path first." });
      }

      const targetDir = path.resolve(cfg.customDirectoryPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const testFile = path.join(targetDir, "noaa_diagnostics_write.txt");
      fs.writeFileSync(testFile, `NOAA Weather Data Exporter local diagnostics test check performed at: ${new Date().toString()}`, "utf-8");
      
      addServiceLog(`Success writing diagnostic proof file to directory: "${targetDir}"`, "success");
      res.json({ success: true, absolutePath: targetDir });
    } catch (err: any) {
      addServiceLog(`Local write diagnostic rejection: ${err.message}`, "err");
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API 5: Force instant pull now of weather records
  app.post("/api/force-pull", async (req, res) => {
    try {
      addServiceLog("Instant forced pull triggered manually by client interface.", "info");
      const savedFilePath = await performBackgroundFetch();
      res.json({ success: true, filename: savedFilePath });
    } catch (err: any) {
      addServiceLog(`Forced weather collection failure: ${err.message}`, "err");
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API 6: Fetch Service logs to show in panel
  app.get("/api/service-logs", (req, res) => {
    res.json(serviceLogs);
  });

  // Service Worker Installer Node Windows script download helpers (built dynamically)
  app.get("/api/install-service-script", (req, res) => {
    const installScript = `// NOAA Weather Data Exporter - Windows Background Service Installer
// Powered by node-windows (Uses WinSW binary under the hood)
const Service = require('node-windows').Service;
const path = require('path');

// Reference Windows service setup
const svc = new Service({
  name: 'NOAAWeatherDataExporter',
  description: 'Automatically pulls hourly NOAA weather records & exports spreadsheet backups headlessly to local folders.',
  script: path.join(__dirname, 'dist', 'server.cjs'),
  nodeOptions: [
    '--harmony'
  ]
});

// Windows service event listeners
svc.on('install', function() {
  console.log('==================================================');
  console.log('NOAAWeatherDataExporter Service Installed Successfully!');
  console.log('==================================================');
  console.log('Starting background weather service daemon now...');
  svc.start();
});

svc.on('alreadyinstalled', function() {
  console.log('NOAA Service is already installed as a native Windows Service.');
});

svc.on('start', function() {
  console.log('Background Service running correctly. Listening on port 3000 headlessly.');
});

// Execute installation
console.log('Registering NOAA Weather Data Exporter daemon on Windows Local Service Controller...');
svc.install();
`;
    res.setHeader("Content-Disposition", "attachment; filename=install-windows-service.js");
    res.setHeader("Content-Type", "application/javascript");
    res.send(installScript);
  });

  app.get("/api/uninstall-service-script", (req, res) => {
    const uninstallScript = `// NOAA Weather Exporter - Windows Background Service Uninstaller
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'NOAAWeatherDataExporter',
  script: path.join(__dirname, 'dist', 'server.cjs')
});

svc.on('uninstall', function() {
  console.log('==================================================');
  console.log('NOAAWeatherDataExporter Windows Service Successfully Uninstalled.');
  console.log('==================================================');
});

console.log('Deregistering NOAA background processes from Local Windows Service manager...');
svc.uninstall();
`;
    res.setHeader("Content-Disposition", "attachment; filename=uninstall-windows-service.js");
    res.setHeader("Content-Type", "application/javascript");
    res.send(uninstallScript);
  });

  // Vite development middleware vs compiled asset hosting
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`NOAA weather server running at http://localhost:${PORT}`);
  });
}

startServer();
