const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// =========================
// Middleware
// =========================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// PostgreSQL
// =========================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("error", (err) => {
  console.error("PostgreSQL error:", err);
});

// =========================
// Database initialization
// =========================

async function initDatabase() {
  try {

    // الشركات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Offerwall',
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // المستخدمون
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        points INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // معاملات المكافآت
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,

        user_id BIGINT NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        company_id BIGINT
          REFERENCES companies(id)
          ON DELETE SET NULL,

        transaction_id TEXT UNIQUE,

        type TEXT NOT NULL DEFAULT 'reward',

        points INTEGER NOT NULL,

        description TEXT,

        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // إضافة AdGem إذا لم تكن موجودة
    await pool.query(`
      INSERT INTO companies (name, type, status)
      SELECT 'AdGem', 'Offerwall', TRUE
      WHERE NOT EXISTS (
        SELECT 1
        FROM companies
        WHERE name = 'AdGem'
      );
    `);

    console.log("PostgreSQL connected");
    console.log("Database tables ready");

  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

// =========================
// Pages
// =========================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// =========================
// Health
// =========================

app.get("/api/health", async (req, res) => {
  try {

    await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      service: "reward-app",
      database: "connected"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      database: "error"
    });

  }
});

// =========================
// Companies
// =========================

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
      [
        name,
        type || "Offerwall"
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Database error"
    });

  }

});

// =========================
// Users
// =========================

app.get("/api/users", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        id,
        name,
        email,
        points,
        created_at
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
      INSERT INTO users
        (name, email, points)
      VALUES
        ($1, $2, 0)
      RETURNING
        id,
        name,
        email,
        points,
        created_at
      `,
      [
        name,
        email
      ]
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

// =========================
// User balance
// =========================

app.get("/api/users/:id", async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {

      return res.status(400).json({
        error: "invalid user id"
      });

    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        points,
        created_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {

      return res.status(404).json({
        error: "user not found"
      });

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Database error"
    });

  }

});

// =========================
// Add reward
// =========================
//
// هذه النقطة مهمة:
// transaction_id يمنع احتساب نفس العملية مرتين.
//

app.post("/api/rewards", async (req, res) => {

  const client = await pool.connect();

  try {

    const {
      user_id,
      company_id,
      transaction_id,
      points,
      description
    } = req.body;

    if (!user_id || !points) {

      client.release();

      return res.status(400).json({
        error: "user_id and points are required"
      });

    }

    const userId = Number(user_id);
    const companyId = company_id ? Number(company_id) : null;
    const rewardPoints = Number(points);

    if (
      !Number.isInteger(userId) ||
      !Number.isInteger(rewardPoints) ||
      rewardPoints <= 0
    ) {

      client.release();

      return res.status(400).json({
        error: "invalid user_id or points"
      });

    }

    await client.query("BEGIN");

    // التأكد أن المستخدم موجود
    const userResult = await client.query(
      `
      SELECT id, points
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {

      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "user not found"
      });

    }

    // منع تكرار العملية
    if (transaction_id) {

      const existing = await client.query(
        `
        SELECT id
        FROM transactions
        WHERE transaction_id = $1
        `,
        [transaction_id]
      );

      if (existing.rows.length > 0) {

        await client.query("ROLLBACK");

        return res.status(409).json({
          error: "transaction already processed"
        });

      }

    }

    // إضافة العملية
    const transactionResult = await client.query(
      `
      INSERT INTO transactions
        (
          user_id,
          company_id,
          transaction_id,
          type,
          points,
          description
        )
      VALUES
        (
          $1,
          $2,
          $3,
          'reward',
          $4,
          $5
        )
      RETURNING *
      `,
      [
        userId,
        companyId,
        transaction_id || null,
        rewardPoints,
        description || "Reward"
      ]
    );

    // إضافة النقاط للمستخدم
    const updateResult = await client.query(
      `
      UPDATE users
      SET points = points + $1
      WHERE id = $2
      RETURNING id, name, email, points
      `,
      [
        rewardPoints,
        userId
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      transaction: transactionResult.rows[0],
      user: updateResult.rows[0]
    });

  } catch (error) {

    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error(error);

    // transaction_id مكرر
    if (error.code === "23505") {

      return res.status(409).json({
        error: "transaction already processed"
      });

    }

    res.status(500).json({
      error: "Database error"
    });

  } finally {

    client.release();

  }

});

// =========================
// User transactions
// =========================

app.get("/api/users/:id/transactions", async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {

      return res.status(400).json({
        error: "invalid user id"
      });

    }

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.transaction_id,
        t.type,
        t.points,
        t.description,
        t.created_at,

        c.name AS company_name

      FROM transactions t

      LEFT JOIN companies c
        ON c.id = t.company_id

      WHERE t.user_id = $1

      ORDER BY t.id DESC
      `,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Database error"
    });

  }

});

// =========================
// All transactions
// =========================

app.get("/api/transactions", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT

        t.id,
        t.transaction_id,
        t.type,
        t.points,
        t.description,
        t.created_at,

        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email,

        c.name AS company_name

      FROM transactions t

      LEFT JOIN users u
        ON u.id = t.user_id

      LEFT JOIN companies c
        ON c.id = t.company_id

      ORDER BY t.id DESC
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Database error"
    });

  }

});

// =========================
// Statistics
// =========================

app.get("/api/stats", async (req, res) => {

  try {

    const usersResult = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      `
    );

    const companiesResult = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM companies
      `
    );

    const pointsResult = await pool.query(
      `
      SELECT COALESCE(SUM(points), 0)::int AS total
      FROM users
      `
    );

    const transactionsResult = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM transactions
      `
    );

    res.json({

      users: usersResult.rows[0].count,

      companies: companiesResult.rows[0].count,

      totalPoints: pointsResult.rows[0].total,

      transactions: transactionsResult.rows[0].count

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Database error"
    });

  }

});

// =========================
// AdGem Postback
// =========================
//
// مؤقتًا:
// نستقبل الطلب فقط.
//
// لا نضيف نقاطًا هنا حتى نتحقق
// من صيغة AdGem الرسمية وبيانات
// التحقق من العملية.
//

app.post("/postbacks/adgem/v3", async (req, res) => {

  console.log("AdGem postback received:");

  console.log(req.body);

  res.json({
    success: true
  });

});

// =========================
// 404
// =========================

app.use((req, res) => {

  res.status(404).send("Not Found");

});

// =========================
// Start
// =========================

async function startServer() {

  await initDatabase();

  app.listen(PORT, () => {

    console.log(
      `Reward App running on port ${PORT}`
    );

  });

}

startServer();
