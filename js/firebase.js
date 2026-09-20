/* ============================================================
   /firebase — initialization + thin data-access layer
   ------------------------------------------------------------
   Fill in firebaseConfig below with your own project's values
   (see FIREBASE_SETUP.md). Until you do, VeriTap runs fully in
   DEMO MODE using in-memory data — nothing touches a network.

   SECURITY: this file is public (it ships to every browser).
   It must never contain a service-account key or Admin SDK
   credential — only the public web-app config, which is safe
   to expose and is restricted by Firebase Security Rules
   (see /firestore.rules) rather than by secrecy.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyCdtaeHhSbCH2qSR07GDnBmFAtD9Tzcbo4",
  authDomain: "attendance-system-4eb27.firebaseapp.com",
  projectId: "attendance-system-4eb27",
  storageBucket: "attendance-system-4eb27.firebasestorage.app",
  messagingSenderId: "772692219393",
  appId: "1:772692219393:web:231e802836357eb412d200"
};

const IS_CONFIGURED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// Global flag other scripts check. True until a real config is supplied.
window.DEMO_MODE = !IS_CONFIGURED;

let app = null, auth = null, db = null, storage = null;

async function initFirebase() {
  if (!IS_CONFIGURED) {
    console.info("[VeriTap] No Firebase config found — running in DEMO MODE.");
    return null;
  }
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const stMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js");

    app = initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    storage = stMod.getStorage(app);

    window.__fb = { app, auth, db, storage, authMod, fsMod, stMod };
    window.DEMO_MODE = false;
    return window.__fb;
  } catch (err) {
    console.error("[VeriTap] Firebase failed to initialize — falling back to DEMO MODE.", err);
    window.DEMO_MODE = true;
    return null;
  }
}

// The scanner (a public device — no admin logged in) still needs to read
// student records and write attendance/security-log entries. Rather than
// leaving Firestore wide open to anyone, it signs in anonymously — a free,
// built-in Firebase Auth method that just proves "this is some real
// browser session," which the rules then check with isSignedIn(). This is
// a reasonable tradeoff for a no-backend class project; a real deployment
// would instead verify each write server-side via a Cloud Function.
async function ensureScannerAuth() {
  if (window.DEMO_MODE) return;
  try {
    const { signInAnonymously } = window.__fb.authMod;
    if (!window.__fb.auth.currentUser) {
      await signInAnonymously(window.__fb.auth);
    }
  } catch (err) {
    console.error("[VeriTap] Anonymous sign-in failed — scanner writes may be blocked by rules.", err);
  }
}
window.ensureScannerAuth = ensureScannerAuth;

/* ------------------------------------------------------------
   Data-access layer. Every function below has a demo (in-memory)
   path and a live (Firestore) path. UI code calls these without
   caring which mode is active.

   Firestore structure (see FIREBASE_SETUP.md for rules):
     /students/{studentId}
     /students/{studentId}/credentials/{credentialId}
     /attendance/{attendanceId}
     /sessions/{sessionId}
     /admins/{adminId}
     /devices/{deviceId}
     /securityLogs/{logId}
     /settings/{settingId}
   ------------------------------------------------------------ */

