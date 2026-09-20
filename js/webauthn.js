/* ============================================================
   /webauthn — passkey registration & assertion
   ------------------------------------------------------------
   The browser's WebAuthn API talks directly to the device's
   secure hardware (Secure Enclave / TEE / TPM). This code never
   sees a fingerprint image or template — only a signed
   cryptographic assertion proving the registered authenticator
   approved the request. That's what gets sent to the server;
   the fingerprint/face match itself happens entirely on-device.

   IMPORTANT — production requirement:
   The `challenge` used below MUST be generated server-side
   (Cloud Function) and the resulting attestation/assertion MUST
   be verified server-side before trusting it. This client-only
   version is for prototype/demo purposes. See FIREBASE_SETUP.md
   step 6 for wiring this to a verifying Cloud Function.
   ============================================================ */

const WebAuthnModule = {
  isSupported() {
    return window.PublicKeyCredential !== undefined;
  },

  async platformAuthenticatorAvailable() {
    if (!this.isSupported()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  _randomChallenge() {
    return crypto.getRandomValues(new Uint8Array(32));
  },

  /**
   * Registers a new passkey bound to this device for a student.
   * Returns { id, publicKey, registeredAt } — safe metadata only.
   */
  async registerCredential(studentId, studentName) {
    if (!this.isSupported()) throw new Error("WEBAUTHN_UNSUPPORTED");

    const publicKey = {
      challenge: this._randomChallenge(), // ⚠ replace with server-issued challenge in production
      rp: { name: "VeriTap Attendance" },
      user: {
        id: new TextEncoder().encode(studentId),
        name: studentName,
        displayName: studentName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // forces the phone's built-in biometric/PIN
        userVerification: "required",
      },
      timeout: 60000,
      attestation: "none",
    };

    const cred = await navigator.credentials.create({ publicKey });
    const meta = {
      id: cred.id,
      studentId,
      publicKey: btoa(String.fromCharCode(...new Uint8Array(cred.response.getPublicKey?.() || []))) || null,
      registeredAt: new Date().toISOString(),
    };
    return meta;
  },

  /**
   * Requests a biometric assertion to verify identity at scan time.
   * Returns true if the platform authenticator approved the request.
   * Server-side, you would additionally verify the signature against
   * the stored public key — never trust the client result alone in
   * a real deployment.
   */
  async verifyAssertion(credentialId) {
    if (!this.isSupported()) throw new Error("WEBAUTHN_UNSUPPORTED");

    const publicKey = {
      challenge: this._randomChallenge(), // ⚠ replace with server-issued challenge in production
      allowCredentials: credentialId
        ? [{ id: Uint8Array.from(atob(credentialId), c => c.charCodeAt(0)), type: "public-key" }]
        : [],
      userVerification: "required",
      timeout: 60000,
    };

    const assertion = await navigator.credentials.get({ publicKey });
    return Boolean(assertion);
  },

  // Demo-mode simulation — no real authenticator involved.
  simulateVerify(succeed = true) {
    return new Promise(resolve => setTimeout(() => resolve(succeed), 1100));
  },
};

window.WebAuthnModule = WebAuthnModule;
