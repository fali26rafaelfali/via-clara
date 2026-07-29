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
  StyleSpecification,
} from "maplibre-gl";

type Coordinates = [number, number];
type RouteKind = "calm" | "fast" | "eco";
type Place = { label: string; coordinates: Coordinates };
type SavedPlace = Place & { kind: "Casa" | "Trabajo" | "Favorito" };
type NearbyPlace = Place & { type: string };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type RouteStep = {
  distance: number;
  duration: number;
  name: string;
  maneuver: { location: Coordinates; type: string; modifier?: string };
};
type RouteResult = {
  geometry: GeoJSON.LineString;
  duration: number;
  distance: number;
  legs: Array<{ steps: RouteStep[] }>;
};

const MADRID: Coordinates = [-3.7038, 40.4168];
const NAVIGATION_BLUE = "#1677ff";
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
};
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

function formatNavigationDistance(metres: number) {
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : formatDistance(metres);
}

function arrivalTime(seconds: number) {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(Date.now() + seconds * 1000),
  );
}

function distanceBetween(a: Coordinates, b: Coordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function instructionFor(step?: RouteStep) {
  if (!step) return "Continúa hasta tu destino";
  const road = step.name ? ` por ${step.name}` : "";
  const modifier: Record<string, string> = {
    left: "a la izquierda",
    right: "a la derecha",
    "slight left": "ligeramente a la izquierda",
    "slight right": "ligeramente a la derecha",
    straight: "recto",
    uturn: "en sentido contrario",
  };
  if (step.maneuver.type === "arrive") return "Has llegado a tu destino";
  if (step.maneuver.type === "depart") return `Sal${road}`;
  if (step.maneuver.type === "roundabout" || step.maneuver.type === "rotary") return `Entra en la rotonda${road}`;
  if (step.maneuver.type === "merge") return `Incorpórate${road}`;
  if (step.maneuver.type === "on ramp") return `Toma el acceso${road}`;
  if (step.maneuver.type === "off ramp") return `Toma la salida${road}`;
  return `Gira ${modifier[step.maneuver.modifier ?? "straight"] ?? "recto"}${road}`;
}

export default function Home() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const originMarker = useRef<Marker | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSpokenStep = useRef(-1);
  const lastRecalculation = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const [origin, setOrigin] = useState<Coordinates>(MADRID);
  const [destination, setDestination] = useState("");
  const [destinationPoint, setDestinationPoint] = useState<Coordinates | null>(null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selected, setSelected] = useState<RouteKind>("calm");
  const [status, setStatus] = useState("Pulsa el botón de ubicación para usar tu GPS");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToTurn, setDistanceToTurn] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [vehicle, setVehicle] = useState<"Coche" | "Eléctrico" | "Moto" | "Caravana">("Coche");
  const [consumption, setConsumption] = useState(6.5);
  const [energyPrice, setEnergyPrice] = useState(1.6);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [weather, setWeather] = useState<{ temperature: number; wind: number } | null>(null);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: mapNode.current,
      style: OSM_STYLE,
      center: MADRID,
      zoom: 12.5,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;
    originMarker.current = new Marker({ color: "#176b4a" }).setLngLat(MADRID).addTo(map);
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      window.speechSynthesis?.cancel();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      setSavedPlaces(JSON.parse(localStorage.getItem("via-clara-saved") ?? "[]"));
      setRecentPlaces(JSON.parse(localStorage.getItem("via-clara-recent") ?? "[]"));
      const settings = JSON.parse(localStorage.getItem("via-clara-vehicle") ?? "{}");
      if (settings.vehicle) setVehicle(settings.vehicle);
      if (settings.consumption) setConsumption(settings.consumption);
      if (settings.energyPrice) setEnergyPrice(settings.energyPrice);
      setAvoidTolls(Boolean(settings.avoidTolls));
      setAvoidHighways(Boolean(settings.avoidHighways));
    } catch {
      // Keep safe defaults when local preferences are unavailable.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("via-clara-vehicle", JSON.stringify({ vehicle, consumption, energyPrice, avoidTolls, avoidHighways }));
  }, [vehicle, consumption, energyPrice, avoidTolls, avoidHighways]);

  useEffect(() => {
    if (!destinationPoint) {
      setWeather(null);
      return;
    }
    const [longitude, latitude] = destinationPoint;
    void fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m`)
      .then((response) => response.json())
      .then((data) => setWeather({ temperature: data.current.temperature_2m, wind: data.current.wind_speed_10m }))
      .catch(() => setWeather(null));
  }, [destinationPoint]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setDarkMode(media.matches);
    updateTheme();
    media.addEventListener("change", updateTheme);

    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstall);

    if ("serviceWorker" in navigator) {
      const serviceWorkerPath = window.location.pathname.startsWith("/via-clara")
        ? "/via-clara/sw.js"
        : "/sw.js";
      void navigator.serviceWorker.register(serviceWorkerPath);
    }
    return () => {
      media.removeEventListener("change", updateTheme);
      window.removeEventListener("beforeinstallprompt", captureInstall);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);
    const map = mapRef.current;
    if (map?.getLayer("openstreetmap")) {
      map.setPaintProperty("openstreetmap", "raster-brightness-max", darkMode ? 0.52 : 1);
      map.setPaintProperty("openstreetmap", "raster-saturation", darkMode ? -0.55 : 0);
      map.setPaintProperty("openstreetmap", "raster-contrast", darkMode ? 0.28 : 0);
    }
    return () => document.body.classList.remove("dark-mode");
  }, [darkMode]);

  useEffect(() => {
    if (started) {
      document.body.classList.add("navigation-active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.body.classList.remove("navigation-active");
    }
    const timer = window.setTimeout(() => mapRef.current?.resize(), 120);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("navigation-active");
    };
  }, [started]);

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
    if (!activeRoute || started) return;
    setRemainingDistance(activeRoute.distance);
    setRemainingDuration(activeRoute.duration);
  }, [activeRoute, started]);

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
        map.setPaintProperty("route", "line-color", NAVIGATION_BLUE);
        if (!map.getLayer("route-casing")) {
          map.addLayer({
            id: "route-casing",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#ffffff", "line-width": 13, "line-opacity": 0.9 },
          }, "route");
        }
      } else {
        map.addSource("route", { type: "geojson", data });
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 13, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": NAVIGATION_BLUE, "line-width": 8, "line-opacity": 0.96 },
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

  async function calculateRoutes(point: Coordinates, from: Coordinates = origin) {
    setLoading(true);
    setStatus("Calculando rutas reales…");
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${point[0]},${point[1]}?alternatives=3&overview=full&geometries=geojson&steps=true`,
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
    const updatedRecents = [place, ...recentPlaces.filter((item) => item.label !== place.label)].slice(0, 4);
    setRecentPlaces(updatedRecents);
    localStorage.setItem("via-clara-recent", JSON.stringify(updatedRecents));
    void calculateRoutes(place.coordinates);
  }

  function saveCurrentPlace(kind: SavedPlace["kind"]) {
    if (!destinationPoint || !destination) {
      setStatus("Elige primero un destino para guardarlo");
      return;
    }
    const place: SavedPlace = { label: destination, coordinates: destinationPoint, kind };
    const updated = [place, ...savedPlaces.filter((item) => item.kind !== kind || kind === "Favorito")].slice(0, 8);
    setSavedPlaces(updated);
    localStorage.setItem("via-clara-saved", JSON.stringify(updated));
    setStatus(`${kind} guardado en este dispositivo`);
  }

  async function findNearby(type: "fuel" | "parking" | "charging_station" | "restaurant") {
    setLoading(true);
    setStatus("Buscando lugares cercanos…");
    try {
      const query = `[out:json][timeout:15];nwr(around:3000,${origin[1]},${origin[0]})[amenity=${type}];out center 8;`;
      const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await response.json();
      const places: NearbyPlace[] = (data.elements ?? []).map((item: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }) => ({
        label: item.tags?.name ?? ({ fuel: "Gasolinera", parking: "Aparcamiento", charging_station: "Cargador", restaurant: "Restaurante" }[type]),
        coordinates: [item.lon ?? item.center?.lon, item.lat ?? item.center?.lat] as Coordinates,
        type,
      })).filter((item: NearbyPlace) => Number.isFinite(item.coordinates[0])).slice(0, 6);
      setNearbyPlaces(places);
      setStatus(`${places.length} lugares encontrados cerca de ti`);
    } catch {
      setStatus("No se pudieron cargar los lugares cercanos");
    } finally {
      setLoading(false);
    }
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
    if (!destinationPoint || !activeRoute) {
      setStatus("Primero selecciona una dirección de la lista");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("Este navegador no permite navegación GPS");
      return;
    }
    setStarted(true);
    setCurrentStepIndex(0);
    setRemainingDistance(activeRoute.distance);
    setRemainingDuration(activeRoute.duration);
    lastSpokenStep.current = -1;
    setStatus("Navegación activa dentro de Vía Clara");
    const steps = activeRoute.legs.flatMap((leg) => leg.steps);
    const routeCoordinates = activeRoute.geometry.coordinates as Coordinates[];
    if ("wakeLock" in navigator) {
      void navigator.wakeLock.request("screen").then((lock) => {
        wakeLock.current = lock;
      }).catch(() => setStatus("Navegación activa · evita apagar la pantalla"));
    }
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const point: Coordinates = [coords.longitude, coords.latitude];
        setOrigin(point);
        setSpeed(Math.max(0, Math.round((coords.speed ?? 0) * 3.6)));
        originMarker.current?.setLngLat(point);
        mapRef.current?.easeTo({
          center: point,
          zoom: 17,
          bearing: coords.heading ?? mapRef.current.getBearing(),
          pitch: 42,
          duration: 600,
        });

        let closestIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        steps.forEach((step, index) => {
          const distance = distanceBetween(point, step.maneuver.location);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });
        const nextIndex = closestDistance < 35 ? Math.min(closestIndex + 1, steps.length - 1) : closestIndex;
        const nextStep = steps[nextIndex];
        const nextDistance = nextStep ? distanceBetween(point, nextStep.maneuver.location) : 0;
        setCurrentStepIndex(nextIndex);
        setDistanceToTurn(nextDistance);
        const remainingSteps = steps.slice(nextIndex);
        setRemainingDistance(nextDistance + remainingSteps.reduce((total, step) => total + step.distance, 0));
        setRemainingDuration(remainingSteps.reduce((total, step) => total + step.duration, 0));

        if (
          nextIndex !== lastSpokenStep.current &&
          nextStep &&
          nextDistance < 450 &&
          !muted &&
          "speechSynthesis" in window &&
          "SpeechSynthesisUtterance" in window
        ) {
          lastSpokenStep.current = nextIndex;
          window.speechSynthesis?.cancel();
          const message = new SpeechSynthesisUtterance(
            `En ${Math.max(10, Math.round(nextDistance / 10) * 10)} metros, ${instructionFor(nextStep)}`,
          );
          message.lang = "es-ES";
          message.rate = 0.95;
          window.speechSynthesis?.speak(message);
        }

        const distanceFromRoute = routeCoordinates.reduce(
          (minimum, coordinate) => Math.min(minimum, distanceBetween(point, coordinate)),
          Number.POSITIVE_INFINITY,
        );
        if (
          distanceFromRoute > 120 &&
          destinationPoint &&
          Date.now() - lastRecalculation.current > 20000
        ) {
          lastRecalculation.current = Date.now();
          setStatus("Te has desviado. Recalculando ruta…");
          void calculateRoutes(destinationPoint, point);
        }
      },
      () => {
        setStatus("No recibimos tu posición. Revisa el permiso GPS.");
        stopNavigation();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }

  function stopNavigation() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    window.speechSynthesis?.cancel();
    void wakeLock.current?.release();
    wakeLock.current = null;
    setStarted(false);
    setSpeed(0);
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    setStatus("Navegación detenida");
  }

  const navigationSteps = activeRoute?.legs.flatMap((leg) => leg.steps) ?? [];
  const currentInstruction = instructionFor(navigationSteps[currentStepIndex]);
  const tripCost = activeRoute ? (activeRoute.distance / 1000 / 100) * consumption * energyPrice : 0;

  async function installApp() {
    if (!installPrompt) {
      setStatus("En Chrome, abre el menú y pulsa «Instalar aplicación»");
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className={`app-shell ${started ? "navigating" : ""}`}>
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
            <div className="nav-instruction">
              <small>{distanceToTurn > 0 ? `En ${formatNavigationDistance(distanceToTurn)}` : "Navegación activa"}</small>
              <strong>{currentInstruction}</strong>
              <span className="nav-meta">{formatNavigationDistance(remainingDistance)} · llegada {arrivalTime(remainingDuration)}</span>
            </div>
            <span className="nav-speed">{speed}<small>km/h</small></span>
            <div className="nav-actions">
              <button onClick={() => { setMuted((value) => !value); window.speechSynthesis?.cancel(); }} aria-label={muted ? "Activar voz" : "Silenciar voz"}>{muted ? "🔇" : "🔊"}</button>
              <button onClick={() => setDarkMode((value) => !value)} aria-label="Cambiar modo de color">{darkMode ? "☀" : "☾"}</button>
              <button className="exit-nav" onClick={stopNavigation}>Salir</button>
            </div>
          </div>
        )}
      </section>

      <aside className="panel">
        <div className="panel-heading">
          <span className="eyebrow">MAPA Y RUTAS REALES</span>
          <h1>Llega bien,<br />no solo rápido.</h1>
          <p>Busca un destino y permite tu ubicación para calcular el viaje desde donde estás.</p>
          <button className="install-button" onClick={installApp}><span>＋</span> Instalar Vía Clara</button>
          {(savedPlaces.length > 0 || recentPlaces.length > 0) && (
            <div className="quick-places">
              {savedPlaces.slice(0, 3).map((place) => (
                <button key={`${place.kind}-${place.label}`} onClick={() => choosePlace(place)}>
                  <span>{place.kind === "Casa" ? "⌂" : place.kind === "Trabajo" ? "▣" : "★"}</span>{place.kind}
                </button>
              ))}
              {recentPlaces.slice(0, 2).map((place) => (
                <button key={`recent-${place.label}`} onClick={() => choosePlace(place)}><span>↶</span>{place.label.split(",")[0]}</button>
              ))}
            </div>
          )}
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

        <button className="tools-toggle" onClick={() => setShowTools((value) => !value)}>
          <span>✦</span> Herramientas de viaje <b>{showTools ? "−" : "+"}</b>
        </button>
        {showTools && (
          <section className="travel-tools">
            <div className="tool-block">
              <strong>Guardar destino</strong>
              <div className="mini-actions">
                <button onClick={() => saveCurrentPlace("Casa")}>⌂ Casa</button>
                <button onClick={() => saveCurrentPlace("Trabajo")}>▣ Trabajo</button>
                <button onClick={() => saveCurrentPlace("Favorito")}>★ Favorito</button>
              </div>
            </div>
            <div className="tool-block">
              <strong>Explorar cerca</strong>
              <div className="mini-actions">
                <button onClick={() => void findNearby("fuel")}>⛽ Gasolineras</button>
                <button onClick={() => void findNearby("parking")}>P Aparcar</button>
                <button onClick={() => void findNearby("charging_station")}>⚡ Cargadores</button>
                <button onClick={() => void findNearby("restaurant")}>● Comer</button>
              </div>
              {nearbyPlaces.length > 0 && (
                <div className="nearby-list">
                  {nearbyPlaces.map((place) => <button key={`${place.label}-${place.coordinates.join("-")}`} onClick={() => choosePlace(place)}>{place.label}<span>Ir →</span></button>)}
                </div>
              )}
            </div>
            <div className="tool-grid">
              <label>Vehículo<select value={vehicle} onChange={(event) => setVehicle(event.target.value as typeof vehicle)}><option>Coche</option><option>Eléctrico</option><option>Moto</option><option>Caravana</option></select></label>
              <label>Consumo<input type="number" min="1" step="0.1" value={consumption} onChange={(event) => setConsumption(Number(event.target.value))} /><small>{vehicle === "Eléctrico" ? "kWh/100 km" : "L/100 km"}</small></label>
              <label>Precio<input type="number" min="0" step="0.01" value={energyPrice} onChange={(event) => setEnergyPrice(Number(event.target.value))} /><small>€/unidad</small></label>
            </div>
            <div className="preference-switches">
              <label><input type="checkbox" checked={avoidTolls} onChange={(event) => setAvoidTolls(event.target.checked)} /> Evitar peajes</label>
              <label><input type="checkbox" checked={avoidHighways} onChange={(event) => setAvoidHighways(event.target.checked)} /> Evitar autopistas</label>
              <small>Preferencias beta: se guardan para el próximo motor avanzado de rutas.</small>
            </div>
            {(activeRoute || weather) && (
              <div className="trip-insights">
                {activeRoute && <span><small>Coste estimado</small><strong>{tripCost.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</strong></span>}
                {weather && <span><small>Tiempo en destino</small><strong>{Math.round(weather.temperature)} °C · viento {Math.round(weather.wind)} km/h</strong></span>}
              </div>
            )}
          </section>
        )}

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
          <span><small>Llegada estimada</small><strong>{activeRoute ? arrivalTime(activeRoute.duration) : "—"}</strong></span>
        </div>
        <button className={`start-button ${started ? "stop" : ""}`} disabled={!activeRoute} onClick={started ? stopNavigation : startNavigation}>
          {started ? "Detener navegación" : activeRoute ? "Iniciar en Vía Clara" : "Primero elige un destino"} <span>{started ? "■" : "→"}</span>
        </button>
        <p className="demo-note">Navegación propia con OpenStreetMap · Mantén la pantalla activa</p>
      </aside>
    </main>
  );
}
