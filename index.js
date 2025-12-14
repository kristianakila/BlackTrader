const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // лимит запросов с одного IP
});
app.use('/api/', limiter);

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bybit-trading', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// Модели
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  apiKeyEncrypted: { type: String },
  apiSecretEncrypted: { type: String },
  isConnected: { type: Boolean, default: false },
  lastSynced: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const tradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tradeId: { type: String, required: true },
  symbol: { type: String, required: true },
  side: { type: String, enum: ['Buy', 'Sell'] },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  timestamp: { type: Date, required: true },
  orderId: { type: String },
  category: { type: String, default: 'spot' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Trade = mongoose.model('Trade', tradeSchema);

// Функции для шифрования
const encrypt = (text) => {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(process.env.ENCRYPTION_IV, 'hex');
  
  let cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return encrypted;
};

const decrypt = (encryptedText) => {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(process.env.ENCRYPTION_IV, 'hex');
  
  let decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

// JWT middleware
const authenticateTelegram = async (req, res, next) => {
  try {
    const initData = req.headers['telegram-init-data'];
    if (!initData) {
      return res.status(401).json({ error: 'No Telegram init data' });
    }

    // В реальном приложении нужно валидировать данные Telegram Web App
    // Здесь упрощенная версия для демонстрации
    
    const urlParams = new URLSearchParams(initData);
    const userId = urlParams.get('user') ? JSON.parse(urlParams.get('user')).id : null;
    
    if (!userId) {
      return res.status(401).json({ error: 'Invalid Telegram user' });
    }

    req.telegramUserId = userId.toString();
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Bybit API интеграция
class BybitService {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseURL = 'https://api.bybit.com';
  }

  async makeRequest(method, endpoint, params = {}) {
    const timestamp = Date.now().toString();
    const queryString = Object.keys(params).length > 0 
      ? '?' + new URLSearchParams(params).toString() 
      : '';
    
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(timestamp + this.apiKey + '5000' + queryString)
      .digest('hex');

    const config = {
      method,
      url: `${this.baseURL}${endpoint}${queryString}`,
      headers: {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': '5000'
      }
    };

    if (method === 'POST') {
      config.headers['Content-Type'] = 'application/json';
      config.data = params;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Bybit API error:', error.response?.data || error.message);
      throw error;
    }
  }

  async validateCredentials() {
    try {
      const result = await this.makeRequest('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED',
        coin: 'USDT'
      });
      return result.retCode === 0;
    } catch (error) {
      return false;
    }
  }

  async getTrades(category = 'spot', limit = 50) {
    try {
      const result = await this.makeRequest('GET', '/v5/execution/list', {
        category,
        limit
      });
      
      if (result.retCode === 0 && result.result.list) {
        return result.result.list.map(trade => ({
          tradeId: trade.execId,
          symbol: trade.symbol,
          side: trade.side,
          price: parseFloat(trade.execPrice),
          quantity: parseFloat(trade.execQty),
          timestamp: new Date(parseInt(trade.execTime)),
          orderId: trade.orderId,
          category
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching trades:', error);
      return [];
    }
  }

  async getPositions(category = 'linear') {
    try {
      const result = await this.makeRequest('GET', '/v5/position/list', {
        category
      });
      return result.retCode === 0 ? result.result.list : [];
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }
}

// Роуты

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Проверка подключения аккаунта
app.get('/api/account/status', authenticateTelegram, async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.telegramUserId });
    
    if (!user) {
      return res.json({ isConnected: false });
    }

    res.json({
      isConnected: user.isConnected,
      lastSynced: user.lastSynced
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Подключение аккаунта Bybit
app.post('/api/account/connect', authenticateTelegram, async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.body;
    
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret are required' });
    }

    // Валидация ключей через Bybit API
    const bybitService = new BybitService(apiKey, apiSecret);
    const isValid = await bybitService.validateCredentials();
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid API credentials' });
    }

    // Шифруем и сохраняем ключи
    const encryptedApiKey = encrypt(apiKey);
    const encryptedApiSecret = encrypt(apiSecret);

    // Сохраняем/обновляем пользователя
    let user = await User.findOne({ telegramId: req.telegramUserId });
    
    if (!user) {
      user = new User({
        telegramId: req.telegramUserId,
        apiKeyEncrypted: encryptedApiKey,
        apiSecretEncrypted: encryptedApiSecret,
        isConnected: true,
        lastSynced: new Date()
      });
    } else {
      user.apiKeyEncrypted = encryptedApiKey;
      user.apiSecretEncrypted = encryptedApiSecret;
      user.isConnected = true;
      user.lastSynced = new Date();
    }

    await user.save();

    // Получаем и сохраняем сделки
    const trades = await bybitService.getTrades();
    
    for (const trade of trades) {
      const existingTrade = await Trade.findOne({ 
        userId: user._id, 
        tradeId: trade.tradeId 
      });
      
      if (!existingTrade) {
        await Trade.create({
          userId: user._id,
          ...trade
        });
      }
    }

    res.json({
      success: true,
      message: 'Account connected successfully',
      tradesCount: trades.length
    });

  } catch (error) {
    console.error('Connect error:', error);
    res.status(500).json({ 
      error: 'Failed to connect account',
      details: error.response?.data || error.message 
    });
  }
});

// Получение сделок
app.get('/api/trades', authenticateTelegram, async (req, res) => {
  try {
    const { limit = 50, category = 'spot' } = req.query;
    
    const user = await User.findOne({ telegramId: req.telegramUserId });
    
    if (!user || !user.isConnected) {
      return res.status(400).json({ error: 'Account not connected' });
    }

    // Расшифровываем ключи
    const apiKey = decrypt(user.apiKeyEncrypted);
    const apiSecret = decrypt(user.apiSecretEncrypted);
    
    const bybitService = new BybitService(apiKey, apiSecret);
    
    // Получаем свежие данные
    const newTrades = await bybitService.getTrades(category, parseInt(limit));
    
    // Обновляем в базе
    for (const trade of newTrades) {
      const existingTrade = await Trade.findOne({ 
        userId: user._id, 
        tradeId: trade.tradeId 
      });
      
      if (!existingTrade) {
        await Trade.create({
          userId: user._id,
          ...trade
        });
      }
    }
    
    // Получаем из базы
    const dbTrades = await Trade.find({ userId: user._id })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    // Обновляем время синхронизации
    user.lastSynced = new Date();
    await user.save();

    res.json({
      success: true,
      trades: dbTrades.map(trade => ({
        id: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        quantity: trade.quantity,
        time: trade.timestamp,
        orderId: trade.orderId,
        category: trade.category
      })),
      lastSynced: user.lastSynced
    });

  } catch (error) {
    console.error('Trades fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch trades',
      details: error.response?.data || error.message 
    });
  }
});

// Отключение аккаунта
app.post('/api/account/disconnect', authenticateTelegram, async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.telegramUserId });
    
    if (user) {
      user.apiKeyEncrypted = null;
      user.apiSecretEncrypted = null;
      user.isConnected = false;
      await user.save();
      
      // Удаляем сделки пользователя
      await Trade.deleteMany({ userId: user._id });
    }
    
    res.json({ success: true, message: 'Account disconnected' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получение позиций
app.get('/api/positions', authenticateTelegram, async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.telegramUserId });
    
    if (!user || !user.isConnected) {
      return res.status(400).json({ error: 'Account not connected' });
    }

    const apiKey = decrypt(user.apiKeyEncrypted);
    const apiSecret = decrypt(user.apiSecretEncrypted);
    
    const bybitService = new BybitService(apiKey, apiSecret);
    const positions = await bybitService.getPositions();
    
    res.json({
      success: true,
      positions: positions.filter(p => parseFloat(p.size) > 0)
    });
  } catch (error) {
    console.error('Positions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Обработка 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
