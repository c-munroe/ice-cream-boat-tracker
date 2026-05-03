export const firebaseConfig = Object.freeze({
  apiKey: "PASTE_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "PASTE_FIREBASE_APP_ID"
});

export const appSettings = Object.freeze({
  boatId: "iceCreamBoat",
  boatName: "Ice Cream Boat",
  defaultCenter: { lat: 41.5801, lng: -71.4774 },
  defaultZoom: 12,
  staleAfterMinutes: 30,
  markerIcon: "Images/logo192.png",
  sendIntervalMs: 10000,
  minimumSendIntervalMs: 5000,
  highAccuracy: true
});

