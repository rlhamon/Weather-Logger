/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as XLSX from 'xlsx';
import { WeatherRecord, DailySummary } from '../types';

interface ExportOptions {
  zipcode: string;
  cityName: string;
  stateCode: string;
  startDateStr: string;
  endDateStr: string;
  unit: 'F' | 'C';
}

/**
 * Encodes and downloads the hourly records as a Standard CSV file.
 * Includes UTF-8 BOM for modern Excel and external tool interoperability.
 */
export function exportToCsv(
  hourlyRecords: WeatherRecord[],
  options: ExportOptions
) {
  const { zipcode, cityName, stateCode, startDateStr, endDateStr, unit } = options;
  const tempLabel = `Temp (°${unit})`;
  const finalFilename = `NOAA_Weather_${zipcode}_${startDateStr}_to_${endDateStr}.csv`;

  const headers = [
    'Date (YYYY-MM-DD)',
    'Hour (24h)',
    tempLabel,
    'Relative Humidity (%)',
    'Wind Speed',
    'Wind Direction',
    'Condition Description',
    'Data Acquisition Channel',
    'ISO Timestamp'
  ];

  const escapeCsvValue = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = hourlyRecords.map(r => [
    r.dateStr,
    r.hourStr,
    r.temperature,
    r.humidity !== null ? `${r.humidity}%` : 'N/A',
    r.windSpeed || 'Calm',
    r.windDirection || 'N/A',
    r.description,
    r.source,
    r.timestamp
  ]);

  const csvContent = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ].join('\n');

  // Insert UTF-8 BOM for seamless Microsoft Excel rendering with special symbols like "°"
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const dataBlob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const downloadLink = document.createElement('a');
  const url = URL.createObjectURL(dataBlob);
  downloadLink.href = url;
  downloadLink.download = finalFilename;
  
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

/**
 * Builds a styled columns Excel table containing daily summaries in page 1,
 * and pristine individual hourly recordings in page 2.
 */
