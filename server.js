const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
const path = require('path');

// -------------------- تحميل مفتاح Firebase (من الملف الذي أرسلته) --------------------
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// -------------------- العقل الرياضي (يوجد فقط في السيرفر) --------------------
class SuperMind {
  constructor() {
    this.w = Math.random() * 2 - 1;
    this.b = 0;
    this.alpha = 0.05;
    this.beta = 0.5;
    this.gamma = 0.1;
    this.prev_grad = 0;
    this.error_history = new Array(10).fill(1.0);
    this.hist_idx = 0;
  }

  predict(x) { return this.w * x + this.b; }
  loss(x, y) { let p = this.predict(x); return (p - y) ** 2; }

  gradients(x, y) {
    let p = this.predict(x);
    let e = p - y;
    return { gw: 2 * e * x, gb: 2 * e };
  }

  updateErrorHistory(err) {
    this.error_history[this.hist_idx % 10] = err;
    this.hist_idx++;
  }

  meanRecent(n) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < n && i < 10; i++) {
      let idx = (this.hist_idx - 1 - i + 10) % 10;
      if (this.hist_idx > i) { sum += this.error_history[idx]; cnt++; }
    }
    return cnt ? sum / cnt : 1.0;
  }

  varRecent(n) {
    let m = this.meanRecent(n);
    let v = 0, cnt = 0;
    for (let i = 0; i < n && i < 10; i++) {
      let idx = (this.hist_idx - 1 - i + 10) % 10;
      if (this.hist_idx > i) { let d = this.error_history[idx] - m; v += d * d; cnt++; }
    }
    return cnt ? v / cnt : 1.0;
  }

  update(x, y) {
    let { gw, gb } = this.gradients(x, y);
    let gnorm = Math.sqrt(gw*gw + gb*gb) + 1e-8;
    let eta = this.alpha * Math.exp(-gnorm / (Math.abs(this.prev_grad) + 1e-8)) + this.beta * this.prev_grad;
    if (isNaN(eta) || !isFinite(eta)) eta = 0.01;

    let memory_term = 0.3 * gw + 0.1 * this.prev_grad;
    let rvar = this.varRecent(5);
    let rmean = this.meanRecent(5);
    let innov_factor = Math.tanh(rvar / (rmean + 1e-8));
    let innov_term = this.gamma * innov_factor * (gw + gb) * 0.1;
    let reg_term = -0.01 * this.w + 0.005 * (Math.random() - 0.5);

    this.w = this.w - eta * gw + memory_term + innov_term + reg_term;
    this.b = this.b - eta * gb + 0.01 * memory_term + 0.02 * innov_term + reg_term * 0.5;

    let curr_loss = this.loss(x, y);
    this.updateErrorHistory(curr_loss);

    let loss_improve = (this.hist_idx > 1) ? (this.error_history[(this.hist_idx-2)%10] - curr_loss) : 0;
    this.alpha += 0.001 * loss_improve;
    if (this.alpha < 0.001) this.alpha = 0.001;
    if (this.alpha > 0.5) this.alpha = 0.5;

    this.beta += 0.0005 * (gnorm - 0.5);
    if (this.beta < 0) this.beta = 0;
    if (this.beta > 0.9) this.beta = 0.9;

    this.gamma += 0.0001 * (rvar - 0.2);
    if (this.gamma < 0) this.gamma = 0;
    if (this.gamma > 0.3) this.gamma = 0.3;

    this.prev_grad = gnorm;
  }

  toJSON() {
    return { w: this.w, b: this.b, alpha: this.alpha, beta: this.beta, gamma: this.gamma,
             prev_grad: this.prev_grad, error_history: this.error_history, hist_idx: this.hist_idx };
  }
  fromJSON(data) {
    this.w = data.w; this.b = data.b; this.alpha = data.alpha; this.beta = data.beta; this.gamma = data.gamma;
    this.prev_grad = data.prev_grad; this.error_history = data.error_history; this.hist_idx = data.hist_idx;
  }
}

