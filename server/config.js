// Бизнес-правила сервиса «Жеткіз 750»
module.exports = {
  PORT: Number(process.env.PORT || 3000),
  DB_FILE: process.env.DB_FILE || __dirname + '/data.sqlite',
  CITY: 'Астана',
  PRICE_SELLER: 750, // платит продавец (наш клиент)
  PRICE_BUYER: 750,  // платит покупатель продавца
  MAX_WEIGHT_KG: 2,
  // Адрес сайта — для ссылок в уведомлениях (например, https://jetkiz750.kz)
  PUBLIC_URL: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Номера, которые при первом входе получают роль администратора (через запятую)
  ADMIN_PHONES: String(process.env.ADMIN_PHONES || '').split(',').map((p) => p.replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7')).filter(Boolean),
  // Сколько получает курьер за одну доставку (остальное — доход сервиса)
  COURIER_FEE: Number(process.env.COURIER_FEE || 1000),
  // Вход по SMS-коду
  OTP_TTL_MIN: 5,           // код действует 5 минут
  OTP_RESEND_SEC: 60,       // повторная отправка — не чаще раза в минуту
  OTP_MAX_ATTEMPTS: 5,      // попыток ввода на один код
  OTP_MAX_PER_HOUR: 5,      // SMS на один номер в час
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
