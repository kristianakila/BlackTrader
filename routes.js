import express from "express";
import { db } from "./firebase.js";
import { getTrades } from "./bybit.js";

const router = express.Router();

/**
 * 🔐 Подключение аккаунта Bybit
 */
router.post("/bybit/connect", async (req, res) => {
  const { userId, apiKey, apiSecret } = req.body;

  if (!userId || !apiKey || !apiSecret) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  try {
    await db.doc(`telegramUsers/${userId}`).set({
      bybit: {
        apiKey,
        apiSecret,
        createdAt: new Date()
      }
    }, { merge: true });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SAVE_FAILED" });
  }
});

/**
 * 📊 Получение сделок
 */
router.get("/bybit/trades/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const snap = await db.doc(`telegramUsers/${userId}`).get();

    if (!snap.exists || !snap.data().bybit) {
      return res.status(404).json({ error: "BYBIT_NOT_CONNECTED" });
    }

    const { apiKey, apiSecret } = snap.data().bybit;

    const trades = await getTrades({ apiKey, apiSecret });

    res.json({ trades });
  } catch (e) {
    res.status(500).json({ error: "FETCH_FAILED" });
  }
});

export default router;
