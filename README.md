# VeriTap — Secure NFC + Biometric Student Attendance

A mobile-first attendance system: students tap an NFC ID card, then verify
with their phone's own fingerprint/face (WebAuthn/passkeys). Attendance is
only marked when **both** checks pass. Raw biometric data never leaves the
student's device — this app only ever sees a cryptographic pass/fail result.

## Try it immediately (DEMO MODE)

No setup required. Open `index.html` in a browser (or serve the folder —
see below) and it runs entirely on an in-memory sample dataset:

- **Scanner** (`index.html`) — tap "Simulate tap" or one of the **Demo:** buttons
  under "Testing / fallback tools" to walk through the success, biometric-failure,
  unknown-card, duplicate, and offline flows.
- **Admin dashboard** (`admin.html`) — any email + any password signs in.
  Explore Overview, Students, Attendance, Sessions, Devices, Security Log and Settings.

A **DEMO MODE** badge appears on both screens whenever no live Firebase
project is configured, so demo data is never confused with the real thing.

### Run locally
Any static file server works — WebAuthn and Web NFC both require either
`localhost` or HTTPS:
```bash
npx serve .
# or
python3 -m http.server 8080
```

## Going live

See **`FIREBASE_SETUP.md`** for the full walkthrough: creating the Firebase
project, enabling Authentication/Firestore/Storage, deploying
`firestore.rules`, wiring up WebAuthn server-side verification, registering
your first admin and student, provisioning NFC cards, and deploying to
GitHub Pages.

## Project structure

```
index.html          Student scanner (PWA entry point)
admin.html           Administrator dashboard
privacy.html         Privacy & data-use page
manifest.json        PWA manifest
service-worker.js    Offline app-shell caching
firestore.rules      Firebase security rules (role-based access)
FIREBASE_SETUP.md     Full backend setup guide
css/
  styles.css          Shared design tokens (glassmorphism, dark/light)
  scanner.css          Scanner-screen styles
  admin.css            Dashboard styles
js/
  firebase.js          Firebase init + data-access layer (auto demo-mode fallback)
  demo-data.js          In-memory sample dataset for DEMO MODE
  nfc.js                Web NFC (NDEFReader) wrapper + testing fallback
  webauthn.js            WebAuthn/passkey registration & verification
  app.js                 Scanner screen state machine
  admin.js                Dashboard logic (auth, CRUD, charts, logs)
icons/                Simple SVG PWA icons
```

## Security notes

- No raw fingerprint/face data is ever requested, transmitted, or stored —
  see `js/webauthn.js` and the Privacy page for how this is enforced.
- `js/firebase.js` holds only the **public** Firebase web config. It must
  never contain a service-account key or Admin SDK credential — access
  control is enforced by `firestore.rules`, not by hiding this file.
- The recommended production pattern writes attendance and security-log
  entries through a Cloud Function (Admin SDK) rather than directly from
  the browser — see `FIREBASE_SETUP.md` step 5.
- This is a **multi-factor anti-proxy system**, not a claim of
  unbreakable security: NFC + on-device biometric + registered-credential
  matching + duplicate blocking + full audit logging, working together.
