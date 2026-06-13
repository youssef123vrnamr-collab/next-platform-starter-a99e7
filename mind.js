// ============================================================================
// mind.js
// "العقل المتعلم" - نموذج character-level trigram يبدأ من seed بسيط
// ويتعلم من كل رسالة يبعتها أي مستخدم.
//
// مهم جداً (شفافية):
// - هذا النموذج لا "يفهم" أي شيء. هو فقط يحسب: "بعد هذين الحرفين،
//   ما هو الحرف الأكثر شيوعاً الذي يأتي بعدهما؟" بناءً على كل ما قرأه.
// - مع مرور الوقت وزيادة عدد الرسائل، الكلام الناتج يصبح أقرب لكلمات
//   عربية/إنجليزية سليمة الإملاء (لأنه يتعلم "إحصائيات الحروف").
// - السقف النهائي: جمل قصيرة، غير دقيقة غالباً، بلا فهم لسياق المحادثة.
//   هذا حد طبيعي لهذا النوع من النماذج البسيطة، وليس عيباً يمكن إصلاحه
//   بمزيد من البيانات فقط.
// ============================================================================

const { ARABIC_SEED_TABLE, ENGLISH_SEED_TABLE } = require('./seed');

const START = "^";
const END = "$";

// تحديد ما إذا كان النص "عربي بشكل غالب" أم "إنجليزي بشكل غالب"
// (تصنيف بسيط جداً بناءً على عدّ الحروف - ليس "فهماً للغة")
function detectLanguage(text) {
  let arabicCount = 0;
  let latinCount = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0x0600 && code <= 0x06FF) arabicCount++;
    else if (/[a-zA-Z]/.test(ch)) latinCount++;
  }
  return arabicCount >= latinCount ? 'ar' : 'en';
}

// تنظيف بسيط للنص: نحتفظ فقط بالحروف، الأرقام، والمسافات
// (نزيل الرموز التعبيرية، علامات الترقيم المعقدة... إلخ لتبسيط الجدول)
function cleanText(text) {
  return text
    .replace(/[\u0640]/g, '')          // إزالة التطويل
    .replace(/[^\u0600-\u06FF a-zA-Z0-9\n.,!? ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class MindModel {
  constructor(data) {
    // جدولان منفصلان: عربي وإنجليزي
    // كل جدول: { "حرف1حرف2": { "حرف3": عدد, ... }, ... }
    this.tables = {
      ar: data?.tables?.ar || deepClone(ARABIC_SEED_TABLE),
      en: data?.tables?.en || deepClone(ENGLISH_SEED_TABLE)
    };

    // إحصائيات للشفافية التعليمية
    this.stats = {
      messagesLearned: data?.stats?.messagesLearned || 0,
      charsLearned: data?.stats?.charsLearned || 0,
      uniqueContexts: data?.stats?.uniqueContexts || { ar: 0, en: 0 }
    };
  }

  // -------------------- التدريب: تعلم من نص جديد --------------------
  // كل رسالة عادية في الشات تستدعي هذه الدالة تلقائياً
  learnFromText(rawText) {
    const text = cleanText(rawText);
    if (!text || text.length < 1) return { learned: 0, lang: null };

    const lang = detectLanguage(text);
    const table = this.tables[lang];

    const padded = START + START + text + END;
    let learned = 0;

    for (let i = 0; i < padded.length - 2; i++) {
      const ctx = padded[i] + padded[i + 1];
      const next = padded[i + 2];
      if (!table[ctx]) {
        table[ctx] = {};
        this.stats.uniqueContexts[lang] = (this.stats.uniqueContexts[lang] || 0) + 1;
      }
      table[ctx][next] = (table[ctx][next] || 0) + 1;
      learned++;
    }

    this.stats.messagesLearned++;
    this.stats.charsLearned += text.length;

    return { learned, lang };
  }

  // -------------------- توليد رد بناءً على ما تعلمه --------------------
  // ملاحظة: الرد لا "يجيب" عن السؤال، هو فقط استكمال إحصائي
  // ينطلق من آخر حرفين في رسالة المستخدم (لو موجودين في الجدول)
  // أو من بداية عشوائية إذا لم يجد سياقاً مطابقاً.
  generateReply(promptText, maxLength = 60) {
    const text = cleanText(promptText);
    const lang = text ? detectLanguage(text) : 'ar';
    const table = this.tables[lang];

    // محاولة الانطلاق من آخر حرفين بالرسالة (إن وُجدا في الجدول)
    let ctx = null;
    const padded = START + START + text;
    for (let i = padded.length - 2; i >= 0; i--) {
      const candidate = padded[i] + padded[i + 1];
      if (table[candidate]) { ctx = candidate; break; }
    }
    // إذا لم نجد، نبدأ من بداية كلمة (سياق ^^)
    if (!ctx) ctx = START + START;

    let output = "";
    let safety = 0;

    while (output.length < maxLength && safety < maxLength * 3) {
      safety++;
      const options = table[ctx];
      if (!options) {
        // سياق غير معروف: نعود لبداية جديدة عشوائية من الجدول
        const keys = Object.keys(table);
        if (keys.length === 0) break;
        ctx = keys[Math.floor(Math.random() * keys.length)];
        continue;
      }

      const nextChar = weightedRandomPick(options);

      if (nextChar === END) {
        output += " ";
        ctx = START + START; // نبدأ كلمة جديدة
        // فرصة للتوقف بعد عدد كلمات كافٍ
        if (output.trim().split(/\s+/).length >= 6 && Math.random() < 0.4) break;
        continue;
      }
      if (nextChar === START) continue;

      output += nextChar;
      ctx = ctx[1] + nextChar;
    }

    const cleaned = output.trim().replace(/\s+/g, ' ');
    return {
      text: cleaned || (lang === 'ar' ? "..." : "..."),
      lang,
      contextsKnown: Object.keys(table).length
    };
  }

  // -------------------- إحصائيات للعرض على الواجهة --------------------
  getStats() {
    return {
      messagesLearned: this.stats.messagesLearned,
      charsLearned: this.stats.charsLearned,
      contextsAr: Object.keys(this.tables.ar).length,
      contextsEn: Object.keys(this.tables.en).length
    };
  }

  toJSON() {
    return { tables: this.tables, stats: this.stats };
  }
}

// -------------------- أدوات مساعدة --------------------

function weightedRandomPick(optionsMap) {
  const entries = Object.entries(optionsMap);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  let r = Math.random() * total;
  for (const [key, count] of entries) {
    r -= count;
    if (r <= 0) return key;
  }
  return entries[0][0];
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { MindModel, detectLanguage, cleanText };
