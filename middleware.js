// middleware.js - helpers shared by the Admin and Maintenance routes
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me"; // same rule as server.js

const clean = (v) => String(v ?? "").trim();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });

// Login check: runs before every protected route
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return bad(res, "Please log in first.", 401);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id, name, email, phone, role, team FROM users WHERE id = ?").get(payload.id);
    if (!user) return bad(res, "Account not found.", 401);
    req.user = user;
    next();
  } catch (err) {
    return bad(res, "Session expired. Please log in again.", 401);
  }
}

// Role check: requireRole("Admin") only lets administrators through
function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.role) ? next() : bad(res, "You do not have permission to do this.", 403);
}

// Login route for one role (used by /api/admin/login and /api/maintenance/login)
function loginHandler(role, label) {
  return (req, res) => {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return bad(res, "Invalid email or password.", 401);
    }
    if (user.role !== role) return bad(res, `This login is only for ${label}.`, 403);

    res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, team: user.team || null },
    });
  };
}

module.exports = { auth, requireRole, loginHandler, clean, bad };