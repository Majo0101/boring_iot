import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const SUPABASE_URL = "https://yfnirgvfpxgxkdgcfbgy.supabase.co";
const SUPABASE_KEY = "sb_publishable_-b3sPNu7d0xhzAzdUnB8_A_-fQ-1thd";
const TABLE_NAME = "temperature_readings";
const HISTORY_LIMIT = 960;
const PREDICTION_MINUTES = 30;
const PREDICTION_WINDOW_MINUTES = 45;

const PREDICTION_CONFIG = {
  temperature_c: {
    damping: 0.55,
    maxChange: 1.2,
    minSamples: 6,
    stableSlopePerHour: 0.6
  },
  pressure_hpa: {
    damping: 0.45,
    maxChange: 0.8,
    minSamples: 6,
    stableSlopePerHour: 0.7
  }
};

const FORECAST_POINT_COUNT = 12;

function formatTemperature(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--.-";
  }

  return Number(value).toFixed(1);
}

function formatPressure(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "----.-";
  }

  return Number(value).toFixed(1);
}

function formatSigned(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function solveQuadraticRegression(samples) {
  const sums = samples.reduce(
    (total, sample) => {
      const x2 = sample.x * sample.x;
      return {
        x: total.x + sample.x,
        x2: total.x2 + x2,
        x3: total.x3 + x2 * sample.x,
        x4: total.x4 + x2 * x2,
        y: total.y + sample.y,
        xy: total.xy + sample.x * sample.y,
        x2y: total.x2y + x2 * sample.y
      };
    },
    { x: 0, x2: 0, x3: 0, x4: 0, y: 0, xy: 0, x2y: 0 }
  );

  const matrix = [
    [samples.length, sums.x, sums.x2, sums.y],
    [sums.x, sums.x2, sums.x3, sums.xy],
    [sums.x2, sums.x3, sums.x4, sums.x2y]
  ];

  for (let pivotIndex = 0; pivotIndex < 3; pivotIndex++) {
    let bestRow = pivotIndex;
    for (let row = pivotIndex + 1; row < 3; row++) {
      if (Math.abs(matrix[row][pivotIndex]) > Math.abs(matrix[bestRow][pivotIndex])) {
        bestRow = row;
      }
    }

    if (Math.abs(matrix[bestRow][pivotIndex]) < 1e-9) {
      return null;
    }

    if (bestRow !== pivotIndex) {
      [matrix[pivotIndex], matrix[bestRow]] = [matrix[bestRow], matrix[pivotIndex]];
    }

    const pivot = matrix[pivotIndex][pivotIndex];
    for (let col = pivotIndex; col < 4; col++) {
      matrix[pivotIndex][col] /= pivot;
    }

    for (let row = 0; row < 3; row++) {
      if (row === pivotIndex) {
        continue;
      }

      const factor = matrix[row][pivotIndex];
      for (let col = pivotIndex; col < 4; col++) {
        matrix[row][col] -= factor * matrix[pivotIndex][col];
      }
    }
  }

  return {
    a: matrix[0][3],
    b: matrix[1][3],
    c: matrix[2][3]
  };
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

function getStats(readings, fieldName) {
  const values = readings
    .map((reading) => Number(reading[fieldName]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return {
      minimum: null,
      maximum: null,
      average: null
    };
  }

  const sum = values.reduce((total, value) => total + value, 0);

  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: sum / values.length
  };
}

function predictField(readings, fieldName, minutesAhead = PREDICTION_MINUTES) {
  const config = PREDICTION_CONFIG[fieldName] ?? PREDICTION_CONFIG.temperature_c;
  const allPoints = [...readings]
    .reverse()
    .map((reading) => ({
      time: new Date(reading.created_at).getTime(),
      value: Number(reading[fieldName])
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));

  if (allPoints.length < 3) {
    return null;
  }

  const latestTime = allPoints[allPoints.length - 1].time;
  const windowStart = latestTime - PREDICTION_WINDOW_MINUTES * 60000;
  let points = allPoints.filter((point) => point.time >= windowStart);

  if (points.length < config.minSamples) {
    points = allPoints.slice(-Math.max(config.minSamples, 20));
  }

  if (points.length < 3) {
    return null;
  }

  const baseTime = points[0].time;
  const samples = points.map((point) => ({
    x: (point.time - baseTime) / 60000,
    y: point.value
  }));

  const count = samples.length;
  const sumX = samples.reduce((sum, sample) => sum + sample.x, 0);
  const sumY = samples.reduce((sum, sample) => sum + sample.y, 0);
  const sumXY = samples.reduce((sum, sample) => sum + sample.x * sample.y, 0);
  const sumXX = samples.reduce((sum, sample) => sum + sample.x * sample.x, 0);
  const denominator = count * sumXX - sumX * sumX;

  if (denominator === 0) {
    return null;
  }

  const slopePerMinute = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slopePerMinute * sumX) / count;
  const latestSample = samples[samples.length - 1];
  const quadratic = solveQuadraticRegression(samples);
  const predictRaw = (x) => {
    if (!quadratic) {
      return intercept + slopePerMinute * x;
    }

    return quadratic.a + quadratic.b * x + quadratic.c * x * x;
  };

  const forecastPoints = Array.from({ length: FORECAST_POINT_COUNT }).map((_, index) => {
    const minutes = ((index + 1) * minutesAhead) / FORECAST_POINT_COUNT;
    const rawValue = predictRaw(latestSample.x + minutes);
    const dampedChange = clamp(
      (rawValue - latestSample.y) * config.damping,
      -config.maxChange,
      config.maxChange
    );

    return {
      minutes,
      value: latestSample.y + dampedChange
    };
  });

  const predicted = forecastPoints[forecastPoints.length - 1].value;

  return {
    predicted,
    change: predicted - latestSample.y,
    slopePerHour: slopePerMinute * 60,
    samples: points.length,
    windowMinutes: PREDICTION_WINDOW_MINUTES,
    forecastPoints
  };
}

function getTemperatureTrend(prediction) {
  if (!prediction) {
    return "Waiting for more data";
  }

  if (prediction.slopePerHour > PREDICTION_CONFIG.temperature_c.stableSlopePerHour) {
    return "Heating up";
  }

  if (prediction.slopePerHour < -PREDICTION_CONFIG.temperature_c.stableSlopePerHour) {
    return "Cooling down";
  }

  return "Mostly stable";
}

function getPressureTrend(prediction) {
  if (!prediction) {
    return "Waiting for pressure";
  }

  if (prediction.slopePerHour > PREDICTION_CONFIG.pressure_hpa.stableSlopePerHour) {
    return "Pressure rising";
  }

  if (prediction.slopePerHour < -PREDICTION_CONFIG.pressure_hpa.stableSlopePerHour) {
    return "Pressure falling";
  }

  return "Pressure stable";
}

function TemperatureChart({ readings, prediction }) {
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
  const latestTime = Math.max(...times);
  const forecastPoints =
    prediction?.forecastPoints?.map((point) => ({
      time: latestTime + point.minutes * 60000,
      value: point.value,
      minutes: point.minutes
    })) ?? [];
  const predictedTime = forecastPoints.length ? forecastPoints[forecastPoints.length - 1].time : null;
  const maxTime = predictedTime ?? latestTime;
  const chartTemperatures = [...temperatures, ...forecastPoints.map((point) => point.value)];
  const minTemperature = Math.floor((Math.min(...chartTemperatures) - 0.5) * 2) / 2;
  const maxTemperature = Math.ceil((Math.max(...chartTemperatures) + 0.5) * 2) / 2;
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

  const latestPoint = points[points.length - 1];
  const forecastPath = forecastPoints.length
    ? [
        `M ${xFor(new Date(latestPoint.created_at).getTime()).toFixed(2)} ${yFor(Number(latestPoint.temperature_c)).toFixed(2)}`,
        ...forecastPoints.map(
          (point) => `L ${xFor(point.time).toFixed(2)} ${yFor(point.value).toFixed(2)}`
        )
      ].join(" ")
    : "";

  const gridLines = Array.from({
    length: Math.floor((maxTemperature - minTemperature) / 0.5) + 1
  }).map((_, index) => {
    const temperature = minTemperature + index * 0.5;
    return {
      temperature,
      y: yFor(temperature),
      major: Number.isInteger(temperature)
    };
  });

  const firstHour = Math.ceil(minTime / 3600000) * 3600000;
  const hourTicks = [];
  for (let tick = firstHour; tick < latestTime; tick += 3600000) {
    if (tick > minTime) {
      hourTicks.push(tick);
    }
  }

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
            className={line.major ? "chart-grid chart-grid-major" : "chart-grid chart-grid-minor"}
            x1={margin.left}
            x2={width - margin.right}
            y1={line.y}
            y2={line.y}
          />
          {line.major ? (
            <text className="chart-label" x={margin.left - 12} y={line.y + 4} textAnchor="end">
              {line.temperature.toFixed(0)} C
            </text>
          ) : null}
        </g>
      ))}

      {hourTicks.map((tick) => (
        <g key={tick}>
          <line
            className="chart-hour-grid"
            x1={xFor(tick)}
            x2={xFor(tick)}
            y1={margin.top}
            y2={height - margin.bottom}
          />
          <text className="chart-time-label" x={xFor(tick)} y={height - 22} textAnchor="middle">
            {formatTime(tick).slice(0, 5)}
          </text>
        </g>
      ))}

      <path className="chart-line" d={path} />
      {forecastPath ? <path className="chart-prediction-line" d={forecastPath} /> : null}

      <circle
        className="chart-dot"
        cx={xFor(new Date(latestPoint.created_at).getTime())}
        cy={yFor(Number(latestPoint.temperature_c))}
        r="5"
      />

      {forecastPoints.length ? (
        <>
          {forecastPoints.map((point, index) => (
            <circle
              key={`${point.time}-${index}`}
              className="chart-prediction-dot"
              cx={xFor(point.time)}
              cy={yFor(point.value)}
              r={index === forecastPoints.length - 1 ? "5" : "3.5"}
            />
          ))}
          <text
            className="chart-prediction-label"
            x={xFor(forecastPoints[forecastPoints.length - 1].time) - 8}
            y={yFor(forecastPoints[forecastPoints.length - 1].value) - 12}
            textAnchor="end"
          >
            +{PREDICTION_MINUTES} min
          </text>
        </>
      ) : null}

      <text className="chart-label" x={margin.left} y={height - 12}>
        {formatTime(points[0].created_at)}
      </text>
      <text className="chart-label" x={width - margin.right} y={height - 12} textAnchor="end">
        {predictedTime ? `Forecast ${formatTime(predictedTime)}` : formatTime(points[points.length - 1].created_at)}
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
  const temperatureStats = useMemo(() => getStats(readings, "temperature_c"), [readings]);
  const pressureStats = useMemo(() => getStats(readings, "pressure_hpa"), [readings]);
  const temperaturePrediction = useMemo(() => predictField(readings, "temperature_c"), [readings]);
  const pressurePrediction = useMemo(() => predictField(readings, "pressure_hpa"), [readings]);
  const deviceStatus = getDeviceStatus(latest);

  async function loadReadings() {
    setIsLoading(true);
    setError("");

    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`);
      url.searchParams.set("select", "created_at,device_id,temperature_c,pressure_hpa,sensor_type");
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
      <div className="ambient-grid" aria-hidden="true" />
      <section className="dashboard">
        <section className="brand-hero" aria-label="Project identity">
          <div className="synth-scene" aria-hidden="true">
            <div className="star-field" />
            <div className="sun" />
            <div className="mountains mountain-back" />
            <div className="mountains mountain-front" />
            <div className="horizon-glow" />
          </div>
          <div className="jp-column jp-left" aria-hidden="true">
            温度 監視 回路 光
          </div>
          <div className="jp-column jp-right" aria-hidden="true">
            電子 部品 未来 制御
          </div>
          <p className="eyebrow">Component Cartel telemetry lab</p>
          <div className="glitch-title" data-text="Boring IOT">
            Boring IOT
          </div>
          <div className="hero-subline">
            <span>ESP32-S3 uplink</span>
            <span>BMP280 pressure feed</span>
            <span>Supabase history</span>
            <span>30 min forecast</span>
          </div>
        </section>

        <header className="topbar">
          <div>
            <p className="eyebrow">ESP32-S3 // BMP280 // Supabase // live forecast</p>
            <h1>Forecast Temp Monitor</h1>
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

          <article className="pressure-card">
            <div className="card-label">Current pressure</div>
            <div className="current-pressure">
              {formatPressure(latest?.pressure_hpa)}
              <span>hPa</span>
            </div>
            <div className="pressure-meta">
              <span>{latest?.sensor_type ?? "BMP280"}</span>
              <span>{getPressureTrend(pressurePrediction)}</span>
            </div>
          </article>

          <article className="prediction-card">
            <div className="card-label">Prediction</div>
            <strong>{PREDICTION_MINUTES} min forecast</strong>
            <div className="prediction-list">
              <div>
                <span>{getTemperatureTrend(temperaturePrediction)}</span>
                <b>
                  {temperaturePrediction
                    ? `${formatTemperature(temperaturePrediction.predicted)} C`
                    : "--.- C"}
                </b>
                <em>{formatSigned(temperaturePrediction?.change)} C</em>
              </div>
              <div>
                <span>{getPressureTrend(pressurePrediction)}</span>
                <b>
                  {pressurePrediction
                    ? `${formatPressure(pressurePrediction.predicted)} hPa`
                    : "----.- hPa"}
                </b>
                <em>{formatSigned(pressurePrediction?.change)} hPa</em>
              </div>
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
            <span>Temp min</span>
            <strong>{formatTemperature(temperatureStats.minimum)} C</strong>
          </article>
          <article>
            <span>Temp avg</span>
            <strong>{formatTemperature(temperatureStats.average)} C</strong>
          </article>
          <article>
            <span>Temp max</span>
            <strong>{formatTemperature(temperatureStats.maximum)} C</strong>
          </article>
          <article>
            <span>Pressure avg</span>
            <strong>{formatPressure(pressureStats.average)} hPa</strong>
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

          <TemperatureChart readings={readings} prediction={temperaturePrediction} />

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
