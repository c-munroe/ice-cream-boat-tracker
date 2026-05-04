import { appSettings } from "./config.js";
import { createAuth, createDatabase, hasFirebaseConfig, loadAuthSdk, loadDatabaseSdk } from "./firebase-client.js";

const elements = {
  authStatus: document.querySelector("#authStatus"),
  trackerStatus: document.querySelector("#trackerStatus"),
  authForm: document.querySelector("#authForm"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  sendInterval: document.querySelector("#sendInterval"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  broadcastPanel: document.querySelector("#broadcastPanel"),
  broadcastLabel: document.querySelector("#broadcastLabel"),
  broadcastMessage: document.querySelector("#broadcastMessage"),
  broadcastCoordinates: document.querySelector("#broadcastCoordinates"),
  broadcastLastUpdated: document.querySelector("#broadcastLastUpdated"),
  broadcastWarning: document.querySelector("#broadcastWarning"),
  currentCoordinates: document.querySelector("#currentCoordinates"),
  currentAccuracy: document.querySelector("#currentAccuracy"),
  lastSent: document.querySelector("#lastSent"),
  userUid: document.querySelector("#userUid")
};

const STATUS_THRESHOLDS_MS = Object.freeze({
  live: 60 * 1000,
  recent: 5 * 60 * 1000,
  stale: 20 * 60 * 1000
});

const state = {
  auth: null,
  db: null,
  databaseSdk: null,
  authSdk: null,
  user: null,
  watchId: null,
  lastPosition: null,
  trackingStartedAt: 0,
  lastPositionAt: 0,
  lastSentAt: 0,
  permissionDenied: false,
  locationUnavailable: false,
  statusTimer: null,
  sendTimer: null,
  wakeLock: null
};

const storedEmail = window.localStorage.getItem("iceCreamBoatTrackerEmail");
if (storedEmail) elements.email.value = storedEmail;

initTracker();
startStatusTimer();
renderBroadcastStatus();

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await signIn();
});

elements.signOutButton.addEventListener("click", async () => {
  await stopTracking();
  await state.authSdk.signOut(state.auth);
});

elements.startButton.addEventListener("click", startTracking);
elements.stopButton.addEventListener("click", stopTracking);
elements.sendInterval.addEventListener("change", () => {
  if (state.watchId !== null) {
    startSendTimer();
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && state.watchId !== null) {
    await requestWakeLock();
  }
});

async function initTracker() {
  if (!hasFirebaseConfig()) {
    setTrackerStatus("Add Firebase config in js/config.js before using the tracker.");
    setSignedInState(null);
    setAuthControlsEnabled(false);
    setAuthStatus("Config needed");
    return;
  }

  try {
    setTrackerStatus("Loading tracker.");
    setAuthControlsEnabled(false);
    const [auth, db, authSdk, databaseSdk] = await Promise.all([
      createAuth(),
      createDatabase(),
      loadAuthSdk(),
      loadDatabaseSdk()
    ]);

    state.auth = auth;
    state.db = db;
    state.authSdk = authSdk;
    state.databaseSdk = databaseSdk;

    authSdk.onAuthStateChanged(auth, (user) => {
      state.user = user;
      setSignedInState(user);
      setAuthControlsEnabled(true);
      if (user) {
        setTrackerStatus("Ready to send location.");
      } else {
        setTrackerStatus("Sign in to start sending location.");
      }
    });
  } catch (error) {
    setTrackerStatus(error.message);
    setSignedInState(null);
    setAuthControlsEnabled(false);
    setAuthStatus("Setup error");
  }
}

async function signIn() {
  const email = elements.email.value.trim();
  const password = elements.password.value;

  if (!email || !password || !state.authSdk) return;

  elements.signInButton.disabled = true;
  setTrackerStatus("Signing in.");

  try {
    await state.authSdk.signInWithEmailAndPassword(state.auth, email, password);
    window.localStorage.setItem("iceCreamBoatTrackerEmail", email);
    elements.password.value = "";
  } catch (error) {
    setTrackerStatus(formatFirebaseError(error));
  } finally {
    elements.signInButton.disabled = false;
  }
}

