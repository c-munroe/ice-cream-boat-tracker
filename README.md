# Ice Cream Boat Tracker

A free static live tracker for the ice cream boat. GitHub Pages hosts the public site, Firebase Realtime Database stores the latest location, and the tracker page sends GPS updates from a phone browser.

## What is included

- `index.html` - public map page that reads the latest boat location.
- `tracker.html` - phone tracker page that signs in and writes GPS updates.
- `js/config.js` - Firebase and boat settings to fill in.
- `firebase/database.rules.json` - recommended Realtime Database rules.
- `scripts/serve.py` - small Python helper for local testing.
- `Images/` - existing image and icon assets. These are reused as-is.

## Local setup

Requirements:

- A Firebase project on the free Spark plan.
- Python 3 for the local helper server.
- A GitHub account for GitHub Pages.

Start the local static server:

```sh
python3 scripts/serve.py --port 8000
```

Open:

- Public map: `http://127.0.0.1:8000/`
- Tracker page: `http://127.0.0.1:8000/tracker.html`

Local GPS testing works on `localhost` and `127.0.0.1`. On a real phone, use the final GitHub Pages HTTPS URL.

## Firebase setup

1. Go to the Firebase console and create a new project.
2. Stay on the free Spark plan.
3. Add a Web app to the Firebase project.
4. Copy the Web app config into `js/config.js`.
5. Open Build > Realtime Database.
6. Create a database. Choose the region closest to where the boat runs.
7. Open Build > Authentication > Sign-in method.
8. Enable Email/Password.
9. Add your boss as a user under Authentication > Users.
10. Copy that user's UID.
11. Open Realtime Database > Data.
12. Add this data:

```json
{
  "authorizedTrackers": {
    "PASTE_BOSS_FIREBASE_AUTH_UID": true
  }
}
```

13. Open Realtime Database > Rules.
14. Paste the contents of `firebase/database.rules.json`.
15. Publish the rules.

The public map can read only `boats/iceCreamBoat/latest`. The tracker page can write only when a signed-in Firebase Auth user is listed under `authorizedTrackers`.

## Firebase config

Edit `js/config.js`:

```js
export const firebaseConfig = Object.freeze({
  apiKey: "your-api-key",
  authDomain: "your-project-id.firebaseapp.com",
  databaseURL: "https://your-project-id-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  appId: "your-app-id"
});
```

Firebase Web config values are not passwords. The database rules are what protect writes.

You can also adjust the default map center in `appSettings.defaultCenter`.

## Boss workflow

1. Open the GitHub Pages tracker URL on the phone: `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/tracker.html`.
2. Sign in with the Firebase email and password.
3. Tap `Start tracking`.
4. Allow GPS permission.
5. Keep the page open while the boat is running.
6. Tap `Stop` at the end of the day.

The public map URL is:

```text
https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/
```

## GitHub Pages deployment

Initialize Git and make the first commit:

```sh
git init
git add .
git commit -m "Initial ice cream boat tracker"
```

Create an empty GitHub repository, then connect and push:

```sh
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Enable GitHub Pages:

1. Open the GitHub repository in a browser.
2. Go to Settings > Pages.
3. Under Build and deployment, choose `Deploy from a branch`.
4. Choose branch `main` and folder `/ (root)`.
5. Save.

GitHub will show the public URL after the first Pages build finishes.

## Database path

The tracker writes one record:

```text
boats/iceCreamBoat/latest
```

Example value:

```json
{
  "lat": 41.5801,
  "lng": -71.4774,
  "accuracy": 12,
  "timestamp": 1717000000000,
  "gpsTimestamp": 1717000000000,
  "updatedAtIso": "2026-05-03T20:00:00.000Z",
  "status": "tracking",
  "trackerUid": "firebase-auth-user-uid"
}
```

Only the latest point is stored. That keeps the free tier usage low and avoids building a cleanup job.

## Troubleshooting

`Add Firebase config in js/config.js`

The placeholder config is still in place. Copy the Web app config from Firebase into `js/config.js`, commit, and push.

`Permission denied`

The signed-in Firebase user is not listed under `authorizedTrackers`, or the rules were not published. Copy the UID shown on the tracker page and add `authorizedTrackers/UID: true` in Realtime Database.

Phone never asks for GPS

Use the HTTPS GitHub Pages URL. Mobile browsers block GPS on plain HTTP except for localhost.

Location stops updating

Keep the tracker page open and the phone charged. Battery saver mode, screen lock, or weak cellular service can pause browser GPS updates.

Map shows a stale location

The public map marks updates as stale after `staleAfterMinutes` in `js/config.js`. Start the tracker again from the phone to send a fresh location.

Map tiles do not load

The site uses free OpenStreetMap tiles through Leaflet. Check the network connection and try again.

## Useful commands

Run locally:

```sh
python3 scripts/serve.py --port 8000
```

Check files Git would commit:

```sh
git status --short
```

Commit changes:

```sh
git add .
git commit -m "Update tracker"
```

Push to GitHub:

```sh
git push
```