const DataStore = {

  async findStudentByNfc(nfcId) {
    if (window.DEMO_MODE) {
      return DemoData.students.find(s => s.nfcId === nfcId) || null;
    }
    const { collection, query, where, getDocs } = window.__fb.fsMod;
    const q = query(collection(window.__fb.db, "students"), where("nfcId", "==", nfcId));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async getStudent(id) {
    if (window.DEMO_MODE) return DemoData.students.find(s => s.id === id) || null;
    const { doc, getDoc } = window.__fb.fsMod;
    const d = await getDoc(doc(window.__fb.db, "students", id));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },

  async listStudents() {
    if (window.DEMO_MODE) return DemoData.students;
    const { collection, getDocs } = window.__fb.fsMod;
    const snap = await getDocs(collection(window.__fb.db, "students"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async upsertStudent(student) {
    if (window.DEMO_MODE) {
      const i = DemoData.students.findIndex(s => s.id === student.id);
      if (i >= 0) DemoData.students[i] = { ...DemoData.students[i], ...student };
      else DemoData.students.push({ id: student.id || `S${Date.now()}`, ...student });
      return true;
    }
    const { doc, setDoc } = window.__fb.fsMod;
    const id = student.id || crypto.randomUUID();
    await setDoc(doc(window.__fb.db, "students", id), student, { merge: true });
    return true;
  },

  async deleteStudent(id) {
    if (window.DEMO_MODE) {
      DemoData.students = DemoData.students.filter(s => s.id !== id);
      return true;
    }
    const { doc, deleteDoc } = window.__fb.fsMod;
    await deleteDoc(doc(window.__fb.db, "students", id));
    return true;
  },

  async recordAttendance(entry) {
    // entry: { studentId, sessionId, nfcResult, biometricResult, status, ts, deviceId }
    if (window.DEMO_MODE) {
      const rec = { id: `A${Date.now()}`, ...entry };
      DemoData.attendance.unshift(rec);
      return rec;
    }
    const { collection, addDoc, serverTimestamp } = window.__fb.fsMod;
    const ref = await addDoc(collection(window.__fb.db, "attendance"), {
      ...entry,
      ts: serverTimestamp(),
    });
    return { id: ref.id, ...entry };
  },

  async hasMarkedToday(studentId) {
    const today = new Date().toDateString();
    if (window.DEMO_MODE) {
      return DemoData.attendance.some(a => a.studentId === studentId &&
        new Date(a.ts).toDateString() === today && a.status !== "failed");
    }
    const { collection, query, where, getDocs } = window.__fb.fsMod;
    const q = query(collection(window.__fb.db, "attendance"), where("studentId", "==", studentId));
    const snap = await getDocs(q);
    return snap.docs.some(d => new Date(d.data().ts?.toDate?.() || d.data().ts).toDateString() === today);
  },

  async listAttendance() {
    if (window.DEMO_MODE) return DemoData.attendance;
    const { collection, getDocs, orderBy, query } = window.__fb.fsMod;
    const q = query(collection(window.__fb.db, "attendance"), orderBy("ts", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async logSecurityEvent(evt) {
    // evt: { type, result, actor, detail, deviceId }
    if (window.DEMO_MODE) {
      DemoData.securityLog.unshift({ id: `L${Date.now()}`, ts: new Date().toISOString(), ...evt });
      return true;
    }
    const { collection, addDoc, serverTimestamp } = window.__fb.fsMod;
    await addDoc(collection(window.__fb.db, "securityLogs"), { ...evt, ts: serverTimestamp() });
    return true;
  },

  async listSecurityLog() {
    if (window.DEMO_MODE) return DemoData.securityLog;
    const { collection, getDocs, orderBy, query } = window.__fb.fsMod;
    const q = query(collection(window.__fb.db, "securityLogs"), orderBy("ts", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getSettings() {
    if (window.DEMO_MODE) return DemoData.settings;
    const { doc, getDoc } = window.__fb.fsMod;
    const d = await getDoc(doc(window.__fb.db, "settings", "general"));
    return d.exists() ? d.data() : DemoData.settings;
  },

  async saveSettings(settings) {
    if (window.DEMO_MODE) { Object.assign(DemoData.settings, settings); return true; }
    const { doc, setDoc } = window.__fb.fsMod;
    await setDoc(doc(window.__fb.db, "settings", "general"), settings, { merge: true });
    return true;
  },

  async listStaff() {
    if (window.DEMO_MODE) return DemoData.admins;
    const { collection, getDocs } = window.__fb.fsMod;
    const snap = await getDocs(collection(window.__fb.db, "admins"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async upsertStaff(staff) {
    if (window.DEMO_MODE) {
      const i = DemoData.admins.findIndex(s => s.id === staff.id);
      if (i >= 0) DemoData.admins[i] = { ...DemoData.admins[i], ...staff };
      else DemoData.admins.push({ id: staff.id || `AD${Date.now()}`, ...staff });
      return true;
    }
    // NOTE: this only writes the staff *record* (name/email/role) to
    // Firestore. It does not create a sign-in account — that still has
    // to be added once in Firebase Console → Authentication → Users,
    // using the same email, then that user's UID should replace this
    // document's ID so the security rules recognize them on login.
    const { doc, setDoc } = window.__fb.fsMod;
    const id = staff.id || crypto.randomUUID();
    await setDoc(doc(window.__fb.db, "admins", id), staff, { merge: true });
    return true;
  },

  async deleteStaff(id) {
    if (window.DEMO_MODE) {
      DemoData.admins = DemoData.admins.filter(s => s.id !== id);
      return true;
    }
    const { doc, deleteDoc } = window.__fb.fsMod;
    await deleteDoc(doc(window.__fb.db, "admins", id));
    return true;
  },

  // ---- Live scan broadcast (for a second-screen / guest display) ----
  // Demo mode uses a plain in-memory value with a tiny pub/sub so it still
  // works for same-device testing; live mode uses a single shared Firestore
  // doc with a real-time listener, which is what makes the laptop update
  // the instant the phone taps a card.
  _liveScanListeners: [],

  async setLiveScan(data) {
    if (window.DEMO_MODE) {
      DemoData._liveScan = { ...data, ts: new Date().toISOString() };
      this._liveScanListeners.forEach(fn => fn(DemoData._liveScan));
      return;
    }
    const { doc, setDoc, serverTimestamp } = window.__fb.fsMod;
    await setDoc(doc(window.__fb.db, "liveScan", "current"), { ...data, ts: serverTimestamp() });
  },

  watchLiveScan(callback) {
    if (window.DEMO_MODE) {
      this._liveScanListeners.push(callback);
      if (DemoData._liveScan) callback(DemoData._liveScan);
      return () => { this._liveScanListeners = this._liveScanListeners.filter(fn => fn !== callback); };
    }
    const { doc, onSnapshot } = window.__fb.fsMod;
    return onSnapshot(doc(window.__fb.db, "liveScan", "current"), (snap) => {
      if (snap.exists()) callback(snap.data());
    });
  },

  // WebAuthn credential metadata — stored directly on the student record
  // (kept intentionally simple for a no-backend deployment; see
  // FIREBASE_SETUP.md for the Cloud-Function-verified subcollection
  // pattern recommended once you have a backend).
  async saveCredential(studentId, credentialMeta) {
    const patch = {
      hasCredential: true,
      credentialId: credentialMeta.id,
      credentialRegisteredAt: credentialMeta.registeredAt,
      pendingRegistrationToken: null,
    };
    if (window.DEMO_MODE) {
      const s = DemoData.students.find(s => s.id === studentId);
      if (s) Object.assign(s, patch);
      return true;
    }
    const { doc, updateDoc } = window.__fb.fsMod;
    await updateDoc(doc(window.__fb.db, "students", studentId), patch);
    return true;
  },

  async revokeCredential(studentId) {
    const patch = { hasCredential: false, credentialId: null, credentialRegisteredAt: null };
    if (window.DEMO_MODE) {
      const s = DemoData.students.find(s => s.id === studentId);
      if (s) Object.assign(s, patch);
      return true;
    }
    const { doc, updateDoc } = window.__fb.fsMod;
    await updateDoc(doc(window.__fb.db, "students", studentId), patch);
    return true;
  },

  // Issues a one-time token so a student can self-register their passkey
  // on their OWN phone via a link, without needing an admin login there.
  async issueRegistrationToken(studentId) {
    const token = crypto.randomUUID().slice(0, 10);
    if (window.DEMO_MODE) {
      const s = DemoData.students.find(s => s.id === studentId);
      if (s) s.pendingRegistrationToken = token;
      return token;
    }
    const { doc, updateDoc } = window.__fb.fsMod;
    await updateDoc(doc(window.__fb.db, "students", studentId), { pendingRegistrationToken: token });
    return token;
  },

  // Unauthenticated read used only by the self-registration link page.
  // Live mode relies on the Firestore rule that only allows this when
  // the doc currently has a pending token set.
  async getStudentForRegistration(studentId) {
    if (window.DEMO_MODE) return DemoData.students.find(s => s.id === studentId) || null;
    const { doc, getDoc } = window.__fb.fsMod;
    const d = await getDoc(doc(window.__fb.db, "students", studentId));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },

  // Completes self-registration: verifies the token matches, then writes
  // ONLY the credential fields and clears the token (single use). The
  // Firestore rule enforces this same shape server-side.
  async completeSelfRegistration(studentId, token, credentialMeta) {
    const student = await this.getStudentForRegistration(studentId);
    if (!student || student.pendingRegistrationToken !== token) return false;
    try {
      await this.saveCredential(studentId, credentialMeta);
      return true;
    } catch {
      return false;
    }
  },
};

window.VeriTapDB = DataStore;
window.initFirebase = initFirebase;
