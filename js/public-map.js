import { appSettings } from "./config.js";
import { createDatabase, hasFirebaseConfig, loadDatabaseSdk } from "./firebase-client.js";

const state = {
  map: null,
  marker: null,
  latest: null,
  hasCentered: false
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  statusText: document.querySelector("#statusText"),
  coordinates: document.querySelector("#coordinates"),
  accuracy: document.querySelector("#accuracy"),
  lastUpdated: document.querySelector("#lastUpdated"),
  centerButton: document.querySelector("#centerButton"),
  mapsLink: document.querySelector("#mapsLink"),
  liveDot: document.querySelector(".live-dot")
};

initMap();
initRealtimeLocation();

elements.centerButton.addEventListener("click", () => {
  if (!state.latest) return;
  state.map.setView([state.latest.lat, state.latest.lng], Math.max(state.map.getZoom(), 15), {
    animate: true
  });
});

function initMap() {
  const center = [appSettings.defaultCenter.lat, appSettings.defaultCenter.lng];

  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true
  }).setView(center, appSettings.defaultZoom);

  L.control.zoom({ position: "topright" }).addTo(state.map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);

  const icon = L.icon({
    iconUrl: appSettings.markerIcon,
    iconSize: [58, 58],
    iconAnchor: [29, 44],
    popupAnchor: [0, -40],
    className: "boat-marker-icon"
  });

  state.marker = L.marker(center, {
    icon,
    title: appSettings.boatName
  }).addTo(state.map);
  state.marker.setOpacity(0);
}

async function initRealtimeLocation() {
  if (!hasFirebaseConfig()) {
    setConnectionState("Config needed");
    setStatus("Add Firebase config in js/config.js", "Not available", "Not available", "Not available");
    return;
  }

  try {
    setConnectionState("Connecting");
    const [db, databaseSdk] = await Promise.all([createDatabase(), loadDatabaseSdk()]);
    const { ref, onValue } = databaseSdk;
    const latestRef = ref(db, `boats/${appSettings.boatId}/latest`);

    onValue(
      latestRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setConnectionState("No location yet");
          setStatus("Waiting for first tracker update", "Not available", "Not available", "Not available");
          return;
        }

        renderLocation(snapshot.val());
      },
      (error) => {
        setConnectionState("Firebase error");
        setStatus(error.message, "Not available", "Not available", "Not available");
      }
    );
  } catch (error) {
    setConnectionState("Setup error");
    setStatus(error.message, "Not available", "Not available", "Not available");
  }
}

function renderLocation(data) {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const timestamp = Number(data.timestamp);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setConnectionState("Invalid location");
    setStatus("Latest location is missing coordinates", "Not available", "Not available", "Not available");
    return;
  }

  const location = { lat, lng };
  const ageMs = Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
  const staleMs = 30 * 1000;
  const isStale = ageMs > staleMs;
  const status =
    data.status === "stopped"
      ? "Tracking Off"
      : isStale
        ? "Location stale — check phone screen/location permissions."
        : "BROADCASTING LIVE";

  state.latest = location;
  state.marker.setLatLng([lat, lng]);
  state.marker.setOpacity(1);
  state.marker.bindPopup(`${appSettings.boatName}<br>${formatCoordinates(lat, lng)}`);

  if (!state.hasCentered) {
    state.map.setView([lat, lng], 15);
    state.hasCentered = true;
  }

  elements.centerButton.disabled = false;
  elements.mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  elements.mapsLink.classList.remove("disabled");
  elements.mapsLink.removeAttribute("aria-disabled");

  elements.liveDot.classList.toggle("is-live", !isStale && data.status !== "stopped");
  elements.liveDot.classList.toggle("is-stale", isStale);
  setConnectionState(status);
  setStatus(
    status,
    formatCoordinates(lat, lng),
    formatAccuracy(data.accuracy),
    Number.isFinite(timestamp) ? formatAge(timestamp) : "Unknown"
  );
}

function setConnectionState(message) {
  elements.connectionStatus.textContent = message;
}

function setStatus(status, coordinates, accuracy, updated) {
  elements.statusText.textContent = status;
  elements.coordinates.textContent = coordinates;
  elements.accuracy.textContent = accuracy;
  elements.lastUpdated.textContent = updated;
}

function formatCoordinates(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function formatAccuracy(accuracy) {
  const value = Number(accuracy);
  if (!Number.isFinite(value)) return "Unknown";
  return `${Math.round(value)} m`;
}

function formatAge(timestamp) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 5) return "Just now";
  if (elapsedSeconds < 60) return `${elapsedSeconds} sec ago`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours} hr ago`;
}
