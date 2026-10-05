const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =========================
// Database
// =========================
async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        company_id INTEGER REFERENCES companies(id),
        points INTEGER NOT NULL,
        transaction_id TEXT UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      INSERT INTO companies (name, type, status)
      SELECT 'AdGem', 'Offerwall', TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM companies WHERE name = 'AdGem'
      );
    `);

    console.log("Database tables ready");
  } finally {
    client.release();
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
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "reward-app",
      database: "connected"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      service: "reward-app",
      database: "error"
    });
  }
});

// =========================
// Companies
// =========================
app.get("/api/companies", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM companies ORDER BY id"
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/companies", async (req, res) => {
  try {
    const { name, type } = req.body;

    if (!name || !type) {
      return res.status(400).json({
        error: "name and type are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO companies (name, type)
       VALUES ($1, $2)
       RETURNING *`,
      [name, type]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// Users
// =========================
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users ORDER BY id DESC"
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "email is required"
      });
    }

    const result = await pool.query(
      `INSERT INTO users (email)
       VALUES ($1)
       ON CONFLICT (email)
       DO UPDATE SET email = EXCLUDED.email
       RETURNING *`,
      [email]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "user not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// Add reward
// =========================
app.post("/api/rewards", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      user_id,
      points,
      company_id,
      transaction_id,
      description
    } = req.body;

    if (!user_id || !points || points <= 0) {
      return res.status(400).json({
        error: "user_id and positive points are required"
      });
    }

    await client.query("BEGIN");

    const user = await client.query(
      "SELECT * FROM users WHERE id = $1 FOR UPDATE",
      [user_id]
    );

    if (user.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "user not found"
      });
    }

    const transaction = await client.query(
      `INSERT INTO transactions
       (user_id, company_id, points, transaction_id, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        user_id,
        company_id || null,
        points,
        transaction_id || null,
        description || null
      ]
    );

    const updatedUser = await client.query(
      `UPDATE users
       SET points = points + $1
       WHERE id = $2
       RETURNING *`,
      [points, user_id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      transaction: transaction.rows[0],
      user: updatedUser.rows[0]
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    res.status(500).json({
      error: error.message
    });

  } finally {
    client.release();
  }
});

// =========================
// Transactions
// =========================
app.get("/api/users/:id/transactions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM transactions
       WHERE user_id = $1
       ORDER BY id DESC`,
      [req.params.id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/transactions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM transactions
       ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// Statistics
// =========================
app.get("/api/stats", async (req, res) => {
  try {
    const users = await pool.query(
      "SELECT COUNT(*) FROM users"
    );

    const companies = await pool.query(
      "SELECT COUNT(*) FROM companies"
    );

    const points = await pool.query(
      "SELECT COALESCE(SUM(points), 0) AS total FROM users"
    );

    const transactions = await pool.query(
      "SELECT COUNT(*) FROM transactions"
    );

    res.json({
      users: Number(users.rows[0].count),
      companies: Number(companies.rows[0].count),
      points: Number(points.rows[0].total),
      transactions: Number(transactions.rows[0].count)
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// AdGem Postback
// =========================
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
  try {
    await pool.query("SELECT 1");

    console.log("PostgreSQL connected");

    await initDatabase();

    app.listen(PORT, () => {
      console.log(`Reward App running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Database connection failed:");
    console.error(error);
    process.exit(1);
  }
}

startServer();
