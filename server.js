const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   PostgreSQL
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

/* =========================
   AdGem Postback
   IMPORTANT:
   This middleware stores the
   exact raw request body.
========================= */

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    }
  })
);

app.use(express.urlencoded({ extended: true }));

/* =========================
   Static files
========================= */

app.use(express.static(__dirname));

/* =========================
   Database initialization
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      status BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      points INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      company_id INTEGER,
      transaction_id TEXT UNIQUE,
      type TEXT NOT NULL,
      points INTEGER NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /* Add AdGem if it does not already exist */
  const company = await pool.query(
    `SELECT id FROM companies WHERE name = $1 LIMIT 1`,
    ["AdGem"]
  );

  if (company.rows.length === 0) {
    await pool.query(
      `INSERT INTO companies (name, type, status)
       VALUES ($1, $2, $3)`,
      ["AdGem", "Offerwall", true]
    );
  }

  console.log("Database tables ready");
}

/* =========================
   Home
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   Admin
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* =========================
   Health
========================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "connected"
    });
  } catch (error) {
    console.error("Health error:", error);

    res.status(500).json({
      ok: false,
      database: "error"
    });
  }
});

/* =========================
   Companies
========================= */

app.get("/api/companies", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM companies ORDER BY id ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load companies"
    });
  }
});

app.post("/api/companies", async (req, res) => {
  try {
    const { name, type, status } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Company name is required"
      });
    }

    const result = await pool.query(
      `INSERT INTO companies (name, type, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        name,
        type || "Offerwall",
        status !== false
      ]
    );

    res.json({
      success: true,
      company: result.rows[0]
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to create company"
    });
  }
});

/* =========================
   Users
========================= */

app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM users ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load users"
    });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, points)
       VALUES ($1, $2, 0)
       RETURNING *`,
      [
        name || "",
        email
      ]
    );

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Email already exists"
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to create user"
    });
  }
});

/* =========================
   Single user
========================= */

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load user"
    });
  }
});

/* =========================
   Manual reward API
========================= */

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

    const rewardPoints = Number(points);

    if (!user_id || !Number.isInteger(rewardPoints) || rewardPoints <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid user_id or points"
      });
    }

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
      [user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (transaction_id) {
      const existing = await client.query(
        `SELECT * FROM transactions
         WHERE transaction_id = $1
         LIMIT 1`,
        [transaction_id]
      );

      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");

        return res.json({
          success: true,
          duplicate: true,
          transaction: existing.rows[0]
        });
      }
    }

    const transactionResult = await client.query(
      `INSERT INTO transactions
       (user_id, company_id, transaction_id, type, points, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        user_id,
        company_id || null,
        transaction_id || null,
        "reward",
        rewardPoints,
        description || "Reward"
      ]
    );

    const updatedUser = await client.query(
      `UPDATE users
       SET points = points + $1
       WHERE id = $2
       RETURNING *`,
      [
        rewardPoints,
        user_id
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      transaction: transactionResult.rows[0],
      user: updatedUser.rows[0]
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Reward error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to add reward"
    });
  } finally {
    client.release();
  }
});

/* =========================
   User transactions
========================= */

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
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load transactions"
    });
  }
});

/* =========================
   All transactions
========================= */

app.get("/api/transactions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM transactions
       ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load transactions"
    });
  }
});

/* =========================
   Statistics
========================= */

app.get("/api/stats", async (req, res) => {
  try {
    const users = await pool.query(
      `SELECT COUNT(*)::integer AS count FROM users`
    );

    const companies = await pool.query(
      `SELECT COUNT(*)::integer AS count FROM companies`
    );

    const rewards = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::integer AS points
       FROM transactions
       WHERE type = 'reward'`
    );

    res.json({
      users: users.rows[0].count,
      companies: companies.rows[0].count,
      rewards: rewards.rows[0].points
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Failed to load statistics"
    });
  }
});

/* =========================================================
   ADGEM V3 SERVER-TO-SERVER POSTBACK
========================================================= */

