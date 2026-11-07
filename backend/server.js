require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5000;
const GH_USER = process.env.GITHUB_USERNAME || "yashwantj730-code";

app.use(express.json({ limit: "20kb" }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(",").map(s => s.trim()) }));

// ---------- Storage: MongoDB if configured, else local JSON file ----------
let Message = null;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.error("MongoDB error:", err.message));
  Message = mongoose.model("Message", new mongoose.Schema({
    name: String, email: String, message: String, createdAt: { type: Date, default: Date.now }
  }));
}
const FILE = path.join(__dirname, "data", "messages.json");
function saveToFile(entry) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const all = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  all.push(entry);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

// ---------- Email alert (optional) ----------
const mailer = process.env.EMAIL_USER && process.env.EMAIL_PASS
  ? nodemailer.createTransport({ service: "gmail", auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

// ---------- Routes ----------
app.get("/", (req, res) => res.json({ status: "ok", api: "Yashwant Jaiswal Portfolio API" }));
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: "Too many messages, try again later." } });
app.post("/api/contact", contactLimiter, async (req, res) => {
  const { name = "", email = "", message = "" } = req.body || {};
  if (!name.trim() || !email.trim() || !message.trim())
    return res.status(400).json({ error: "Name, email and message are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Please enter a valid email." });
  if (message.length > 3000) return res.status(400).json({ error: "Message is too long." });

  const entry = { name: name.trim(), email: email.trim(), message: message.trim(), createdAt: new Date().toISOString() };
  try {
    if (Message) await Message.create(entry); else saveToFile(entry);
    if (mailer) {
      mailer.sendMail({
        from: process.env.EMAIL_USER, to: process.env.EMAIL_TO || process.env.EMAIL_USER, replyTo: entry.email,
        subject: `Portfolio message from ${entry.name}`,
        text: `${entry.message}\n\nFrom: ${entry.name} <${entry.email}>`
      }).catch(e => console.error("Mail error:", e.message));
    }
    res.json({ success: true, message: "Thanks! Your message has been received." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error, please try again." });
  }
});

// Admin: read messages -> GET /api/messages?key=ADMIN_KEY
app.get("/api/messages", async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  const list = Message ? await Message.find().sort({ createdAt: -1 }).lean()
    : (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")).reverse() : []);
  res.json(list);
});

// GitHub projects (cached 1 hour)
let cache = { at: 0, data: null };
app.get("/api/projects", async (req, res) => {
  if (cache.data && Date.now() - cache.at < 3600e3) return res.json(cache.data);
  try {
    const r = await fetch(`https://api.github.com/users/${GH_USER}/repos?sort=updated&per_page=100`,
      { headers: { "User-Agent": "portfolio-backend" } });
    const repos = await r.json();
    const data = repos.filter(x => !x.fork).map(x => ({
      name: x.name, description: x.description, language: x.language,
      url: x.html_url, demo: x.homepage || null, stars: x.stargazers_count, updated: x.updated_at
    }));
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Could not load GitHub projects." });
  }
});

app.listen(PORT, () => console.log(`Portfolio API running on http://localhost:${PORT}`));
