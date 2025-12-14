const BybitService = require('../services/bybitService');
const FirebaseService = require('../services/firebaseService');
const EncryptionService = require('../services/encryptionService');

class BybitController {
  async connectAccount(req, res) {
    try {
      const { userId, apiKey, apiSecret } = req.body;
      
      if (!userId || !apiKey || !apiSecret) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }
      
      // Проверяем, не подключен ли уже этот аккаунт
      const apiHash = EncryptionService.hash(apiKey + apiSecret);
      const accountExists = await FirebaseService.checkAccountExists(userId, apiHash);
      
      if (accountExists) {
        return res.status(400).json({
          success: false,
          error: 'This account is already connected'
        });
      }
      
      // Тестируем подключение к Bybit
      const testResult = await BybitService.testConnection(apiKey, apiSecret);
      
      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          error: testResult.error
        });
      }
      
      // Сохраняем учетные данные
      await FirebaseService.saveBybitCredentials(userId, apiKey, apiSecret);
      
      // Получаем последние сделки
      const tradesResult = await BybitService.getTrades(apiKey, apiSecret);
      
      if (tradesResult.success) {
        await FirebaseService.saveTrades(userId, tradesResult.trades);
      }
      
      res.json({
        success: true,
        message: 'Account connected successfully',
        userInfo: {
          uid: testResult.uid,
          permissions: testResult.permissions
        },
        initialTrades: tradesResult.success ? tradesResult.trades : []
      });
      
    } catch (error) {
      console.error('Connect account error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async getTrades(req, res) {
    try {
      const { userId } = req.params;
      
      // Получаем учетные данные из Firebase
      const credentials = await FirebaseService.getBybitCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Bybit account not found'
        });
      }
      
      // Получаем сделки из Bybit
      const tradesResult = await BybitService.getTrades(
        credentials.apiKey,
        credentials.apiSecret
      );
      
      if (!tradesResult.success) {
        // Если не удалось получить с Bybit, возвращаем кэшированные
        const cachedTrades = await FirebaseService.getUserTrades(userId);
        
        return res.json({
          success: true,
          trades: cachedTrades,
          source: 'cache',
          message: tradesResult.error
        });
      }
      
      // Сохраняем новые сделки
      await FirebaseService.saveTrades(userId, tradesResult.trades);
      
      res.json({
        success: true,
        trades: tradesResult.trades,
        source: 'bybit',
        total: tradesResult.total
      });
      
    } catch (error) {
      console.error('Get trades error:', error);
      
      // Попытка вернуть кэшированные данные при ошибке
      try {
        const cachedTrades = await FirebaseService.getUserTrades(req.params.userId);
        
        res.json({
          success: true,
          trades: cachedTrades,
          source: 'cache_fallback',
          error: error.message
        });
      } catch (cacheError) {
        res.status(500).json({
          success: false,
          error: error.message || 'Internal server error'
        });
      }
    }
  }

  async getPositions(req, res) {
    try {
      const { userId } = req.params;
      
      const credentials = await FirebaseService.getBybitCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Bybit account not found'
        });
      }
      
      const positionsResult = await BybitService.getPositions(
        credentials.apiKey,
        credentials.apiSecret
      );
      
      if (!positionsResult.success) {
        return res.status(400).json({
          success: false,
          error: positionsResult.error
        });
      }
      
      res.json({
        success: true,
        positions: positionsResult.positions
      });
      
    } catch (error) {
      console.error('Get positions error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async disconnectAccount(req, res) {
    try {
      const { userId } = req.params;
      
      await FirebaseService.disconnectBybitAccount(userId);
      
      res.json({
        success: true,
        message: 'Account disconnected successfully'
      });
      
    } catch (error) {
      console.error('Disconnect account error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async checkConnection(req, res) {
    try {
      const { userId } = req.params;
      
      const credentials = await FirebaseService.getBybitCredentials(userId);
      
      if (!credentials) {
        return res.json({
          connected: false,
          connectedAt: null,
          lastSyncedAt: null
        });
      }
      
      // Тестируем подключение
      const testResult = await BybitService.testConnection(
        credentials.apiKey,
        credentials.apiSecret
      );
      
      res.json({
        connected: testResult.success,
        connectedAt: credentials.connectedAt,
        lastSyncedAt: credentials.lastSyncedAt,
        testResult: testResult
      });
      
    } catch (error) {
      console.error('Check connection error:', error);
      res.json({
        connected: false,
        error: error.message
      });
    }
  }
}

module.exports = new BybitController();
