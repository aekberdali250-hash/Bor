const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// ===============================
// Express
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// PostgreSQL
// ===============================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// اختبار الاتصال بقاعدة البيانات
pool.on("error", (err) => {
  console.error("PostgreSQL error:", err);
});

// ===============================
// إنشاء الجداول
// ===============================

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Offerwall',
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        points INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // إضافة AdGem إذا لم تكن موجودة
    await pool.query(`
      INSERT INTO companies (name, type, status)
      SELECT 'AdGem', 'Offerwall', TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM companies WHERE name = 'AdGem'
      );
    `);

    console.log("PostgreSQL connected");
    console.log("Database tables ready");

  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

// ===============================
// الصفحات
// ===============================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ===============================
// Health
// ===============================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      service: "reward-app",
      database: "connected"
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      database: "error"
    });
  }
});

// ===============================
// الشركات
// ===============================

app.get("/api/companies", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, type, status
      FROM companies
      ORDER BY id ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Database error"
    });
  }
});

app.post("/api/companies", async (req, res) => {
  try {
    const { name, type } = req.body;

    if (!name) {
      return res.status(400).json({
        error: "name is required"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO companies (name, type, status)
      VALUES ($1, $2, TRUE)
      RETURNING id, name, type, status
      `,
      [name, type || "Offerwall"]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Database error"
    });
  }
});

// ===============================
// المستخدمون
// ===============================

app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, points, created_at
      FROM users
      ORDER BY id DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Database error"
    });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "name and email are required"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO users (name, email, points)
      VALUES ($1, $2, 0)
      RETURNING id, name, email, points, created_at
      `,
      [name, email]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "email already exists"
      });
    }

    res.status(500).json({
      error: "Database error"
    });
  }
});

// ===============================
// الإحصائيات
// ===============================

app.get("/api/stats", async (req, res) => {
  try {
    const usersResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users"
    );

    const companiesResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM companies"
    );

    const pointsResult = await pool.query(
      "SELECT COALESCE(SUM(points), 0)::int AS total FROM users"
    );

    res.json({
      users: usersResult.rows[0].count,
      companies: companiesResult.rows[0].count,
      totalPoints: pointsResult.rows[0].total
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Database error"
    });
  }
});

// ===============================
// AdGem Postback
// ===============================

app.post("/postbacks/adgem/v3", async (req, res) => {
  console.log("AdGem postback received:");
  console.log(req.body);

  res.json({
    success: true
  });
});

// ===============================
// Not Found
// ===============================

app.use((req, res) => {
  res.status(404).send("Not Found");
});

// ===============================
// تشغيل الخادم
// ===============================

async function startServer() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`Reward App running on port ${PORT}`);
  });
}

startServer();
