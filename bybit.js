import axios from "axios";
import CryptoJS from "crypto-js";

const BASE_URL = "https://api.bybit.com";

function sign(params, secret) {
  const ordered = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");

  return CryptoJS.HmacSHA256(ordered, secret).toString();
}

export async function getTrades({ apiKey, apiSecret }) {
  const timestamp = Date.now();

  const params = {
    api_key: apiKey,
    timestamp,
    limit: 50,
    recv_window: 5000
  };

  const signature = sign(params, apiSecret);

  try {
    const res = await axios.get(`${BASE_URL}/v5/execution/list`, {
      params: {
        ...params,
        sign: signature
      }
    });

    return res.data.result.list;
  } catch (err) {
    console.error("Bybit error:", err.response?.data || err.message);
    throw new Error("BYBIT_REQUEST_FAILED");
  }
}