app.post("/postbacks/adgem/v3", async (req, res) => {
  try {
    const receivedSignature = req.get("Signature") || "";

    if (!process.env.ADGEM_POSTBACK_KEY) {
      console.error("ADGEM_POSTBACK_KEY is missing");

      return res.status(500).json({
        success: false,
        error: "Postback configuration error"
      });
    }

    if (!req.rawBody) {
      console.error("Raw AdGem request body is missing");

      return res.status(400).json({
        success: false,
        error: "Invalid request body"
      });
    }

    /* Verify HMAC-SHA256 signature */

    const expectedSignature = crypto
      .createHmac(
        "sha256",
        process.env.ADGEM_POSTBACK_KEY
      )
      .update(req.rawBody)
      .digest("hex");

    const expected = Buffer.from(
      expectedSignature,
      "utf8"
    );

    const received = Buffer.from(
      receivedSignature,
      "utf8"
    );

    const signatureValid =
      expected.length === received.length &&
      crypto.timingSafeEqual(
        expected,
        received
      );

    if (!signatureValid) {
      console.error("Invalid AdGem signature");

      return res.status(401).json({
        success: false,
        error: "Invalid signature"
      });
    }

    /* Parse verified JSON */

    let payload;

    try {
      payload = JSON.parse(
        req.rawBody.toString("utf8")
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON"
      });
    }

    const data = payload.data || {};

    const playerId = String(
      data.player_id || ""
    ).trim();

    const conversionId = String(
      data.conversion_id || ""
    ).trim();

    const amount = Number(data.amount);

    const conversionType =
      data.conversion_type || "reward";

    console.log("AdGem postback received:", {
      request_id: payload.request_id,
      player_id: playerId,
      conversion_id: conversionId,
      amount,
      conversion_type: conversionType
    });

    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: "Missing player_id"
      });
    }

    if (!conversionId) {
      return res.status(400).json({
        success: false,
        error: "Missing conversion_id"
      });
    }

    /*
      Install events normally have amount = 0.
      We only reward actual reward conversions.
    */

    if (
      conversionType === "install" ||
      amount <= 0 ||
      !Number.isInteger(amount)
    ) {
      return res.status(200).json({
        success: true,
        rewarded: false,
        reason: "Non-reward conversion"
      });
    }

    /*
      IMPORTANT:
      For the first version, player_id is expected
      to contain our database user ID.

      We will later replace this with a dedicated
      adgem_player_id column / mapping when the
      Offerwall link is built.
    */

    if (!/^\d+$/.test(playerId)) {
      console.error(
        "AdGem player_id is not a numeric user ID:",
        playerId
      );

      return res.status(400).json({
        success: false,
        error: "Unknown player_id format"
      });
    }

    const userId = Number(playerId);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /*
        Lock the user row so two simultaneous
        postbacks cannot update points incorrectly.
      */

      const userResult = await client.query(
        `SELECT *
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        await client.query("ROLLBACK");

        console.error(
          "AdGem user not found:",
          userId
        );

        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      /*
        conversion_id is unique in transactions.
        This prevents AdGem retries from paying
        the same conversion twice.
      */

      const existing = await client.query(
        `SELECT *
         FROM transactions
         WHERE transaction_id = $1
         LIMIT 1`,
        [conversionId]
      );

      if (existing.rows.length > 0) {
        await client.query("ROLLBACK");

        console.log(
          "Duplicate AdGem conversion:",
          conversionId
        );

        return res.status(200).json({
          success: true,
          duplicate: true,
          rewarded: false
        });
      }

      /*
        Find AdGem company
      */

      const companyResult = await client.query(
        `SELECT id
         FROM companies
         WHERE name = 'AdGem'
         LIMIT 1`
      );

      const companyId =
        companyResult.rows.length > 0
          ? companyResult.rows[0].id
          : null;

      /*
        Record conversion
      */

      const transactionResult = await client.query(
        `INSERT INTO transactions
         (
           user_id,
           company_id,
           transaction_id,
           type,
           points,
           description
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          companyId,
          conversionId,
          "reward",
          amount,
          `AdGem: ${data.offer_name || "Offer"}`
        ]
      );

      /*
        Add points
      */

      const updatedUser = await client.query(
        `UPDATE users
         SET points = points + $1
         WHERE id = $2
         RETURNING *`,
        [
          amount,
          userId
        ]
      );

      await client.query("COMMIT");

      console.log(
        `AdGem reward added: user=${userId}, points=${amount}`
      );

      return res.status(200).json({
        success: true,
        rewarded: true,
        points: amount,
        transaction_id: transactionResult.rows[0].transaction_id,
        user: updatedUser.rows[0]
      });

    } catch (error) {
      await client.query("ROLLBACK");

      /*
        If another request inserted the same
        conversion_id at the same time, PostgreSQL
        can reject it because transaction_id is UNIQUE.
      */

      if (error.code === "23505") {
        console.log(
          "Duplicate AdGem conversion detected by database:",
          conversionId
        );

        return res.status(200).json({
          success: true,
          duplicate: true,
          rewarded: false
        });
      }

      console.error(
        "AdGem reward database error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Reward processing failed"
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error(
      "AdGem postback error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Postback processing failed"
    });
  }
});

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not Found"
  });
});

/* =========================
   Start
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Reward App running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}

startServer();
