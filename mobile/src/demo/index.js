// Демо-режим приложения: сервер работает внутри приложения, база хранится в файле на телефоне.
// Включается сборкой с EXPO_PUBLIC_API_URL=demo (профиль «demo» в eas.json).
import { File, Paths } from 'expo-file-system';
import { createDemoBackend } from './backend.generated';

const dbFile = () => new File(Paths.document, 'jetkiz750-demo-db.txt');
let backend = null;

export function demoBackend() {
  if (!backend) {
    backend = createDemoBackend({
      load: async () => { const f = dbFile(); return f.exists ? await f.text() : null; },
      save: async (s) => { const f = dbFile(); if (!f.exists) f.create(); await f.write(s); },
    });
  }
  return backend;
}

// «Начать заново»: стираем базу; новые демо-данные появятся при следующем запуске приложения
export function resetDemo() {
  backend?.stop();
  try { const f = dbFile(); if (f.exists) f.delete(); } catch {}
}
