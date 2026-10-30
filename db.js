// db.js - opens the database file and creates the tables if they do not exist
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const db = new Database(path.join(__dirname, "rcmrs.db")); // file is created automatically
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Citizen',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  road_name      TEXT NOT NULL,
  location       TEXT NOT NULL,
  road_type      TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  priority       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending','In Progress','Completed')),
  description    TEXT NOT NULL,
  image          TEXT NOT NULL DEFAULT '',
  date           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES reports(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL,
  date       TEXT NOT NULL
);
`);

// Demo data (only the first time, when there are no users)
if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
  db.prepare(
    "INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (1, ?, ?, ?, ?, 'Citizen')"
  ).run("Nima Yoozer", "nima@rcmrs.bt", "17123456", bcrypt.hashSync("1234", 10));

  const add = db.prepare(`INSERT INTO reports
    (id, user_id, road_name, location, road_type, condition_type, priority, status, description, date)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
  add.run(101, "Paro Highway", "Thimphu", "Highway", "Potholes", "Critical", "Pending",
    "Large potholes causing accidents near the bridge.", "2026-05-01");
  add.run(102, "Zhemgang Road", "Trongsa", "Highway", "Road Block", "High", "In Progress",
    "Landslide blocked the road after heavy rain.", "2026-05-03");
  add.run(103, "Wandue Road", "Gelephu", "Urban Road", "Drainage Blockage", "Medium", "Completed",
    "Drainage blocked with debris causing flooding.", "2026-04-20");
  console.log("Demo data added: nima@rcmrs.bt / 1234");
}

// ===== Admin + Maintenance extension =====
// Add the "team" column if the database was created before this feature
if (!db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "team")) {
  db.exec("ALTER TABLE users ADD COLUMN team TEXT");
}

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL UNIQUE REFERENCES reports(id),
  contractor TEXT NOT NULL,
  deadline   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Assigned'
             CHECK (status IN ('Assigned','In Progress','Pending Approval','Completed'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

// Demo staff accounts (all use password 1234)
if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Admin'").get().n === 0) {
  const addStaff = db.prepare(
    "INSERT OR IGNORE INTO users (name, email, phone, password_hash, role, team) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const pw = bcrypt.hashSync("1234", 10);
  addStaff.run("Sangay Admin", "sangay@rcmrs.bt", "17000003", pw, "Admin", null);
  addStaff.run("Kinley Admin", "kinley@rcmrs.bt", "17000004", pw, "Admin", null);
  addStaff.run("Sonam Tenzin", "sonam@rcmrs.bt", "17000002", pw, "Maintenance", "Highlight Ltd");
  addStaff.run("Dorji Crew", "dorji@rcmrs.bt", "17000005", pw, "Maintenance", "CDCL Ltd");
  addStaff.run("Rinchen Crew", "rinchen@rcmrs.bt", "17000006", pw, "Maintenance", "PWD");
  console.log("Demo staff added: sangay@rcmrs.bt (Admin), sonam@rcmrs.bt (Maintenance) / 1234");
}

// Demo tasks for the demo reports
if (db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n === 0) {
  const hasReport = (id) => db.prepare("SELECT 1 FROM reports WHERE id = ?").get(id);
  const addTask = db.prepare("INSERT INTO tasks (report_id, contractor, deadline, status) VALUES (?, ?, ?, ?)");
  if (hasReport(102)) addTask.run(102, "Highlight Ltd", "2026-05-20", "In Progress");
  if (hasReport(103)) addTask.run(103, "CDCL Ltd", "2026-05-05", "Completed");
}

// Demo resources
const addEquip = db.prepare("INSERT OR IGNORE INTO equipment (name, count) VALUES (?, ?)");
[["Excavator", 4], ["Dump Truck", 6], ["Road Roller", 3], ["Concrete Mixer", 5]].forEach((e) => addEquip.run(...e));
const addSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
addSetting.run("equipmentUsage", 65);
addSetting.run("materialSupply", 72);

module.exports = db;