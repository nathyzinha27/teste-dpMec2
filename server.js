const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// 🔧 Evita erro ao salvar o banco
const dbPath = path.join(__dirname, "data.db");
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// 🔐 CORS liberado
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// 🔧 Permitir imagens base64 grandes
app.use(express.json({ limit: "20mb" }));

// 🔐 Tokens ativos com expiração
let activeTokens = {};

function generateToken() {
  const token = crypto.randomBytes(32).toString("hex");

  // expira em 24h
  activeTokens[token] = Date.now() + 24 * 60 * 60 * 1000;

  return token;
}

// 🔒 Verifica token válido e não expirado
function checkAuth(req, res, next) {
  const token = req.headers.authorization;

  if (!token || !activeTokens[token]) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  if (Date.now() > activeTokens[token]) {
    delete activeTokens[token];
    return res.status(401).json({ error: "Token expirado" });
  }

  next();
}

// 📌 SQLite
const db = new sqlite3.Database(dbPath);

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      uid TEXT PRIMARY KEY,
      id TEXT,
      name TEXT,
      date TEXT,
      amount REAL,
      photo TEXT,
      createdAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY,
      password TEXT
    )
  `);

  db.get("SELECT * FROM admin WHERE id = 1", (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (id, password) VALUES (1, ?)", ["admin123"]);
      console.log("Senha admin criada: admin123");
    }
  });
});

// =========================
//       LOGIN TOKEN
// =========================
app.post("/api/login", (req, res) => {
  const { password } = req.body;

  db.get("SELECT password FROM admin WHERE id = 1", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row.password === password) {
      const token = generateToken();
      return res.json({ success: true, token });
    }

    return res.status(401).json({ error: "Senha incorreta" });
  });
});

// =========================
//          ROTAS
// =========================

// Usuários
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', checkAuth, (req, res) => {
  const { id, firstName, lastName } = req.body;

  db.run(
    'INSERT OR REPLACE INTO users(id, firstName, lastName) VALUES(?,?,?)',
    [id, firstName, lastName],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Registros
app.get('/api/records', (req, res) => {
  db.all('SELECT * FROM records ORDER BY createdAt DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/records', (req, res) => {
  const { uid, id, name, date, amount, photo } = req.body;
  const createdAt = new Date().toISOString();

  db.run(
    'INSERT INTO records(uid,id,name,date,amount,photo,createdAt) VALUES(?,?,?,?,?,?,?)',
    [uid, id, name, date, amount, photo, createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.delete('/api/records/:uid', checkAuth, (req, res) => {
  db.run(
    'DELETE FROM records WHERE uid = ?',
    [req.params.uid],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// =========================
//     FILTRAR POR SEMANA
// =========================
function getWeekRange(dateString) {
  const date = dateString ? new Date(dateString) : new Date();
  const d = new Date(date);
  const day = d.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() + diff);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

app.get("/api/records/week", (req, res) => {
  const dateFilter = req.query.date || null;

  const { start, end } = getWeekRange(dateFilter);

  const sql = `
      SELECT * FROM records
      WHERE date BETWEEN ? AND ?
      ORDER BY date ASC
  `;

  db.all(sql, [start.toISOString(), end.toISOString()], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      semana: {
        inicio: start.toISOString().split("T")[0],
        fim: end.toISOString().split("T")[0]
      },
      registros: rows
    });
  });
});

// 🚀 Rodar servidor
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("🔥 Backend online na porta", PORT));
