"use client";

import { useMemo, useState } from "react";

type RouteKind = "calm" | "fast" | "eco";

const routes: Record<RouteKind, { label: string; time: string; distance: string; note: string }> = {
  calm: { label: "Tranquila", time: "24 min", distance: "12,4 km", note: "Menos cruces difíciles y tráfico denso" },
  fast: { label: "Rápida", time: "18 min", distance: "11,1 km", note: "La llegada más directa ahora mismo" },
  eco: { label: "Ecológica", time: "22 min", distance: "10,7 km", note: "Menos consumo y frenadas bruscas" },
};

export default function Home() {
  const [destination, setDestination] = useState("");
  const [selected, setSelected] = useState<RouteKind>("calm");
  const [started, setStarted] = useState(false);
  const current = routes[selected];
  const suggestions = useMemo(
    () =>
      destination.trim().length > 1
        ? ["Centro histórico", "Estación de tren", "Parque del Río"].filter((item) =>
            item.toLowerCase().includes(destination.toLowerCase()),
          )
        : [],
    [destination],
  );

  return (
    <main className="app-shell">
      <section className="map" aria-label="Mapa de navegación de demostración">
        <div className="map-grid" />
        <div className="park park-one">Parque del Oeste</div>
        <div className="park park-two">Jardines del Río</div>
        <div className="road road-a" />
        <div className="road road-b" />
        <div className="road road-c" />
        <div className={`route-line ${selected}`} />
        <div className="origin-pin"><span /></div>
        <div className="destination-pin">★</div>
        <button className="locate" aria-label="Centrar mi ubicación">◎</button>

        <header className="brand">
          <span className="brand-mark">V</span>
          <div><strong>Vía Clara</strong><small>Tu ruta, a tu manera</small></div>
        </header>

        {started && (
          <div className="navigation-banner">
            <span className="turn-arrow">↱</span>
            <div><small>En 300 metros</small><strong>Gira a la derecha</strong></div>
            <button onClick={() => setStarted(false)}>Salir</button>
          </div>
        )}
      </section>

      <aside className="panel">
        <div className="panel-heading">
          <span className="eyebrow">PLANEA TU VIAJE</span>
          <h1>Llega bien,<br />no solo rápido.</h1>
          <p>Elige una ruta que se adapte a cómo quieres conducir hoy.</p>
        </div>

        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="¿Adónde quieres ir?"
            aria-label="Destino"
          />
          {destination && <button onClick={() => setDestination("")}>×</button>}
          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((item) => (
                <button key={item} onClick={() => setDestination(item)}>{item}</button>
              ))}
            </div>
          )}
        </div>

        <div className="route-title">
          <strong>¿Qué ruta prefieres?</strong>
          <span>Tráfico moderado</span>
        </div>

        <div className="route-options">
          {(Object.keys(routes) as RouteKind[]).map((key) => {
            const route = routes[key];
            return (
              <button
                key={key}
                className={`route-card ${selected === key ? "active" : ""}`}
                onClick={() => setSelected(key)}
              >
                <span className={`route-icon ${key}`}>{key === "calm" ? "♧" : key === "fast" ? "➜" : "◒"}</span>
                <span className="route-copy"><strong>{route.label}</strong><small>{route.note}</small></span>
                <span className="route-time"><strong>{route.time}</strong><small>{route.distance}</small></span>
              </button>
            );
          })}
        </div>

        <div className="summary">
          <span><small>Ruta elegida</small><strong>{current.label}</strong></span>
          <span><small>Llegada estimada</small><strong>18:42</strong></span>
        </div>

        <button className="start-button" onClick={() => setStarted(true)}>
          Iniciar navegación <span>→</span>
        </button>
        <p className="demo-note">Demo web · Los datos de ruta son simulados</p>
      </aside>
    </main>
  );
}
