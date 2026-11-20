// Бизнес-правила сервиса «Жеткіз 750»
module.exports = {
  PORT: Number(process.env.PORT || 3000),
  DB_FILE: process.env.DB_FILE || __dirname + '/data.sqlite',
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
