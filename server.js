// server.js - the RCMRS backend (Express + SQLite)
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

// ---------- Settings ----------
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
if (!process.env.JWT_SECRET) console.warn("WARNING: set JWT_SECRET in .env (using an unsafe default).");

// Where are the frontend folders (admin, ci, main)? The first place that has a "ci" folder wins.
const FRONTEND_PLACES = [
  path.join(__dirname, "..", "frontend", "RCMRS"),   // D:\project1\frontend\RCMRS
  path.join(__dirname, "..", "frontend"),            // D:\project1\frontend
  path.join(__dirname, ".."),                        // D:\project1
];
const ROOT = FRONTEND_PLACES.find((p) => fs.existsSync(path.join(p, "ci"))) || FRONTEND_PLACES[0];

const UPLOAD_DIR = path.join(__dirname, "uploads");        // report photos
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ROAD_TYPES = ["Highway", "Village Road", "Urban Road"];
const ISSUES = ["Potholes", "Cracks", "Road Block", "Drainage Blockage", "Landslide"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// ---------- Helpers ----------
const clean = (v) => String(v ?? "").trim();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const today = () => new Date().toISOString().split("T")[0];

// ---------- Middleware ----------
app.use(express.json({ limit: "20kb" }));
// Serve ONLY the three frontend folders (never the backend folder, it holds secrets)
app.use("/ci", express.static(path.join(ROOT, "ci")));             // citizen portal
app.use("/admin", express.static(path.join(ROOT, "admin")));       // admin portal
app.use("/main", express.static(path.join(ROOT, "main")));         // maintenance portal
app.get("/", (req, res) => res.redirect("/ci/index.html"));
app.use("/uploads", express.static(UPLOAD_DIR));           // serves uploaded photos

// Photo upload settings
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex") + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },                   // 5 MB
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error("Only JPG, PNG, WEBP or GIF images are allowed.")),
});

// Login check: runs before every protected route
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return bad(res, "Please log in first.", 401);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, name, email, phone, role FROM users WHERE id = ?").get(payload.id);
    if (!user) return bad(res, "Account not found.", 401);
    req.user = user;
    next();
  } catch (err) {
    return bad(res, "Session expired. Please log in again.", 401);
  }
}

// ---------- Auth routes ----------
app.post("/api/signup", (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const phone = clean(req.body.phone);
  const password = String(req.body.password || "");

  if (name.length < 3 || name.length > 60) return bad(res, "Name must be 3 to 60 characters.");
  if (!EMAIL_RE.test(email)) return bad(res, "Enter a valid email address.");
  if (!/^(17|77)\d{6}$/.test(phone)) return bad(res, "Phone must be 8 digits starting with 17 or 77.");
  if (password.length < 6) return bad(res, "Password must be at least 6 characters.");

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return bad(res, "Email already registered.", 409);
  }
  const hash = bcrypt.hashSync(password, 10);              // never store plain passwords
  db.prepare("INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'Citizen')")
    .run(name, email, phone, hash);
  res.status(201).json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return bad(res, "Invalid email or password.", 401);
  }
  if (user.role !== "Citizen") return bad(res, "This login is only for citizens.", 403);

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

