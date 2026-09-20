/* ============================================================
   /utils — demo dataset (DEMO MODE only)
   Never confused with real attendance: every screen that shows
   demo data carries a visible "DEMO MODE" badge.
   ============================================================ */

const FIRST = ["Rahul", "Aisha", "Vikram", "Priya", "Arjun", "Sneha", "Karan", "Meera", "Devansh", "Ananya", "Rohan", "Ishita", "Kabir", "Tanya", "Yash", "Nisha"];
const LAST = ["Patil", "Sharma", "Reddy", "Verma", "Iyer", "Nair", "Gupta", "Khan", "Joshi", "Rao", "Mehta", "Singh"];
const CLASSES = ["11-A", "11-B", "12-A", "12-B"];
const DIVISIONS = ["A", "B", "C"];
const COURSES = ["Science", "Commerce", "Arts"];

function seedStudents(n = 40) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 3) % LAST.length];
    list.push({
      id: `S${1000 + i}`,
      name: `${first} ${last}`,
      studentId: `STU${1000 + i}`,
      rollNo: String(i + 1).padStart(2, "0"),
      prn: `PRN2026${String(1000 + i)}`,
      class: CLASSES[i % CLASSES.length],
      division: DIVISIONS[i % DIVISIONS.length],
      course: COURSES[i % COURSES.length],
      department: COURSES[i % COURSES.length],
      academicYear: "2026-27",
      photo: `https://i.pravatar.cc/160?img=${(i % 70) + 1}`,
      nfcId: `NFC-${(100000 + i * 37).toString(16).toUpperCase()}`,
      hasCredential: i % 6 !== 0,
      credentialId: i % 6 === 0 ? null : `cred_${i}`,
      credentialRegisteredAt: i % 6 === 0 ? null : "2026-06-12",
      pendingRegistrationToken: null,
      status: "active",
      email: "",
      phone: "",
      guardianContact: "",
      registeredAt: "2026-06-12",
    });
  }
  return list;
}

function seedAttendance(students) {
  const list = [];
  const now = Date.now();
  students.forEach((s, i) => {
    if (i % 5 === 0) return; // some absent today, no record
    const late = i % 9 === 0;
    list.push({
      id: `A${1000 + i}`,
      studentId: s.id,
      studentName: s.name,
      sessionId: "SESS-PHY-12A",
      subject: "Physics",
      class: s.class,
      division: s.division,
      nfcResult: "success",
      biometricResult: i % 13 === 0 ? "failed" : "success",
      status: i % 13 === 0 ? "failed" : (late ? "late" : "present"),
      ts: new Date(now - i * 60000).toISOString(),
      deviceId: "DEV-SCN-01",
    });
  });
  return list;
}

function seedSecurityLog(students) {
  const events = [
    { type: "admin_login", result: "success", actor: "admin@college.edu" },
    { type: "credential_registration", result: "success", actor: students[2]?.name },
    { type: "failed_biometric", result: "failed", actor: students[7]?.name },
    { type: "unregistered_card", result: "failed", actor: "Unknown card NFC-FF221A" },
    { type: "duplicate_attempt", result: "blocked", actor: students[3]?.name },
    { type: "student_edit", result: "success", actor: "admin@college.edu" },
  ];
  return events.map((e, i) => ({
    id: `L${i}`,
    ts: new Date(Date.now() - i * 3600 * 1000).toISOString(),
    deviceId: "DEV-SCN-01",
    ...e,
  }));
}

const _students = seedStudents(40);

const DemoData = {
  students: _students,
  attendance: seedAttendance(_students),
  securityLog: seedSecurityLog(_students),
  sessions: [
    { id: "SESS-PHY-12A", subject: "Physics", teacher: "Mr. Kulkarni", class: "12-A", division: "A", date: "2026-09-17", start: "10:00", end: "11:00", room: "204", type: "Lecture" },
  ],
  devices: [
    { id: "DEV-SCN-01", name: "Front Gate Scanner", location: "Main Entrance", staff: "Security Desk", active: true, lastActive: new Date().toISOString() },
  ],
  admins: [
    { id: "AD1", email: "admin@college.edu", role: "super_admin", name: "System Administrator" },
    { id: "AD2", email: "kulkarni@college.edu", role: "teacher", name: "Mr. Kulkarni", assignedClass: "12-A" },
    { id: "AD3", email: "reddy@college.edu", role: "admin", name: "Ms. Reddy" },
  ],
  settings: {
    collegeName: "Horizon College of Engineering",
    academicYear: "2026-27",
    lateThresholdMin: 15,
    closeThresholdMin: 30,
    attendanceStart: "09:00",
    lowAttendanceAlert: 75,
    theme: "dark",
  },
};

window.DemoData = DemoData;
