// Feature flags. Every feature can be toggled independently on the options page.

export interface FeatureDef {
  id: string;
  name: string; // Uzbek, user-visible
  defaultOn: boolean;
  description: string; // Uzbek, user-visible
}

export const FEATURES: FeatureDef[] = [
  { id: 'F1', name: 'Chatni aniqlash', defaultOn: true, description: "Ochiq chat ID va nomini URL va sarlavhadan o'qish" },
  { id: 'F2', name: 'Panel (dock)', defaultOn: true, description: "Telegram ichida o'ng tomonda panel (Alt+T)" },
  { id: 'F3', name: 'Tiket kartasi', defaultOn: true, description: 'Mijoz, status, SLA taymeri, tarix' },
  { id: 'F4', name: 'Status tugmalari', defaultOn: true, description: "Men olaman / Kutilmoqda / Hal bo'ldi, qayta biriktirish" },
  { id: 'F5', name: 'Shablonlar', defaultOn: true, description: "Shablonlar ro'yxati va ';' bilan tezkor chaqirish" },
  { id: 'F6', name: "Yozish maydoniga qo'yish", defaultOn: true, description: "Matnni composerga qo'yish (yuborilmaydi)" },
  { id: 'F7', name: "Xabarlarni o'qish (tajriba)", defaultOn: true, description: "Oxirgi xabarlarni DOM'dan o'qish" },
  { id: 'F8', name: 'Xabar ustida TP tugmasi', defaultOn: true, description: 'Xabar ustiga kursor olib borilganda menyu' },
  { id: 'F9', name: 'AI javob qoralamasi', defaultOn: true, description: 'Server bilim bazasidan javob qoralamasi tayyorlaydi' },
  { id: 'F10', name: 'Tavsiya chiplari', defaultOn: true, description: "Composer ustida mos shablon/maqola chiplari" },
  { id: 'F11', name: "Chatlar ro'yxatida belgilar", defaultOn: true, description: "Chatlar ro'yxatida status nuqtalari" },
  { id: 'F12', name: 'Buyruqlar palitrasi', defaultOn: true, description: 'Ctrl+K / Alt+K bilan qidiruv' },
  { id: 'F14', name: 'Bildirishnomalar va badge', defaultOn: true, description: "Biriktirish/SLA bildirishnomasi, ikonka badge" },
  { id: 'F15', name: 'Yon panel (side panel)', defaultOn: true, description: 'Chrome yon panelida bir xil kontent' },
];

export const defaultFlags = (): Record<string, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f.id, f.defaultOn]));
