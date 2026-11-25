// Demo data: two fictional businesses, three weeks of history and two weeks ahead, all relative to "now".
// Everything is placed by walking each person's real schedule, so the sample day never contains an overlap.
import { ACTIVE, TZ, addDays, localParts, localToTs, staffWindows, dowOf } from './core.js';

const H = (h, m = 0) => h * 60 + m;
const week = (spec) => Array.from({ length: 7 }, (_, i) => spec[i] || null); // index 0 = Sunday

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const settings = () => ({ step: 15, minNotice: 120, windowDays: 30, cancelHours: 12, noShowLimit: 3, graceMin: 15, reminders: [1440, 120] });

const BUSINESSES = [
  {
    id: 'layali', type: 'salon', color: '#c2410c',
    name: { en: 'Layali Beauty Lounge', ar: 'صالون ليالي' }, tagline: { en: 'Hair, nails and skin care in Maadi', ar: 'شعر وأظافر وعناية بالبشرة في المعادي' },
    address: { en: '12 Road 9, Maadi, Cairo', ar: '١٢ شارع ٩، المعادي، القاهرة' }, phone: '0100 000 0101',
    hours: week({ 0: [H(10), H(21)], 1: [H(10), H(21)], 2: [H(10), H(21)], 3: [H(10), H(21)], 4: [H(10), H(21)], 5: [H(14), H(21)], 6: [H(10), H(21)] }),
    staff: [
      { id: 'st-hala', name: { en: 'Hala', ar: 'هالة' }, title: { en: 'Senior stylist', ar: 'ستايليست أولى' }, color: '#e76f51', hours: week({ 0: [H(10), H(19)], 1: [H(10), H(19)], 2: [H(10), H(19)], 3: [H(10), H(19)], 4: [H(10), H(19)], 6: [H(10), H(19)] }), breaks: [[H(14), H(15)]] },
      { id: 'st-mariam', name: { en: 'Mariam', ar: 'مريم' }, title: { en: 'Colour specialist', ar: 'أخصائية ألوان' }, color: '#8e5ea2', hours: week({ 0: [H(12), H(21)], 1: [H(12), H(21)], 3: [H(12), H(21)], 4: [H(12), H(21)], 5: [H(14), H(21)], 6: [H(12), H(21)] }), breaks: [[H(16), H(16, 45)]] },
      { id: 'st-nour', name: { en: 'Nour', ar: 'نور' }, title: { en: 'Nail artist', ar: 'فنانة أظافر' }, color: '#2a9d8f', hours: week({ 0: [H(10), H(20)], 1: [H(10), H(20)], 2: [H(10), H(20)], 3: [H(10), H(20)], 4: [H(10), H(20)], 6: [H(10), H(20)] }), breaks: [[H(15), H(15, 45)]] },
      { id: 'st-salma', name: { en: 'Salma', ar: 'سلمى' }, title: { en: 'Skin therapist', ar: 'أخصائية بشرة' }, color: '#3a86c8', hours: week({ 0: [H(11), H(20)], 2: [H(11), H(20)], 3: [H(11), H(20)], 4: [H(11), H(20)], 5: [H(14), H(20)], 6: [H(11), H(20)] }), breaks: [[H(15), H(15, 30)]] },
    ],
    services: [
      ['lay-cut', 'hair', 'Haircut and blow-dry', 'قص وسشوار', 'Consultation, wash, cut and styling.', 'استشارة وغسيل وقص وتصفيف.', 60, 0, 350, ['st-hala', 'st-mariam']],
      ['lay-blow', 'hair', 'Blow-dry', 'سشوار', 'Wash and blow-dry, any length.', 'غسيل وسشوار لأي طول.', 45, 0, 200, ['st-hala', 'st-mariam']],
      ['lay-color', 'hair', 'Root colour', 'صبغة جذور', 'Root touch-up with toner.', 'صبغة جذور مع تونر.', 120, 15, 900, ['st-mariam']],
      ['lay-high', 'hair', 'Highlights', 'هايلايت', 'Foil highlights, toner and finish.', 'هايلايت بالورق مع تونر وتصفيف.', 180, 15, 1800, ['st-mariam']],
      ['lay-kera', 'hair', 'Keratin treatment', 'كيراتين', 'Smoothing treatment, long lasting.', 'علاج تنعيم طويل المدى.', 150, 0, 2200, ['st-hala']],
      ['lay-mani', 'nails', 'Manicure', 'مانيكير', 'Shape, cuticle care and polish.', 'تشكيل وعناية بالجلد وطلاء.', 40, 0, 180, ['st-nour']],
      ['lay-pedi', 'nails', 'Pedicure', 'باديكير', 'Soak, scrub, shape and polish.', 'نقع وتقشير وتشكيل وطلاء.', 50, 0, 220, ['st-nour']],
      ['lay-gel', 'nails', 'Gel polish', 'جل', 'Long-wear gel colour on hands.', 'طلاء جل طويل الثبات لليدين.', 60, 0, 300, ['st-nour']],
      ['lay-facial', 'skin', 'Classic facial', 'تنظيف بشرة', 'Deep cleanse, mask and massage.', 'تنظيف عميق وماسك وتدليك.', 60, 10, 650, ['st-salma']],
      ['lay-hydra', 'skin', 'Hydrating facial', 'ترطيب بشرة', 'Hydration facial with serum infusion.', 'جلسة ترطيب مع سيروم.', 75, 10, 950, ['st-salma']],
      ['lay-massage', 'skin', 'Relaxing massage', 'مساج استرخاء', 'Back, neck and shoulders.', 'ظهر ورقبة وأكتاف.', 60, 10, 700, ['st-salma']],
    ],
    cats: { hair: ['Hair', 'شعر'], nails: ['Nails', 'أظافر'], skin: ['Skin and body', 'بشرة وجسم'] },
    weight: { 'lay-cut': 5, 'lay-blow': 4, 'lay-color': 3, 'lay-high': 1, 'lay-kera': 1, 'lay-mani': 5, 'lay-pedi': 3, 'lay-gel': 4, 'lay-facial': 3, 'lay-hydra': 2, 'lay-massage': 2 },
    phonePrefix: '010000001',
  },
  {
    id: 'pulse', type: 'gym', color: '#0f766e',
    name: { en: 'Pulse Training Studio', ar: 'بالس ستوديو' }, tagline: { en: 'One-to-one coaching in Nasr City', ar: 'تدريب فردي في مدينة نصر' },
    address: { en: '5 Mostafa El-Nahas St, Nasr City, Cairo', ar: '٥ شارع مصطفى النحاس، مدينة نصر، القاهرة' }, phone: '0100 000 0202',
    hours: week({ 0: [H(7), H(22)], 1: [H(7), H(22)], 2: [H(7), H(22)], 3: [H(7), H(22)], 4: [H(7), H(22)], 5: [H(14), H(20)], 6: [H(8), H(21)] }),
    staff: [
      { id: 'st-karim', name: { en: 'Karim', ar: 'كريم' }, title: { en: 'Strength coach', ar: 'مدرب قوة' }, color: '#0f766e', hours: week({ 0: [H(7), H(16)], 1: [H(7), H(16)], 2: [H(7), H(16)], 3: [H(7), H(16)], 4: [H(7), H(16)], 6: [H(8), H(14)] }), breaks: [[H(12), H(13)]] },
      { id: 'st-dina', name: { en: 'Dina', ar: 'دينا' }, title: { en: 'Pilates and yoga', ar: 'بيلاتس ويوجا' }, color: '#b45f06', hours: week({ 0: [H(9), H(19)], 1: [H(9), H(19)], 3: [H(9), H(19)], 4: [H(9), H(19)], 5: [H(14), H(20)], 6: [H(9), H(17)] }), breaks: [[H(13), H(14)]] },
      { id: 'st-omar', name: { en: 'Omar', ar: 'عمر' }, title: { en: 'Boxing and cardio', ar: 'ملاكمة وكارديو' }, color: '#7c3aed', hours: week({ 0: [H(14), H(22)], 1: [H(14), H(22)], 2: [H(14), H(22)], 3: [H(14), H(22)], 4: [H(14), H(22)], 5: [H(14), H(20)], 6: [H(12), H(21)] }), breaks: [[H(18), H(18, 30)]] },
      { id: 'st-rana', name: { en: 'Rana', ar: 'رنا' }, title: { en: 'Clinical dietitian', ar: 'أخصائية تغذية' }, color: '#be185d', hours: week({ 0: [H(10), H(18)], 2: [H(10), H(18)], 4: [H(10), H(18)], 6: [H(10), H(16)] }), breaks: [[H(14), H(14, 30)]] },
    ],
    services: [
      ['pul-intro', 'start', 'Intro assessment', 'تقييم مبدئي', 'Goals, movement screen and a starter plan.', 'الأهداف وفحص الحركة وخطة بداية.', 45, 0, 250, ['st-karim', 'st-dina', 'st-omar']],
      ['pul-pt', 'train', 'Personal training', 'تدريب شخصي', 'One hour, one coach, a plan built for you.', 'ساعة مع مدرب واحد وخطة مصممة لك.', 60, 10, 450, ['st-karim', 'st-omar']],
      ['pul-box', 'train', 'Boxing 1:1', 'ملاكمة فردية', 'Pads, bag work and conditioning.', 'تدريب على الوسادات والكيس واللياقة.', 60, 10, 500, ['st-omar']],
      ['pul-pilates', 'mind', 'Private pilates', 'بيلاتس خاص', 'Mat or reformer, core and posture.', 'ماتس أو ريفورمر، تقوية وقوام.', 50, 10, 550, ['st-dina']],
      ['pul-yoga', 'mind', 'Private yoga', 'يوجا خاصة', 'Flow and breath work at your pace.', 'حركة وتنفس بالسرعة المناسبة لك.', 60, 0, 500, ['st-dina']],
      ['pul-stretch', 'mind', 'Mobility and stretch', 'مرونة وإطالة', 'Thirty minutes of guided recovery.', 'ثلاثون دقيقة من التعافي الموجّه.', 30, 0, 250, ['st-dina', 'st-karim']],
      ['pul-nutri', 'nutrition', 'Nutrition consultation', 'استشارة تغذية', 'Review of habits and a simple meal plan.', 'مراجعة العادات وخطة وجبات بسيطة.', 30, 0, 300, ['st-rana']],
    ],
    cats: { start: ['Start here', 'ابدأ من هنا'], train: ['Training', 'تدريب'], mind: ['Mind and body', 'عقل وجسم'], nutrition: ['Nutrition', 'تغذية'] },
    weight: { 'pul-intro': 2, 'pul-pt': 7, 'pul-box': 3, 'pul-pilates': 4, 'pul-yoga': 2, 'pul-stretch': 3, 'pul-nutri': 2 },
    phonePrefix: '010000002',
  },
];