async function startTracking() {
  if (!state.user) {
    setTrackerStatus("Sign in before starting.");
    return;
  }

  if (!("geolocation" in navigator)) {
    state.locationUnavailable = true;
    setTrackerStatus("This browser does not support GPS location.");
    renderBroadcastStatus();
    return;
  }

  if (state.watchId !== null) return;

  await requestWakeLock();
  state.permissionDenied = false;
  state.locationUnavailable = false;
  state.trackingStartedAt = Date.now();
  setTrackerStatus("Requesting GPS permission.");
  renderBroadcastStatus();

  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      state.lastPosition = position;
      state.lastPositionAt = Date.now();
      state.permissionDenied = false;
      state.locationUnavailable = false;
      renderPosition(position);
      renderBroadcastStatus();
      await sendPosition(position, "tracking");
    },
    async (error) => {
      setTrackerStatus(formatGeolocationError(error));
      if (error.code === error.PERMISSION_DENIED) {
        state.permissionDenied = true;
        state.trackingStartedAt = 0;
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        stopSendTimer();
        await releaseWakeLock();
      }
      renderBroadcastStatus();
      updateTrackingButtons();
    },
    {
      enableHighAccuracy: appSettings.highAccuracy,
      maximumAge: 15000,
      timeout: 60000
    }
  );

  startSendTimer();
  updateTrackingButtons();
}

async function stopTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  stopSendTimer();
  state.trackingStartedAt = 0;

  if (state.lastPosition && state.user) {
    await sendPosition(state.lastPosition, "stopped", true);
  }

  await releaseWakeLock();
  state.permissionDenied = false;
  renderBroadcastStatus();
  updateTrackingButtons();

  if (state.user) {
    setTrackerStatus("Tracking stopped.");
  }
}

async function sendPosition(position, status, force = false) {
  const now = Date.now();
  const throttleMs = getSendIntervalMs();

  if (!force && now - state.lastSentAt < throttleMs) return;

  const payload = buildLocationPayload(position, status);
  const { ref, set } = state.databaseSdk;

  try {
    await set(ref(state.db, `boats/${appSettings.boatId}/latest`), payload);
    state.lastSentAt = now;
    elements.lastSent.textContent = new Date(payload.timestamp).toLocaleTimeString();
    setTrackerStatus(status === "stopped" ? "Stopped location sent." : "Location sent.");
  } catch (error) {
    setTrackerStatus(formatFirebaseError(error));
  }
}

function buildLocationPayload(position, status) {
  const coords = position.coords;
  const payload = {
    lat: round(coords.latitude, 6),
    lng: round(coords.longitude, 6),
    accuracy: round(coords.accuracy, 1),
    timestamp: Date.now(),
    gpsTimestamp: Math.round(position.timestamp),
    updatedAtIso: new Date().toISOString(),
    status,
    trackerUid: state.user.uid
  };

  addNumberIfFinite(payload, "altitude", coords.altitude, 1);
  addNumberIfFinite(payload, "heading", coords.heading, 1);
  addNumberIfFinite(payload, "speed", coords.speed, 2);

  return payload;
}

function renderPosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  elements.currentCoordinates.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  elements.currentAccuracy.textContent = Number.isFinite(accuracy) ? `${Math.round(accuracy)} m` : "Unknown";
}

function startStatusTimer() {
  if (state.statusTimer) return;
  state.statusTimer = window.setInterval(renderBroadcastStatus, 1000);
}

function startSendTimer() {
  stopSendTimer();
  const intervalMs = getSendIntervalMs();
  state.sendTimer = window.setInterval(() => {
    if (state.watchId === null || !state.lastPosition || !state.user) return;
    sendPosition(state.lastPosition, "tracking", true);
  }, intervalMs);
}

function stopSendTimer() {
  if (!state.sendTimer) return;
  window.clearInterval(state.sendTimer);
  state.sendTimer = null;
}

