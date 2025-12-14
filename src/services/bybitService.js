const { RestClientV5 } = require('bybit-api');
const EncryptionService = require('./encryptionService');

class BybitService {
  constructor() {
    this.testnet = process.env.BYBIT_TESTNET === 'true';
  }

  createClient(apiKey, apiSecret) {
    try {
      const decryptedApiKey = EncryptionService.decrypt(apiKey);
      const decryptedApiSecret = EncryptionService.decrypt(apiSecret);
      
      return new RestClientV5({
        key: decryptedApiKey,
        secret: decryptedApiSecret,
        testnet: this.testnet,
        enable_time_sync: true,
      });
    } catch (error) {
      console.error('Error creating Bybit client:', error);
      throw new Error('Invalid API credentials');
    }
  }

  async testConnection(apiKey, apiSecret) {
    try {
      const client = this.createClient(apiKey, apiSecret);
      const result = await client.getApiKeyInfo();
      
      if (result.retCode !== 0) {
        throw new Error(result.retMsg || 'Connection test failed');
      }
      
      // Проверяем разрешения API ключа
      const permissions = result.result?.[0]?.permissions;
      if (!permissions || !permissions.includes('ContractTrade')) {
        throw new Error('API key needs ContractTrade permission (Read-Only)');
      }
      
      return {
        success: true,
        uid: result.result?.[0]?.uid,
        permissions: permissions
      };
    } catch (error) {
      console.error('Bybit connection test error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getTrades(apiKey, apiSecret, params = {}) {
    try {
      const client = this.createClient(apiKey, apiSecret);
      
      const response = await client.getExecutionHistory({
        category: 'linear',
        limit: 20,
        ...params
      });
      
      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to fetch trades');
      }
      
      return {
        success: true,
        trades: this.formatTrades(response.result.list || []),
        total: response.result.list?.length || 0
      };
    } catch (error) {
      console.error('Error fetching trades:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getPositions(apiKey, apiSecret) {
    try {
      const client = this.createClient(apiKey, apiSecret);
      
      const response = await client.getPositionInfo({
        category: 'linear',
        settleCoin: 'USDT'
      });
      
      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to fetch positions');
      }
      
      return {
        success: true,
        positions: response.result.list || []
      };
    } catch (error) {
      console.error('Error fetching positions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  formatTrades(trades) {
    return trades.map(trade => ({
      id: trade.execId,
      symbol: trade.symbol,
      side: trade.side,
      price: parseFloat(trade.execPrice),
      quantity: parseFloat(trade.execQty),
      time: this.formatTimestamp(trade.execTime),
      orderId: trade.orderId,
      orderLinkId: trade.orderLinkId,
      fee: parseFloat(trade.execFee || 0),
      feeCurrency: trade.feeCurrency,
      tradeType: trade.tradeType,
      pnl: parseFloat(trade.closedPnl || 0)
    }));
  }

  formatTimestamp(timestamp) {
    const date = new Date(parseInt(timestamp));
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
}

module.exports = new BybitService();
