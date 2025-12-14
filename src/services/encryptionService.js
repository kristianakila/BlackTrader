const CryptoJS = require('crypto-js');

class EncryptionService {
  constructor() {
    this.secretKey = process.env.ENCRYPTION_SECRET || 'your-secret-key-change-in-production';
  }

  encrypt(text) {
    try {
      return CryptoJS.AES.encrypt(text, this.secretKey).toString();
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Encryption failed');
    }
  }

  decrypt(ciphertext) {
    try {
      const bytes = CryptoJS.AES.decrypt(ciphertext, this.secretKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Decryption failed');
    }
  }

  hash(text) {
    return CryptoJS.SHA256(text).toString();
  }
}

module.exports = new EncryptionService();