const FIRST_F = [['Nada', 'ندى'], ['Yasmin', 'ياسمين'], ['Salma', 'سلمى'], ['Aya', 'آية'], ['Farida', 'فريدة'], ['Reem', 'ريم'], ['Hana', 'هنا'], ['Laila', 'ليلى'], ['Jana', 'جنى'], ['Mai', 'مي'], ['Dalia', 'داليا'], ['Heba', 'هبة'], ['Sara', 'سارة'], ['Noura', 'نورا'], ['Malak', 'ملك']];
const FIRST_M = [['Ahmed', 'أحمد'], ['Youssef', 'يوسف'], ['Mostafa', 'مصطفى'], ['Tarek', 'طارق'], ['Hossam', 'حسام'], ['Amr', 'عمرو'], ['Sherif', 'شريف'], ['Ziad', 'زياد'], ['Khaled', 'خالد'], ['Adel', 'عادل']];
const LAST = [['Hassan', 'حسن'], ['Ibrahim', 'إبراهيم'], ['Saleh', 'صالح'], ['Fouad', 'فؤاد'], ['Nabil', 'نبيل'], ['Mansour', 'منصور'], ['Said', 'سعيد'], ['Gaber', 'جابر'], ['Zaki', 'زكي'], ['Rashad', 'رشاد'], ['Kamel', 'كامل'], ['Lotfy', 'لطفي']];