// -------------------- عقول النماذج الثلاثة --------------------
const minds = { alpha: new SuperMind(), beta: new SuperMind(), gamma: new SuperMind() };

async function loadMind(model) {
  const docRef = db.collection('super_minds').doc(model);
  const doc = await docRef.get();
  if (doc.exists) {
    minds[model].fromJSON(doc.data());
    console.log(`✅ تم تحميل عقل ${model} من Firebase`);
  } else {
    // تهيئة خاصة لكل نموذج عند أول مرة
    if (model === 'beta') { minds[model].w = 1.2; minds[model].b = 0.3; }
    if (model === 'gamma') { minds[model].w = 1.8; minds[model].b = 0.7; }
    await saveMind(model);
    console.log(`🆕 تم إنشاء عقل ${model} جديد وحفظه في Firebase`);
  }
}

async function saveMind(model) {
  await db.collection('super_minds').doc(model).set(minds[model].toJSON());
  console.log(`💾 تم حفظ عقل ${model} في Firebase`);
}

// -------------------- خدمات خارجية (صور وفيديو) --------------------
async function generateImage(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + " high quality")}`;
}

function generateDemoVideo() {
  return "https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4";
}

function parseCommand(text) {
  const lower = text.toLowerCase();
  if (lower.includes('صورة') || lower.includes('ارسم') || lower.includes('صور')) return 'image';
  if (lower.includes('فيديو') || lower.includes('video')) return 'video';
  if (lower.includes('كود') || lower.includes('code')) return 'code';
  return 'chat';
}

function simpleChatReply(prompt, model) {
  const mind = minds[model];
  const intelligence = mind.predict(1); // قيمة ذكاء الرموز
  return `🤖 رد من نموذج ${model.toUpperCase()} (قوة الذكاء الحالية ${intelligence.toFixed(3)}):\n"${prompt}"\nالعقل يتعلم من تقييماتك.`;
}

// -------------------- خادم Express --------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));  // مجلد الواجهة الأمامية

// API تدريب العقل (باستخدام التقييم)
app.post('/api/train', async (req, res) => {
  const { model, isPositive } = req.body;
  if (!minds[model]) return res.status(400).json({ error: 'Model not found' });
  const target = isPositive ? 0.2 : 0.8;
  minds[model].update(1.0, target);
  await saveMind(model);
  res.json({ success: true });
});

// API معالجة الأوامر (صورة، فيديو، كود، محادثة)
app.post('/api/process', async (req, res) => {
  let { prompt, model } = req.body;
  if (!prompt) prompt = "";
  if (!minds[model]) model = "alpha";
  const type = parseCommand(prompt);

  if (type === 'image') {
    const imgUrl = await generateImage(prompt);
    res.json({ type: 'image', url: imgUrl, message: '🖼️ تم توليد الصورة' });
  } 
  else if (type === 'video') {
    const videoUrl = generateDemoVideo();
    res.json({ type: 'video', url: videoUrl, message: '🎬 فيديو تجريبي' });
  }
  else if (type === 'code') {
    const mind = minds[model];
    const codeSnippet = `// معادلة العقل الحالية (مخفية في الخادم)\nfloat predict(float x) { return ${mind.w.toFixed(6)}f * x + ${mind.b.toFixed(6)}f; }`;
    res.json({ type: 'code', content: codeSnippet, message: '💻 كود المعادلة الحالية (من الخادم)' });
  }
  else {
    const reply = simpleChatReply(prompt, model);
    res.json({ type: 'chat', content: reply, message: 'رد نصي' });
  }
});

// -------------------- بدء الخادم وتحميل العقول من Firebase --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await loadMind('alpha');
  await loadMind('beta');
  await loadMind('gamma');
  console.log('✅ جميع العقول جاهزة (المعادلات مخفية تماماً عن العميل)');
});