// Бизнес-правила сервиса «Жеткіз 750»
module.exports = {
  PORT: Number(process.env.PORT || 3000),
  DB_FILE: process.env.DB_FILE || __dirname + '/data.sqlite',
  // Адрес сайта — используется в ссылках из SMS (https://jetkiz750.kz)
  // На Render адрес берётся автоматически из RENDER_EXTERNAL_URL
  PUBLIC_URL: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  OTP_SECRET: process.env.OTP_SECRET || 'dev-otp-secret', // в продакшене задайте случайную строку
  OTP_LENGTH: 4,
  OTP_TTL_MIN: 5,
  OTP_RESEND_SEC: 60,
  OTP_MAX_ATTEMPTS: 5,
  CITY: 'Астана',
  PRICE_SELLER: 750, // платит продавец (наш клиент)
  PRICE_BUYER: 750,  // платит покупатель продавца
  MAX_WEIGHT_KG: 2,
  DISTRICTS: ['Алматы', 'Байконур', 'Есиль', 'Сарыарка', 'Нура'],
  STATUSES: {
    new: 'Ожидает оплаты продавцом',
    ready: 'Ищем курьера',
    assigned: 'Курьер назначен',
    picked_up: 'В пути',
    delivered: 'Доставлен',
    cancelled: 'Отменён',
  },
};
