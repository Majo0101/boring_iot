import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const SUPABASE_URL = "https://yfnirgvfpxgxkdgcfbgy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-b3sPNu7d0xhzAzdUnB8_A_-fQ-1thd";
const TABLE_NAME = "temperature_readings";
const HISTORY_LIMIT = 120;

function formatTemperature(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--.-";
  }

  return Number(value).toFixed(1);
}

function formatTime(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("sk-SK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("sk-SK", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function getDeviceStatus(reading) {
  if (!reading) {
    return "No data";
  }

  const minutesOld = (Date.now() - new Date(reading.created_at).getTime()) / 60000;
  return minutesOld <= 2 ? "Online" : "Offline";
}

function getStats(readings) {
  if (!readings.length) {
    return {
      minimum: null,
      maximum: null,
      average: null
    };
  }

  const values = readings.map((reading) => Number(reading.temperature_c));
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: sum / values.length
  };
}

function TemperatureChart({ readings }) {
  const points = useMemo(() => [...readings].reverse(), [readings]);
  const width = 900;
  const height = 320;
  const margin = { top: 24, right: 24, bottom: 44, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  if (points.length < 2) {
    return (
      <div className="empty-chart">
        <span>Waiting for sensor history</span>
      </div>
    );
  }

  const times = points.map((point) => new Date(point.created_at).getTime());
  const temperatures = points.map((point) => Number(point.temperature_c));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minTemperature = Math.floor(Math.min(...temperatures) - 1);
  const maxTemperature = Math.ceil(Math.max(...temperatures) + 1);
  const temperatureRange = Math.max(maxTemperature - minTemperature, 1);
  const timeRange = Math.max(maxTime - minTime, 1);
  const xFor = (time) => margin.left + ((time - minTime) / timeRange) * plotWidth;
  const yFor = (temperature) =>
    margin.top + (1 - (temperature - minTemperature) / temperatureRange) * plotHeight;

  const path = points
    .map((point, index) => {
      const x = xFor(new Date(point.created_at).getTime());
      const y = yFor(Number(point.temperature_c));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const gridLines = Array.from({ length: 5 }).map((_, index) => {
    const temperature = minTemperature + (temperatureRange * index) / 4;
    return {
      temperature,
      y: yFor(temperature)
    };
  });

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Temperature history chart"
    >
      {gridLines.map((line) => (
        <g key={line.temperature}>
          <line
            className="chart-grid"
            x1={margin.left}
            x2={width - margin.right}
            y1={line.y}
            y2={line.y}
          />
          <text className="chart-label" x={margin.left - 12} y={line.y + 4} textAnchor="end">
            {line.temperature.toFixed(0)} C
          </text>
        </g>
      ))}

      <path className="chart-area" d={`${path} L ${width - margin.right} ${height - margin.bottom} L ${margin.left} ${height - margin.bottom} Z`} />
      <path className="chart-line" d={path} />

      {points.map((point, index) => (
        <circle
          key={`${point.created_at}-${index}`}
          className="chart-dot"
          cx={xFor(new Date(point.created_at).getTime())}
          cy={yFor(Number(point.temperature_c))}
          r="4"
        />
      ))}

      <text className="chart-label" x={margin.left} y={height - 12}>
        {formatTime(points[0].created_at)}
      </text>
      <text className="chart-label" x={width - margin.right} y={height - 12} textAnchor="end">
        {formatTime(points[points.length - 1].created_at)}
      </text>
    </svg>
  );
}

function App() {
  const [readings, setReadings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const latest = readings[0] ?? null;
  const stats = useMemo(() => getStats(readings), [readings]);
  const deviceStatus = getDeviceStatus(latest);

  async function loadReadings() {
    setIsLoading(true);
    setError("");

    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`);
      url.searchParams.set("select", "created_at,device_id,temperature_c");
      url.searchParams.set("order", "created_at.desc");
      url.searchParams.set("limit", String(HISTORY_LIMIT));

      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });

      if (!response.ok) {
        throw new Error(`Supabase returned ${response.status}`);
      }

      const data = await response.json();
      setReadings(data);
      setLastRefresh(new Date());
    } catch (requestError) {
      setError(requestError.message || "Could not load Supabase data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadReadings();
    const intervalId = window.setInterval(loadReadings, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <main className="page">
      <section className="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">ESP32 // Supabase // live dashboard</p>
            <h1>LED Temp Monitor</h1>
          </div>
          <button type="button" onClick={loadReadings} disabled={isLoading}>
            {isLoading ? "Syncing" : "Refresh"}
          </button>
        </header>

        <section className="hero-grid">
          <article className="temperature-card">
            <div className="card-label">Current temperature</div>
            <div className="current-temperature">
              {formatTemperature(latest?.temperature_c)}
              <span>C</span>
            </div>
            <div className={`status-badge status-${deviceStatus.toLowerCase().replace(" ", "-")}`}>
              {deviceStatus}
            </div>
          </article>

          <article className="device-card">
            <div>
              <span className="card-label">Device</span>
              <strong>{latest?.device_id ?? "Waiting for ESP32"}</strong>
            </div>
            <div>
              <span className="card-label">Last reading</span>
              <strong>{formatDateTime(latest?.created_at)}</strong>
            </div>
            <div>
              <span className="card-label">Last dashboard sync</span>
              <strong>{lastRefresh ? formatTime(lastRefresh) : "--"}</strong>
            </div>
          </article>
        </section>

        <section className="stats-grid" aria-label="Temperature statistics">
          <article>
            <span>Minimum</span>
            <strong>{formatTemperature(stats.minimum)} C</strong>
          </article>
          <article>
            <span>Average</span>
            <strong>{formatTemperature(stats.average)} C</strong>
          </article>
          <article>
            <span>Maximum</span>
            <strong>{formatTemperature(stats.maximum)} C</strong>
          </article>
          <article>
            <span>Readings</span>
            <strong>{readings.length}</strong>
          </article>
        </section>

        <section className="history-panel" aria-labelledby="history-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2 id="history-title">Recent temperature timeline</h2>
            </div>
            <span>{HISTORY_LIMIT} max records</span>
          </div>

          <TemperatureChart readings={readings} />

          {error ? <p className="message error">{error}</p> : null}
          {!error && !readings.length && !isLoading ? (
            <p className="message">No Supabase readings yet. Upload from ESP32 and refresh.</p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
