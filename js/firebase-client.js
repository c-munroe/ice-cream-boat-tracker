import { firebaseConfig } from "./config.js";

const FIREBASE_VERSION = "10.12.5";

export function hasFirebaseConfig() {
  const requiredValues = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.databaseURL,
    firebaseConfig.projectId,
    firebaseConfig.appId
  ];

  return requiredValues.every((value) => {
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      !value.includes("PASTE_") &&
      !value.includes("YOUR_PROJECT_ID")
    );
  });
}

export async function createFirebaseApp() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase config is not set in js/config.js.");
  }

  const { initializeApp, getApp, getApps } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`
  );

  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export async function createDatabase() {
  const app = await createFirebaseApp();
  const { getDatabase } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`
  );

  return getDatabase(app);
}

export async function createAuth() {
  const app = await createFirebaseApp();
  const { getAuth } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`
  );

  return getAuth(app);
}

export async function loadDatabaseSdk() {
  return import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`);
}

export async function loadAuthSdk() {
  return import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
}

