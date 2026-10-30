// routes/admin.js - everything the Admin portal needs (mounted at /api/admin)
const express = require("express");
const db = require("../db");
const { auth, requireRole, loginHandler, clean, bad } = require("../middleware");

const router = express.Router();

const CONTRACTORS = ["Highlight Ltd", "CDCL Ltd", "PWD", "Thromde"];
const STATUSES = ["Pending", "In Progress", "Completed"];
const ROLES = ["Citizen", "Maintenance", "Admin"];
const today = () => new Date().toISOString().split("T")[0];
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().split("T")[0];
const count = (sql, ...p) => db.prepare(sql).get(...p).n;

// Public: admin login
router.post("/login", loginHandler("Admin", "administrators"));

// Everything below needs a logged-in Admin
router.use(auth, requireRole("Admin"));

// ----- Numbers for the dashboard, delegation and priority cards -----
router.get("/stats", (req, res) => {
  res.json({
    total: count("SELECT COUNT(*) n FROM reports"),
    pending: count("SELECT COUNT(*) n FROM reports WHERE status = 'Pending'"),
    critical: count("SELECT COUNT(*) n FROM reports WHERE priority = 'Critical'"),
    completed: count("SELECT COUNT(*) n FROM reports WHERE status = 'Completed'"),
    assigned: count("SELECT COUNT(*) n FROM tasks WHERE status <> 'Completed'"),
    unassigned: count("SELECT COUNT(*) n FROM reports WHERE id NOT IN (SELECT report_id FROM tasks)"),
    completedTasks: count("SELECT COUNT(*) n FROM tasks WHERE status = 'Completed'"),
    overdue: count("SELECT COUNT(*) n FROM tasks WHERE deadline < ? AND status <> 'Completed'", today()),
  });
});

// ----- All reports from every citizen, with their task (if any) -----
router.get("/reports", (req, res) => {
  res.json(db.prepare(`
    SELECT r.*, u.name AS citizen_name,
           t.contractor, t.status AS task_status, t.deadline, 'RC' || (300 + t.id) AS task_id
    FROM reports r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN tasks t ON t.report_id = r.id
    ORDER BY r.id DESC`).all());
});

// Change the status of a report
router.put("/reports/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status);
  if (!STATUSES.includes(status)) return bad(res, "Invalid status.");
  if (!db.prepare("SELECT id FROM reports WHERE id = ?").get(id)) return bad(res, "Report not found.", 404);

  db.transaction(() => {
    db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, id);
    if (status === "Completed") db.prepare("UPDATE tasks SET status = 'Completed' WHERE report_id = ?").run(id);
  })();
  res.json({ ok: true });
});

// Assign (or un-assign) a contractor
router.put("/reports/:id/contractor", (req, res) => {
  const id = Number(req.params.id);
  const contractor = clean(req.body.contractor);
  if (!db.prepare("SELECT id FROM reports WHERE id = ?").get(id)) return bad(res, "Report not found.", 404);
  const task = db.prepare("SELECT * FROM tasks WHERE report_id = ?").get(id);

  if (contractor === "Unassigned") {
    if (task && task.status === "Completed") return bad(res, "A completed task cannot be un-assigned.", 409);
    db.prepare("DELETE FROM tasks WHERE report_id = ?").run(id);
    return res.json({ ok: true });
  }
  if (!CONTRACTORS.includes(contractor)) return bad(res, "Invalid contractor.");

  if (task) {
    const status = task.status === "Completed" ? "Completed" : "Assigned";
    db.prepare("UPDATE tasks SET contractor = ?, status = ? WHERE id = ?").run(contractor, status, task.id);
  } else {
    db.prepare("INSERT INTO tasks (report_id, contractor, deadline, status) VALUES (?, ?, ?, 'Assigned')")
      .run(id, contractor, inDays(15));
  }
  res.json({ ok: true });
});

// ----- User management -----
router.get("/users", (req, res) => {
  res.json(db.prepare("SELECT id, name, email, phone, role, team FROM users ORDER BY id").all());
});

// Change a user's role and/or team
router.put("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id, role, team FROM users WHERE id = ?").get(id);
  if (!user) return bad(res, "User not found.", 404);

  const role = req.body.role !== undefined ? clean(req.body.role) : user.role;
  let team = req.body.team !== undefined ? clean(req.body.team) || null : user.team;

  if (!ROLES.includes(role)) return bad(res, "Invalid role.");
  if (id === req.user.id && role !== user.role) return bad(res, "You cannot change your own role.");
  if (role !== "Maintenance") team = null;
  else if (team && !CONTRACTORS.includes(team)) return bad(res, "Invalid team.");

  db.prepare("UPDATE users SET role = ?, team = ? WHERE id = ?").run(role, team, id);
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, "You cannot delete your own account.");
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(id)) return bad(res, "User not found.", 404);

  const used = count("SELECT COUNT(*) n FROM reports WHERE user_id = ?", id)
             + count("SELECT COUNT(*) n FROM feedback WHERE user_id = ?", id);
  if (used > 0) return bad(res, "This user has reports or feedback, so the account cannot be deleted.", 409);

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;