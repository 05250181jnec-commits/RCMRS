/* ============================================
   RCMRS - Citizen Frontend Demo
   Data stored in localStorage (no backend yet)
   ============================================ */

// Seed demo data on first run
function seedDemoData() {
    if (!localStorage.getItem("users")) {
        localStorage.setItem("users", JSON.stringify([
            { id: 1, name: "Nima Yoozer", email: "nima@rcmrs.bt", password: "1234",
              role: "Citizen", phone: "17123456" }
        ]));
    }

    if (!localStorage.getItem("reports")) {
        localStorage.setItem("reports", JSON.stringify([
            {
                id: 101, road_name: "Paro Highway", location: "Thimphu",
                road_type: "Highway", condition_type: "Potholes",
                priority: "Critical", status: "Pending",
                description: "Large potholes causing accidents near the bridge.",
                image: "", user_id: 1, date: "2026-05-01"
            },
            {
                id: 102, road_name: "Zhemgang Road", location: "Trongsa",
                road_type: "Highway", condition_type: "Road Block",
                priority: "High", status: "In Progress",
                description: "Landslide blocked the road after heavy rain.",
                image: "", user_id: 1, date: "2026-05-03"
            },
            {
                id: 103, road_name: "Wandue Road", location: "Gelephu",
                road_type: "Urban Road", condition_type: "Drainage Blockage",
                priority: "Medium", status: "Completed",
                description: "Drainage blocked with debris causing flooding.",
                image: "", user_id: 1, date: "2026-04-20"
            }
        ]));
    }

    if (!localStorage.getItem("feedback")) {
        localStorage.setItem("feedback", JSON.stringify([]));
    }
}

// Getters / setters
function getUsers()   { return JSON.parse(localStorage.getItem("users"))    || []; }
function getReports() { return JSON.parse(localStorage.getItem("reports"))  || []; }
function saveReports(r) { localStorage.setItem("reports", JSON.stringify(r)); }
function getFeedback() { return JSON.parse(localStorage.getItem("feedback")) || []; }
function saveFeedback(f) { localStorage.setItem("feedback", JSON.stringify(f)); }

function getCurrentUser() {
    const id = localStorage.getItem("currentUserId");
    if (!id) return null;
    return getUsers().find(u => u.id == id);
}

function logout() {
    localStorage.removeItem("currentUserId");
    window.location.href = "index.html";
}

// Utility: badge classes
function statusClass(s)   { return "badge-" + s.toLowerCase().replace(" ", ""); }
function priorityClass(p) { return "badge-" + p.toLowerCase(); }

// Ensure citizen is logged in (call on protected pages)
function requireCitizen() {
    const user = getCurrentUser();
    if (!user || user.role !== "Citizen") {
        alert("Please login as a citizen first.");
        window.location.href = "index.html";
        return null;
    }
    return user;
}

document.addEventListener("DOMContentLoaded", seedDemoData);
