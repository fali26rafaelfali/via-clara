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
import {
  BriefcaseBusiness,
  Check,
  CirclePlus,
  Cloud,
  Download,
  Fuel,
  Home as HomeIcon,
  Leaf,
  LocateFixed,
  LogIn,
  LogOut,
  Moon,
  Navigation,
  SquareParking,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  TriangleAlert,
  Utensils,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

type Coordinates = [number, number];
type RouteKind = "calm" | "fast" | "eco";
type TravelMode = "Normal" | "Familia" | "Caravana";
type Place = { label: string; coordinates: Coordinates };
type SavedPlace = Place & { kind: "Casa" | "Trabajo" | "Favorito" };
type AuthSession = { access_token: string; refresh_token: string; user: { id: string; email?: string } };
type NearbyPlace = Place & { type: string };
type AlertKind = "radar" | "accident" | "traffic" | "works" | "hazard" | "vehicle";
type RoadAlert = {
  id: string;
  kind: AlertKind;
  coordinates: Coordinates;
  createdAt: number;
  confirmations: number;
  source: "OpenStreetMap" | "Comunidad" | "DGT";
  road?: string;
  municipality?: string;
};
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type ScreenWakeLock = {
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
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
const SUPABASE_URL = "https://vbzhxoanlqpqwxfidgao.supabase.co";
const SUPABASE_KEY = "sb_publishable_dXBO8BiyoQkEVlqldNDesQ_HPoeQ0yn";
const ZBE_CITIES = ["madrid", "barcelona", "sevilla", "málaga", "granada", "bilbao", "valladolid", "alicante", "oviedo", "pamplona", "salamanca", "vitoria", "tarragona", "girona", "castellón"];
const ALERT_DETAILS: Record<AlertKind, { label: string; icon: string; color: string; expires: number }> = {
  radar: { label: "Radar fijo", icon: "◉", color: "#be3c32", expires: 30 * 24 * 60 * 60 * 1000 },
  accident: { label: "Accidente", icon: "⚠", color: "#d74836", expires: 90 * 60 * 1000 },
  traffic: { label: "Retención", icon: "≋", color: "#e0822c", expires: 45 * 60 * 1000 },
  works: { label: "Obras", icon: "◆", color: "#c78322", expires: 8 * 60 * 60 * 1000 },
  hazard: { label: "Peligro", icon: "!", color: "#7859b8", expires: 2 * 60 * 60 * 1000 },
  vehicle: { label: "Vehículo detenido", icon: "▰", color: "#3978a8", expires: 60 * 60 * 1000 },
};
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

function alertAge(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Ahora mismo";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
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

function deviceId() {
  let id = localStorage.getItem("via-clara-device-id");
  if (!id) {
    id = `device-${crypto.randomUUID()}`;
    localStorage.setItem("via-clara-device-id", id);
  }
  return id;
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
  const navigationStepFloor = useRef(0);
  const lastVoiceAt = useRef(0);
  const lastRecalculation = useRef(0);
  const wakeLock = useRef<ScreenWakeLock | null>(null);
  const alertMarkers = useRef<Marker[]>([]);
  const warnedAlerts = useRef<Set<string>>(new Set());
  const roadAlertsRef = useRef<RoadAlert[]>([]);
  const latestOrigin = useRef<Coordinates>(MADRID);
  const alertRefreshTimer = useRef<number | null>(null);
  const navigationStartedAt = useRef(0);
  const restReminderSpoken = useRef(false);
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
  const [weather, setWeather] = useState<{ temperature: number; wind: number; precipitation: number; code: number } | null>(null);
  const [routeWeather, setRouteWeather] = useState<{ label: string; level: "good" | "warning" | "danger" } | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>("Normal");
  const [environmentalBadge, setEnvironmentalBadge] = useState<"Sin etiqueta" | "B" | "C" | "ECO" | "0">("C");
  const [roadAlerts, setRoadAlerts] = useState<RoadAlert[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<RoadAlert | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

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
      if (alertRefreshTimer.current !== null) window.clearInterval(alertRefreshTimer.current);
      window.speechSynthesis?.cancel();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    roadAlertsRef.current = roadAlerts;
  }, [roadAlerts]);

  useEffect(() => {
    if (!started) return;
    const resumeScreenLock = () => {
      if (document.visibilityState === "visible") void keepScreenAwake();
    };
    document.addEventListener("visibilitychange", resumeScreenLock);
    window.addEventListener("pageshow", resumeScreenLock);
    void keepScreenAwake();
    return () => {
      document.removeEventListener("visibilitychange", resumeScreenLock);
      window.removeEventListener("pageshow", resumeScreenLock);
    };
  }, [started]);

  useEffect(() => {
    try {
      setSavedPlaces(JSON.parse(localStorage.getItem("via-clara-saved") ?? "[]"));
      setRecentPlaces(JSON.parse(localStorage.getItem("via-clara-recent") ?? "[]"));
      const settings = JSON.parse(localStorage.getItem("via-clara-vehicle") ?? "{}");
      const storedAlerts: RoadAlert[] = JSON.parse(localStorage.getItem("via-clara-alerts") ?? "[]");
      setRoadAlerts(storedAlerts.filter((alert) => Date.now() - alert.createdAt < ALERT_DETAILS[alert.kind].expires));
      if (settings.vehicle) setVehicle(settings.vehicle);
      if (settings.consumption) setConsumption(settings.consumption);
      if (settings.energyPrice) setEnergyPrice(settings.energyPrice);
      if (settings.travelMode) setTravelMode(settings.travelMode);
      if (settings.environmentalBadge) setEnvironmentalBadge(settings.environmentalBadge);
      setAvoidTolls(Boolean(settings.avoidTolls));
      setAvoidHighways(Boolean(settings.avoidHighways));
      const storedSession = localStorage.getItem("via-clara-session");
      if (storedSession) {
        const restored: AuthSession = JSON.parse(storedSession);
        void restoreAccount(restored);
      }
    } catch {
      // Keep safe defaults when local preferences are unavailable.
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      alertMarkers.current.forEach((marker) => marker.remove());
      alertMarkers.current = roadAlerts.map((alert) => {
        const details = ALERT_DETAILS[alert.kind];
        const element = document.createElement("button");
        element.className = `road-alert-marker ${alert.kind}`;
        element.textContent = details.icon;
        element.title = `${details.label} · ${alert.source}`;
        element.setAttribute("aria-label", element.title);
        element.style.backgroundColor = details.color;
        element.onclick = () => {
          setSelectedAlert(alert);
          setStatus(`${details.label}${alert.road ? ` en ${alert.road}` : ""} · Fuente: ${alert.source}`);
        };
        return new Marker({ element }).setLngLat(alert.coordinates).addTo(map);
      });
    };
    if (map.isStyleLoaded()) render();
    else map.once("load", render);
    return () => alertMarkers.current.forEach((marker) => marker.remove());
  }, [roadAlerts]);

  useEffect(() => {
    localStorage.setItem("via-clara-vehicle", JSON.stringify({ vehicle, consumption, energyPrice, avoidTolls, avoidHighways, travelMode, environmentalBadge }));
  }, [vehicle, consumption, energyPrice, avoidTolls, avoidHighways, travelMode, environmentalBadge]);

  useEffect(() => {
    if (!destinationPoint) {
      setWeather(null);
      return;
    }
    const [longitude, latitude] = destinationPoint;
    void fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,precipitation,weather_code`)
      .then((response) => response.json())
      .then((data) => setWeather({
        temperature: data.current.temperature_2m,
        wind: data.current.wind_speed_10m,
        precipitation: data.current.precipitation,
        code: data.current.weather_code,
      }))
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
    if (!activeRoute) {
      setRouteWeather(null);
      return;
    }
    const coordinates = activeRoute.geometry.coordinates as Coordinates[];
    const midpoint = coordinates[Math.floor(coordinates.length / 2)];
    void fetch(`https://api.open-meteo.com/v1/forecast?latitude=${midpoint[1]}&longitude=${midpoint[0]}&current=wind_speed_10m,precipitation,weather_code`)
      .then((response) => response.json())
      .then((data) => {
        const current = data.current;
        if (current.weather_code >= 95 || current.wind_speed_10m >= 60) setRouteWeather({ label: "Riesgo de tormenta o viento fuerte en ruta", level: "danger" });
        else if (current.precipitation > 0 || current.weather_code >= 45 || current.wind_speed_10m >= 35) setRouteWeather({ label: "Conduce con precaución: tiempo adverso en ruta", level: "warning" });
        else setRouteWeather({ label: "Condiciones meteorológicas favorables", level: "good" });
      })
      .catch(() => setRouteWeather(null));
  }, [activeRoute]);

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
    if (session) void uploadSavedPlace(place, session);
    setStatus(`${kind} guardado${session ? " y sincronizado" : " en este dispositivo"}`);
  }

  async function syncSavedPlaces(activeSession: AuthSession, localPlaces?: SavedPlace[]) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/saved_places?select=kind,label,longitude,latitude&order=updated_at.desc`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${activeSession.access_token}` },
      });
      if (!response.ok) throw new Error("sync");
      const cloud: Array<{ kind: SavedPlace["kind"]; label: string; longitude: number; latitude: number }> = await response.json();
      const local = localPlaces ?? JSON.parse(localStorage.getItem("via-clara-saved") ?? "[]") as SavedPlace[];
      const remotePlaces = cloud.map((place) => ({ kind: place.kind, label: place.label, coordinates: [place.longitude, place.latitude] as Coordinates }));
      const merged = [...remotePlaces];
      for (const place of local) {
        const samePrimary = place.kind !== "Favorito" && merged.some((item) => item.kind === place.kind);
        const duplicate = merged.some((item) => item.kind === place.kind && item.label === place.label);
        if (!samePrimary && !duplicate) merged.push(place);
      }
      const finalPlaces = merged.slice(0, 20);
      setSavedPlaces(finalPlaces);
      localStorage.setItem("via-clara-saved", JSON.stringify(finalPlaces));
      await Promise.all(finalPlaces.map((place) => uploadSavedPlace(place, activeSession)));
      setStatus("Casa, Trabajo y Favoritos sincronizados");
    } catch {
      setStatus("No se pudo sincronizar. Tus lugares siguen guardados en este móvil.");
    }
  }

  async function restoreAccount(storedSession: AuthSession) {
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: storedSession.refresh_token }),
      });
      if (!response.ok) throw new Error("expired");
      const refreshed = await response.json() as AuthSession;
      localStorage.setItem("via-clara-session", JSON.stringify(refreshed));
      setSession(refreshed);
      await syncSavedPlaces(refreshed);
    } catch {
      localStorage.removeItem("via-clara-session");
      setSession(null);
    }
  }

  async function uploadSavedPlace(place: SavedPlace, activeSession: AuthSession) {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${activeSession.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    };
    if (place.kind !== "Favorito") {
      await fetch(`${SUPABASE_URL}/rest/v1/saved_places?kind=eq.${encodeURIComponent(place.kind)}&label=neq.${encodeURIComponent(place.label)}`, {
        method: "DELETE",
        headers,
      });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/saved_places?on_conflict=user_id,kind,label`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: activeSession.user.id,
        kind: place.kind,
        label: place.label,
        longitude: place.coordinates[0],
        latitude: place.coordinates[1],
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async function submitAccount(mode: "login" | "signup") {
    if (!accountEmail.includes("@") || accountPassword.length < 6) {
      setStatus("Escribe un correo válido y una contraseña de al menos 6 caracteres");
      return;
    }
    setAccountBusy(true);
    try {
      const endpoint = mode === "login" ? "/auth/v1/token?grant_type=password" : "/auth/v1/signup";
      const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: accountEmail.trim(), password: accountPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.msg ?? data.error_description ?? "No se pudo acceder");
      if (!data.access_token) {
        setStatus("Revisa tu correo para confirmar la cuenta y después pulsa Entrar");
        return;
      }
      const nextSession = data as AuthSession;
      localStorage.setItem("via-clara-session", JSON.stringify(nextSession));
      setSession(nextSession);
      setAccountPassword("");
      setAccountOpen(false);
      await syncSavedPlaces(nextSession, savedPlaces);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo acceder a la cuenta");
    } finally {
      setAccountBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem("via-clara-session");
    setSession(null);
    setAccountOpen(false);
    setStatus("Sesión cerrada. Tus lugares continúan guardados en este móvil.");
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

  async function loadSafetyAlerts(point: Coordinates = origin) {
    setStatus("Actualizando alertas de seguridad…");
    try {
      const query = `[out:json][timeout:15];nwr(around:15000,${point[1]},${point[0]})[highway=speed_camera];out center;`;
      const [response, sharedResponse] = await Promise.all([
        fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`),
        fetch(`${SUPABASE_URL}/rest/v1/road_reports?select=id,kind,latitude,longitude,created_at,confirmations&limit=1000`, {
          headers: { apikey: SUPABASE_KEY },
          cache: "no-store",
        }),
      ]);
      if (!response.ok) throw new Error("alerts");
      const data = await response.json();
      const sharedData = sharedResponse.ok ? await sharedResponse.json() : [];
      const base = window.location.pathname.startsWith("/via-clara") ? "/via-clara" : "";
      const dgtData = await fetch(`${base}/dgt-incidents.json`, { cache: "no-store" })
        .then((result) => result.ok ? result.json() : { incidents: [] })
        .catch(() => ({ incidents: [] }));
      const cameras: RoadAlert[] = (data.elements ?? []).map((item: { id: number; lat?: number; lon?: number; center?: { lat: number; lon: number } }) => ({
        id: `osm-radar-${item.id}`,
        kind: "radar",
        coordinates: [item.lon ?? item.center?.lon, item.lat ?? item.center?.lat] as Coordinates,
        createdAt: Date.now(),
        confirmations: 0,
        source: "OpenStreetMap",
      })).filter((item: RoadAlert) => Number.isFinite(item.coordinates[0]));
      const official: RoadAlert[] = (dgtData.incidents ?? [])
        .filter((alert: RoadAlert) => distanceBetween(point, alert.coordinates) < 100000)
        .slice(0, 250);
      const shared: RoadAlert[] = sharedData.map((item: { id: string; kind: AlertKind; latitude: number; longitude: number; created_at: string; confirmations: number }) => ({
        id: `shared-${item.id}`,
        kind: item.kind,
        coordinates: [item.longitude, item.latitude],
        createdAt: Date.parse(item.created_at),
        confirmations: item.confirmations,
        source: "Comunidad",
      })).filter((alert: RoadAlert) => distanceBetween(point, alert.coordinates) < 100000);
      const community = roadAlerts.filter((alert) => alert.id.startsWith("local-") && Date.now() - alert.createdAt < ALERT_DETAILS[alert.kind].expires);
      const combined = [...community, ...shared, ...official, ...cameras];
      setRoadAlerts(combined);
      localStorage.setItem("via-clara-alerts", JSON.stringify(community));
      setStatus(`${official.length} DGT · ${cameras.length} radares · ${shared.length} avisos compartidos`);
      return combined;
    } catch {
      setStatus("No se pudieron actualizar ahora las alertas");
      return [];
    }
  }

  async function focusSafetyAlerts() {
    const alerts = await loadSafetyAlerts(origin);
    const map = mapRef.current;
    if (!map || !alerts.length) {
      setStatus("No hay alertas visibles cerca de tu ubicación");
      return;
    }
    setSelectedAlert(null);
    const bounds = alerts.reduce(
      (box, alert) => box.extend(alert.coordinates),
      new LngLatBounds(alerts[0].coordinates, alerts[0].coordinates),
    );
    map.fitBounds(bounds as LngLatBoundsLike, {
      padding: { top: 90, right: 70, bottom: 90, left: 70 },
      maxZoom: 13,
      duration: 900,
    });
    setStatus(`Mostrando ${alerts.length} alertas en el mapa`);
  }

  async function reportAlert(kind: Exclude<AlertKind, "radar">) {
    const alert: RoadAlert = {
      id: `local-${Date.now()}`,
      kind,
      coordinates: origin,
      createdAt: Date.now(),
      confirmations: 1,
      source: "Comunidad",
    };
    setShowReport(false);
    setStatus("Compartiendo aviso con la comunidad…");
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/report_road_incident`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_kind: kind,
          p_latitude: origin[1],
          p_longitude: origin[0],
          p_device_id: deviceId(),
        }),
      });
      if (!response.ok) throw new Error("shared report");
      setStatus(`${ALERT_DETAILS[kind].label} compartido con todos los conductores`);
      await loadSafetyAlerts(origin);
    } catch {
      const community = [alert, ...roadAlerts.filter((item) => item.id.startsWith("local-"))];
      setRoadAlerts([...community, ...roadAlerts.filter((item) => !item.id.startsWith("local-"))]);
      localStorage.setItem("via-clara-alerts", JSON.stringify(community));
      setStatus("Sin conexión: aviso guardado solo en este dispositivo");
    }
  }

  async function voteAlert(alert: RoadAlert, present: boolean) {
    if (!alert.id.startsWith("shared-")) return;
    setStatus("Registrando tu confirmación…");
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vote_road_report`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_report_id: alert.id.replace("shared-", ""),
          p_device_id: deviceId(),
          p_present: present,
        }),
      });
      if (!response.ok) throw new Error("vote");
      setSelectedAlert(null);
      setStatus(present ? "Gracias: aviso confirmado" : "Gracias: revisaremos si el aviso ya terminó");
      await loadSafetyAlerts(origin);
    } catch {
      setStatus("No se pudo registrar el voto. Prueba de nuevo.");
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
        latestOrigin.current = point;
        setOrigin(point);
        originMarker.current?.setLngLat(point);
        mapRef.current?.flyTo({ center: point, zoom: 15 });
        setStatus("Ubicación GPS activada");
        void loadSafetyAlerts(point);
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
    navigationStepFloor.current = 0;
    lastVoiceAt.current = 0;
    warnedAlerts.current.clear();
    navigationStartedAt.current = Date.now();
    restReminderSpoken.current = false;
    void loadSafetyAlerts(origin);
    if (alertRefreshTimer.current !== null) window.clearInterval(alertRefreshTimer.current);
    alertRefreshTimer.current = window.setInterval(() => {
      void loadSafetyAlerts(latestOrigin.current);
    }, 120000);
    setStatus("Navegación activa · cargando alertas de seguridad");
    const steps = activeRoute.legs.flatMap((leg) => leg.steps);
    const routeCoordinates = activeRoute.geometry.coordinates as Coordinates[];
    void keepScreenAwake();
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const point: Coordinates = [coords.longitude, coords.latitude];
        latestOrigin.current = point;
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
        const detectedIndex = closestDistance < 35 ? Math.min(closestIndex + 1, steps.length - 1) : closestIndex;
        const nextIndex = Math.max(navigationStepFloor.current, detectedIndex);
        navigationStepFloor.current = nextIndex;
        const nextStep = steps[nextIndex];
        const nextDistance = nextStep ? distanceBetween(point, nextStep.maneuver.location) : 0;
        setCurrentStepIndex(nextIndex);
        setDistanceToTurn(nextDistance);
        const remainingSteps = steps.slice(nextIndex);
        setRemainingDistance(nextDistance + remainingSteps.reduce((total, step) => total + step.distance, 0));
        setRemainingDuration(remainingSteps.reduce((total, step) => total + step.duration, 0));

        if (alertsEnabled) {
          const approaching = roadAlertsRef.current
            .map((alert) => ({ alert, distance: distanceBetween(point, alert.coordinates) }))
            .filter(({ alert, distance }) => distance < (alert.kind === "radar" ? 700 : 450) && !warnedAlerts.current.has(alert.id))
            .sort((a, b) => a.distance - b.distance)[0];
          if (approaching) {
            warnedAlerts.current.add(approaching.alert.id);
            const warning = `${ALERT_DETAILS[approaching.alert.kind].label} a ${Math.max(50, Math.round(approaching.distance / 50) * 50)} metros`;
            setStatus(warning);
            if (!muted && "speechSynthesis" in window) {
              const message = new SpeechSynthesisUtterance(warning);
              message.lang = "es-ES";
              window.speechSynthesis.speak(message);
            }
          }
        }

        const restAfterMinutes = travelMode === "Normal" ? 120 : 90;
        if (!restReminderSpoken.current && Date.now() - navigationStartedAt.current >= restAfterMinutes * 60000) {
          restReminderSpoken.current = true;
          const reminder = "Es un buen momento para descansar. Busca una parada segura cercana.";
          setStatus(reminder);
          if (!muted && "speechSynthesis" in window) {
            const message = new SpeechSynthesisUtterance(reminder);
            message.lang = "es-ES";
            window.speechSynthesis.speak(message);
          }
        }

        if (
          nextIndex !== lastSpokenStep.current &&
          nextStep &&
          nextDistance < 450 &&
          Date.now() - lastVoiceAt.current > 8000 &&
          !muted &&
          "speechSynthesis" in window &&
          "SpeechSynthesisUtterance" in window
        ) {
          lastSpokenStep.current = nextIndex;
          lastVoiceAt.current = Date.now();
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

  async function keepScreenAwake() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || wakeLock.current) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLock.current = lock;
      lock.addEventListener?.("release", () => {
        if (wakeLock.current === lock) wakeLock.current = null;
      });
    } catch {
      wakeLock.current = null;
      setStatus("Navegación activa · revisa el ahorro de batería si la pantalla se apaga");
    }
  }

  function stopNavigation() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (alertRefreshTimer.current !== null) {
      window.clearInterval(alertRefreshTimer.current);
      alertRefreshTimer.current = null;
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
  const restAfterMinutes = travelMode === "Normal" ? 120 : 90;
  const restRecommended = Boolean(activeRoute && activeRoute.duration / 60 > restAfterMinutes);
  const zbeDestination = ZBE_CITIES.find((city) => destination.toLocaleLowerCase("es").includes(city));
  const zbeWarning = Boolean(zbeDestination && (environmentalBadge === "Sin etiqueta" || environmentalBadge === "B"));

  async function shareTrip() {
    if (!activeRoute || !destination) {
      setStatus("Elige primero un destino para compartir el viaje");
      return;
    }
    const text = `Voy hacia ${destination}. Llegada estimada ${arrivalTime(remainingDuration || activeRoute.duration)}. Distancia ${formatDistance(remainingDistance || activeRoute.distance)}. Compartido desde Vía Clara.`;
    try {
      if (navigator.share) await navigator.share({ title: "Mi viaje en Vía Clara", text, url: window.location.href });
      else {
        await navigator.clipboard.writeText(`${text} ${window.location.href}`);
        setStatus("Resumen del viaje copiado para compartir");
      }
    } catch {
      setStatus("No se ha compartido el viaje");
    }
  }

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
        <button className="locate icon-button" onClick={locateMe} aria-label="Usar mi ubicación GPS" title="Usar mi ubicación GPS"><LocateFixed /></button>
        {started && activeRoute && (
          <div className="navigation-banner">
            <span className="turn-arrow">↱</span>
            <div className="nav-instruction">
              <small>{distanceToTurn > 0 ? `En ${formatNavigationDistance(distanceToTurn)}` : "Navegación activa"}</small>
              <strong>{currentInstruction}</strong>
              <span className="nav-meta">{formatNavigationDistance(remainingDistance)} · llegada {arrivalTime(remainingDuration)} · {roadAlerts.length} alertas</span>
            </div>
            <span className="nav-speed">{speed}<small>km/h</small></span>
            <div className="nav-actions">
              <button className="report-nav icon-button" onClick={() => setShowReport(true)} aria-label="Comunicar incidencia"><TriangleAlert /></button>
              <button className="icon-button" onClick={() => void shareTrip()} aria-label="Compartir viaje"><Share2 /></button>
              <button className="icon-button" onClick={() => { setMuted((value) => !value); window.speechSynthesis?.cancel(); }} aria-label={muted ? "Activar voz" : "Silenciar voz"}>{muted ? <VolumeX /> : <Volume2 />}</button>
              <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Cambiar modo de color">{darkMode ? <Sun /> : <Moon />}</button>
              <button className="exit-nav" onClick={stopNavigation}><LogOut /> Salir</button>
            </div>
          </div>
        )}
        {started && (
          <section className="safety-card navigation-safety-card">
            <button className="safety-heading" onClick={() => void focusSafetyAlerts()} title="Mostrar todas las alertas en el mapa">
              <span className="safety-icon"><ShieldCheck /></span>
              <span><strong>Seguridad en ruta</strong><small>Radares y avisos cercanos</small></span>
            </button>
            <div className="safety-card-actions">
              <button onClick={() => void loadSafetyAlerts()}><RefreshCw /> Actualizar</button>
              <button className="report-button" onClick={() => setShowReport(true)}><CirclePlus /> Comunicar</button>
            </div>
            <p><b>{roadAlerts.length}</b> alertas visibles · DGT, radares de OpenStreetMap y avisos compartidos de Vía Clara.</p>
          </section>
        )}
        {showReport && (
          <div className="report-sheet" role="dialog" aria-modal="true" aria-label="Comunicar incidencia">
            <div className="report-card">
              <div className="report-heading"><div><small>AVISO COMUNITARIO</small><strong>¿Qué está pasando?</strong></div><button onClick={() => setShowReport(false)}>×</button></div>
              <p>Se marcará en tu posición actual y caducará automáticamente.</p>
              <div className="report-grid">
                {(["accident", "traffic", "works", "hazard", "vehicle"] as const).map((kind) => (
                  <button key={kind} onClick={() => void reportAlert(kind)}>
                    <span style={{ background: ALERT_DETAILS[kind].color }}>{ALERT_DETAILS[kind].icon}</span>
                    {ALERT_DETAILS[kind].label}
                  </button>
                ))}
              </div>
              <small className="safety-note">Por seguridad, comunica el aviso con el vehículo detenido o mediante un acompañante.</small>
            </div>
          </div>
        )}
        {selectedAlert && (
          <div className="alert-detail" role="dialog" aria-modal="true" aria-label="Detalle de incidencia">
            <div className="alert-detail-card">
              <button className="alert-detail-close" onClick={() => setSelectedAlert(null)} aria-label="Cerrar">×</button>
              <span className="alert-detail-icon" style={{ background: ALERT_DETAILS[selectedAlert.kind].color }}>
                {ALERT_DETAILS[selectedAlert.kind].icon}
              </span>
              <small>{selectedAlert.source === "Comunidad" ? "COMUNIDAD VÍA CLARA" : `FUENTE ${selectedAlert.source.toUpperCase()}`}</small>
              <strong>{ALERT_DETAILS[selectedAlert.kind].label}</strong>
              {selectedAlert.road && <p>{selectedAlert.road}{selectedAlert.municipality ? ` · ${selectedAlert.municipality}` : ""}</p>}
              <div className="alert-detail-meta">
                <span>{alertAge(selectedAlert.createdAt)}</span>
                {selectedAlert.source === "Comunidad" && <span>{selectedAlert.confirmations} confirmaciones</span>}
              </div>
              {selectedAlert.id.startsWith("shared-") ? (
                <div className="alert-votes">
                  <button className="still-there" onClick={() => void voteAlert(selectedAlert, true)}>✓ Sigue ahí</button>
                  <button onClick={() => void voteAlert(selectedAlert, false)}>× Ya no está</button>
                </div>
              ) : (
                <p className="official-note">Información de consulta. Los votos comunitarios solo se aplican a avisos de usuarios.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <aside className="panel">
        <div className="panel-heading">
          <span className="eyebrow">MAPA Y RUTAS REALES</span>
          <h1>Llega bien,<br />no solo rápido.</h1>
          <p>Busca un destino y permite tu ubicación para calcular el viaje desde donde estás.</p>
          <div className="top-actions">
            <button className="install-button" onClick={installApp}><Download /> Instalar Vía Clara</button>
            <button className={`account-button ${session ? "connected" : ""}`} onClick={() => setAccountOpen(true)}>
              {session ? <Cloud /> : <LogIn />}{session ? "Cuenta sincronizada" : "Mi cuenta"}
            </button>
          </div>
          {(savedPlaces.length > 0 || recentPlaces.length > 0) && (
            <div className="quick-places">
              {savedPlaces.slice(0, 3).map((place) => (
                <button key={`${place.kind}-${place.label}`} onClick={() => choosePlace(place)}>
                  <span>{place.kind === "Casa" ? <HomeIcon /> : place.kind === "Trabajo" ? <BriefcaseBusiness /> : <Star />}</span>{place.kind}
                </button>
              ))}
              {recentPlaces.slice(0, 2).map((place) => (
                <button key={`recent-${place.label}`} onClick={() => choosePlace(place)}><span>↶</span>{place.label.split(",")[0]}</button>
              ))}
            </div>
          )}
        </div>

        {accountOpen && (
          <div className="account-sheet" role="dialog" aria-modal="true" aria-label="Cuenta y sincronización">
            <div className="account-card">
              <button className="account-close" onClick={() => setAccountOpen(false)} aria-label="Cerrar">×</button>
              <span className="eyebrow">SINCRONIZACIÓN SEGURA</span>
              <h2>{session ? "Tu cuenta Vía Clara" : "Tus lugares en todos tus móviles"}</h2>
              {session ? (
                <>
                  <p>Sesión iniciada como <strong>{session.user.email}</strong>. Casa, Trabajo y Favoritos se sincronizan automáticamente.</p>
                  <button className="account-primary" onClick={() => void syncSavedPlaces(session, savedPlaces)}>Sincronizar ahora</button>
                  <button className="account-secondary" onClick={signOut}>Cerrar sesión</button>
                </>
              ) : (
                <>
                  <p>Entra o crea una cuenta. Conservaremos también los lugares que ya tienes guardados en este móvil.</p>
                  <label>Correo electrónico<input type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="tu@email.com" autoComplete="email" /></label>
                  <label>Contraseña<input type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="current-password" /></label>
                  <button className="account-primary" disabled={accountBusy} onClick={() => void submitAccount("login")}>{accountBusy ? "Conectando…" : "Entrar y sincronizar"}</button>
                  <button className="account-secondary" disabled={accountBusy} onClick={() => void submitAccount("signup")}>Crear cuenta nueva</button>
                  <small>Tus direcciones solo serán visibles dentro de tu cuenta.</small>
                </>
              )}
            </div>
          </div>
        )}

        <div className="search-box">
          <span className="search-icon"><Search /></span>
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
          {destination && <button className="icon-button" onClick={() => { setDestination(""); setDestinationPoint(null); setSuggestions([]); }} aria-label="Borrar destino"><X /></button>}
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

        <button className="gps-button" onClick={locateMe}><LocateFixed /> Usar mi ubicación actual</button>
        <div className="status-line"><span className={loading ? "pulse" : ""} />{status}</div>

        <button className="tools-toggle" onClick={() => setShowTools((value) => !value)}>
          <SlidersHorizontal /> Herramientas de viaje <b>{showTools ? "−" : "+"}</b>
        </button>
        {showTools && (
          <section className="travel-tools">
            <div className="tool-block">
              <strong>Guardar destino</strong>
              <div className="mini-actions">
                <button onClick={() => saveCurrentPlace("Casa")}><HomeIcon /> Casa</button>
                <button onClick={() => saveCurrentPlace("Trabajo")}><BriefcaseBusiness /> Trabajo</button>
                <button onClick={() => saveCurrentPlace("Favorito")}><Star /> Favorito</button>
              </div>
            </div>
            <div className="tool-block">
              <strong>Explorar cerca</strong>
              <div className="mini-actions">
                <button onClick={() => void findNearby("fuel")}><Fuel /> Gasolineras</button>
                <button onClick={() => void findNearby("parking")}><SquareParking /> Aparcar</button>
                <button onClick={() => void findNearby("charging_station")}><Zap /> Cargadores</button>
                <button onClick={() => void findNearby("restaurant")}><Utensils /> Comer</button>
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
            <div className="journey-profile">
              <label>Modo de viaje
                <select value={travelMode} onChange={(event) => setTravelMode(event.target.value as TravelMode)}>
                  <option>Normal</option><option>Familia</option><option>Caravana</option>
                </select>
              </label>
              <label>Etiqueta ambiental
                <select value={environmentalBadge} onChange={(event) => setEnvironmentalBadge(event.target.value as typeof environmentalBadge)}>
                  <option>Sin etiqueta</option><option>B</option><option>C</option><option>ECO</option><option>0</option>
                </select>
              </label>
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

        {activeRoute && (
          <section className="journey-assistant">
            <div className={`journey-signal ${routeWeather?.level ?? "good"}`}>
              <span>{routeWeather?.level === "danger" ? "⚠" : routeWeather?.level === "warning" ? "☂" : "☀"}</span>
              <div><small>TIEMPO EN LA RUTA</small><strong>{routeWeather?.label ?? "Consultando condiciones…"}</strong></div>
            </div>
            {restRecommended && (
              <div className="journey-signal rest">
                <span>☕</span>
                <div><small>COPILOTO DE DESCANSO</small><strong>Parada recomendada tras {restAfterMinutes} minutos</strong></div>
                <button onClick={() => void findNearby("restaurant")}>Buscar</button>
              </div>
            )}
            {zbeDestination && (
              <div className={`journey-signal ${zbeWarning ? "danger" : "good"}`}>
                <span>Ⓔ</span>
                <div><small>ZONA DE BAJAS EMISIONES</small><strong>{zbeWarning ? `Revisa las restricciones de ${zbeDestination}` : `Etiqueta ${environmentalBadge}: comprueba las normas locales`}</strong></div>
              </div>
            )}
            <button className="share-trip" onClick={() => void shareTrip()}><Share2 /> Compartir estado del viaje</button>
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
                <span className={`route-icon ${key}`}>{key === "calm" ? <Check /> : key === "fast" ? <Navigation /> : <Leaf />}</span>
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
          {started ? "Detener navegación" : activeRoute ? "Iniciar en Vía Clara" : "Primero elige un destino"} <span>{started ? <X /> : <Navigation />}</span>
        </button>
        <p className="demo-note">Navegación propia con OpenStreetMap · Mantén la pantalla activa</p>
      </aside>
    </main>
  );
}