export function exportToExcel(
  hourlyRecords: WeatherRecord[],
  dailySummaries: DailySummary[],
  options: ExportOptions
) {
  const { zipcode, cityName, stateCode, startDateStr, endDateStr, unit } = options;
  const tempLabel = `Temp (°${unit})`;
  const finalFilename = `NOAA_Weather_${zipcode}_${startDateStr}_to_${endDateStr}.xlsx`;

  // --- Sheet 1: Daily Weather Summaries ---
  const dailyRows = dailySummaries.map(d => ({
    'Date (YYYY-MM-DD)': d.dateStr,
    [`Min ${tempLabel}`]: d.minTemp,
    [`Max ${tempLabel}`]: d.maxTemp,
    [`Mean ${tempLabel}`]: d.avgTemp,
    'Average Humidity (%)': d.avgHumidity !== null ? `${d.avgHumidity}%` : 'N/A',
    'Hourly Samples Count': d.recordsCount
  }));

  const dailyWS = XLSX.utils.json_to_sheet(dailyRows);

  // Add rich title meta-information to the top of the sheets if needed, but simple, readable columns are often best.
  // SheetJS allows configuring column widths
  const dailyCols = [
    { wch: 20 }, // Date
    { wch: 15 }, // Min Temp
    { wch: 15 }, // Max Temp
    { wch: 15 }, // Mean Temp
    { wch: 22 }, // Avg Humidity
    { wch: 20 }, // Records count
  ];
  dailyWS['!cols'] = dailyCols;


  // --- Sheet 2: Hourly Atmospheric Records ---
  const hourlyRows = hourlyRecords.map(r => ({
    'Date (YYYY-MM-DD)': r.dateStr,
    'Hour (24h)': r.hourStr,
    [tempLabel]: r.temperature,
    'Relative Humidity (%)': r.humidity !== null ? `${r.humidity}%` : 'N/A',
    'Wind Speed': r.windSpeed || 'Calm',
    'Wind Direction': r.windDirection || 'N/A',
    'Condition Description': r.description,
    'Data Acquisition Channel': r.source,
    'ISO Timestamp': r.timestamp
  }));

  const hourlyWS = XLSX.utils.json_to_sheet(hourlyRows);
  const hourlyCols = [
    { wch: 20 }, // Date
    { wch: 12 }, // Hour
    { wch: 15 }, // Temp
    { wch: 22 }, // Humidity
    { wch: 15 }, // Wind Speed
    { wch: 15 }, // Wind Direction
    { wch: 25 }, // Condition
    { wch: 30 }, // Acquisition Channel
    { wch: 28 }, // ISO Timestamp
  ];
  hourlyWS['!cols'] = hourlyCols;


  // --- Create Workbook ---
  const workbook = XLSX.utils.book_new();
  
  // Append sheets
  XLSX.utils.book_append_sheet(workbook, dailyWS, 'Daily Summaries');
  XLSX.utils.book_append_sheet(workbook, hourlyWS, 'Hourly Weather Records');

  // Generate Excel buffer & trigger automatic download
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const dataBlob = new Blob([excelBuffer], { type: 'application/octet-stream' });
  
  const downloadLink = document.createElement('a');
  const url = URL.createObjectURL(dataBlob);
  downloadLink.href = url;
  downloadLink.download = finalFilename;
  
  // Append, click, and teardown
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

/**
 * Weather template mapping specification.
 */
export interface TemplateConfig {
  fileName: string;
  fileBuffer: ArrayBuffer; // Binary content of the uploaded spreadsheet or CSV template file
  isExcel: boolean;
  startRow: number; // 1-based start row index, e.g. 5 means filling from row 5 onwards
  sheetName: string; // Target sheet name to populate (falls back to first sheet if empty/not found)
  mappings: {
    dateStr: string;        // e.g. "A"
    hourStr: string;        // e.g. "B"
    temperature: string;    // e.g. "C"
    humidity: string;       // e.g. "D"
    windSpeed: string;      // e.g. "E"
    windDirection: string;  // e.g. "F"
    description: string;    // e.g. "G"
    source: string;         // e.g. "H"
    timestamp: string;      // e.g. "I"
  };
}

/**
 * Fills data into the uploaded template file at custom cell locations
 * and triggers a download of the modified sheet.
 */
export function exportWithTemplate(
  records: WeatherRecord[],
  template: TemplateConfig
) {
  const { fileBuffer, startRow, sheetName, mappings, isExcel } = template;

  // Read template workbook
  const workbook = XLSX.read(new Uint8Array(fileBuffer), {
    type: 'array',
    cellStyles: true,
    cellFormula: true,
    cellNF: true,
    cellDates: true
  });

  // Access specified worksheet
  const targetSheetName = sheetName || workbook.SheetNames[0];
  let worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) {
    // Fallback if not exists
    worksheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!worksheet) {
    // If workbook is completely empty, make a new worksheet
    worksheet = XLSX.utils.aoa_to_sheet([]);
    const defaultSheetName = workbook.SheetNames[0] || 'Sheet1';
    XLSX.utils.book_append_sheet(workbook, worksheet, defaultSheetName);
  }

  // Determine current bounds
  let maxRowIdx = 0;
  if (worksheet && worksheet['!ref']) {
    try {
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      maxRowIdx = range.e.r;
    } catch (_) {}
  }

  // Convert 1-based startRow to 0-based index
  const startRow0Based = Math.max(0, startRow - 1);

  // Field keys list matching the weather records
  const fields = [
    { key: 'dateStr', col: mappings.dateStr },
    { key: 'hourStr', col: mappings.hourStr },
    { key: 'temperature', col: mappings.temperature },
    { key: 'humidity', col: mappings.humidity },
    { key: 'windSpeed', col: mappings.windSpeed },
    { key: 'windDirection', col: mappings.windDirection },
    { key: 'description', col: mappings.description },
    { key: 'source', col: mappings.source },
    { key: 'timestamp', col: mappings.timestamp }
  ];

  records.forEach((record, index) => {
    const rIdx = startRow0Based + index;
    if (rIdx > maxRowIdx) {
      maxRowIdx = rIdx;
    }

    fields.forEach(({ key, col }) => {
      if (col && typeof col === 'string' && col.trim() !== '') {
        try {
          const colLetter = col.trim().toUpperCase();
          const cIdx = XLSX.utils.decode_col(colLetter);
          const cellAddress = XLSX.utils.encode_cell({ r: rIdx, c: cIdx });

          const rawVal = (record as any)[key];
          let val = rawVal;
          let type: 's' | 'n' | 'b' = 's';

          if (rawVal === null || rawVal === undefined) {
            val = '';
          } else if (typeof rawVal === 'number') {
            type = 'n';
          } else if (typeof rawVal === 'boolean') {
            type = 'b';
          } else {
            val = String(rawVal);
          }

          worksheet[cellAddress] = { t: type, v: val };
        } catch (colErr) {
          console.error(`Error writing cell index for field ${key} with column ${col}:`, colErr);
        }
      }
    });
  });

  // Re-calculate range
  let minR = 0, minC = 0, maxC = 8;
  if (worksheet && worksheet['!ref']) {
    try {
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      minR = range.s.r;
      minC = range.s.c;
      if (range.e.c > maxC) {
        maxC = range.e.c;
      }
    } catch (_) {}
  }

  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { r: minR, c: minC },
    e: { r: maxRowIdx, c: maxC }
  });

  // Write out file content
  let outputBuffer: any;
  if (isExcel) {
    outputBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  } else {
    outputBuffer = XLSX.write(workbook, { bookType: 'csv', type: 'string' });
  }

  // Generate appropriate blob
  const mimeType = isExcel ? 'application/octet-stream' : 'text/csv;charset=utf-8;';
  const dataBlob = isExcel
    ? new Blob([outputBuffer], { type: mimeType })
    : new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), outputBuffer], { type: mimeType });

  const finalFilename = `NOAA_CustomMapped_${template.fileName}`;

  const downloadLink = document.createElement('a');
  const url = URL.createObjectURL(dataBlob);
  downloadLink.href = url;
  downloadLink.download = finalFilename;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

