import express from "express";
import cors from "cors";
import axios from "axios";
import CryptoJS from "crypto-js";
import { db } from "./firebase.js";
import { PORT, ENCRYPTION_KEY, BYBIT_BASE_URL } from "./env.js";

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   Encryption helpers
========================= */
function encrypt(text) {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decrypt(cipher) {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
  const bytes = CryptoJS.AES.decrypt(cipher, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/* =========================
   Bybit signature
========================= */
function signBybit(secret, params) {
  const ordered = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const query = Object.entries(ordered)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return CryptoJS.HmacSHA256(query, secret).toString();
}

/* =========================
   Connect Bybit
========================= */
app.post("/api/bybit/connect", async (req, res) => {
  try {
    const { userId, apiKey, apiSecret } = req.body;
    if (!userId || !apiKey || !apiSecret) {
      return res.status(400).json({ error: "Missing params" });
    }

    await db.doc(`telegramUsers/${userId}`).set(
      {
        bybit: {
          apiKey: encrypt(apiKey),
          apiSecret: encrypt(apiSecret),
          connectedAt: new Date(),
        },
      },
      { merge: true }
    );

    res.json({ success: true });
  } catch (e) {
    console.error("Bybit connect error:", e);
    res.status(500).json({ error: "Bybit connect failed" });
  }
});

/* =========================
   CLOSED PNL (CORRECT)
========================= */
app.get("/api/bybit/trades/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const snap = await db.doc(`telegramUsers/${userId}`).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const bybit = snap.data()?.bybit;
    if (!bybit) {
      return res.status(400).json({ error: "Bybit not connected" });
    }

    const apiKey = decrypt(bybit.apiKey);
    const apiSecret = decrypt(bybit.apiSecret);

    const timestamp = Date.now();
    const params = {
      api_key: apiKey,
      timestamp,
      recv_window: 5000,
      category: "linear",
      limit: 50
    };

    const sign = signBybit(apiSecret, params);

    const response = await axios.get(
      `${BYBIT_BASE_URL}/v5/position/closed-pnl`,
      { params: { ...params, sign } }
    );

    const list = response.data?.result?.list || [];

    const trades = list.map(trade => {
      const qty = Number(trade.qty || 0);
      const entryPrice = Number(trade.avgEntryPrice || 0);
      const exitPrice = Number(trade.avgExitPrice || 0);
      const closedPnl = Number(trade.closedPnl || 0);

      const execValue = qty * entryPrice;
      const pnlPercent = execValue ? (closedPnl / execValue) * 100 : 0;

      // ИНВЕРТИРУЕМ СТОРОНУ!
      // Bybit API возвращает "Buy" для шорта и "Sell" для лонга в closed-pnl
      // Исправляем чтобы фронтенд видел правильные стороны
      const invertedSide = trade.side === "Buy" ? "Sell" : "Buy";

      return {
        symbol: trade.symbol,
        side: invertedSide, // ← ИСПРАВЛЕНО ЗДЕСЬ!
        execQty: qty,
        entryPrice,
        exitPrice,
        closedPnl: Number(closedPnl.toFixed(6)),
        pnlPercent: Number(pnlPercent.toFixed(2)),
        execValue: Number(execValue.toFixed(2)),
        execTime: Number(trade.updatedTime),
        timeFormatted: new Date(Number(trade.updatedTime)).toLocaleString("ru-RU")
      };
    });

    res.json({ success: true, trades });

  } catch (e) {
    console.error("Closed PnL error:", e?.response?.data || e);
    res.status(500).json({ error: "Failed to fetch closed PnL" });
  }
});

/* =========================
   Get user keys
========================= */
app.get("/api/user/keys/:userId", async (req, res) => {
  try {
    const snap = await db.doc(`telegramUsers/${req.params.userId}`).get();
    if (!snap.exists || !snap.data()?.bybit) {
      return res.status(404).json({ success: false });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

/* =========================
   Remove keys
========================= */
app.post("/api/user/remove-keys", async (req, res) => {
  try {
    const { userId } = req.body;
    await db.doc(`telegramUsers/${userId}`).set({ bybit: null }, { merge: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

/* =========================
   Health
========================= */
app.get("/", (_, res) => res.send("OK"));

/* =========================
   Start server
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
