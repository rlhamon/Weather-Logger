/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { WeatherRecord, DailySummary } from '../types';
import { calculateDailySummaries } from '../utils/weatherApi';
import { Calendar, Clock, Thermometer, Wind, Droplets, Grid, FileText, ChevronLeft, ChevronRight, Search } from 'lucide-react';

interface WeatherTableProps {
  records: WeatherRecord[];
  unit: 'F' | 'C';
}

export default function WeatherTable({ records, unit }: WeatherTableProps) {
  const [activeTab, setActiveTab] = useState<'hourly' | 'daily'>('hourly');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Derive Daily Summaries
  const dailySummaries = useMemo(() => calculateDailySummaries(records), [records]);

  // Handle filtering
  const filteredHourlyRecords = useMemo(() => {
    if (!searchTerm) return records;
    return records.filter(r => 
      r.dateStr.includes(searchTerm) || 
      r.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.source.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [records, searchTerm]);

  // Reset page when research query or tab modifies
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab]);

  // Paginated raw lists
  const paginatedHourly = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredHourlyRecords.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredHourlyRecords, currentPage]);

  const totalPages = Math.ceil(filteredHourlyRecords.length / itemsPerPage) || 1;

  if (records.length === 0) {
    return null;
  }

  return (
    <div id="weather-table-container" className="w-full bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-100 bg-slate-50/50 justify-between items-center px-6 py-3 flex-wrap gap-3">
        <div className="flex bg-slate-100 p-0.5 rounded-lg">
          <button
            type="button"
            id="tab-hourly"
            onClick={() => setActiveTab('hourly')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'hourly'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Raw Hourly Records ({filteredHourlyRecords.length})
          </button>
          <button
            type="button"
            id="tab-daily"
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'daily'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Daily Summaries ({dailySummaries.length})
          </button>
        </div>

        {activeTab === 'hourly' && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              id="hourly-search"
              placeholder="Search description/date..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs w-48 rounded-lg border border-slate-200 bg-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
            />
          </div>
        )}
      </div>

      {activeTab === 'hourly' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold tracking-wider">
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Hour</th>
                <th className="px-6 py-3">Temperature</th>
                <th className="px-6 py-3">Atmosphere</th>
                <th className="px-6 py-3">Humidity</th>
                <th className="px-6 py-3">Wind Info</th>
                <th className="px-6 py-3">Source Channel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedHourly.map((row, idx) => (
                <tr key={`${row.timestamp}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-slate-900 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {row.dateStr}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-600 px-2 py-0.5 rounded-sm font-semibold">
                      {row.hourStr}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 font-semibold text-slate-900">
                    <span className="flex items-center gap-0.5">
                      <Thermometer className="h-3.5 w-3.5 text-sky-500" />
                      {row.temperature}°{unit}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-slate-600 font-medium">
                    {row.description}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">
                    {row.humidity !== null ? (
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3.5 w-3.5 text-blue-400" />
                        {row.humidity}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    {row.windSpeed ? (
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <Wind className="h-3.5 w-3.5 text-slate-400" />
                        {row.windSpeed} {row.windDirection && `(${row.windDirection})`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="inline-block px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-600 font-semibold max-w-[130px] truncate">
                      {row.source}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredHourlyRecords.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    No records matched search conditions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Table pagination */}
          {filteredHourlyRecords.length > itemsPerPage && (
            <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50/50 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                Showing <strong className="text-slate-700">{Math.min(filteredHourlyRecords.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(filteredHourlyRecords.length, currentPage * itemsPerPage)}</strong> of <strong className="text-slate-700">{filteredHourlyRecords.length}</strong> items
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  id="btn-prev-page"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="p-1 px-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="text-xs self-center px-1 text-slate-500 font-semibold">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  id="btn-next-page"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="p-1 px-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase font-bold tracking-wider">
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Min Temp</th>
                <th className="px-6 py-3">Max Temp</th>
                <th className="px-6 py-3">Mean Temperature</th>
                <th className="px-6 py-3">Avg Humidity</th>
                <th className="px-6 py-3">Total Hourly Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {dailySummaries.map((summary) => (
                <tr key={summary.dateStr} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-3.5 font-semibold text-slate-900 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    {summary.dateStr}
                  </td>
                  <td className="px-6 py-3.5 text-blue-600 font-bold">
                    {summary.minTemp}°{unit}
                  </td>
                  <td className="px-6 py-3.5 text-red-600 font-bold">
                    {summary.maxTemp}°{unit}
                  </td>
                  <td className="px-6 py-3.5 font-semibold text-slate-900">
                    {summary.avgTemp}°{unit}
                  </td>
                  <td className="px-6 py-3.5 text-slate-600">
                    {summary.avgHumidity !== null ? (
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3.5 w-3.5 text-blue-400" />
                        {summary.avgHumidity}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-slate-400">
                    {summary.recordsCount} hours
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
