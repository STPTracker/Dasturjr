/* ============================================================
   /scanner — scanner screen orchestration
   Flow: idle → nfc-found → biometric → success/failure → idle
   ============================================================ */

const Scanner = {
  currentStudent: null,
  currentSession: { id: "SESS-PHY-12A", subject: "Physics", class: "12-A", division: "A" },
  stopNfc: null,
  deviceId: "DEV-SCN-01",

  els: {},

  init() {
    this.els = {
      views: document.querySelectorAll(".stage-view"),
      clock: document.getElementById("clock"),
      dateLabel: document.getElementById("dateLabel"),
      onlineBadge: document.getElementById("onlineBadge"),
      offlineBanner: document.getElementById("offlineBanner"),
      nfcSupportNote: document.getElementById("nfcSupportNote"),
      studentCardNfc: document.getElementById("studentCardNfc"),
      studentCardBio: document.getElementById("studentCardBio"),
      bioAvatar: document.getElementById("bioAvatar"),
      verifyBtn: document.getElementById("verifyBtn"),
      resultIcon: document.getElementById("resultIcon"),
      resultTitle: document.getElementById("resultTitle"),
      resultName: document.getElementById("resultName"),
      resultTime: document.getElementById("resultTime"),
      resultMeta: document.getElementById("resultMeta"),
      chipNfc: document.getElementById("chipNfc"),
      chipBio: document.getElementById("chipBio"),
      failReason: document.getElementById("failReason"),
      demoBadge: document.getElementById("demoBadge"),
      simInput: document.getElementById("simNfcId"),
    };

    this.tickClock();
    setInterval(() => this.tickClock(), 1000 * 15);

    window.addEventListener("online", () => this.updateConnectivity());
    window.addEventListener("offline", () => this.updateConnectivity());
    this.updateConnectivity();

    if (window.DEMO_MODE) this.els.demoBadge.classList.remove("visually-hidden");

    if (!NfcModule.isSupported()) {
      this.els.nfcSupportNote.textContent = "NFC scanning is not supported on this device/browser. Use the fallback below for testing.";
      this.els.nfcSupportNote.style.display = "block";
    }

    document.getElementById("startScanBtn").addEventListener("click", () => this.beginNfcListen());
    document.getElementById("simulateTapBtn").addEventListener("click", () => this.runSimulatedTap());
    this.els.verifyBtn.addEventListener("click", () => this.runBiometricVerify());
    document.getElementById("cancelBioBtn").addEventListener("click", () => this.reset());
    document.querySelectorAll("[data-demo-outcome]").forEach(btn => {
      btn.addEventListener("click", () => this.runDemoOutcome(btn.dataset.demoOutcome));
    });

    this.goTo("idle");
    this.beginNfcListen();
  },

  tickClock() {
    const now = new Date();
    this.els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    this.els.dateLabel.textContent = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  },

  updateConnectivity() {
    const online = navigator.onLine;
    this.els.onlineBadge.className = `badge ${online ? "badge-online" : "badge-offline"}`;
    this.els.onlineBadge.innerHTML = `<span class="badge-dot"></span> ${online ? "ONLINE" : "OFFLINE"}`;
    this.els.offlineBanner.classList.toggle("show", !online);
  },

  goTo(view) {
    this.els.views.forEach(v => v.classList.toggle("active", v.dataset.view === view));
  },

  async beginNfcListen() {
    if (this.stopNfc) this.stopNfc();
    this.stopNfc = await NfcModule.startScan(
      (payload) => this.handleNfcPayload(payload),
      (err) => { /* silent — fallback UI already shown */ }
    );
  },

  runSimulatedTap() {
    const id = this.els.simInput.value.trim() || DemoData.students[0].nfcId;
    NfcModule.simulateTap(id, (payload) => this.handleNfcPayload(payload));
  },

  async handleNfcPayload(nfcId) {
    const student = await VeriTapDB.findStudentByNfc(nfcId);

    if (!student) {
      await VeriTapDB.logSecurityEvent({ type: "unregistered_card", result: "failed", actor: `Unknown card ${nfcId}`, deviceId: this.deviceId });
      return this.showFailure("Card verification failed.", "This ID card is not registered to any student.");
    }
    if (student.status !== "active") {
      return this.showFailure("Student not registered.", "This student's registration is inactive.");
    }
    const alreadyMarked = await VeriTapDB.hasMarkedToday(student.id);
    if (alreadyMarked) {
      return this.showFailure("Attendance already marked.", `${student.name} already checked in today.`);
    }

    this.currentStudent = student;
    this.renderStudentCards(student);
    this.setChip("chipNfc", "success");
    this.setChip("chipBio", "pending");
    this.goTo("found");
    VeriTapDB.setLiveScan({ stage: "found", name: student.name, studentId: student.studentId,
      rollNo: student.rollNo, class: student.class, division: student.division, photo: student.photo });
  },

  renderStudentCards(student) {
    const html = `
      <img src="${student.photo}" alt="">
      <div>
        <div class="s-name">${student.name}</div>
        <div class="s-meta">${student.studentId} · ${student.class} · Div ${student.division} · Roll ${student.rollNo}</div>
      </div>`;
    this.els.studentCardNfc.innerHTML = html;
    this.els.studentCardBio.innerHTML = html;
    this.els.bioAvatar.src = student.photo;
  },

  setChip(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("pending", state === "pending");
    el.innerHTML = state === "success"
      ? `✓ ${el.dataset.label}`
      : state === "failed"
      ? `✕ ${el.dataset.label}`
      : `… ${el.dataset.label}`;
  },

  async runBiometricVerify() {
    this.goTo("verifying");
    const student = this.currentStudent;
    VeriTapDB.setLiveScan({ stage: "verifying", name: student.name, studentId: student.studentId,
      rollNo: student.rollNo, class: student.class, division: student.division, photo: student.photo });
    let ok = false;

    try {
      if (window.DEMO_MODE || !WebAuthnModule.isSupported() || !student.hasCredential) {
        ok = await WebAuthnModule.simulateVerify(true);
      } else {
        ok = await WebAuthnModule.verifyAssertion(student.credentialId);
      }
    } catch (err) {
      ok = false;
    }

    if (ok) {
      this.setChip("chipBio", "success");
      await this.markAttendance(student, "success");
    } else {
      this.setChip("chipBio", "failed");
      await VeriTapDB.logSecurityEvent({ type: "failed_biometric", result: "failed", actor: student.name, deviceId: this.deviceId });
      this.showFailure("Identity verification failed.", "Biometric verification did not match the registered credential.");
    }
  },

  async markAttendance(student, biometricResult) {
    const now = new Date();
    const settings = await VeriTapDB.getSettings();
    const [h, m] = (settings.attendanceStart || "09:00").split(":").map(Number);
    const startMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const isLate = nowMinutes > startMinutes + (settings.lateThresholdMin || 15);

    const record = await VeriTapDB.recordAttendance({
      studentId: student.id,
      studentName: student.name,
      sessionId: this.currentSession.id,
      subject: this.currentSession.subject,
      class: student.class,
      division: student.division,
      nfcResult: "success",
      biometricResult,
      status: isLate ? "late" : "present",
      ts: now.toISOString(),
      deviceId: this.deviceId,
    });

    await VeriTapDB.logSecurityEvent({
      type: "attendance_marked", result: "success", actor: student.name, deviceId: this.deviceId,
    });

    this.els.resultIcon.className = "result-icon success";
    this.els.resultIcon.textContent = "✓";
    this.els.resultTitle.textContent = "ATTENDANCE MARKED";
    this.els.resultName.textContent = student.name;
    this.els.resultTime.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    this.els.resultMeta.textContent = `${this.currentSession.subject} · ${isLate ? "Late arrival" : "On time"}`;
    document.getElementById("resultAvatar").src = student.photo;
    this.goTo("success");

    VeriTapDB.setLiveScan({ stage: "success", name: student.name, studentId: student.studentId,
      rollNo: student.rollNo, class: student.class, division: student.division, photo: student.photo,
      time: this.els.resultTime.textContent, subject: this.currentSession.subject, late: isLate });

    setTimeout(() => this.reset(), 4500);
  },

  showFailure(title, detail) {
    this.els.resultIcon.className = "result-icon fail";
    this.els.resultIcon.textContent = "✕";
    document.getElementById("failTitle").textContent = title;
    this.els.failReason.textContent = detail;
    this.goTo("failure");
    VeriTapDB.setLiveScan({ stage: "failed", title, detail });
    setTimeout(() => this.reset(), 4000);
  },

  runDemoOutcome(kind) {
    const student = DemoData.students[Math.floor(Math.random() * 6)];
    switch (kind) {
      case "nfc-detected":
        this.handleNfcPayload(student.nfcId);
        break;
      case "bio-fail":
        this.currentStudent = student;
        this.renderStudentCards(student);
        this.goTo("found");
        setTimeout(async () => {
          this.goTo("verifying");
          this.setChip("chipNfc", "success");
          setTimeout(async () => {
            this.setChip("chipBio", "failed");
            await VeriTapDB.logSecurityEvent({ type: "failed_biometric", result: "failed", actor: student.name, deviceId: this.deviceId });
            this.showFailure("Identity verification failed.", "Biometric verification did not match the registered credential.");
          }, 900);
        }, 400);
        break;
      case "unknown-student":
        this.handleNfcPayload("NFC-UNKNOWN-CARD");
        break;
      case "duplicate":
        VeriTapDB.hasMarkedToday = async () => true;
        this.handleNfcPayload(student.nfcId);
        setTimeout(() => { delete VeriTapDB.hasMarkedToday; }, 10);
        break;
      case "offline":
        this.els.offlineBanner.classList.add("show");
        setTimeout(() => this.updateConnectivity(), 3500);
        break;
    }
  },

  reset() {
    this.currentStudent = null;
    this.setChip("chipNfc", "pending");
    this.setChip("chipBio", "pending");
    this.goTo("idle");
    VeriTapDB.setLiveScan({ stage: "idle" });
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  await window.initFirebase();
  await window.ensureScannerAuth?.();

  const params = new URLSearchParams(location.search);
  const registerId = params.get("register");
  const registerToken = params.get("token");

  if (registerId && registerToken) {
    return SelfRegister.init(registerId, registerToken);
  }

  Scanner.init();
});

