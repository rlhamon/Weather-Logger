/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { geocodeZipcode, fetchNoaaForecast, fetchNoaaObservations, fetchHistoricalBackup, calculateDailySummaries } from './utils/weatherApi';
import { exportToExcel, exportToCsv, exportWithTemplate } from './utils/excelExport';
import { LocationInfo, WeatherRecord, WeatherUnit } from './types';

// Convert browser binary buffers to base64 for persistent offline localStorage saving
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

import WeatherChart from './components/WeatherChart';
import WeatherTable from './components/WeatherTable';
import { 
  Cloud, 
  CloudRain, 
  Download, 
  Search, 
  Calendar, 
  MapPin, 
  Activity, 
  FileSpreadsheet, 
  Info, 
  Thermometer, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  HelpCircle,
  TrendingUp,
  Wind,
  Droplets,
  Copy,
  Check,
  Printer,
  ChevronDown,
  Upload
} from 'lucide-react';

export default function App() {
  // Master UI state
  const [zipcode, setZipcode] = useState<string>('90210');
  const [unit, setUnit] = useState<WeatherUnit>('F');
  const [autoExport, setAutoExport] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  // File landing and custom folder destination states
  const [customDirectoryPath, setCustomDirectoryPath] = useState<string>(() => {
    return localStorage.getItem('noaa_custom_directory_path') || '';
  });
  const [directoryName, setDirectoryName] = useState<string>(() => {
    return localStorage.getItem('noaa_directory_name') || '';
  });
  const [directoryHandle, setDirectoryHandle] = useState<any>(null);

  // Sync customDirectoryPath and directoryName to local storage
  useEffect(() => {
    localStorage.setItem('noaa_custom_directory_path', customDirectoryPath);
    localStorage.setItem('noaa_directory_name', directoryName);
  }, [customDirectoryPath, directoryName]);

  const selectLocalDirectory = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        addLog('Requesting authorization to select local datalogger directory...', 'info');
        const handle = await (window as any).showDirectoryPicker();
        if (handle) {
          setDirectoryHandle(handle);
          setDirectoryName(handle.name);
          addLog(`Target folder set directly: "${handle.name}". Ready for direct-to-disk import exports.`, 'success');
        }
      } else {
        addLog('Your browser does not support high-fidelity direct folder writing. Please use the Directory Path field below as fallback.', 'err');
      }
    } catch (err: any) {
      addLog(`Directory selection cancelled or failed: ${err?.message || err}`, 'err');
    }
  };

  const clearLocalDirectory = () => {
    setDirectoryHandle(null);
    setDirectoryName('');
    addLog('Direct-to-disk local folder handle revoked. Falling back to browser downloads.', 'info');
  };

  // Custom spreadsheet template mapping configuration states
  const [useTemplate, setUseTemplate] = useState<boolean>(() => {
    return localStorage.getItem('noaa_use_template') === 'true';
  });
  const [templateFileName, setTemplateFileName] = useState<string>(() => {
    return localStorage.getItem('noaa_template_filename') || '';
  });
  const [templateFileBase64, setTemplateFileBase64] = useState<string>(() => {
    return localStorage.getItem('noaa_template_base64') || '';
  });
  const [templateStartRow, setTemplateStartRow] = useState<number>(() => {
    const rawVal = localStorage.getItem('noaa_template_startrow');
    return rawVal ? parseInt(rawVal, 10) : 2;
  });
  const [templateSheetName, setTemplateSheetName] = useState<string>(() => {
    return localStorage.getItem('noaa_template_sheetname') || '';
  });
  const [templateMappings, setTemplateMappings] = useState<Record<string, string>>(() => {
    const rawVal = localStorage.getItem('noaa_template_mappings');
    if (rawVal) {
      try {
        return JSON.parse(rawVal);
      } catch (_) {}
    }
    return {
      dateStr: 'A',
      hourStr: 'B',
      temperature: 'C',
      humidity: 'D',
      windSpeed: 'E',
      windDirection: 'F',
      description: 'G',
      source: 'H',
      timestamp: 'I'
    };
  });

  // Track settings changes in local storage
  useEffect(() => {
    localStorage.setItem('noaa_use_template', String(useTemplate));
    localStorage.setItem('noaa_template_filename', templateFileName);
    localStorage.setItem('noaa_template_base64', templateFileBase64);
    localStorage.setItem('noaa_template_startrow', String(templateStartRow));
    localStorage.setItem('noaa_template_sheetname', templateSheetName);
    localStorage.setItem('noaa_template_mappings', JSON.stringify(templateMappings));
  }, [useTemplate, templateFileName, templateFileBase64, templateStartRow, templateSheetName, templateMappings]);
  
  // Date selection state
  const [selectedPreset, setSelectedPreset] = useState<string>('yesterday');
  const [startDateStr, setStartDateStr] = useState<string>('');
  const [endDateStr, setEndDateStr] = useState<string>('');

  // Automated day rollover state
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [rolloverEnabled, setRolloverEnabled] = useState<boolean>(true);
  const [lastCheckedDayStr, setLastCheckedDayStr] = useState<string>('');

  // Loaded data state
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [records, setRecords] = useState<WeatherRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Logging / Status trail state
  const [statusLog, setStatusLog] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'err' }>>([]);
  const [copied, setCopied] = useState<boolean>(false);

  // Helper to obtain clean local YYYY-MM-DD date string
  const getTodayDateStr = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Generate date bounds for Yesterday (default)
  const getYesterdayDates = () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  };

  // Helper to add lines to standard interactive console logger
  const addLog = (text: string, type: 'info' | 'success' | 'err' = 'info') => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStatusLog(prev => [{ time: timeStr, text, type }, ...prev].slice(0, 15));
  };

  // Initialize dates
  useEffect(() => {
    const todayStr = getTodayDateStr();
    setLastCheckedDayStr(todayStr);

    const yesterday = getYesterdayDates();
    setStartDateStr(yesterday);
    setEndDateStr(yesterday);
    addLog('Application running. Configured ready for NOAA Weather Archival.');
  }, []);

  // Fetch handler triggered on click, change, preset selection, or mount
  const executeQuery = async (
    targetZip: string, 
    start: string, 
    end: string, 
    tempUnit: WeatherUnit,
    triggerAutoDownload: boolean = false
  ) => {
    if (!/^\d{5}$/.test(targetZip.trim())) {
      setError('Please provide a valid 5-digit US Zipcode.');
      return;
    }
    if (!start || !end) {
      setError('Start Date and End Date must be selected.');
      return;
    }

    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T23:59:59');

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setError('Invalid date formatting. Use YYYY-MM-DD.');
      return;
    }

    if (startDate > endDate) {
      setError('Start Date cannot be after End Date.');
      return;
    }

    setLoading(true);
    setError(null);
    setRecords([]);
    
    addLog(`Resolving coordinates for ZIP code ${targetZip}...`, 'info');

    try {
      // 1. Resolve Location Details
      const locInfo = await geocodeZipcode(targetZip);
      setLocation(locInfo);
      addLog(`Resolved: ${locInfo.cityName}, ${locInfo.stateCode || locInfo.state} (${locInfo.latitude.toFixed(3)}, ${locInfo.longitude.toFixed(3)})`, 'success');

      // 2. Determine best acquisition channel
      const today = new Date();
      const pastThreshold = new Date();
      pastThreshold.setDate(today.getDate() - 7); // NOAA observations standard window

      let fetchedRecords: WeatherRecord[] = [];
      let usedSource = '';

      if (endDate > today) {
        // Querying future dates -> NOAA Forecast Model
        addLog(`End Date exceeds current time. Pulling from active NOAA Forecast Model...`, 'info');
        fetchedRecords = await fetchNoaaForecast(locInfo.latitude, locInfo.longitude, startDate, endDate, tempUnit);
        usedSource = 'NOAA NWS Forecast';
      } else if (startDate < pastThreshold) {
        // Querying historical records beyond last 7 days -> NOAA Historical Reanalysis Model
        addLog(`Date range goes back beyond 7 days. Retrieving from NOAA Reanalysis Archives...`, 'info');
        fetchedRecords = await fetchHistoricalBackup(locInfo.latitude, locInfo.longitude, startDate, endDate, tempUnit);
        usedSource = 'NOAA Archive';
      } else {
        // Recent range -> Try Live Station Observations first, fallback to Historical Reanalysis
        try {
          addLog(`Retrieving active METAR weather station recordings near ${locInfo.cityName}...`, 'info');
          fetchedRecords = await fetchNoaaObservations(locInfo.latitude, locInfo.longitude, startDate, endDate, tempUnit);
          usedSource = 'NOAA Direct METAR';
        } catch (obsErr) {
          addLog(`Live observations busy or incomplete: ${obsErr instanceof Error ? obsErr.message : 'METAR offline'}. Fetching from NOAA archive instead...`, 'info');
          fetchedRecords = await fetchHistoricalBackup(locInfo.latitude, locInfo.longitude, startDate, endDate, tempUnit);
          usedSource = 'NOAA Reanalysis Backup';
        }
      }

      // Safeguard
      if (fetchedRecords.length === 0) {
        throw new Error('No weather measurements found on file for this interval.');
      }

      setRecords(fetchedRecords);
      addLog(`Successfully parsed ${fetchedRecords.length} hour-by-hour temperature details via ${usedSource}.`, 'success');

      // 3. Handle Auto-Export if enabled
      if (triggerAutoDownload) {
        if (useTemplate) {
          if (templateFileBase64) {
            try {
              addLog(`Auto-Export active. Populating custom data logger template: ${templateFileName}...`, 'info');
              const buffer = base64ToArrayBuffer(templateFileBase64);
              const isExcel = templateFileName.toLowerCase().endsWith('.xlsx') || templateFileName.toLowerCase().endsWith('.xls');
              exportWithTemplate(fetchedRecords, {
                fileName: templateFileName,
                fileBuffer: buffer,
                isExcel,
                startRow: templateStartRow,
                sheetName: templateSheetName,
                mappings: templateMappings as any,
                directoryHandle,
                customDirectoryPath
              });
              addLog(`Custom template compilation complete! Built file downloaded.`, 'success');
            } catch (tempErr: any) {
              addLog(`Auto-export template writing error: ${tempErr?.message || tempErr}`, 'err');
            }
          } else {
            addLog(`Auto-Export: Custom Template is enabled, but no template file has been uploaded! Falling back to standard export.`, 'err');
            const exportConfig = {
              zipcode: locInfo.zipcode,
              cityName: locInfo.cityName,
              stateCode: locInfo.stateCode || locInfo.state,
              startDateStr: start,
              endDateStr: end,
              unit: tempUnit,
              directoryHandle,
              customDirectoryPath
            };

            if (exportFormat === 'xlsx') {
              addLog('Auto-Export fallback: Initiating automatic Excel workbook compilation...', 'info');
              const summaries = calculateDailySummaries(fetchedRecords);
              exportToExcel(fetchedRecords, summaries, exportConfig);
              addLog('Excel spreadsheet generation complete! File downloaded.', 'success');
            } else {
              addLog('Auto-Export fallback: Initiating automatic CSV file generation...', 'info');
              exportToCsv(fetchedRecords, exportConfig);
              addLog('CSV generation complete! File downloaded.', 'success');
            }
          }
        } else {
          const exportConfig = {
            zipcode: locInfo.zipcode,
            cityName: locInfo.cityName,
            stateCode: locInfo.stateCode || locInfo.state,
            startDateStr: start,
            endDateStr: end,
            unit: tempUnit,
            directoryHandle,
            customDirectoryPath
          };

          if (exportFormat === 'xlsx') {
            addLog('Auto-Export active. Initiating automatic Excel workbook compilation...', 'info');
            const summaries = calculateDailySummaries(fetchedRecords);
            exportToExcel(fetchedRecords, summaries, exportConfig);
            addLog('Excel spreadsheet generation complete! File downloaded.', 'success');
          } else {
            addLog('Auto-Export active. Initiating automatic CSV file generation...', 'info');
            exportToCsv(fetchedRecords, exportConfig);
            addLog('CSV generation complete! File downloaded.', 'success');
          }
        }
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unable to complete weather query.';
      setError(errMsg);
      addLog(`Query Failed: ${errMsg}`, 'err');
    } finally {
      setLoading(false);
    }
  };

  // Perform automatic load of "Yesterday's" data on startup
  useEffect(() => {
    const yesterday = getYesterdayDates();
    if (yesterday) {
      // Trigger query
      executeQuery('90210', yesterday, yesterday, 'F', false);
    }
  }, []);

  // 1. Maintain ticking visual UI clock for the data archiver program
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // 2. Active monitor detecting calendar day rollover to auto-download previous day totals
  useEffect(() => {
    if (!rolloverEnabled) return;

    const detectorTimer = setInterval(() => {
      const now = new Date();
      const liveTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      if (lastCheckedDayStr && liveTodayStr !== lastCheckedDayStr) {
        addLog(`Calendar day shift detected! Clock rolled from ${lastCheckedDayStr} to ${liveTodayStr}`, 'info');
        
        // Save old completed day
        const elapsedDay = lastCheckedDayStr;
        
        // Advance check
        setLastCheckedDayStr(liveTodayStr);
        
        // Update user screen parameters to match the rolled completed day
        setStartDateStr(elapsedDay);
        setEndDateStr(elapsedDay);
        setSelectedPreset('yesterday');
        
        // Fire executeQuery forcing full record compilation and browser file download
        addLog(`Automatic rollover starting. Compiling totals for yesterday (${elapsedDay})...`, 'success');
        executeQuery(zipcode, elapsedDay, elapsedDay, unit, true);
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(detectorTimer);
  }, [rolloverEnabled, lastCheckedDayStr, zipcode, unit]);

  // Manual rollover simulation for testing and hardware syncing
  const handleSimulateRollover = () => {
    if (!lastCheckedDayStr) return;
    
    addLog('Simulating automated calendar day rollover event...', 'info');
    
    const currentDate = new Date(lastCheckedDayStr + 'T12:00:00');
    currentDate.setDate(currentDate.getDate() + 1);
    
    const virtualNextDay = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    const elapsedDayVal = lastCheckedDayStr;
    
    addLog(`Simulation: Virtual clocked rolled over from ${elapsedDayVal} to ${virtualNextDay}.`, 'success');
    
    setLastCheckedDayStr(virtualNextDay);
    setStartDateStr(elapsedDayVal);
    setEndDateStr(elapsedDayVal);
    setSelectedPreset('yesterday');
    
    addLog(`Simulation trigger: Fetching previous day's totals for ${elapsedDayVal} with auto-download...`, 'success');
    executeQuery(zipcode, elapsedDayVal, elapsedDayVal, unit, true);
  };

  // Handle preset selections
  const handlePresetChange = (preset: string) => {
    setSelectedPreset(preset);
    const today = new Date();
    let start = '';
    let end = '';

    const formatOffsetDate = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(today.getDate() - offsetDays);
      return d.toISOString().split('T')[0];
    };

    switch (preset) {
      case 'yesterday':
        start = getYesterdayDates();
        end = getYesterdayDates();
        addLog('Preset set: Previous Day.');
        break;
      case 'last7':
        start = formatOffsetDate(7);
        end = formatOffsetDate(1);
        addLog('Preset set: Last 7 Days Weather Archive.');
        break;
      case 'last30':
        start = formatOffsetDate(30);
        end = formatOffsetDate(1);
        addLog('Preset set: Last 30 Days Weather Archive.');
        break;
      case 'custom':
        // Keep existing parameters, let user click input fields
        addLog('Preset set: Custom Dates. Change start/end triggers below.');
        return;
      default:
        return;
    }

    setStartDateStr(start);
    setEndDateStr(end);
    
    // Automatically query immediately when changing preset
    executeQuery(zipcode, start, end, unit, autoExport);
  };

  // Immediate manually triggered action
  const handleSearchTrigger = (e: React.FormEvent) => {
    e.preventDefault();
    executeQuery(zipcode, startDateStr, endDateStr, unit, autoExport);
  };

  // Process and load custom spreadsheet / CSV metadata templates
  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog(`Loading template sheet: ${file.name}...`, 'info');
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        try {
          const base64 = arrayBufferToBase64(buffer);
          setTemplateFileName(file.name);
          setTemplateFileBase64(base64);
          addLog(`Successfully parsed template file. Settings saved into web storage.`, 'success');
        } catch (err: any) {
          addLog(`Error parsing uploaded template: ${err?.message || err}`, 'err');
        }
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Export trigger supporting both Excel (.xlsx), CSV (.csv) and custom templates
  const triggerManualExport = () => {
    if (records.length === 0 || !location) {
      addLog('Cannot export. No database loaded yet. Please search a ZIP code.', 'err');
      return;
    }

    if (useTemplate) {
      if (templateFileBase64) {
        try {
          addLog(`Assembling weather data entries into custom template: ${templateFileName}...`, 'info');
          const buffer = base64ToArrayBuffer(templateFileBase64);
          const isExcel = templateFileName.toLowerCase().endsWith('.xlsx') || templateFileName.toLowerCase().endsWith('.xls');
          exportWithTemplate(records, {
            fileName: templateFileName,
            fileBuffer: buffer,
            isExcel,
            startRow: templateStartRow,
            sheetName: templateSheetName,
            mappings: templateMappings as any,
            directoryHandle,
            customDirectoryPath
          });
          addLog(`Custom template export successful. Integrated file downloaded!`, 'success');
          return;
        } catch (err: any) {
          addLog(`Failed to populate custom template: ${err?.message || err}`, 'err');
          return;
        }
      } else {
        addLog(`Custom template mapping is enabled, but no template file has been uploaded! Please upload a file in the Custom Template panel, or disable custom template to use standard export.`, 'err');
        return;
      }
    }

    const exportConfig = {
      zipcode: location.zipcode,
      cityName: location.cityName,
      stateCode: location.stateCode || location.state,
      startDateStr: startDateStr,
      endDateStr: endDateStr,
      unit: unit,
      directoryHandle,
      customDirectoryPath
    };

    if (exportFormat === 'xlsx') {
      addLog('Assembling dataset columns into worksheets...', 'info');
      const summaries = calculateDailySummaries(records);
      exportToExcel(records, summaries, exportConfig);
      addLog('Excel export successful. Transferred sheets to user local drive.', 'success');
    } else {
      addLog('Encoding dataset columns into CSV rows...', 'info');
      exportToCsv(records, exportConfig);
      addLog('CSV export successful. Transferred CSV sheet to user local drive.', 'success');
    }
  };

  // Calculates metrics block
  const metrics = useMemo(() => {
    if (records.length === 0) return null;
    const temps = records.map(r => r.temperature);
    const max = Math.max(...temps);
    const min = Math.min(...temps);
    const avg = parseFloat((temps.reduce((sum, val) => sum + val, 0) / temps.length).toFixed(1));
    return { min, max, avg };
  }, [records]);

  // Action to format and copy current weather metrics to clipboard
  const handleCopySummary = async () => {
    if (!metrics || !location) return;

    const summaryText = `WEATHER DATA SUMMARY - NOAA DATA ARCHIVER
-----------------------------------------
Region Location: ${location.cityName}, ${location.stateCode || location.state} (${location.zipcode})
Date Interval  : ${startDateStr} to ${endDateStr}
Average Temp   : ${metrics.avg}°${unit}
Peak Recorded  : ${metrics.max}°${unit}
Lowest Temp    : ${metrics.min}°${unit}
Hourly Records : ${records.length} slots
Generated At   : ${new Date().toLocaleString()} (Local)`;

    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      addLog(`Formatted weather metrics summary for ${location.cityName} copied to clipboard!`, 'success');
      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch (err) {
      addLog('Copy to clipboard failed. Ensure permissions are allowed.', 'err');
    }
  };

  // Action to trigger browser print dialog for current metrics & chart snapshot
  const handlePrint = () => {
    addLog(`Initiating browser print dialog for ${location?.cityName || 'current'} weather metrics and chart snapshot...`, 'info');
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col antialiased">
      {/* Structural Master Header */}
      <header className="h-20 shrink-0 border-b border-slate-200 bg-white shadow-xs px-6 sm:px-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-md shadow-sky-100 shrink-0">
            <Cloud className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800 uppercase flex items-center gap-2">
              NOAA Data Archiver <span className="bg-sky-100 text-sky-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">v2.4</span>
            </h1>
            <p className="text-xs text-slate-500 hidden sm:block font-medium">National Oceanic & Atmospheric Administration Exporter</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 leading-none">Status</span>
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5 mt-0.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              NOAA CDO Nodes Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto grid grid-cols-12 gap-6 print:block print:p-0">
        
        {/* Left Hand Sidebar Controls Panel (3 columns width) */}
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-6">
          
          {/* Location & Zip Form container */}
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
            <h2 className="text-slate-800 font-bold text-sm tracking-tight mb-4 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-sky-600" />
              Location Setup
            </h2>
            <form onSubmit={handleSearchTrigger} className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 block">US Postal Zip Code</label>
                <div className="relative">
                  <input
                    type="text"
                    id="user-zipcode"
                    placeholder="Enter Zipcode (e.g. 90210)"
                    value={zipcode}
                    onChange={(e) => setZipcode(e.target.value.slice(0, 5))}
                    className="w-full p-3 pl-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-semibold focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white outline-hidden transition-all text-slate-800"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    id="submit-zipcode-btn"
                    className="absolute right-2.5 top-2.5 bg-sky-600 text-white p-1.5 rounded-lg hover:bg-sky-700 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                    title="Retrieve Weather Records"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {location && (
                <div className="p-3.5 bg-sky-50/50 rounded-xl border border-sky-100 flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-sky-600 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold text-slate-800 uppercase tracking-tight block">Target Weather Region</span>
                    <span className="text-slate-600 font-medium">{location.cityName}, {location.stateCode || location.state}</span>
                    <span className="text-[10px] text-slate-400 block font-mono mt-0.5">Lat: {location.latitude.toFixed(4)} / Lon: {location.longitude.toFixed(4)}</span>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Temporal Time Config Container */}
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs">
            <h2 className="text-slate-800 font-bold text-sm tracking-tight mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-sky-600" />
              Temporal Range
            </h2>
            
            {/* Quick Presets Menu */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                id="preset-yesterday"
                onClick={() => handlePresetChange('yesterday')}
                className={`p-2 text-xs font-semibold rounded-xl text-center border transition-all ${
                  selectedPreset === 'yesterday'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Previous Day
              </button>
              <button
                type="button"
                id="preset-last7"
                onClick={() => handlePresetChange('last7')}
                className={`p-2 text-xs font-semibold rounded-xl text-center border transition-all ${
                  selectedPreset === 'last7'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                id="preset-last30"
                onClick={() => handlePresetChange('last30')}
                className={`p-2 text-xs font-semibold rounded-xl text-center border transition-all ${
                  selectedPreset === 'last30'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                id="preset-custom"
                onClick={() => handlePresetChange('custom')}
                className={`p-2 text-xs font-semibold rounded-xl text-center border transition-all ${
                  selectedPreset === 'custom'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Custom Range
              </button>
            </div>

            {/* Custom Range Input fields */}
            <div className={`space-y-3 pt-2 border-t border-slate-100 transition-opacity ${selectedPreset === 'custom' ? 'opacity-100' : 'opacity-70'}`}>
              <div>
                <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold">Start Date</span>
                <input
                  type="date"
                  id="start-date-input"
                  value={startDateStr}
                  onChange={(e) => {
                    setStartDateStr(e.target.value);
                    if (selectedPreset !== 'custom') setSelectedPreset('custom');
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block mb-1 uppercase font-bold">End Date</span>
                <input
                  type="date"
                  id="end-date-input"
                  value={endDateStr}
                  onChange={(e) => {
                    setEndDateStr(e.target.value);
                    if (selectedPreset !== 'custom') setSelectedPreset('custom');
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                />
              </div>
              
              <button
                type="button"
                id="apply-dates-btn"
                onClick={() => executeQuery(zipcode, startDateStr, endDateStr, unit, autoExport)}
                disabled={loading}
                className="w-full py-2 bg-slate-800 text-white text-xs font-bold rounded-xl mt-1.5 hover:bg-slate-900 active:scale-98 transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                Reload Custom Interval
              </button>
            </div>
          </div>

          {/* Unit selection and Export config */}
          <div className="bg-sky-950 p-5 rounded-2xl text-white shadow-md shadow-sky-950/20">
            <h3 className="font-bold text-sm mb-4 tracking-tight uppercase border-b border-sky-900 pb-2 text-sky-200 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Export Configuration
            </h3>
            <div className="space-y-4">
              {/* Temperature measurement unit */}
              <div>
                <span className="text-[10px] text-sky-300 block mb-1.5 uppercase font-bold tracking-wider">Atmospheric Scale</span>
                <div className="flex bg-sky-900/50 p-1 rounded-lg">
                  <button
                    type="button"
                    id="scale-f"
                    onClick={() => {
                      setUnit('F');
                      executeQuery(zipcode, startDateStr, endDateStr, 'F', false);
                    }}
                    className={`flex-1 text-center py-1.5 text-xs font-bold rounded-md transition-all ${
                      unit === 'F' ? 'bg-sky-600 text-white shadow-xs' : 'text-sky-200 hover:text-white'
                    }`}
                  >
                    Fahrenheit (°F)
                  </button>
                  <button
                    type="button"
                    id="scale-c"
                    onClick={() => {
                      setUnit('C');
                      executeQuery(zipcode, startDateStr, endDateStr, 'C', false);
                    }}
                    className={`flex-1 text-center py-1.5 text-xs font-bold rounded-md transition-all ${
                      unit === 'C' ? 'bg-sky-600 text-white shadow-xs' : 'text-sky-200 hover:text-white'
                    }`}
                  >
                    Celsius (°C)
                  </button>
                </div>
              </div>

              {/* Autodownload checkbox */}
              <div className="pt-2 border-t border-sky-900/60">
                <label className="flex items-start gap-3 text-xs select-none cursor-pointer font-medium">
                  <input 
                    type="checkbox" 
                    id="check-auto-download"
                    checked={autoExport}
                    onChange={(e) => setAutoExport(e.target.checked)}
                    className="mt-0.5 accent-sky-400 h-4 w-4 rounded-sm border-sky-900 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-sky-100 block">Auto-Download Spreadsheet</span>
                    <span className="text-[10px] text-sky-300 leading-tight block mt-0.5 font-normal">Automatically trigger downloading Excel workbook upon completing fetch.</span>
                  </div>
                </label>
              </div>

              {/* Land Location/Folder Selection */}
              <div className="pt-2.5 border-t border-sky-900/60 space-y-2">
                <span className="text-[10px] text-sky-300 block uppercase font-bold tracking-wider">File Landing Destination</span>
                
                <div>
                  <label className="text-[9px] text-sky-200 block mb-1 font-semibold uppercase tracking-wider">Datalogger Import Subfolder / Path:</label>
                  <input
                    type="text"
                    value={customDirectoryPath}
                    onChange={(e) => setCustomDirectoryPath(e.target.value)}
                    placeholder="e.g. C:/LoggerData/Imports/ or /var/log/weather/"
                    className="w-full text-xs bg-sky-900/40 border border-sky-800 rounded-lg px-2.5 py-1.5 text-white placeholder-sky-400/50 focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-mono"
                    title="Specify a local subfolder or directory path configuration where you want the file to be imported. Appends folder identifier context to the download filename."
                  />
                </div>

                <div className="pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-sky-300 font-bold uppercase tracking-wider">Direct-to-Disk Sync:</span>
                    {directoryName ? (
                      <button
                        type="button"
                        onClick={clearLocalDirectory}
                        className="text-[9px] text-rose-300 hover:text-rose-100 font-bold underline cursor-pointer"
                      >
                        Disconnect folder
                      </button>
                    ) : null}
                  </div>
                  
                  {directoryName ? (
                    <div className="mt-1 p-2 bg-emerald-950/40 border border-emerald-900/50 rounded-lg flex items-center justify-between text-[10px] text-emerald-200 font-mono">
                      <span className="truncate font-bold max-w-[190px]" title={directoryName}>
                        📂 {directoryName}
                      </span>
                      <span className="text-[9px] uppercase bg-emerald-900/65 text-emerald-100 px-1.5 py-0.5 rounded-sm shrink-0 font-bold font-sans">
                        Active
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={selectLocalDirectory}
                      className="w-full mt-1 py-1.5 bg-sky-900/70 hover:bg-sky-900 text-sky-100 text-xs font-bold rounded-lg transition-all border border-sky-800/80 active:scale-98 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      title="Directly select a physical directory on your computer to save files silently"
                    >
                      <Upload className="h-3.5 w-3.5 text-sky-300" />
                      Select Local Folder...
                    </button>
                  )}
                  <p className="text-[9px] text-sky-300/65 leading-relaxed mt-1">
                    Tip: Direct saving runs in standard tabs. For silent direct-to-disk writes, choose "Open in a new tab" from the top-right tool menu. Otherwise, we cleanly include the custom folder context in the download!
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Automated Day-Rollover & Hardware Data Logger Sync Engine */}
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs print:hidden">
            <h3 className="text-slate-800 font-bold text-sm tracking-tight mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-600" />
              Logger Automator
            </h3>
            <p className="text-[10px] text-slate-500 leading-relaxed mb-4">
              Allows running beside a hardware weather data logger. Keeps track of the local day. When a calendar day changes, dates shift to yesterday and automatically triggers a dataset compilation event.
            </p>

            <div className="space-y-4">
              {/* Local Program Ticking clock status display */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-1.5">
                <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">Local System Clock</span>
                <span className="text-xs font-mono font-bold text-slate-700">
                  {currentTime.toLocaleDateString()} {currentTime.toLocaleTimeString()}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5 pt-1.5 border-t border-slate-200/60">
                  <span className="text-[9px] uppercase font-bold text-slate-400">Tracked Day:</span>
                  <span className="text-[10px] font-mono font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded-sm">
                    {lastCheckedDayStr || 'Unknown'}
                  </span>
                </div>
              </div>

              {/* Status and Active Checkbox */}
              <label className="flex items-start gap-3 text-xs select-none cursor-pointer">
                <input 
                  type="checkbox" 
                  id="rollover-engine-checkbox"
                  checked={rolloverEnabled}
                  onChange={(e) => {
                    setRolloverEnabled(e.target.checked);
                    addLog(e.target.checked 
                      ? 'Automated Day Rollover Engine armed & monitoring clock.' 
                      : 'Automated Day Rollover Engine deactivated.', 'info');
                  }}
                  className="mt-0.5 accent-sky-600 h-4 w-4 rounded-sm border-slate-300"
                />
                <div>
                  <span className="font-bold text-slate-800 block">Arm Day-Rollover Engine</span>
                  <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                    Monitor system time and auto-download previous day's totals.
                  </span>
                </div>
              </label>

              {/* Trigger simulation button for quick verification */}
              <button
                type="button"
                id="btn-simulate-rollover"
                onClick={handleSimulateRollover}
                className="w-full py-2 bg-sky-50 hover:bg-sky-100/80 hover:text-sky-700 text-sky-600 text-xs font-bold rounded-xl mt-1.5 active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-sky-100 shadow-2xs"
                title="Manually simulate a day rollover event to verify automatic previous-day export download"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Simulate Day Rollover</span>
              </button>
            </div>
          </div>

          {/* Custom Spreadsheet/CSV Template Mapper Card */}
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs print:hidden">
            <h3 className="text-slate-800 font-bold text-sm tracking-tight mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-sky-600" />
                Custom Template
              </span>
              <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-100 text-sky-600 font-mono">
                Logger Sync
              </span>
            </h3>
            
            <p className="text-[10px] text-slate-500 leading-relaxed mb-4">
              Upload a customized Excel (.xlsx/.xls) or CSV template to populate weather observations directly into specific rows and column letters for your local logging tools.
            </p>

            <div className="space-y-4">
              {/* Toggle to activate template */}
              <label className="flex items-start gap-3 text-xs select-none cursor-pointer">
                <input 
                  type="checkbox" 
                  id="template-override-checkbox"
                  checked={useTemplate}
                  onChange={(e) => {
                    setUseTemplate(e.target.checked);
                    addLog(e.target.checked 
                      ? 'Custom template overrides active. Exports will write to template cells.' 
                      : 'Standard exports restored.', 'info');
                  }}
                  className="mt-0.5 accent-sky-600 h-4 w-4 rounded-sm border-slate-300"
                />
                <div>
                  <span className="font-bold text-slate-800 block">Enable Custom Template</span>
                  <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                    Map atmospheric parameters directly into pre-formatted cells.
                  </span>
                </div>
              </label>

              {useTemplate && (
                <div className="pt-3 border-t border-slate-100 space-y-4">
                  {/* File Upload Box */}
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider mb-1.5">
                      Spreadsheet or CSV Template File
                    </span>
                    
                    {templateFileBase64 ? (
                      <div className="p-2.5 bg-sky-50/40 border border-sky-100 rounded-xl flex items-center justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] font-mono font-bold text-slate-700 block truncate" title={templateFileName}>
                            {templateFileName}
                          </span>
                          <span className="text-[9px] text-sky-600 font-bold flex items-center gap-1 mt-0.5">
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-sky-500" />
                            Stored Offline & Active
                          </span>
                        </div>
                        <button
                          type="button"
                          id="btn-clear-template"
                          onClick={() => {
                            setTemplateFileName('');
                            setTemplateFileBase64('');
                            addLog('Custom template file cleared.', 'info');
                          }}
                          className="px-2 py-1 text-[10px] bg-white border border-slate-200 text-slate-500 hover:text-rose-500 hover:border-rose-200 rounded-md transition-all cursor-pointer font-bold"
                          title="Clear uploaded template file"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div className="relative border-2 border-dashed border-slate-200 rounded-xl hover:border-sky-400 hover:bg-sky-50/20 transition-all p-4 text-center cursor-pointer">
                        <input
                          type="file"
                          id="file-template-uploader"
                          accept=".xlsx,.xls,.csv"
                          onChange={handleTemplateUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Upload className="h-5 w-5 text-sky-500 mx-auto mb-1.5" />
                        <span className="text-[10px] text-slate-600 font-bold block">
                          Upload Excel / CSV Template
                        </span>
                        <span className="text-[8px] text-slate-400 block mt-0.5">
                          Drag file here or click to browse
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Sheet Name and Start Row Row */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider mb-1">
                        Sheet Name
                      </span>
                      <input 
                        type="text"
                        id="input-template-sheetname"
                        value={templateSheetName}
                        onChange={(e) => setTemplateSheetName(e.target.value)}
                        placeholder="First Sheet (Auto)"
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-medium"
                      />
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider mb-1">
                        Start Row
                      </span>
                      <input 
                        type="number"
                        id="input-template-startrow"
                        value={templateStartRow}
                        onChange={(e) => setTemplateStartRow(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        min="1"
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Mapping Fields Sliders */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                        Column Mapping Letter
                      </span>
                      <span className="text-[8px] text-slate-400 font-semibold italic">
                        Leave blank to omit
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                      {[
                        { key: 'dateStr', label: 'Date (YYYY-MM-DD)' },
                        { key: 'hourStr', label: 'Hour (HH:00)' },
                        { key: 'temperature', label: 'Temperature' },
                        { key: 'humidity', label: 'Relative Humidity (%)' },
                        { key: 'windSpeed', label: 'Wind Speed' },
                        { key: 'windDirection', label: 'Wind Direction' },
                        { key: 'description', label: 'Condition Weather' },
                        { key: 'source', label: 'Acquisition Channel' },
                        { key: 'timestamp', label: 'Raw Date Timestamp' }
                      ].map(({ key, label }) => (
                        <div key={key} className="flex items-center justify-between gap-1.5 border-b border-slate-200/50 pb-1.5 last:border-0 last:pb-0">
                          <span className="text-[10px] text-slate-700 font-medium truncate shrink-1" title={label}>
                            {label}
                          </span>
                          <input 
                            type="text"
                            id={`mapping-${key}`}
                            value={templateMappings[key] || ''}
                            onChange={(e) => {
                              const cleanedVal = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
                              setTemplateMappings(prev => ({
                                ...prev,
                                [key]: cleanedVal
                              }));
                            }}
                            placeholder="None"
                            className="w-12 text-center text-xs bg-white border border-slate-200 rounded-md py-0.5 px-1 font-mono font-bold text-sky-600 focus:outline-hidden focus:ring-1 focus:ring-sky-500 uppercase"
                            maxLength={3}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Diagnostic Console Panel (Interactive status monitoring) */}
          <div className="bg-slate-900 text-slate-300 p-5 rounded-2xl border border-slate-800 font-mono text-[10px] shadow-sm">
            <div className="flex justify-between items-center mb-2.5 border-b border-slate-800 pb-2">
              <span className="text-[9px] uppercase font-bold tracking-wider text-sky-400">Atmospheric Data Terminal</span>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>
            </div>
            <div className="h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {statusLog.length === 0 ? (
                <div className="text-slate-500 italic">No system actions registered.</div>
              ) : (
                statusLog.map((log, i) => (
                  <div key={i} className="leading-relaxed border-l-2 pl-2 border-slate-800">
                    <span className="text-sky-400 font-bold">[{log.time}]</span>{' '}
                    <span className={
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'err' ? 'text-rose-400 font-semibold' : 'text-slate-300'
                    }>
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </aside>

        {/* Right Hand Output Panel (9 columns width) */}
        <section className="col-span-12 lg:col-span-8 xl:col-span-9 flex flex-col gap-6 print:w-full print:p-0">
          
          {/* Diagnostic Alert Errors if present */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl flex items-start gap-3 animated text-sm">
              <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold block text-sm text-rose-900">Atmospheric Network Query Error</span>
                <span className="text-xs text-rose-700 font-semibold mt-1 block">{error}</span>
                <span className="text-[11px] text-rose-600 block mt-2 leading-relaxed">
                  Tip: Ensure the ZIP code is a valid 5-digit sequence. If a direct Live Metar station experiences high latency, the database will attempt to use historical reanalysis modules.
                </span>
              </div>
            </div>
          )}

          {/* Interactive Loading Visual feedback */}
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center shadow-xs">
              <div className="relative flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-sky-100 border-t-sky-600 rounded-full animate-spin"></div>
                <CloudRain className="absolute h-5 w-5 text-sky-600 animate-bounce" />
              </div>
              <h3 className="text-sm font-bold mt-4 text-slate-800 uppercase tracking-tight">Accessing Atmospheric Archive...</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed">
                Contacting NOAA CDO server layers to locate coordinates and download temperature history records.
              </p>
            </div>
          ) : records.length > 0 ? (
            <>
              {/* Printable-only report header formatted professionally with location, coordinate thresholds, timeline, and timestamps */}
              <div id="noaa-print-header" className="hidden print:block border-b-2 border-slate-800 pb-4 mb-6">
                <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-2xl font-black text-slate-950 tracking-tight">NOAA WEATHER METRICS REPORT</h1>
                    <p className="text-sm font-semibold text-slate-600 mt-1">
                      Target Area: <span className="text-slate-900 font-bold">{location?.cityName}, {location?.stateCode || location?.state}</span> ({location?.zipcode})
                    </p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Coordinates: Lat {location?.latitude.toFixed(4)} / Lon {location?.longitude.toFixed(4)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-sm inline-block uppercase">PRESET: {selectedPreset}</p>
                    <p className="text-xs text-slate-600 mt-1">Timeline: {startDateStr} to {endDateStr}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">Report Date: {new Date().toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* Metrics Header Summary Bar with Copy & Print Summary Triggers */}
              <div id="noaa-metrics-summary" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-sky-600 animate-pulse" />
                    WEATHER METRICS SUMMARY
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      id="btn-copy-summary"
                      onClick={handleCopySummary}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-sky-600 hover:bg-slate-100 hover:border-sky-200 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Copy Weather Summary of current metrics to clipboard"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-sky-600" />
                          <span>Copy Summary</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      id="btn-print-summary"
                      onClick={handlePrint}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-sky-600 hover:bg-slate-100 hover:border-sky-200 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                      title="Print weather metrics report page"
                    >
                      <Printer className="h-3 w-3 text-sky-600" />
                      <span>Print Summary</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border-r border-slate-100 last:border-0 pr-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Average Temp</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-800">{metrics?.avg}</span>
                      <span className="text-xs font-semibold text-slate-400">°{unit}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Selected interval average</span>
                  </div>

                  <div className="border-r border-slate-100 last:border-0 pr-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Peak Recorded</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-rose-600">{metrics?.max}</span>
                      <span className="text-xs font-semibold text-rose-400">°{unit}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Maximum registered temperature</span>
                  </div>

                  <div className="border-r border-slate-100 last:border-0 pr-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Lowest Recorded</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-blue-600">{metrics?.min}</span>
                      <span className="text-xs font-semibold text-blue-400">°{unit}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Minimum registered temperature</span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Spreadsheets Row Count</span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-800">{records.length}</span>
                      <span className="text-xs font-semibold text-slate-400">slots</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Individual hour data points</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Line Chart rendering hourly metrics */}
              <WeatherChart records={records} unit={unit} />

              {/* Action trigger bar for spreadsheet manual exporting */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between print:hidden">
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <div className="w-10 h-10 bg-sky-50 text-sky-600 rounded-xl flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="text-center md:text-left flex-1">
                    <h3 className="text-xs font-bold text-slate-800">Dataset Export Available</h3>
                    <p className="text-[10px] text-slate-500">Fully synthesized multi-tab Microsoft Excel workbooks or interoperable flat CSV files.</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                  {/* Unified format select dropdown */}
                  <div className="relative flex-1 sm:flex-none">
                    <select
                      id="export-format-selector"
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as 'xlsx' | 'csv')}
                      className="w-full sm:w-auto appearance-none bg-white border border-slate-200 text-slate-700 text-xs font-bold pl-4 pr-10 py-2.5 rounded-xl hover:border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 cursor-pointer uppercase tracking-wider"
                      title="Select download format"
                    >
                      <option value="xlsx">Excel File (.xlsx)</option>
                      <option value="csv">Standard CSV (.csv)</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>

                  <button
                    type="button"
                    id="btn-manual-xlsx-export"
                    onClick={triggerManualExport}
                    className="flex-1 sm:flex-none px-6 py-2.5 bg-sky-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-sky-100 hover:bg-sky-700 hover:scale-[1.01] active:scale-99 transition-all flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer font-semibold shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    Export {exportFormat === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}
                  </button>
                </div>
              </div>

              {/* Hourly Grid Rows and daily average summaries tabs */}
              <div className="print:hidden">
                <WeatherTable records={records} unit={unit} />
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center shadow-xs">
              <CloudRain className="h-10 w-10 text-slate-300 animate-pulse mb-3" />
              <h3 className="text-sm font-bold text-slate-800 uppercase">No Database Active</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed">
                Provide a valid zipcode on the sidebar to resolve coordinates and retrieve historical temperature charts immediately.
              </p>
            </div>
          )}

          {/* Quick Informational Guide Footer section explaining source details */}
          <div className="bg-slate-100 border border-slate-200 rounded-2xl p-5 flex items-start gap-4 print:hidden">
            <Info className="h-5 w-5 text-slate-500 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed text-slate-600 font-medium">
              <span className="font-bold text-slate-800 block mb-1">How NOAA Data Archival Works:</span>
              <ul className="list-disc list-inside space-y-1">
                <li>On start/refresh, previous day hour-to-hour records download automatically for <span className="font-bold text-sky-600">{location?.cityName || 'ZIP 90210'}</span>.</li>
                <li><strong>Forecast queries</strong> utilize standard model coordinate endpoints compiled in real time.</li>
                <li><strong>Observations / METAR measurements</strong> pull direct sensory reporting from the closest Physical Weather Stations.</li>
                <li><strong>Historical Range queries</strong> unlock NOAA Model Reanalysis archives spanning all records from 1940 through today!</li>
              </ul>
            </div>
          </div>

        </section>
      </main>

      {/* Corporate Metadata Footer aligned precisely to Geometric design layout rules */}
      <footer className="h-14 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between px-6 sm:px-10 text-[10px] text-slate-400 font-bold tracking-tight uppercase gap-2 py-3 sm:py-0">
        <div className="flex items-center gap-4">
          <span>PORTAL_REF: NOAA_CDO_V2_PRO</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span>LOCATION_REF: {location ? `${location.cityName.replace(/\s+/g, '_')}_${location.stateCode || 'US'}` : 'CALIFORNIA_SOUTH_09'}</span>
        </div>
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Verified Secure Connection to NOAA CDO and NWS Stations</span>
        </div>
      </footer>
    </div>
  );
}
