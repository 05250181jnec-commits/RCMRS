// routes/maintenance.js - everything the Maintenance portal needs (mounted at /api/maintenance)
const express = require("express");
const db = require("../db");
const { auth, requireRole, loginHandler, clean, bad } = require("../middleware");

const router = express.Router();
const TASK_STATUSES = ["Assigned", "In Progress", "Pending Approval", "Completed"];

// Public: maintenance login
router.post("/login", loginHandler("Maintenance", "maintenance teams"));

// Everything below needs a logged-in Maintenance user
router.use(auth, requireRole("Maintenance"));

const TASK_SQL = `
  SELECT 'RC' || (300 + t.id) AS task_id, t.report_id, t.contractor, t.deadline, t.status,
         r.condition_type AS issue_type, r.priority, r.road_name, r.location
  FROM tasks t JOIN reports r ON r.id = t.report_id`;

// Tasks given to MY team (the contractor name must match my "team")
router.get("/tasks", (req, res) => {
  if (!req.user.team) return res.json([]);
  res.json(db.prepare(TASK_SQL + " WHERE t.contractor = ? ORDER BY t.deadline").all(req.user.team));
});

// Update the status of one of my tasks, e.g. PUT /api/maintenance/tasks/RC301/status
router.put("/tasks/:taskId/status", (req, res) => {
  const match = /^RC(\d+)$/.exec(req.params.taskId);
  const id = match ? Number(match[1]) - 300 : NaN;
  const status = clean(req.body.status);
  if (!TASK_STATUSES.includes(status)) return bad(res, "Invalid status.");

  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND contractor = ?").get(id, req.user.team);
  if (!task) return bad(res, "Task not found.", 404);

  db.transaction(() => {
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
    // Keep the citizen's report in step with the work
    if (status === "Completed" || status === "In Progress") {
      db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, task.report_id);
    }
  })();
  res.json({ ok: true });
});

// Equipment and supply numbers for the resources panel
router.get("/resources", (req, res) => {
  const setting = (key) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) || { value: 0 }).value;
  res.json({
    equipment: db.prepare("SELECT name, count FROM equipment ORDER BY name").all(),
    equipmentUsage: setting("equipmentUsage"),
    materialSupply: setting("materialSupply"),
  });
});

module.exports = router;