/* ============================================================
   Self-registration — opened via a one-time link so each student
   registers their passkey on their OWN phone, not the admin's.
   ============================================================ */
const SelfRegister = {
  async init(studentId, token) {
    document.querySelectorAll(".stage-view").forEach(v => v.classList.remove("active"));
    const view = document.querySelector('[data-view="selfRegister"]');
    view.classList.add("active");

    const student = await VeriTapDB.getStudentForRegistration(studentId);
    const statusEl = document.getElementById("regStatus");
    const btn = document.getElementById("regRegisterBtn");

    if (!student || student.pendingRegistrationToken !== token) {
      document.getElementById("regStudentCard").innerHTML = "";
      document.querySelector('[data-view="selfRegister"] .stage-title').textContent = "Link expired or invalid";
      document.querySelector('[data-view="selfRegister"] .stage-hint').textContent =
        "Ask your administrator to send you a new registration link.";
      btn.style.display = "none";
      return;
    }

    document.getElementById("regStudentCard").innerHTML = `
      <img src="${student.photo}" alt="">
      <div>
        <div class="s-name">${student.name}</div>
        <div class="s-meta">${student.studentId} · ${student.class} · Div ${student.division}</div>
      </div>`;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      statusEl.textContent = "Follow your phone's fingerprint/face prompt…";
      statusEl.className = "text-secondary";
      document.getElementById("regFpIcon").classList.add("pulse");

      try {
        let meta;
        if (!WebAuthnModule.isSupported()) {
          meta = { id: `demo_${studentId}_${Date.now()}`, registeredAt: new Date().toISOString() };
          await WebAuthnModule.simulateVerify(true);
        } else {
          meta = await WebAuthnModule.registerCredential(studentId, student.name);
        }
        const ok = await VeriTapDB.completeSelfRegistration(studentId, token, meta);
        document.getElementById("regFpIcon").classList.remove("pulse");
        if (ok) {
          statusEl.textContent = "✓ Registered! You can now check in with this phone.";
          statusEl.className = "text-mint";
          btn.style.display = "none";
        } else {
          statusEl.textContent = "This link was already used or has expired. Ask for a new one.";
          statusEl.className = "text-red";
        }
      } catch (err) {
        document.getElementById("regFpIcon").classList.remove("pulse");
        statusEl.textContent = "Registration was cancelled or failed. Tap the button to try again.";
        statusEl.className = "text-red";
        btn.disabled = false;
      }
    });
  },
};