export function seedState(now = Date.now()) {
  const state = { version: 1, seededAt: now, seq: {}, businesses: [], clients: [], bookings: [], reminderLog: {}, ops: [] };
  const nextId = (p) => { state.seq[p] = (state.seq[p] || 0) + 1; return p + state.seq[p]; };
  const rand = rng(20261125);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (const def of BUSINESSES) {
    const staff = def.staff.map((s) => ({ ...s, active: true, off: [] }));
    const services = def.services.map(([id, cat, en, ar, de, da, dur, buffer, price, who]) => ({ id, cat, name: { en, ar }, desc: { en: de, ar: da }, dur, buffer, price, active: true, staff: who }));
    const b = { id: def.id, type: def.type, tz: TZ, color: def.color, name: def.name, tagline: def.tagline, address: def.address, phone: def.phone, hours: def.hours, closed: [], settings: settings(), cats: def.cats, staff, services };
    state.businesses.push(b);
    const today = localParts(now, TZ).date;

    // Client pool (fictional names and numbers).
    const pool = [];
    const female = def.type === 'salon';
    for (let i = 0; i < 30; i++) {
      const [fe, fa] = female || rand() < 0.35 ? pick(FIRST_F) : pick(FIRST_M);
      const [le, la] = pick(LAST);
      const c = { id: nextId('c'), biz: def.id, name: `${fe} ${le}`, nameAr: `${fa} ${la}`, phone: def.phonePrefix + String(10 + i).padStart(2, '0'), notes: '', tags: [], created: now - Math.floor(rand() * 200 + 25) * 86400000 };
      pool.push(c);
    }
    const prone = new Set(pool.slice(0, 3).map((c) => c.id)); // a few clients who often do not show up
    const weights = def.weight;
    const used = new Map(); // clientId|date -> intervals

    for (let off = -21; off <= 14; off++) {
      const date = addDays(today, off);
      const fill = off < 0 ? 0.55 : Math.max(0.1, 0.5 - off * 0.03);
      for (const st of staff) {
        for (const [ws, we] of staffWindows(b, st, date)) {
          let t = Math.ceil(ws / 15) * 15;
          while (t < we) {
            if (rand() > fill) { t += 15 * (1 + Math.floor(rand() * 3)); continue; }
            const options = services.filter((s) => s.staff.includes(st.id));
            const total = options.reduce((n, s) => n + (weights[s.id] || 1), 0);
            let r = rand() * total, svc = options[0];
            for (const s of options) { r -= weights[s.id] || 1; if (r <= 0) { svc = s; break; } }
            if (t + svc.dur > we) { t += 15; continue; }
            let client = null;
            for (let tries = 0; tries < 8 && !client; tries++) {
              const c = pick(pool); const iv = used.get(c.id + '|' + date) || [];
              if (!iv.some(([s, e]) => t < e && s < t + svc.dur)) client = c;
            }
            if (!client) { t += 15; continue; }
            used.set(client.id + '|' + date, [...(used.get(client.id + '|' + date) || []), [t, t + svc.dur]]);
            const startTs = localToTs(date, t, TZ), endTs = localToTs(date, t + svc.dur, TZ);
            let status = 'confirmed', lateCancel = false;
            const r2 = rand();
            if (endTs <= now) status = r2 < (prone.has(client.id) ? 0.4 : 0.025) ? 'no_show' : r2 > 0.9 ? 'cancelled' : 'completed';
            else if (startTs <= now) status = 'checked_in';
            else if (r2 < 0.06) status = 'cancelled';
            if (status === 'cancelled') lateCancel = rand() < 0.4;
            const src = off < 0 || startTs <= now ? (rand() < 0.5 ? 'online' : rand() < 0.65 ? 'phone' : 'walk_in') : (rand() < 0.6 ? 'online' : 'phone');
            const createdAt = Math.min(now - 60000 * Math.floor(rand() * 90 + 5), startTs - Math.floor((rand() * 8 + 0.2) * 86400000) * (src === 'walk_in' ? 0 : 1));
            const bk = { id: nextId('b'), code: '', biz: def.id, serviceId: svc.id, staffId: st.id, clientId: client.id, date, start: t, end: t + svc.dur, buffer: svc.buffer, price: svc.price, status, source: src, note: '', createdAt, lateCancel, history: [{ t: createdAt, ev: 'created', by: src === 'online' ? 'client' : 'reception' }] };
            if (status !== 'confirmed') bk.history.push({ t: Math.min(now, status === 'cancelled' ? Math.max(createdAt + 1, startTs - 86400000 * rand() * 2) : endTs), ev: status, by: status === 'cancelled' ? (src === 'online' ? 'client' : 'reception') : 'reception', ...(status === 'cancelled' ? { late: lateCancel } : {}) });
            state.bookings.push(bk);
            t += svc.dur + svc.buffer + 15 * Math.floor(rand() * 3);
            t = Math.ceil(t / 15) * 15;
          }
        }
      }
    }
    // One client is already over the no-show limit, so the online page asks them to call.
    const flagged = pool[0];
    let ns = state.bookings.filter((x) => x.clientId === flagged.id && x.status === 'no_show').length;
    for (const bk of state.bookings.filter((x) => x.clientId === flagged.id && x.status === 'completed')) { if (ns >= 3) break; bk.status = 'no_show'; bk.history.push({ t: bk.createdAt + 1, ev: 'no_show', by: 'reception' }); ns++; }
    flagged.tags = ['no-show risk'];
    pool[3].tags = ['regular']; pool[4].tags = ['regular']; pool[4].notes = def.type === 'salon' ? 'Prefers Hala. Sensitive scalp, ask before colour.' : 'Knee injury, no jumping drills.';
    for (const c of pool) state.clients.push({ id: c.id, biz: c.biz, name: c.name, nameAr: c.nameAr, phone: c.phone, notes: c.notes, tags: c.tags, created: c.created });
  }

  // Codes (unique, readable) and reminder log.
  const seen = new Set();
  for (const bk of state.bookings) { let code; do code = 'MWD-' + [...Array(6)].map(() => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 32)]).join(''); while (seen.has(code)); seen.add(code); bk.code = code; }
  for (const bk of state.bookings) {
    if (bk.status !== 'confirmed') continue;
    const b = state.businesses.find((x) => x.id === bk.biz);
    const s = localToTs(bk.date, bk.start, TZ);
    for (const off of b.settings.reminders) { const dueAt = s - off * 60000; if (dueAt >= bk.createdAt && dueAt < now - 45 * 60000) state.reminderLog[bk.id + ':' + off] = { status: 'sent', at: dueAt + 60000 }; }
  }
  return state;
}
