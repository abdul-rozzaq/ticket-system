// Tiny i18n: `uz` is the default; add `ru` later by filling the dictionary below (missing keys fall back to uz).
export type Lang = 'uz' | 'ru';

const uz = {
  'app.name': 'TP Yordam tizimi',
  'auth.invalidCredentials': "Login yoki parol noto'g'ri",
  'auth.locked': "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring",
  'auth.inactive': 'Foydalanuvchi faol emas',
  'auth.forbidden': "Bu amal uchun ruxsat yo'q",
  'auth.mustChangePassword': "Davom etish uchun parolni o'zgartiring",
  'auth.weakPassword': "Parol kamida 10 ta belgidan iborat bo'lishi kerak",
  'ticket.new': 'Yangi tiket',
  'ticket.taken': '✅ {name} tomonidan olindi',
  'ticket.alreadyTaken': 'Bu tiketni allaqachon {name} olgan',
  'ticket.closed': 'Tiket yopildi',
  'ticket.notFound': 'Tiket topilmadi',
  'status.NEW': 'Yangi',
  'status.IN_PROGRESS': 'Jarayonda',
  'status.WAITING_CLIENT': 'Mijoz kutilmoqda',
  'status.CLOSED': 'Yopilgan',
  'urgency.HIGH': 'Shoshilinch',
  'urgency.NORMAL': 'Oddiy',
  'urgency.LOW': 'Past',
  'stage.NEW': '🆕 Yangi',
  'stage.WAITING': '⏳ Kutilmoqda',
  'stage.OVERDUE': '🔴 Kechikkan',
  'stage.CLOSED': '✅ Yopilgan',
  'bot.takeButton': '🙋 Men olaman',
  'bot.snoozeButton': '⏭ Keyinroq',
  'bot.openChat': '🔗 Chatni ochish',
  'bot.reassign': "Boshqaga o'tkazish",
  'bot.done': "Hal bo'ldi",
  'bot.wait': 'Kutilmoqda',
  'bot.linked': "✅ Hisobingiz bog'landi, {name}",
  'bot.badCode': "Kod noto'g'ri yoki muddati o'tgan",
  'bot.notStaff': "Siz xodim sifatida bog'lanmagansiz",
  'bot.digest': 'Bugun sizda {open} ta ochiq tiket, {overdue} tasi kechikkan',
  'kb.notFound': 'Bazada topilmadi',
  'error.validation': "Kiritilgan ma'lumotlar noto'g'ri",
  'error.internal': 'Ichki xatolik',
} as const;

export type I18nKey = keyof typeof uz;
const ru: Partial<Record<I18nKey, string>> = {};
const dicts: Record<Lang, Partial<Record<I18nKey, string>>> = { uz, ru };

export function t(key: I18nKey, params: Record<string, string | number> = {}, lang: Lang = 'uz'): string {
  const raw: string = dicts[lang][key] ?? uz[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (w, k: string) => (k in params ? String(params[k]) : w));
}
