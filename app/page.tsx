"use client";

import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";

type Coordinates = [number, number];
type RouteKind = "calm" | "fast" | "eco";
type Place = { label: string; coordinates: Coordinates };
type RouteResult = { geometry: GeoJSON.LineString; duration: number; distance: number };

const MADRID: Coordinates = [-3.7038, 40.4168];
const routeLabels: Record<RouteKind, { label: string; note: string; color: string }> = {
  calm: { label: "Tranquila", note: "Alternativa con un ritmo más relajado", color: "#176b4a" },
  fast: { label: "Rápida", note: "La llegada más directa ahora mismo", color: "#d86641" },
  eco: { label: "Ecológica", note: "Menos kilómetros y consumo estimado", color: "#477da8" },
};

function formatDuration(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function formatDistance(metres: number) {
  return `${(metres / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`;
}

export default function Home() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const originMarker = useRef<Marker | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const [origin, setOrigin] = useState<Coordinates>(MADRID);
  const [destination, setDestination] = useState("");
  const [destinationPoint, setDestinationPoint] = useState<Coordinates | null>(null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selected, setSelected] = useState<RouteKind>("calm");
  const [status, setStatus] = useState("Pulsa el botón de ubicación para usar tu GPS");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: mapNode.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: MADRID,
      zoom: 12.5,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;
    originMarker.current = new Marker({ color: "#176b4a" }).setLngLat(MADRID).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (destination.trim().length < 3 || destinationPoint) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(destination)}&limit=5`,
          { signal: controller.signal },
        );
        const data = await response.json();
        setSuggestions(
          (data.features ?? []).map((feature: { geometry: { coordinates: Coordinates }; properties: Record<string, string> }) => ({
            coordinates: feature.geometry.coordinates,
            label: [feature.properties.name, feature.properties.street, feature.properties.city, feature.properties.country]
              .filter(Boolean)
              .filter((value, index, array) => array.indexOf(value) === index)
              .join(", "),
          })),
        );
      } catch {
        if (!controller.signal.aborted) setStatus("No se pudo buscar ese destino");
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destination, destinationPoint]);

  const activeRoute = (() => {
    if (!routes.length) return null;
    if (selected === "fast") return [...routes].sort((a, b) => a.duration - b.duration)[0];
    if (selected === "eco") return [...routes].sort((a, b) => a.distance - b.distance)[0];
    return [...routes].sort((a, b) => b.duration - a.duration)[0];
  })();

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeRoute) return;
    const updateRoute = () => {
      const source = map.getSource("route") as GeoJSONSource | undefined;
      const data: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: activeRoute.geometry,
      };
      if (source) {
        source.setData(data);
        map.setPaintProperty("route", "line-color", routeLabels[selected].color);
      } else {
        map.addSource("route", { type: "geojson", data });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": routeLabels[selected].color, "line-width": 7, "line-opacity": 0.92 },
        });
      }
      const coords = activeRoute.geometry.coordinates as Coordinates[];
      const bounds = coords.reduce(
        (box, coordinate) => box.extend(coordinate),
        new LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds as LngLatBoundsLike, { padding: 70, duration: 700 });
    };
    if (map.isStyleLoaded()) updateRoute();
    else map.once("load", updateRoute);
  }, [activeRoute, selected]);

  async function calculateRoutes(point: Coordinates) {
    setLoading(true);
    setStatus("Calculando rutas reales…");
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${point[0]},${point[1]}?alternatives=3&overview=full&geometries=geojson&steps=true`,
      );
      if (!response.ok) throw new Error("route");
      const data = await response.json();
      if (!data.routes?.length) throw new Error("empty");
      setRoutes(data.routes);
      setStatus(`${data.routes.length} ${data.routes.length === 1 ? "ruta encontrada" : "rutas encontradas"}`);
      const map = mapRef.current;
      if (map) {
        destinationMarker.current?.remove();
        destinationMarker.current = new Marker({ color: "#16201b" }).setLngLat(point).addTo(map);
      }
    } catch {
      setRoutes([]);
      setStatus("No se ha podido calcular la ruta. Prueba otro destino.");
    } finally {
      setLoading(false);
    }
  }

  function choosePlace(place: Place) {
    setDestination(place.label);
    setDestinationPoint(place.coordinates);
    setSuggestions([]);
    setStarted(false);
    void calculateRoutes(place.coordinates);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setStatus("Este navegador no permite usar el GPS");
      return;
    }
    setStatus("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point: Coordinates = [coords.longitude, coords.latitude];
        setOrigin(point);
        originMarker.current?.setLngLat(point);
        mapRef.current?.flyTo({ center: point, zoom: 15 });
        setStatus("Ubicación GPS activada");
        if (destinationPoint) void calculateRoutes(destinationPoint);
      },
      () => setStatus("Activa el permiso de ubicación para usar tu GPS"),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function startNavigation() {
    if (!destinationPoint) {
      setStatus("Primero selecciona una dirección de la lista");
      return;
    }
    setStarted(true);
    const [longitude, latitude] = destinationPoint;
    window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
  }

  return (
    <main className="app-shell">
      <section className="map-wrap" aria-label="Mapa real de navegación">
        <div ref={mapNode} className="map-canvas" />
        <header className="brand">
          <span className="brand-mark">V</span>
          <div><strong>Vía Clara</strong><small>Tu ruta, a tu manera</small></div>
        </header>
        <button className="locate" onClick={locateMe} aria-label="Usar mi ubicación GPS" title="Usar mi ubicación GPS">◎</button>
        {started && activeRoute && (
          <div className="navigation-banner">
            <span className="turn-arrow">↱</span>
            <div><small>Navegación iniciada</small><strong>Sigue la ruta marcada</strong></div>
            <button onClick={() => setStarted(false)}>Salir</button>
          </div>
        )}
      </section>

      <aside className="panel">
        <div className="panel-heading">
          <span className="eyebrow">MAPA Y RUTAS REALES</span>
          <h1>Llega bien,<br />no solo rápido.</h1>
          <p>Busca un destino y permite tu ubicación para calcular el viaje desde donde estás.</p>
        </div>

        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            value={destination}
            onChange={(event) => {
              setDestination(event.target.value);
              setDestinationPoint(null);
            }}
            placeholder="¿Adónde quieres ir?"
            aria-label="Destino"
            autoComplete="off"
          />
          {destination && <button onClick={() => { setDestination(""); setDestinationPoint(null); setSuggestions([]); }}>×</button>}
          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((place) => (
                <button key={`${place.label}-${place.coordinates.join("-")}`} onClick={() => choosePlace(place)}>
                  <strong>{place.label.split(",")[0]}</strong>
                  <small>{place.label.split(",").slice(1).join(",")}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="gps-button" onClick={locateMe}><span>◎</span> Usar mi ubicación actual</button>
        <div className="status-line"><span className={loading ? "pulse" : ""} />{status}</div>

        <div className="route-title">
          <strong>¿Qué ruta prefieres?</strong>
          <span>{routes.length ? "Datos en directo" : "Elige un destino"}</span>
        </div>

        <div className="route-options">
          {(Object.keys(routeLabels) as RouteKind[]).map((key) => {
            const details = routeLabels[key];
            const candidate = routes.length
              ? key === "fast"
                ? [...routes].sort((a, b) => a.duration - b.duration)[0]
                : key === "eco"
                  ? [...routes].sort((a, b) => a.distance - b.distance)[0]
                  : [...routes].sort((a, b) => b.duration - a.duration)[0]
              : null;
            return (
              <button key={key} className={`route-card ${selected === key ? "active" : ""}`} onClick={() => setSelected(key)}>
                <span className={`route-icon ${key}`}>{key === "calm" ? "♧" : key === "fast" ? "➜" : "◒"}</span>
                <span className="route-copy"><strong>{details.label}</strong><small>{details.note}</small></span>
                <span className="route-time">
                  <strong>{candidate ? formatDuration(candidate.duration) : "—"}</strong>
                  <small>{candidate ? formatDistance(candidate.distance) : "Sin calcular"}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="summary">
          <span><small>Ruta elegida</small><strong>{routeLabels[selected].label}</strong></span>
          <span><small>Distancia</small><strong>{activeRoute ? formatDistance(activeRoute.distance) : "—"}</strong></span>
        </div>
        <button className="start-button" disabled={!activeRoute} onClick={startNavigation}>
          {activeRoute ? "Abrir navegación GPS" : "Primero elige un destino"} <span>→</span>
        </button>
        <p className="demo-note">El botón abre la navegación paso a paso en Google Maps</p>
      </aside>
    </main>
  );
}
