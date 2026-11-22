// Демо-заказы для витрины (DEMO_ORDERS=1): чтобы в кабинетах сразу было что посмотреть.
// Создаются через собственное API сервера, только при пустой базе и тестовых платежах.
const { db } = require('./db');

module.exports = async function seedDemoOrders(base) {
  if (db.prepare('SELECT COUNT(*) n FROM orders').get().n > 0) return;
  const api = async (m, u, body, t) => {
    const r = await fetch(base + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(`${u}: ${data.error}`);
    return data;
  };
  const login = async (phone, password) => (await api('POST', '/auth/login', { phone, password })).token;
  const seller = await login('77000000004', 'seller123');
  const courier = await login('77000000003', 'courier123');
  const order = async (o, paid = true) => {
    const r = await api('POST', '/seller/orders', { district: 'Есиль', weight_kg: 1, pay_now: paid, ...o }, seller);
    if (paid) await api('POST', '/payments/callback/mock', { invoice: r.invoice, result: 'ok' });
    return r.order;
  };
  const a = await order({ buyer_name: 'Асель', buyer_phone: '77000000005', address: 'ул. Кенесары, 40, кв 12', item_desc: 'Букет роз' });
  const b = await order({ buyer_name: 'Ержан', buyer_phone: '77011112233', address: 'пр. Туран, 18', district: 'Нура', item_desc: 'Книга', weight_kg: 0.5 });
  await order({ buyer_name: 'Мадина', buyer_phone: '77015550011', address: 'ул. Сарайшык, 7', district: 'Алматы', item_desc: 'Духи', weight_kg: 0.3 });
  await order({ buyer_name: 'Тимур', buyer_phone: '77019998877', address: 'ул. Достык, 5', item_desc: 'Часы', weight_kg: 0.4 }, false);
  for (const o of [a, b]) {
    await api('POST', `/courier/orders/${o.id}/take`, null, courier);
    await api('POST', `/courier/orders/${o.id}/pickup`, null, courier);
  }
  await api('POST', `/courier/orders/${b.id}/deliver`, { cash_received: true }, courier);
  await api('POST', '/tickets', { subject: 'Когда привезут?', message: 'Здравствуйте! Подскажите, во сколько ждать курьера?', contact_name: 'Асель', contact_phone: '77000000005', order_code: a.code });
  console.log(`Демо-заказы созданы. Страница покупателя: /t/${a.code}`);
};
