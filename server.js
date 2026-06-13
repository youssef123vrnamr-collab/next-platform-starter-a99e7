const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
const multer = require('multer');
const { MindModel } = require('./mind');

// -------------------- تحميل مفتاح Firebase --------------------
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// -------------------- العقل المتعلم (نسخة واحدة في الذاكرة + Firestore) --------------------
const MIND_DOC = db.collection('learning_mind').doc('main');
let mind = new MindModel(); // يبدأ بـ seed بسيط لحين تحميل البيانات المحفوظة

async function loadMind() {
  const doc = await MIND_DOC.get();
  if (doc.exists) {
    mind = new MindModel(doc.data());
    console.log('✅ تم تحميل العقل من Firebase. رسائل تعلّمها العقل حتى الآن:', mind.stats.messagesLearned);
  } else {
    await saveMind();
    console.log('🆕 لا توجد بيانات سابقة - بدأ العقل بـ seed بسيط وتم حفظه.');
  }
}

let saveTimer = null;
async function saveMind() {
  // نؤجل الحفظ قليلاً لتجميع عدة طلبات متتالية بدون كتابة Firestore كثيرة
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await MIND_DOC.set(mind.toJSON());
      console.log('💾 تم حفظ العقل في Firebase (رسائل متعلَّمة:', mind.stats.messagesLearned, ')');
    } catch (e) {
      console.error('❌ خطأ في حفظ العقل:', e.message);
    }
  }, 1500);
}

