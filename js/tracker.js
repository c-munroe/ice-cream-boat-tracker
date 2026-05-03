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
  currentCoordinates: document.querySelector("#currentCoordinates"),
  currentAccuracy: document.querySelector("#currentAccuracy"),
  lastSent: document.querySelector("#lastSent"),
  userUid: document.querySelector("#userUid")
};

const state = {
  auth: null,
  db: null,
  databaseSdk: null,
  authSdk: null,
  user: null,
  watchId: null,
  lastPosition: null,
  lastSentAt: 0,
  wakeLock: null
};

const storedEmail = window.localStorage.getItem("iceCreamBoatTrackerEmail");
if (storedEmail) elements.email.value = storedEmail;

initTracker();

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
    setTrackerStatus("This browser does not support GPS location.");
    return;
  }

  if (state.watchId !== null) return;

  await requestWakeLock();
  setTrackerStatus("Requesting GPS permission.");

  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      state.lastPosition = position;
      renderPosition(position);
      await sendPosition(position, "tracking");
    },
    async (error) => {
      setTrackerStatus(formatGeolocationError(error));
      if (error.code === error.PERMISSION_DENIED) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        await releaseWakeLock();
      }
      updateTrackingButtons();
    },
    {
      enableHighAccuracy: appSettings.highAccuracy,
      maximumAge: 5000,
      timeout: 20000
    }
  );

  updateTrackingButtons();
}

async function stopTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  if (state.lastPosition && state.user) {
    await sendPosition(state.lastPosition, "stopped", true);
  }

  await releaseWakeLock();
  updateTrackingButtons();

  if (state.user) {
    setTrackerStatus("Tracking stopped.");
  }
}

async function sendPosition(position, status, force = false) {
  const now = Date.now();
  const throttleMs = Math.max(
    appSettings.minimumSendIntervalMs,
    Number(elements.sendInterval.value) * 1000 || appSettings.sendIntervalMs
  );

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
