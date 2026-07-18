import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="page">
      <div className="city-grid" aria-hidden="true" />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ESP32 // LED strip // temperature node</p>
          <h1 data-text="Boring IoT">Boring IoT</h1>
          <p className="lead">
            The dashboard is booting up. Soon this page will track live temperature readings,
            device status, and history from our ESP32 sensor rig.
          </p>
          <div className="actions">
            <div className="badge">System build in progress</div>
            <span className="build-id">BUILD 0101</span>
          </div>
        </div>

        <aside className="preview" aria-label="Project preview">
          <div className="preview-header">
            <span className="pulse" />
            <span>Prototype uplink</span>
          </div>
          <div className="temp-readout">--.- C</div>
          <div className="led-strip" aria-hidden="true">
            {Array.from({ length: 14 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="status-list">
            <span>ESP32 pending</span>
            <span>Supabase next</span>
            <span>GitHub Pages ready soon</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
