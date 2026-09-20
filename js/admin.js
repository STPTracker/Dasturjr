/* ============================================================
   /admin — dashboard logic
   ============================================================ */

const Admin = {
  currentUser: null, // { email, role }
  state: { students: [], attendance: [], log: [], settings: {}, staff: [] },

  async init() {
    await window.initFirebase();
    this.wireLogin();
    this.wireNav();
    this.wireModals();
    document.getElementById("demoBadgeAdmin")?.classList.toggle("visually-hidden", !window.DEMO_MODE);

    // Auto-login shortcut in demo mode isn't automatic — admin still "logs in"
    // to demonstrate the auth flow, but any email/password is accepted below.
  },

  /* ---------------- AUTH ---------------- */
  wireLogin() {
    const form = document.getElementById("loginForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const pass = document.getElementById("loginPassword").value;
      const errEl = document.getElementById("loginError");
      errEl.textContent = "";

      if (window.DEMO_MODE) {
        if (!email || !pass) { errEl.textContent = "Enter an email and password to continue (demo accepts any values)."; return; }
        this.currentUser = { email, role: "super_admin", name: email.split("@")[0] };
        await VeriTapDB.logSecurityEvent({ type: "admin_login", result: "success", actor: email });
        return this.enterDashboard();
      }

      try {
        const { signInWithEmailAndPassword } = window.__fb.authMod;
        const cred = await signInWithEmailAndPassword(window.__fb.auth, email, pass);
        this.currentUser = { email: cred.user.email, role: "admin", name: cred.user.email.split("@")[0] };
        await VeriTapDB.logSecurityEvent({ type: "admin_login", result: "success", actor: email });
        this.enterDashboard();
      } catch (err) {
        errEl.textContent = "Sign-in failed. Check your credentials.";
      }
    });
  },

  async enterDashboard() {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("dashboardShell").style.display = "flex";
    document.getElementById("currentUserName").textContent = this.currentUser.name;
    document.getElementById("currentUserRole").textContent = this.currentUser.role.replace("_", " ");
    await this.refreshAll();
    this.renderOverview();
    this.startLiveRefresh();
  },

  // Polls Firestore every few seconds so the dashboard updates on its own —
  // handy for demos where attendance is being marked live on another device.
  startLiveRefresh() {
    if (this._liveRefreshTimer) clearInterval(this._liveRefreshTimer);
    this._liveRefreshTimer = setInterval(async () => {
      if (!this.currentUser) return;
      const active = document.querySelector(".panel.active")?.id;
      await this.refreshAll();
      if (active === "panel-overview") this.renderOverview();
      if (active === "panel-attendance") this.renderAttendance();
      if (active === "panel-security") this.renderSecurityLog();
      if (active === "panel-students") this.renderStudents();
    }, 4000);
  },

  logout() {
    if (this._liveRefreshTimer) clearInterval(this._liveRefreshTimer);
    this.currentUser = null;
    document.getElementById("dashboardShell").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
  },

  /* ---------------- NAV ---------------- */
  wireNav() {
    document.querySelectorAll(".nav-item[data-panel]").forEach(item => {
      item.addEventListener("click", () => this.showPanel(item.dataset.panel));
    });
    document.getElementById("logoutBtn").addEventListener("click", () => this.logout());
    document.getElementById("themeToggleAdmin").addEventListener("click", () => {
      const root = document.documentElement;
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      localStorage.setItem("veritap-theme", next);
    });
  },

  async showPanel(name) {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.panel === name));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === `panel-${name}`));
    const heading = document.getElementById("panelHeading");
    if (heading) heading.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    if (name === "students") this.renderStudents();
    if (name === "staff") this.renderStaff();
    if (name === "attendance") this.renderAttendance();
    if (name === "security") this.renderSecurityLog();
    if (name === "settings") this.renderSettings();
    if (name === "sessions") this.renderSessions();
    if (name === "devices") this.renderDevices();
    if (name === "overview") this.renderOverview();
  },

  async refreshAll() {
    this.state.students = await VeriTapDB.listStudents();
    this.state.attendance = await VeriTapDB.listAttendance();
    this.state.log = await VeriTapDB.listSecurityLog();
    this.state.settings = await VeriTapDB.getSettings();
    this.state.staff = await VeriTapDB.listStaff();
  },

  /* ---------------- OVERVIEW ---------------- */
  renderOverview() {
    const total = this.state.students.length;
    const todayRecords = this.state.attendance.filter(a => new Date(a.ts).toDateString() === new Date().toDateString());
    const present = todayRecords.filter(a => a.status === "present" || a.status === "late").length;
    const late = todayRecords.filter(a => a.status === "late").length;
    const failed = todayRecords.filter(a => a.status === "failed").length;
    const absent = Math.max(total - present, 0);
    const pct = total ? ((present / total) * 100).toFixed(1) : "0.0";

    const kpis = [
      { label: "Total students", value: total },
      { label: "Present today", value: present, cls: "text-mint" },
      { label: "Absent today", value: absent, cls: "text-red" },
      { label: "Late arrivals", value: late, cls: "text-amber" },
      { label: "Attendance %", value: pct + "%" },
      { label: "Failed verifications", value: failed, cls: "text-red" },
    ];
    document.getElementById("kpiGrid").innerHTML = kpis.map(k => `
      <div class="kpi-card glass">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls || ""}">${k.value}</div>
      </div>`).join("");

    this.drawDonut(present, absent);
    this.drawWeekly();
  },

  drawDonut(present, absent) {
    const total = present + absent || 1;
    const presentPct = present / total;
    const r = 60, c = 2 * Math.PI * r;
    const presentLen = c * presentPct;
    const svg = `
      <svg width="170" height="170" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--border)" stroke-width="18"/>
        <circle cx="85" cy="85" r="${r}" fill="none" stroke="#34D399" stroke-width="18"
          stroke-dasharray="${presentLen} ${c - presentLen}" stroke-linecap="round"
          transform="rotate(-90 85 85)"/>
        <text x="85" y="80" text-anchor="middle" font-family="Space Grotesk" font-size="26" font-weight="700" fill="var(--text-primary)">${((present/total)*100).toFixed(0)}%</text>
        <text x="85" y="100" text-anchor="middle" font-family="Inter" font-size="11" fill="var(--text-secondary)">present</text>
      </svg>`;
    document.getElementById("donutChart").innerHTML = svg;
    document.getElementById("donutLegend").innerHTML = `
      <div class="legend-row"><span class="legend-dot" style="background:#34D399"></span> Present — ${present}</div>
      <div class="legend-row"><span class="legend-dot" style="background:var(--border)"></span> Absent — ${absent}</div>`;
  },

  drawWeekly() {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const vals = days.map(() => 60 + Math.round(Math.random() * 35));
    const max = 100, w = 320, h = 110, bw = w / days.length;
    const bars = vals.map((v, i) => {
      const bh = (v / max) * (h - 20);
      return `<rect x="${i * bw + 10}" y="${h - bh}" width="${bw - 16}" height="${bh}" rx="6" fill="url(#g1)"></rect>
              <text x="${i * bw + bw/2 - 3}" y="${h + 14}" font-size="10" fill="var(--text-secondary)" font-family="Inter">${days[i]}</text>`;
    }).join("");
    document.getElementById("weeklyChart").innerHTML = `
      <svg width="100%" height="140" viewBox="0 0 ${w} ${h + 18}">
        <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5B8DEF"/><stop offset="100%" stop-color="#34D399"/>
        </linearGradient></defs>
        ${bars}
      </svg>`;
  },

  /* ---------------- STUDENTS ---------------- */
  renderStudents(filter = {}) {
    let rows = this.state.students;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(s => [s.name, s.studentId, s.rollNo, s.prn].join(" ").toLowerCase().includes(q));
    }
    if (filter.class) rows = rows.filter(s => s.class === filter.class);

    document.getElementById("studentsTbody").innerHTML = rows.map(s => `
      <tr>
        <td><img class="row-avatar" src="${s.photo}" alt=""></td>
        <td>${s.name}</td>
        <td>${s.studentId}</td>
        <td>${s.class} / ${s.division}</td>
        <td>${s.hasCredential ? '<span class="status-chip status-present">Registered</span>' : '<span class="status-chip status-fail">No passkey</span>'}</td>
        <td>${s.status === "active" ? '<span class="status-chip status-present">Active</span>' : '<span class="status-chip status-absent">Inactive</span>'}</td>
        <td>
          <button class="icon-btn" data-edit="${s.id}" title="Edit" aria-label="Edit ${s.name}">✎</button>
          <button class="icon-btn" data-revoke="${s.id}" title="Revoke NFC card" aria-label="Revoke card">🚫</button>
          <button class="icon-btn" data-delete="${s.id}" title="Delete" aria-label="Delete ${s.name}">🗑</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="7" class="text-secondary" style="padding:20px;">No students match.</td></tr>`;

    document.getElementById("classFilter").innerHTML = `<option value="">All classes</option>` +
      [...new Set(this.state.students.map(s => s.class))].map(c => `<option>${c}</option>`).join("");

    document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => this.openStudentModal(b.dataset.edit));
    document.querySelectorAll("[data-delete]").forEach(b => b.onclick = () => this.confirmDeleteStudent(b.dataset.delete));
    document.querySelectorAll("[data-revoke]").forEach(b => b.onclick = () => this.revokeCard(b.dataset.revoke));
  },

  openStudentModal(id = null) {
    const s = id ? this.state.students.find(x => x.id === id) : null;
    document.getElementById("studentModalTitle").textContent = s ? "Edit student" : "Add new student";
    const f = document.getElementById("studentForm");
    f.reset();
    f.dataset.id = s?.id || "";
    document.getElementById("nfcScanStatus").textContent = "";
    if (s) {
      f.name.value = s.name; f.studentId.value = s.studentId; f.rollNo.value = s.rollNo;
      f.prn.value = s.prn; f.class.value = s.class; f.division.value = s.division;
      f.course.value = s.course; f.nfcId.value = s.nfcId;
    }
    // Passkey registration only makes sense once a student record exists.
    const wrap = document.getElementById("passkeyFieldWrap");
    const chip = document.getElementById("passkeyStatusChip");
    if (s) {
      wrap.style.display = "block";
      if (s.hasCredential) { chip.textContent = "✓ Passkey registered"; chip.className = "status-chip status-present"; }
      else { chip.textContent = "No passkey yet"; chip.className = "status-chip status-fail"; }
    } else {
      wrap.style.display = "none";
    }
    document.getElementById("studentModal").classList.add("show");
  },

  wireModals() {
    document.getElementById("addStudentBtn").addEventListener("click", () => this.openStudentModal());
    document.getElementById("addStaffBtn")?.addEventListener("click", () => this.openStaffModal());
    document.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", (e) => {
      e.target.closest(".modal-backdrop").classList.remove("show");
    }));

    document.getElementById("studentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const id = f.dataset.id || undefined;
      const existing = id ? this.state.students.find(s => s.id === id) : null;
      const student = {
        id, name: f.name.value, studentId: f.studentId.value, rollNo: f.rollNo.value,
        prn: f.prn.value, class: f.class.value, division: f.division.value, course: f.course.value,
        department: f.course.value, academicYear: this.state.settings.academicYear || "2026-27",
        nfcId: f.nfcId.value || `NFC-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
        photo: existing?.photo || `https://i.pravatar.cc/160?img=${Math.floor(Math.random() * 70) + 1}`,
        status: "active",
        hasCredential: existing?.hasCredential || false,
        credentialId: existing?.credentialId || null,
        credentialRegisteredAt: existing?.credentialRegisteredAt || null,
      };
      await VeriTapDB.upsertStudent(student);
      await VeriTapDB.logSecurityEvent({ type: "student_edit", result: "success", actor: this.currentUser.email, detail: student.name });
      document.getElementById("studentModal").classList.remove("show");
      await this.refreshAll();
      this.renderStudents();
      this.toast(`Saved ${student.name}.`);
    });

    document.getElementById("staffForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const staff = {
        id: f.dataset.id || undefined,
        name: f.name.value, email: f.email.value, role: f.role.value,
        assignedClass: f.role.value === "teacher" ? f.assignedClass.value : "",
      };
      await VeriTapDB.upsertStaff(staff);
      await VeriTapDB.logSecurityEvent({ type: "admin_edit", result: "success", actor: this.currentUser.email, detail: staff.email });
      document.getElementById("staffModal").classList.remove("show");
      await this.refreshAll();
      this.renderStaff();
      this.toast(`Saved ${staff.name}. Remember to add their sign-in in Firebase Authentication too.`);
    });

    // ---- In-modal NFC card scan ----
    let stopModalNfc = null;
    document.getElementById("scanNfcModalBtn")?.addEventListener("click", async () => {
      const statusEl = document.getElementById("nfcScanStatus");
      const nfcInput = document.getElementById("studentForm").nfcId;
      if (!NfcModule.isSupported()) {
        statusEl.textContent = "Web NFC isn't supported on this browser/device — type the card ID manually, or use Chrome on Android.";
        statusEl.className = "text-amber";
        return;
      }
      statusEl.textContent = "Hold the card near the back of this phone…";
      statusEl.className = "text-secondary";
      if (stopModalNfc) stopModalNfc();
      stopModalNfc = await NfcModule.startScan(
        (id) => {
          nfcInput.value = id;
          statusEl.textContent = `✓ Card detected: ${id}`;
          statusEl.className = "text-mint";
          if (stopModalNfc) stopModalNfc();
        },
        () => {
          statusEl.textContent = "Couldn't read a card — try again.";
          statusEl.className = "text-red";
        }
      );
    });

    // ---- Self-registration link (recommended path) ----
    document.getElementById("copyRegLinkBtn")?.addEventListener("click", async () => {
      const f = document.getElementById("studentForm");
      const studentId = f.dataset.id;
      if (!studentId) return this.toast("Save the student first, then generate their link.");
      const token = await VeriTapDB.issueRegistrationToken(studentId);
      const url = `${location.origin}${location.pathname.replace(/admin\.html$/, "index.html")}?register=${studentId}&token=${token}`;
      try {
        await navigator.clipboard.writeText(url);
        this.toast("Link copied — send it to the student to open on their own phone.");
      } catch {
        prompt("Copy this link and send it to the student:", url);
      }
    });

    // ---- In-modal biometric (passkey) registration ----
    document.getElementById("registerPasskeyBtn")?.addEventListener("click", async () => {
      const f = document.getElementById("studentForm");
      const studentId = f.dataset.id;
      const student = this.state.students.find(s => s.id === studentId);
      if (!student) return this.toast("Save the student first, then register their passkey.");
      const chip = document.getElementById("passkeyStatusChip");
      chip.textContent = "Waiting for fingerprint/face…";

      try {
        let meta;
        if (window.DEMO_MODE || !WebAuthnModule.isSupported()) {
          await WebAuthnModule.simulateVerify(true);
          meta = { id: `demo_cred_${studentId}`, registeredAt: new Date().toISOString() };
        } else {
          meta = await WebAuthnModule.registerCredential(studentId, student.name);
        }
        await VeriTapDB.saveCredential(studentId, meta);
        await VeriTapDB.logSecurityEvent({ type: "credential_registration", result: "success", actor: this.currentUser.email, detail: student.name });
        chip.textContent = "✓ Passkey registered";
        chip.className = "status-chip status-present";
        await this.refreshAll();
        this.toast(`Fingerprint/face registered for ${student.name}.`);
      } catch (err) {
        chip.textContent = "Registration failed";
        chip.className = "status-chip status-fail";
        this.toast("Passkey registration failed or was cancelled.");
      }
    });

    document.getElementById("studentSearch")?.addEventListener("input", (e) => this.renderStudents({ q: e.target.value }));
    document.getElementById("classFilter")?.addEventListener("change", (e) => this.renderStudents({ class: e.target.value }));
    document.getElementById("statusFilter")?.addEventListener("change", (e) => this.renderAttendance({ status: e.target.value }));
    document.getElementById("importCsvBtn")?.addEventListener("click", () => this.toast("CSV import: see FIREBASE_SETUP.md for the bulk-import script template."));

    // Settings form
    document.getElementById("settingsForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      await VeriTapDB.saveSettings({
        collegeName: f.collegeName.value,
        academicYear: f.academicYear.value,
        attendanceStart: f.attendanceStart.value,
        lateThresholdMin: Number(f.lateThresholdMin.value),
        closeThresholdMin: Number(f.closeThresholdMin.value),
        lowAttendanceAlert: Number(f.lowAttendanceAlert.value),
      });
      await VeriTapDB.logSecurityEvent({ type: "settings_changed", result: "success", actor: this.currentUser.email });
      this.toast("Settings saved.");
    });
  },

  async confirmDeleteStudent(id) {
    const s = this.state.students.find(x => x.id === id);
    if (!confirm(`Delete ${s.name}? This cannot be undone. Type OK to confirm.`)) return;
    await VeriTapDB.deleteStudent(id);
    await VeriTapDB.logSecurityEvent({ type: "student_deleted", result: "success", actor: this.currentUser.email, detail: s.name });
    await this.refreshAll();
    this.renderStudents();
    this.toast(`${s.name} deleted.`);
  },

  async revokeCard(id) {
    const s = this.state.students.find(x => x.id === id);
    if (!confirm(`Revoke NFC card for ${s.name}?`)) return;
    await VeriTapDB.logSecurityEvent({ type: "credential_revocation", result: "success", actor: this.currentUser.email, detail: s.name });
    this.toast(`Card revoked for ${s.name}.`);
  },

  /* ---------------- STAFF (TEACHERS & ADMINS) ---------------- */
  renderStaff() {
    const roleLabel = { super_admin: "Super Admin", admin: "Admin", teacher: "Teacher" };
    document.getElementById("staffTbody").innerHTML = this.state.staff.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.email}</td>
        <td><span class="status-chip ${s.role === 'teacher' ? 'status-late' : 'status-present'}">${roleLabel[s.role] || s.role}</span></td>
        <td>${s.assignedClass || "—"}</td>
        <td>
          <button class="icon-btn" data-edit-staff="${s.id}" title="Edit" aria-label="Edit ${s.name}">✎</button>
          <button class="icon-btn" data-delete-staff="${s.id}" title="Remove" aria-label="Remove ${s.name}">🗑</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="text-secondary" style="padding:20px;">No teachers or admins added yet.</td></tr>`;

    document.querySelectorAll("[data-edit-staff]").forEach(b => b.onclick = () => this.openStaffModal(b.dataset.editStaff));
    document.querySelectorAll("[data-delete-staff]").forEach(b => b.onclick = () => this.confirmDeleteStaff(b.dataset.deleteStaff));
  },

  openStaffModal(id = null) {
    const s = id ? this.state.staff.find(x => x.id === id) : null;
    document.getElementById("staffModalTitle").textContent = s ? "Edit teacher / admin" : "Add teacher / admin";
    const f = document.getElementById("staffForm");
    f.reset();
    f.dataset.id = s?.id || "";
    if (s) {
      f.name.value = s.name; f.email.value = s.email; f.role.value = s.role;
      f.assignedClass.value = s.assignedClass || "";
    }
    document.getElementById("staffModal").classList.add("show");
  },

  async confirmDeleteStaff(id) {
    const s = this.state.staff.find(x => x.id === id);
    if (!confirm(`Remove ${s.name} from staff?`)) return;
    await VeriTapDB.deleteStaff(id);
    await VeriTapDB.logSecurityEvent({ type: "admin_removed", result: "success", actor: this.currentUser.email, detail: s.name });
    await this.refreshAll();
    this.renderStaff();
    this.toast(`${s.name} removed.`);
  },

  /* ---------------- ATTENDANCE ---------------- */
  renderAttendance(filter = {}) {
    let rows = this.state.attendance;
    if (filter.status) rows = rows.filter(r => r.status === filter.status);
    document.getElementById("attendanceTbody").innerHTML = rows.map(r => {
      const s = this.state.students.find(x => x.id === r.studentId);
      return `<tr>
        <td><img class="row-avatar" src="${s?.photo || ''}" alt=""></td>
        <td>${r.studentName}</td>
        <td>${s?.studentId || "—"}</td>
        <td>${new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${r.nfcResult === "success" ? "✓" : "✕"}</td>
        <td>${r.biometricResult === "success" ? "✓" : "✕"}</td>
        <td><span class="status-chip status-${r.status}">${r.status}</span></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="text-secondary" style="padding:20px;">No attendance records yet.</td></tr>`;
  },

  exportAttendanceCsv() {
    const header = "Name,StudentID,Time,NFC,Biometric,Status\n";
    const rows = this.state.attendance.map(r => {
      const s = this.state.students.find(x => x.id === r.studentId);
      return [r.studentName, s?.studentId, new Date(r.ts).toLocaleString(), r.nfcResult, r.biometricResult, r.status].join(",");
    }).join("\n");
    this.downloadFile("attendance.csv", header + rows, "text/csv");
  },

  downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  },

  /* ---------------- SECURITY LOG ---------------- */
  renderSecurityLog() {
    document.getElementById("securityTbody").innerHTML = this.state.log.map(l => `
      <tr>
        <td>${new Date(l.ts).toLocaleString()}</td>
        <td>${l.type.replace(/_/g, " ")}</td>
        <td>${l.actor || "—"}</td>
        <td><span class="status-chip ${l.result === 'success' ? 'status-present' : 'status-fail'}">${l.result}</span></td>
        <td>${l.deviceId || "—"}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="text-secondary" style="padding:20px;">No events logged yet.</td></tr>`;
  },

  /* ---------------- SETTINGS ---------------- */
  renderSettings() {
    const s = this.state.settings;
    const f = document.getElementById("settingsForm");
    f.collegeName.value = s.collegeName || "";
    f.academicYear.value = s.academicYear || "";
    f.attendanceStart.value = s.attendanceStart || "09:00";
    f.lateThresholdMin.value = s.lateThresholdMin ?? 15;
    f.closeThresholdMin.value = s.closeThresholdMin ?? 30;
    f.lowAttendanceAlert.value = s.lowAttendanceAlert ?? 75;
  },

  /* ---------------- SESSIONS / DEVICES ---------------- */
  renderSessions() {
    document.getElementById("sessionsTbody").innerHTML = DemoData.sessions.map(s => `
      <tr><td>${s.subject}</td><td>${s.teacher}</td><td>${s.class}/${s.division}</td><td>${s.date}</td><td>${s.start}–${s.end}</td><td>${s.room}</td></tr>
    `).join("");
  },

  renderDevices() {
    document.getElementById("devicesTbody").innerHTML = DemoData.devices.map(d => `
      <tr><td>${d.name}</td><td>${d.id}</td><td>${d.location}</td><td>${d.staff}</td>
      <td><span class="status-chip ${d.active ? 'status-present' : 'status-absent'}">${d.active ? "Active" : "Inactive"}</span></td>
      <td>${new Date(d.lastActive).toLocaleTimeString()}</td></tr>
    `).join("");
  },

  /* ---------------- TOAST ---------------- */
  toast(msg) {
    const stack = document.getElementById("toastStack");
    const t = document.createElement("div");
    t.className = "toast glass-strong";
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  },
};

document.addEventListener("DOMContentLoaded", () => Admin.init());
