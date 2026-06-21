/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { WeatherRecord } from '../types';

interface WeatherChartProps {
  records: WeatherRecord[];
  unit: 'F' | 'C';
}

export default function WeatherChart({ records, unit }: WeatherChartProps) {
  if (records.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 italic text-slate-400">
        No temperature data available to visualize.
      </div>
    );
  }

  // Format data for Recharts
  const data = records.map((record) => {
    // Format timestamp representation nicely
    const timeLabel = `${record.dateStr.substring(5)} ${record.hourStr}`;
    return {
      name: timeLabel,
      temp: record.temperature,
      humidity: record.humidity,
      originalTime: record.timestamp,
    };
  });

  return (
    <div id="noaa-weather-chart-card" className="w-full bg-white p-5 rounded-2xl border border-slate-100 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Hourly Temperature Trend</h3>
          <p className="text-xs text-slate-500">Visualizing weather fluctuations chronologically</p>
        </div>
        <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
          Scale: °{unit}
        </span>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="name"
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              minTickGap={25}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              unit={`°${unit}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                fontSize: '12px',
                fontFamily: 'Inter, sans-serif'
              }}
              labelStyle={{ fontWeight: 600, color: '#1e293b' }}
            />
            <Line
              type="monotone"
              dataKey="temp"
              name="Temperature"
              stroke="#0ea5e9"
              strokeWidth={2.5}
              dot={{ r: 1.5, strokeWidth: 1 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
