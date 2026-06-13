// ============================================================================
// seed.js
// "بذرة" بسيطة جداً للعقل: مجرد جداول ترددات أولية لتتابعات الحروف
// (character trigrams) في العربية والإنجليزية، مأخوذة من كلمات شائعة جداً.
// هذه ليست "فهماً" بأي شكل - هي فقط نقطة انطلاق إحصائية بسيطة
// لتجنب أن يبدأ العقل بحروف عشوائية تماماً بلا معنى من أول لحظة.
// كل التعلم الحقيقي بعد ذلك يأتي من رسائل المستخدمين.
// ============================================================================

// كلمات عربية شائعة جداً (أدوات، ضمائر، كلمات يومية بسيطة)
const ARABIC_SEED_WORDS = [
  "في", "من", "إلى", "على", "أن", "هذا", "هذه", "ذلك", "التي", "الذي",
  "كان", "يكون", "هو", "هي", "أنت", "أنا", "نحن", "هم", "لا", "نعم",
  "ما", "ماذا", "متى", "كيف", "أين", "لماذا", "مع", "عن", "بعد", "قبل",
  "اليوم", "غدا", "أمس", "الآن", "هنا", "هناك", "كل", "بعض", "شيء", "أشياء",
  "جميل", "كبير", "صغير", "جديد", "قديم", "سعيد", "حزين", "خائف", "غاضب", "هادئ",
  "حب", "فرح", "حزن", "خوف", "غضب", "أمل", "سلام", "صداقة", "عائلة", "بيت",
  "ماء", "شمس", "قمر", "نجوم", "سماء", "أرض", "بحر", "جبل", "شجرة", "زهرة",
  "كتاب", "قلم", "مدرسة", "طالب", "معلم", "علم", "فكرة", "سؤال", "جواب", "كلمة",
  "شكرا", "من فضلك", "مرحبا", "أهلا", "السلام عليكم", "وعليكم السلام", "صباح الخير", "مساء الخير",
  "أحب", "أريد", "أعرف", "أفهم", "أقول", "أرى", "أسمع", "أشعر", "أفكر", "أتعلم"
];

// كلمات إنجليزية شائعة جداً (stop words + كلمات عاطفية أساسية)
const ENGLISH_SEED_WORDS = [
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to",
  "of", "in", "on", "at", "for", "with", "and", "or", "but", "not",
  "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "what", "when", "where", "why", "how", "who", "which",
  "today", "tomorrow", "yesterday", "now", "here", "there", "all", "some", "thing", "things",
  "good", "bad", "big", "small", "new", "old", "happy", "sad", "afraid", "angry", "calm",
  "love", "joy", "sadness", "fear", "anger", "hope", "peace", "friend", "family", "home",
  "water", "sun", "moon", "star", "sky", "earth", "sea", "mountain", "tree", "flower",
  "book", "pen", "school", "student", "teacher", "knowledge", "idea", "question", "answer", "word",
  "thanks", "please", "hello", "hi", "good morning", "good evening",
  "i love", "i want", "i know", "i feel", "i think", "i see", "i hear", "i learn"
];

// ----------------------------------------------------------------------------
// بناء جدول ترددات character-trigram من قائمة كلمات
// نمثل كل كلمة بحدود ابتداء/انتهاء (^ و $) لمعرفة بدايات ونهايات الكلمات
// التركيب: table[ "حرف1حرف2" ] = { "حرف3": عدد التكرارات, ... }
// ----------------------------------------------------------------------------
function buildSeedTable(words) {
  const table = {};
  for (const wordRaw of words) {
    const word = "^^" + wordRaw + "$"; // حدود البداية والنهاية
    for (let i = 0; i < word.length - 2; i++) {
      const ctx = word[i] + word[i + 1];
      const next = word[i + 2];
      if (!table[ctx]) table[ctx] = {};
      table[ctx][next] = (table[ctx][next] || 0) + 1;
    }
  }
  return table;
}

const ARABIC_SEED_TABLE = buildSeedTable(ARABIC_SEED_WORDS);
const ENGLISH_SEED_TABLE = buildSeedTable(ENGLISH_SEED_WORDS);

module.exports = {
  ARABIC_SEED_TABLE,
  ENGLISH_SEED_TABLE,
  ARABIC_SEED_WORDS,
  ENGLISH_SEED_WORDS
};
