# VeriTap — Firebase Setup & Deployment Guide

This turns the prototype (which runs in **DEMO MODE** out of the box, with no
backend) into a live system backed by Firebase. Do this only with proper
institutional authorization before enrolling real student biometrics
(see section 44 / the Privacy page in the app).

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it (e.g. `veritap-attendance`), disable Google Analytics unless you want it.
3. Once created, click the **web icon (</>)** to register a web app — this gives you the `firebaseConfig` object.
4. Paste that config into `js/firebase.js`, replacing the empty `firebaseConfig` object. As soon as `apiKey` and `projectId` are non-empty, the app automatically switches out of DEMO MODE.

> The web config (`apiKey`, `projectId`, etc.) is **public by design** — it is safe to ship in frontend code. It is not a secret; access control comes entirely from Firebase Security Rules, not from hiding this object. **Never** put a service-account JSON key or Admin SDK credential in any file under this repository.

## 2. Enable Authentication

1. In the console: **Build → Authentication → Get started**.
2. Enable the **Email/Password** provider (used for admin/teacher logins).
3. Also enable the **Anonymous** provider — the scanner (phone) uses this so it can read student records and write attendance without being an admin. This is required or the scanner will fail to mark attendance in live mode.
4. Under **Settings → Authorized domains**, add your GitHub Pages domain (e.g. `yourusername.github.io`).

## 3. Configure Firestore

1. **Build → Firestore Database → Create database**.
2. Start in **production mode** (the rules file below enforces access, so you don't need test mode).
3. Choose a region close to your users.
4. The app expects these top-level collections (created automatically the first time each is written to):
   ```
   /students/{studentId}
   /students/{studentId}/credentials/{credentialId}
   /attendance/{attendanceId}
   /sessions/{sessionId}
   /admins/{adminId}
   /devices/{deviceId}
   /securityLogs/{logId}
   /settings/{settingId}
   ```

## 4. Configure Firebase Storage

1. **Build → Storage → Get started**. Choose the same region as Firestore.
2. Student photos upload to a path like `student-photos/{studentId}.jpg`.
3. Recommended storage rules (Storage → Rules):
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /student-photos/{studentId} {
         allow read: if request.auth != null;
         allow write: if request.auth != null; // tighten to admin-only via a custom claim in production
       }
     }
   }
   ```

## 5. Deploy Firebase Security Rules

1. Install the CLI: `npm install -g firebase-tools`
2. `firebase login`
3. `firebase init firestore` (point it at this folder; when it asks for a rules file, use the included `firestore.rules`)
4. `firebase deploy --only firestore:rules`

The included `firestore.rules` denies all direct client writes to `/attendance` and `/securityLogs` by default — the recommended production pattern routes those writes through a **Cloud Function** using the Admin SDK, so a compromised or modified client can never fabricate attendance or erase log entries. See the comments inside `firestore.rules` for the (weaker) alternative if you want the scanner to write directly instead.

## 6. Configure WebAuthn / passkeys

`js/webauthn.js` implements registration (`navigator.credentials.create`) and verification (`navigator.credentials.get`) using the **platform authenticator** (the phone's own fingerprint/face/PIN) so biometric processing never leaves the device.

For a real deployment you should add a small Cloud Function pair:
- `generateChallenge` — issues a random, server-tracked challenge before registration/verification (replacing the client-generated one currently in `webauthn.js`, which is fine for a prototype but not for production).
- `verifyAssertion` — verifies the signed assertion against the stored public key server-side before your attendance-writing function accepts it.

A library like [`@simplewebauthn/server`](https://simplewebauthn.dev/) inside a Cloud Function handles this verification for you.

WebAuthn requires a **secure context** — HTTPS or `localhost`. GitHub Pages serves over HTTPS by default, so this works out of the box once deployed.

## 7. Register the first administrator

Since `/admins/{uid}` is required for the security rules to recognize an admin:

1. In Firebase Console → Authentication, manually add a user (email + password) for yourself.
2. Copy that user's UID.
3. In Firestore, create a document at `/admins/{that-uid}` with:
   ```json
   { "email": "you@college.edu", "role": "super_admin", "name": "Your Name" }
   ```
4. You can now sign in through `admin.html` with that email/password.

## 8. Register the first student

Use **Admin Dashboard → Students → Add student**, or the setup wizard on first run. Fill in identity fields, then have the student complete WebAuthn registration on their own phone (Section 9 of the spec / the registration flow in the app) so a passkey is bound to their device before their first real scan.

## 9. Configure NFC cards

Web NFC (`NDEFReader`, used in `js/nfc.js`) only works in **Chrome on Android**, over HTTPS. To provision a card:
1. Write a small NDEF text record containing the student's unique NFC identifier onto each card (any NFC-writer app, e.g. "NFC Tools", can do this), **or** simply use the physical tag's hardware serial number — `js/nfc.js` falls back to that automatically if no text record is present.
2. Enter that same identifier in the student's **NFC card ID** field in the admin panel.
3. iOS Safari and desktop browsers have no Web NFC support — the app detects this and shows the labeled testing fallback instead; never treat that fallback as equivalent to a real tap in production (see spec section 42).

## 10. Deploy the frontend to GitHub Pages

1. Push this folder to a GitHub repository.
2. Repo → **Settings → Pages** → Source: deploy from a branch → pick `main` and `/ (root)`.
3. Your site will be live at `https://yourusername.github.io/your-repo/`.
4. Add that exact domain to Firebase Authentication's **Authorized domains** (step 2 above) or sign-in will fail.
5. Confirm HTTPS is active (GitHub Pages provides this automatically) — required for both WebAuthn and Web NFC.

---

## Before going live: a final credential check

Search your repository for anything that looks like a private key before pushing:
```bash
grep -ril "private_key" .
grep -ril "BEGIN PRIVATE KEY" .
```
Only the public `firebaseConfig` values belong in this codebase. Service-account keys belong only in a Cloud Functions environment or a secrets manager — never in anything served to a browser.

## What's demo vs. production-ready here

| Area | This prototype | For production |
|---|---|---|
| Data | In-memory demo dataset (`js/demo-data.js`) until Firebase is configured | Real Firestore collections |
| Attendance writes | Direct client write (demo) | Route through a Cloud Function that validates NFC + WebAuthn server-side |
| WebAuthn challenge | Generated client-side | Generate & verify server-side |
| Offline queue | Basic online/offline banner + service-worker shell cache | Add an IndexedDB queue that syncs on reconnect and de-duplicates by a client-generated idempotency key |
| CSV bulk import | UI placeholder | Add a script/Cloud Function that validates rows and calls `upsertStudent` per row |
