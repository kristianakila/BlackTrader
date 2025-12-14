const { db } = require('../config/firebase');
const EncryptionService = require('./encryptionService');

class FirebaseService {
  constructor() {
    this.usersCollection = 'telegramUsers';
    this.bybitAccountsCollection = 'bybitAccounts';
  }

  async saveBybitCredentials(userId, apiKey, apiSecret) {
    try {
      const userRef = db.collection(this.usersCollection).doc(userId);
      const bybitRef = db.collection(this.bybitAccountsCollection).doc(userId);
      
      // Шифруем ключи
      const encryptedApiKey = EncryptionService.encrypt(apiKey);
      const encryptedApiSecret = EncryptionService.encrypt(apiSecret);
      
      // Сохраняем хэш для проверки уникальности
      const apiHash = EncryptionService.hash(apiKey + apiSecret);
      
      const accountData = {
        userId,
        apiKey: encryptedApiKey,
        apiSecret: encryptedApiSecret,
        apiHash,
        isConnected: true,
        connectedAt: new Date().toISOString(),
        lastSyncedAt: null,
        updatedAt: new Date().toISOString()
      };
      
      // Сохраняем в отдельной коллекции
      await bybitRef.set(accountData, { merge: true });
      
      // Обновляем статус в профиле пользователя
      await userRef.update({
        hasBybitAccount: true,
        bybitConnectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      return { success: true, message: 'Credentials saved successfully' };
    } catch (error) {
      console.error('Error saving Bybit credentials:', error);
      throw error;
    }
  }

  async getBybitCredentials(userId) {
    try {
      const bybitRef = db.collection(this.bybitAccountsCollection).doc(userId);
      const doc = await bybitRef.get();
      
      if (!doc.exists) {
        return null;
      }
      
      const data = doc.data();
      return {
        apiKey: data.apiKey,
        apiSecret: data.apiSecret,
        connectedAt: data.connectedAt,
        lastSyncedAt: data.lastSyncedAt
      };
    } catch (error) {
      console.error('Error getting Bybit credentials:', error);
      throw error;
    }
  }

  async disconnectBybitAccount(userId) {
    try {
      const userRef = db.collection(this.usersCollection).doc(userId);
      const bybitRef = db.collection(this.bybitAccountsCollection).doc(userId);
      
      // Удаляем из коллекции аккаунтов
      await bybitRef.delete();
      
      // Обновляем статус в профиле пользователя
      await userRef.update({
        hasBybitAccount: false,
        bybitDisconnectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      return { success: true, message: 'Account disconnected successfully' };
    } catch (error) {
      console.error('Error disconnecting Bybit account:', error);
      throw error;
    }
  }

  async saveTrades(userId, trades) {
    try {
      const tradesRef = db.collection('trades').doc(userId);
      
      const batchData = {
        userId,
        trades: trades,
        syncedAt: new Date().toISOString(),
        count: trades.length
      };
      
      await tradesRef.set(batchData, { merge: true });
      
      // Обновляем время последней синхронизации в аккаунте
      const bybitRef = db.collection(this.bybitAccountsCollection).doc(userId);
      await bybitRef.update({
        lastSyncedAt: new Date().toISOString()
      });
      
      return { success: true };
    } catch (error) {
      console.error('Error saving trades:', error);
      throw error;
    }
  }

  async getUserTrades(userId) {
    try {
      const tradesRef = db.collection('trades').doc(userId);
      const doc = await tradesRef.get();
      
      if (!doc.exists) {
        return [];
      }
      
      return doc.data().trades || [];
    } catch (error) {
      console.error('Error getting user trades:', error);
      throw error;
    }
  }

  async checkAccountExists(userId, apiHash) {
    try {
      const querySnapshot = await db.collection(this.bybitAccountsCollection)
        .where('apiHash', '==', apiHash)
        .get();
      
      return !querySnapshot.empty;
    } catch (error) {
      console.error('Error checking account existence:', error);
      throw error;
    }
  }
}

module.exports = new FirebaseService();