function renderBroadcastStatus() {
  const isTracking = state.watchId !== null;
  const hasPosition = Boolean(state.lastPosition);
  const ageSeconds = hasPosition ? Math.max(0, Math.floor((Date.now() - state.lastPositionAt) / 1000)) : null;
  const ageMs = Number.isFinite(ageSeconds) ? ageSeconds * 1000 : Number.POSITIVE_INFINITY;
  const secondsSinceStart = state.trackingStartedAt
    ? Math.max(0, Math.floor((Date.now() - state.trackingStartedAt) / 1000))
    : 0;
  const secondsSinceStartMs = secondsSinceStart * 1000;

  if (hasPosition) {
    const { latitude, longitude } = state.lastPosition.coords;
    elements.broadcastCoordinates.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    elements.broadcastLastUpdated.textContent = `Last updated: ${formatElapsed(ageSeconds)}`;
  } else {
    elements.broadcastCoordinates.textContent = "Not available";
    elements.broadcastLastUpdated.textContent = "Not available";
  }

  if (state.permissionDenied) {
    setBroadcastMode(
      "is-warning",
      "Location Blocked",
      "NOT BROADCASTING",
      "Location permission was denied. Enable location permissions for this site, then start tracking again."
    );
    return;
  }

  if (state.locationUnavailable) {
    setBroadcastMode(
      "is-warning",
      "Location Unavailable",
      "NOT BROADCASTING",
      "This browser does not support GPS location. Use Safari, Chrome, or another browser with location services."
    );
    return;
  }

  if (isTracking && ((hasPosition && ageMs >= STATUS_THRESHOLDS_MS.stale) || (!hasPosition && secondsSinceStartMs >= STATUS_THRESHOLDS_MS.stale))) {
    setBroadcastMode(
      "is-offline",
      "Tracker Offline",
      "No fresh GPS update for more than 20 minutes.",
      "Check the phone battery, screen, cellular signal, and location permissions."
    );
    return;
  }

  if (isTracking && ((hasPosition && ageMs >= STATUS_THRESHOLDS_MS.recent) || (!hasPosition && secondsSinceStartMs >= STATUS_THRESHOLDS_MS.recent))) {
    setBroadcastMode(
      "is-stale",
      "Location Delayed",
      "Waiting for a fresh GPS update.",
      "If this continues, check the phone screen, cellular signal, and location permissions."
    );
    return;
  }

  if (isTracking && hasPosition && ageMs >= STATUS_THRESHOLDS_MS.live) {
    setBroadcastMode("is-recent", "Recently Updated", "GPS update is a little delayed, but tracking is still on.", "");
    return;
  }

  if (isTracking && hasPosition) {
    setBroadcastMode("is-live", "BROADCASTING LIVE", "Phone is actively sharing location.", "");
    return;
  }

  if (isTracking) {
    setBroadcastMode("is-off", "Starting GPS", "Waiting for the first location update.", "");
    return;
  }

  setBroadcastMode("is-off", "Tracking Off", "NOT BROADCASTING", "");
}

function setBroadcastMode(modeClass, label, message, warning) {
  elements.broadcastPanel.classList.remove("is-off", "is-live", "is-recent", "is-stale", "is-offline", "is-warning");
  elements.broadcastPanel.classList.add(modeClass);
  elements.broadcastLabel.textContent = label;
  elements.broadcastMessage.textContent = message;

  if (warning) {
    elements.broadcastWarning.hidden = false;
    elements.broadcastWarning.textContent = warning;
  } else {
    elements.broadcastWarning.hidden = true;
    elements.broadcastWarning.textContent = "";
  }
}

function setSignedInState(user) {
  const isSignedIn = Boolean(user);
  elements.authStatus.textContent = isSignedIn ? "Signed in" : "Signed out";
  elements.userUid.textContent = isSignedIn ? user.uid : "Not signed in";
  elements.signOutButton.disabled = !isSignedIn;
  elements.startButton.disabled = !isSignedIn || state.watchId !== null;
  elements.stopButton.disabled = state.watchId === null;
}

function setAuthControlsEnabled(isEnabled) {
  elements.email.disabled = !isEnabled;
  elements.password.disabled = !isEnabled;
  elements.signInButton.disabled = !isEnabled;
}

function updateTrackingButtons() {
  const isTracking = state.watchId !== null;
  elements.startButton.disabled = !state.user || isTracking;
  elements.stopButton.disabled = !isTracking;
}

function setAuthStatus(message) {
  elements.authStatus.textContent = message;
}

function setTrackerStatus(message) {
  elements.trackerStatus.textContent = message;
}

function formatElapsed(seconds) {
  if (!Number.isFinite(seconds)) return "Not available";
  if (seconds < 1) return "just now";
  if (seconds === 1) return "1 second ago";
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  return `${minutes} minutes ago`;
}

function getSendIntervalMs() {
  return Math.max(
    appSettings.minimumSendIntervalMs,
    Number(elements.sendInterval.value) * 1000 || appSettings.sendIntervalMs
  );
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || state.wakeLock) return;

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) return;

  try {
    await state.wakeLock.release();
  } catch {
    state.wakeLock = null;
  }
}

function addNumberIfFinite(target, key, value, digits) {
  if (Number.isFinite(value)) {
    target[key] = round(value, digits);
  }
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatFirebaseError(error) {
  if (error?.code === "PERMISSION_DENIED" || error?.message?.includes("Permission denied")) {
    return "Permission denied. Check the tracker UID in Firebase database rules data.";
  }

  if (error?.code === "auth/invalid-credential") {
    return "Email or password is incorrect.";
  }

  return error?.message || "Firebase error.";
}

function formatGeolocationError(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return "GPS permission was blocked.";
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return "GPS location is unavailable.";
  }

  if (error.code === error.TIMEOUT) {
    return "GPS timed out. Try again with a clear view of the sky.";
  }

  return "GPS error.";
}
