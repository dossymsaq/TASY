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
  // SMS о статусах заказа (оформлен, курьер везёт, доставлен, отменён). По умолчанию выключены:
  // уведомления идут push-ом в приложение, а покупателю продавец сам отправляет ссылку. SMS_STATUS=1 — включить.
  SMS_STATUS: process.env.SMS_STATUS === '1',
  // Продавцы работают по договору: самостоятельная регистрация продавца — это заявка,
  // владелец одобряет её в кабинете. SELLER_APPROVAL=0 — открывать доступ сразу.
  SELLER_APPROVAL: process.env.SELLER_APPROVAL !== '0',
  // Аккаунты продавцов и курьеров выдаёт владелец. SELLER_SIGNUP=1 — разрешить продавцам подавать заявку самим.
  SELLER_SIGNUP: process.env.SELLER_SIGNUP === '1',
  // Режим запуска. LAUNCH_MODE=soft — «мягкий старт» без договоров с банком и SMS-сервисом:
  //   оплата только наличными курьеру (продавец — при заборе, покупатель — при получении),
  //   вход по паролю, клиенты отслеживают посылку по ссылке без входа.
  // Отдельно: ONLINE_PAYMENTS=0/1, SMS_LOGIN=0/1.
  LAUNCH_MODE: process.env.LAUNCH_MODE === 'soft' ? 'soft' : 'full',
  get ONLINE_PAYMENTS() { return process.env.ONLINE_PAYMENTS ? process.env.ONLINE_PAYMENTS === '1' : this.LAUNCH_MODE !== 'soft'; },
  get SMS_LOGIN() { return process.env.SMS_LOGIN ? process.env.SMS_LOGIN === '1' : this.LAUNCH_MODE !== 'soft'; },
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
