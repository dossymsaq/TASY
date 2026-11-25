import React from 'react';
import { ActivityIndicator, BackHandler, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, loadToken, saveToken } from './src/api';
import { Nav } from './src/nav';
import { Button, T, useTheme } from './src/ui';
import Auth from './src/screens/Auth';
import Profile from './src/screens/Profile';
import { NewOrder, SellerOrders, Shared } from './src/screens/Seller';
import { ClientOrders } from './src/screens/Client';
import { Available, Deliver, Done, Mine } from './src/screens/Courier';
import { Assign, Couriers, Dashboard, Orders, Users } from './src/screens/Admin';
import { TicketChat, Tickets } from './src/screens/Support';
import { CourierMoney, Wallet } from './src/screens/Money';

// Вкладки для каждой роли: [ключ, иконка, подпись, экран]
const TABS = {
  seller: [['new', '➕', 'Заказ', NewOrder], ['orders', '📦', 'Мои заказы', SellerOrders], ['support', '💬', 'Поддержка', Tickets], ['profile', '👤', 'Профиль', Profile]],
  client: [['orders', '📦', 'Посылки', ClientOrders], ['support', '💬', 'Поддержка', Tickets], ['profile', '👤', 'Профиль', Profile]],
  courier: [['available', '🔔', 'Доступные', Available], ['mine', '🛵', 'Мои', Mine], ['done', '✅', 'История', Done], ['wallet', '💰', 'Деньги', Wallet], ['profile', '👤', 'Профиль', Profile]],
  admin: [['dash', '📊', 'Обзор', Dashboard], ['orders', '📦', 'Заказы', Orders], ['couriers', '🛵', 'Курьеры', Couriers], ['users', '👥', 'Люди', Users], ['tickets', '💬', 'Обращения', Tickets]],
  support: [['tickets', '💬', 'Обращения', Tickets], ['orders', '🔎', 'Заказы', Orders], ['profile', '👤', 'Профиль', Profile]],
};
const STACK = { ticket: TicketChat, shared: Shared, deliver: Deliver, assign: Assign, profile: Profile, courierMoney: CourierMoney, support: Tickets };

function Main() {
  const th = useTheme();
  const [boot, setBoot] = React.useState(true);
  const [bootErr, setBootErr] = React.useState('');
  const [cfg, setCfg] = React.useState(null);
  const [user, setUser] = React.useState(null);
  const [tab, setTab] = React.useState(null);
  const [stack, setStack] = React.useState([]);

  const start = React.useCallback(async () => {
    setBoot(true); setBootErr('');
    try {
      setCfg(await api('GET', '/config'));
      if (await loadToken()) {
        try { setUser((await api('GET', '/me')).user); } catch { await saveToken(null); }
      }
    } catch (e) { setBootErr(e.message); }
    setBoot(false);
  }, []);
  React.useEffect(() => { start(); }, [start]);
  React.useEffect(() => { if (user) setTab((t) => (TABS[user.role].some((x) => x[0] === t) ? t : TABS[user.role][0][0])); }, [user]);
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { setStack((s) => s.slice(0, -1)); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  const nav = React.useMemo(() => ({
    user, cfg, setUser,
    push: (name, params = {}) => setStack((s) => [...s, { name, params }]),
    pop: () => setStack((s) => s.slice(0, -1)),
    logout: async () => { try { await api('POST', '/auth/logout'); } catch {} await saveToken(null); setUser(null); setStack([]); },
  }), [user, cfg]);

  if (boot) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={th.brand} /></View>;
  if (bootErr) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      <T bold size={18}>{bootErr}</T><T muted>Проверьте интернет и попробуйте снова</T><Button title="Повторить" onPress={start} />
    </View>
  );
  if (!user) return <Nav.Provider value={nav}><Auth onLogin={setUser} cfg={cfg} /></Nav.Provider>;

  const tabs = TABS[user.role];
  const top = stack[stack.length - 1];
  const current = tabs.find((t) => t[0] === tab) || tabs[0];
  const Screen = top ? STACK[top.name] : current[3];
  const title = top ? top.params.title || '' : current[2];

  return (
    <Nav.Provider value={nav}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 52, borderBottomWidth: 1, borderColor: th.line, backgroundColor: th.card, gap: 12 }}>
        {top ? <Pressable onPress={nav.pop} hitSlop={12}><Text style={{ fontSize: 22, color: th.brand }}>‹ Назад</Text></Pressable> : <T bold size={18}>Жеткіз <T bold size={18} style={{ backgroundColor: '#fec50c', color: '#14212b' }}> 750 </T></T>}
        <T bold numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{title}</T>
        {!top && user.role === 'admin' ? <Pressable onPress={() => nav.push('profile', { title: 'Профиль' })} hitSlop={12}><Text style={{ fontSize: 20 }}>👤</Text></Pressable> : null}
        {!top && user.role === 'courier' ? <Pressable onPress={() => nav.push('support', { title: 'Поддержка' })} hitSlop={12} accessibilityLabel="Поддержка"><Text style={{ fontSize: 20 }}>💬</Text></Pressable> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Screen key={top ? stack.length + top.name : current[0]} {...(top?.params || {})} />
      </View>
      {!top ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: th.line, backgroundColor: th.card }}>
          {tabs.map(([k, icon, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }} accessibilityRole="tab" accessibilityState={{ selected: k === current[0] }}>
              <Text style={{ fontSize: 20, opacity: k === current[0] ? 1 : 0.5 }}>{icon}</Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: k === current[0] ? th.brand : th.muted }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Nav.Provider>
  );
}

export default function App() {
  const th = useTheme();
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: th.bg }} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <Main />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