// -------------------- توليد الصور (Pollinations - منفصل عن العقل) --------------------
async function generateImage(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + " high quality")}`;
}

// -------------------- وصف الصور المرفوعة (منفصل تماماً عن العقل المتعلم) --------------------
// نستخدم خدمة وصف صور خارجية جاهزة (موديل تصنيف/وصف صور مُدرَّب مسبقاً)
// هذه ليست "تعلماً من الصفر" - هي أداة جاهزة منفصلة، يتم فقط تمرير
// النص الناتج منها إلى العقل المتعلم كـ "رسالة" عادية للتدريب عليها.
async function describeImage(imageBuffer, mimeType) {
  // ⚠️ تتطلب هذه الخدمة (Hugging Face Inference API) مفتاحاً مجانياً
  // يوضع في متغير بيئة HUGGINGFACE_API_KEY على Vercel.
  // بدون المفتاح ترجع null وتوضح الواجهة ذلك للمستخدم.
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ HUGGINGFACE_API_KEY غير موجود - وصف الصور معطّل.');
    return null;
  }
  try {
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base',
      imageBuffer,
      {
        headers: {
          'Content-Type': mimeType || 'application/octet-stream',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 20000
      }
    );
    const result = response.data;
    let caption = null;
    if (Array.isArray(result) && result[0]?.generated_text) {
      caption = result[0].generated_text;
    }
    return caption || null;
  } catch (e) {
    console.error('⚠️ تعذّر وصف الصورة (خدمة خارجية):', e.message);
    return null;
  }
}

// -------------------- ملفات نصية مرفوعة (تُستخدم كبيانات تدريب مباشرة) --------------------
function extractTextFromUpload(buffer, mimeType, originalName) {
  // نقبل فقط الملفات النصية البسيطة (txt, md, csv, json كنص...)
  // أي ملف آخر (pdf, docx...) يحتاج معالجة منفصلة غير مرتبطة بالعقل
  const textLikeTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];
  const isTextLike = textLikeTypes.includes(mimeType) ||
    /\.(txt|md|csv|json)$/i.test(originalName || '');

  if (!isTextLike) return null;

  try {
    return buffer.toString('utf-8');
  } catch (e) {
    return null;
  }
}

// -------------------- سجل الملفات (اسم الملف ↔ نوع ↔ وصف يكتبه المستخدم) --------------------
// هذا سجل بسيط (كود عادي - بحث/تخزين، ليس "تعلماً") يُستخدم للاسترجاع المباشر
// عند سؤال المستخدم لاحقاً "الفيديو ده بتاع إيه؟"
const FILES_COLLECTION = db.collection('file_registry');

// خريطة في الذاكرة لتسريع البحث (تُحمَّل من Firestore عند بدء التشغيل)
let fileRegistry = {}; // { filename: { type, description, uploadedAt } }

async function loadFileRegistry() {
  try {
    const snap = await FILES_COLLECTION.get();
    snap.forEach(doc => { fileRegistry[doc.id] = doc.data(); });
    console.log(`📁 تم تحميل سجل الملفات (${Object.keys(fileRegistry).length} ملف)`);
  } catch (e) {
    console.error('❌ خطأ في تحميل سجل الملفات:', e.message);
  }
}

// تصنيف نوع الملف من الامتداد - كود عادي مباشر، ليس "ذكاءً"
function classifyFileType(filename, mimeType) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext) || (mimeType || '').startsWith('video/')) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) || (mimeType || '').startsWith('image/')) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext) || (mimeType || '').startsWith('audio/')) return 'audio';
  if (['txt', 'md', 'csv', 'json'].includes(ext)) return 'text';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'document';
  return 'unknown';
}

// حفظ/تحديث وصف ملف - مع تجنب التكرار لو الوصف نفسه موجود مسبقاً
async function registerFileDescription(filename, type, description) {
  const existing = fileRegistry[filename];
  if (existing && existing.description === description) {
    return { saved: false, reason: 'duplicate' };
  }
  const entry = { type, description, uploadedAt: new Date().toISOString() };
  fileRegistry[filename] = entry;
  try {
    await FILES_COLLECTION.doc(filename).set(entry);
  } catch (e) {
    console.error('❌ خطأ في حفظ سجل الملف:', e.message);
  }
  return { saved: true };
}

// محاولة الاسترجاع: لو رسالة المستخدم بتذكر اسم ملف معروف، نرجع وصفه المحفوظ
// هذا بحث نصي بسيط (كود عادي) - وليس "فهماً" من العقل المتعلم
function tryLookupFile(message) {
  const lower = message.toLowerCase();
  for (const [filename, entry] of Object.entries(fileRegistry)) {
    const baseName = filename.split('.')[0].toLowerCase();
    if (lower.includes(filename.toLowerCase()) || (baseName.length > 2 && lower.includes(baseName))) {
      return { filename, ...entry };
    }
  }
  return null;
}


const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB حد أقصى

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// -------------------- API: محادثة عادية (كل رسالة = تدريب تلقائي) --------------------
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'الرسالة مطلوبة' });
  }

  // 0) بحث بسيط (كود عادي): هل الرسالة بتسأل عن ملف معروف في السجل؟
  const fileMatch = tryLookupFile(message);

  // 1) العقل يولّد رداً بناءً على ما تعلمه حتى الآن (قبل التعلم من هذه الرسالة)
  const reply = mind.generateReply(message);

  // 2) التدريب التلقائي: هذه الرسالة تصبح جزءاً من بيانات العقل
  const learnResult = mind.learnFromText(message);
  await saveMind();

  res.json({
    reply: reply.text,
    fileInfo: fileMatch ? {
      filename: fileMatch.filename,
      type: fileMatch.type,
      description: fileMatch.description
    } : null,
    meta: {
      detectedLang: reply.lang,
      charsLearnedFromThisMessage: learnResult.learned,
      totalMessagesLearned: mind.stats.messagesLearned,
      totalCharsLearned: mind.stats.charsLearned,
      contextsKnown: { ar: mind.tables.ar && Object.keys(mind.tables.ar).length, en: mind.tables.en && Object.keys(mind.tables.en).length }
    }
  });
});

// -------------------- API: تعليم العقل نصاً مباشراً (بدون رد) --------------------
// يُستخدم لزر "علّم العقل" - مثلاً نصوص جاهزة عن المشاعر أو أي موضوع آخر
app.post('/api/teach', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'النص مطلوب' });
  }

  const result = mind.learnFromText(text);
  await saveMind();

  res.json({
    success: true,
    learned: result.learned,
    lang: result.lang,
    stats: mind.getStats()
  });
});

// -------------------- API: رفع صورة (وصف خارجي + تعليم العقل بالوصف) --------------------
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق صورة' });

  const caption = await describeImage(req.file.buffer, req.file.mimetype);

  if (!caption) {
    return res.json({
      success: false,
      message: 'تعذّر التعرف على الصورة حالياً (الخدمة الخارجية غير متاحة)'
    });
  }

  // الوصف الناتج من موديل التصنيف الجاهز يُستخدم كرسالة تدريب عادية للعقل
  const learnResult = mind.learnFromText(caption);
  await saveMind();

  res.json({
    success: true,
    caption,
    learned: learnResult.learned,
    stats: mind.getStats()
  });
});

// -------------------- API: رفع ملف نصي (يُستخدم كبيانات تدريب) --------------------
app.post('/api/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق ملف' });

  const content = extractTextFromUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (content === null) {
    return res.json({
      success: false,
      message: 'هذا النوع من الملفات غير مدعوم للتعلم المباشر (مدعوم: txt, md, csv, json)'
    });
  }

  // تقسيم الملف لأسطر/فقرات وتعليم العقل كل جزء (لتجنب جملة واحدة ضخمة جداً)
  const chunks = content.split(/\n+/).map(c => c.trim()).filter(c => c.length > 0).slice(0, 500);
  let totalLearned = 0;
  for (const chunk of chunks) {
    const r = mind.learnFromText(chunk);
    totalLearned += r.learned;
  }
  await saveMind();

  res.json({
    success: true,
    chunksLearned: chunks.length,
    totalCharsLearned: totalLearned,
    stats: mind.getStats()
  });
});

// -------------------- API: مرفق عام (📎) - يصنّف النوع ويربطه بوصف يكتبه المستخدم --------------------
// يُستخدم من قائمة "📎" الموحّدة: ملف / صورة / فيديو / صوت
// الملف نفسه لا "يُفهم" - فقط نوعه يُصنَّف بالامتداد (كود عادي)
// والوصف (الذي يكتبه المستخدم بنفسه عن محتوى الملف) هو ما يتعلمه العقل ويُسجَّل
app.post('/api/upload-attachment', upload.single('attachment'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق ملف' });

  const filename = req.file.originalname || `file_${Date.now()}`;
  const type = classifyFileType(filename, req.file.mimetype);
  const userDescription = (req.body.description || '').trim();

  let autoCaption = null;
  // محاولة وصف تلقائي للصور فقط (عبر أداة خارجية - منفصلة عن العقل)
  if (type === 'image') {
    autoCaption = await describeImage(req.file.buffer, req.file.mimetype);
  }

  // الوصف النهائي: ما كتبه المستخدم أولاً، وإن لم يوجد فالوصف التلقائي (للصور فقط)
  const finalDescription = userDescription || autoCaption;

  let registryResult = { saved: false };
  let learnResult = { learned: 0, lang: null };

  if (finalDescription) {
    registryResult = await registerFileDescription(filename, type, finalDescription);
    // العقل يتعلم من الوصف كنص عادي (إن لم يكن مكرراً بالضبط)
    learnResult = mind.learnFromText(finalDescription);
    await saveMind();
  }

  res.json({
    success: true,
    filename,
    type,
    autoCaption,
    description: finalDescription || null,
    registered: registryResult.saved,
    learned: learnResult.learned,
    stats: mind.getStats()
  });
});


app.post('/api/generate-image', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'الوصف مطلوب' });
  const url = await generateImage(prompt);
  res.json({ url });
});

// -------------------- API: إحصائيات العقل (للشفافية التعليمية) --------------------
app.get('/api/stats', (req, res) => {
  res.json(mind.getStats());
});

// -------------------- بدء الخادم --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await loadMind();
  await loadFileRegistry();
});