// ---------- Report routes ----------
// My reports (optional ?status=Completed)
app.get("/api/reports", auth, (req, res) => {
  const status = clean(req.query.status);
  const rows = status
    ? db.prepare("SELECT * FROM reports WHERE user_id = ? AND status = ? ORDER BY id DESC").all(req.user.id, status)
    : db.prepare("SELECT * FROM reports WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
  res.json(rows);
});

// Submit a new report (form-data, because it can include a photo)
app.post("/api/reports", auth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return bad(res, err.code === "LIMIT_FILE_SIZE" ? "Photo must be under 5 MB." : err.message);

    const b = req.body;
    const r = {
      road_name: clean(b.road_name), location: clean(b.location),
      road_type: clean(b.road_type), condition_type: clean(b.condition_type),
      priority: clean(b.priority), description: clean(b.description),
    };
    let error = null;
    if (r.road_name.length < 3 || r.road_name.length > 100) error = "Road name must be 3 to 100 characters.";
    else if (r.location.length < 3 || r.location.length > 150) error = "Location must be 3 to 150 characters.";
    else if (!ROAD_TYPES.includes(r.road_type)) error = "Invalid road type.";
    else if (!ISSUES.includes(r.condition_type)) error = "Invalid issue type.";
    else if (!PRIORITIES.includes(r.priority)) error = "Invalid priority.";
    else if (r.description.length < 10 || r.description.length > 1000) error = "Description must be 10 to 1000 characters.";

    if (error) {
      if (req.file) fs.unlink(req.file.path, () => {});    // remove the photo we no longer need
      return bad(res, error);
    }

    const info = db.prepare(`INSERT INTO reports
      (user_id, road_name, location, road_type, condition_type, priority, status, description, image, date)
      VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`)
      .run(req.user.id, r.road_name, r.location, r.road_type, r.condition_type, r.priority,
           r.description, req.file ? req.file.filename : "", today());

    res.status(201).json({ report: { id: info.lastInsertRowid } });
  });
});

// ---------- Feedback routes ----------
// Overall numbers shown in the three cards (all citizens)
app.get("/api/feedback/stats", auth, (req, res) => {
  const s = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(ROUND(AVG(rating), 1), 0) AS average,
      COALESCE(SUM(rating >= 4), 0) AS positive FROM feedback`).get();
  res.json({
    total: s.total,
    average: s.average,
    positivePct: s.total ? Math.round((s.positive / s.total) * 100) : 0,
  });
});

// My own feedback history
app.get("/api/feedback", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC").all(req.user.id));
});

app.post("/api/feedback", auth, (req, res) => {
  const requestId = Number(req.body.request_id);
  const rating = Number(req.body.rating);
  const comment = clean(req.body.comment);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, "Please give a rating from 1 to 5.");
  if (comment.length < 3 || comment.length > 500) return bad(res, "Comment must be 3 to 500 characters.");

  const report = db.prepare("SELECT * FROM reports WHERE id = ? AND user_id = ?").get(requestId, req.user.id);
  if (!report) return bad(res, "Report not found.", 404);
  if (report.status !== "Completed") return bad(res, "You can only review completed reports.");
  if (db.prepare("SELECT id FROM feedback WHERE request_id = ? AND user_id = ?").get(requestId, req.user.id)) {
    return bad(res, "You already gave feedback for this report.", 409);
  }

  db.prepare("INSERT INTO feedback (request_id, user_id, rating, comment, date) VALUES (?, ?, ?, ?, ?)")
    .run(requestId, req.user.id, rating, comment, today());
  res.status(201).json({ ok: true });
});

// ---------- Admin + Maintenance portals ----------
app.use("/api/admin", require("./routes/admin"));
app.use("/api/maintenance", require("./routes/maintenance"));

// ---------- Unknown API routes + error catcher ----------
app.use("/api", (req, res) => bad(res, "Route not found.", 404));
app.use((err, req, res, next) => {
  console.error(err);
  bad(res, "Server error. Please try again.", 500);
});

app.listen(PORT, () => {
  console.log(`RCMRS running at http://localhost:${PORT}`);
  console.log(`Frontend folder: ${ROOT}`);
  if (!fs.existsSync(path.join(ROOT, "ci"))) {
    console.warn("WARNING: no 'ci' folder found there. Check where your admin, ci and main folders are.");
  }
  console.log(`  Citizen     : http://localhost:${PORT}/ci/index.html`);
  console.log(`  Admin       : http://localhost:${PORT}/admin/login.html`);
  console.log(`  Maintenance : http://localhost:${PORT}/main/login.html`);
});