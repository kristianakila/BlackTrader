const crypto = require('crypto');

function verifyTelegramWebAppData(telegramInitData) {
  try {
    const initData = new URLSearchParams(telegramInitData);
    const hash = initData.get('hash');
    initData.delete('hash');
    
    // Сортируем параметры
    const dataCheckString = Array.from(initData.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');
    
    // Создаем секретный ключ
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.TELEGRAM_BOT_TOKEN);
    
    // Проверяем хэш
    const calculatedHash = crypto.createHmac('sha256', secretKey.digest())
      .update(dataCheckString)
      .digest('hex');
    
    return calculatedHash === hash;
  } catch (error) {
    console.error('Telegram auth error:', error);
    return false;
  }
}

function authMiddleware(req, res, next) {
  // В режиме разработки пропускаем без проверки
  if (process.env.NODE_ENV === 'development') {
    req.userId = req.headers['x-user-id'] || 'test-user';
    return next();
  }
  
  const telegramInitData = req.headers['x-telegram-init-data'];
  
  if (!telegramInitData) {
    return res.status(401).json({
      success: false,
      error: 'Telegram authentication required'
    });
  }
  
  if (!verifyTelegramWebAppData(telegramInitData)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid Telegram authentication'
    });
  }
  
  // Извлекаем userId из данных Telegram
  const initData = new URLSearchParams(telegramInitData);
  const userStr = initData.get('user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      req.userId = user.id.toString();
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user data'
      });
    }
  } else {
    return res.status(400).json({
      success: false,
      error: 'User data not found'
    });
  }
  
  next();
}

module.exports = { authMiddleware };
