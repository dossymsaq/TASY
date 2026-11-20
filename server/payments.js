// Платёжный модуль.
// Сейчас работает в тестовом режиме (MOCK): любой платёж проходит успешно.
// Для продакшена замените charge()/refund() на вызовы Kaspi Pay / Freedom Pay / Halyk ePay:
//  1) charge() создаёт счёт у провайдера и возвращает ссылку на оплату;
//  2) провайдер присылает webhook → вызвать markPaid() в routes.
const crypto = require('node:crypto');

const MODE = process.env.PAYMENT_MODE || 'mock';

async function charge({ orderCode, payer, amount }) {
  if (MODE !== 'mock') throw new Error('Платёжный провайдер не настроен');
  return { ok: true, provider_ref: `MOCK-${orderCode}-${payer}-${crypto.randomBytes(3).toString('hex')}`, amount };
}

async function refund({ provider_ref }) {
  if (MODE !== 'mock') throw new Error('Платёжный провайдер не настроен');
  return { ok: true, provider_ref };
}

module.exports = { charge, refund, MODE };
