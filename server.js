const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOPICS_FILE = path.join(DATA_DIR, 'topics.json');

// ==========================================================
// Persistência simples em JSON (troque por SQLite/Postgres em produção)
// ==========================================================
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(TOPICS_FILE)) fs.writeFileSync(TOPICS_FILE, '[]');
}
const readJSON = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
};
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ==========================================================
// Rate limiter (janela deslizante com bloqueio)
// ==========================================================
function createRateLimiter({ windowMs, maxAttempts, blockMs }) {
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, e] of store) {
      const expired = e.blockedUntil ? now > e.blockedUntil : now - e.firstAttempt > windowMs;
      if (expired) store.delete(key);
    }
  }, Math.max(windowMs, 60_000)).unref();

  return {
    check(key) {
      const now = Date.now();
      const e = store.get(key);
      if (!e) return { allowed: true };
      if (e.blockedUntil) {
        if (now < e.blockedUntil)
          return { allowed: false, retryAfter: Math.ceil((e.blockedUntil - now) / 1000) };
        store.delete(key);
        return { allowed: true };
      }
      if (now - e.firstAttempt > windowMs) { store.delete(key); return { allowed: true }; }
      return { allowed: true };
    },
    fail(key) {
      const now = Date.now();
      let e = store.get(key);
      if (!e || now - e.firstAttempt > windowMs || (e.blockedUntil && now > e.blockedUntil))
        e = { count: 0, firstAttempt: now, blockedUntil: null };
      e.count += 1;
      if (e.count >= maxAttempts) e.blockedUntil = now + blockMs;
      store.set(key, e);
    },
    reset(key) { store.delete(key); }
  };
}

// 5 tentativas por IP/usuário em 15 min → bloqueio de 15 min
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  blockMs: 15 * 60 * 1000
});
// 20 cadastros por hora por IP
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxAttempts: 20,
  blockMs: 60 * 60 * 1000
});

// Hash "dummy" para evitar enumeração por tempo de resposta
const DUMMY_HASH = bcrypt.hashSync('dummy-timing-equalizer', 10);

// ==========================================================
// Seed de demonstração
// ==========================================================
function seedIfNeeded() {
  const users = readJSON(USERS_FILE);
  if (users.length) return;

  const now = Date.now();
  const mk = (username, password) => ({
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: now
  });
  writeJSON(USERS_FILE, [mk('ana', 'senha123'), mk('bruno', 'senha123')]);

  writeJSON(TOPICS_FILE, [
    {
      id: crypto.randomUUID(),
      title: 'Bem-vindo ao DevForum — leia antes de postar',
      body: 'Regras: seja respeitoso, pesquise antes de perguntar e marque tópicos sensíveis como privados.',
      author: 'ana',
      visibility: 'public',
      pinned: true,
      upvotes: ['ana', 'bruno'],
      downvotes: [],
      replies: [{ id: crypto.randomUUID(), author: 'bruno', body: 'Bora codar!', createdAt: now - 5 * 3600_000 }],
      createdAt: now - 3 * 86400_000
    },
    {
      id: crypto.randomUUID(),
      title: 'Qual a melhor forma de estudar algoritmos?',
      body: 'Estou começando com estruturas de dados e queria dicas de rotina.',
      author: 'bruno',
      visibility: 'public',
      pinned: false,
      upvotes: ['ana'],
      downvotes: [],
      replies: [{ id: crypto.randomUUID(), author: 'ana', body: 'Resolva um problema por dia no Beecrowd.', createdAt: now - 2 * 3600_000 }],
      createdAt: now - 20 * 3600_000
    },
    {
      id: crypto.randomUUID(),
      title: 'Minha config de Neovim para 2025',
      body: 'Compartilhando init.lua com LSP, telescope e treesitter.',
      author: 'ana',
      visibility: 'public',
      pinned: false,
      upvotes: ['ana', 'bruno'],
      downvotes: [],
      replies: [],
      createdAt: now - 8 * 3600_000
    },
    {
      id: crypto.randomUUID(),
      title: 'Rascunho pessoal: ideias de projeto',
      body: 'Anotações privadas sobre um app de notas em Markdown.',
      author: 'ana',
      visibility: 'private',
      pinned: false,
      upvotes: [],
      downvotes: [],
      replies: [],
      createdAt: now - 3600_000
    }
  ]);
}

// ==========================================================
// Middlewares
// ==========================================================
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // true apenas com HTTPS
    maxAge: 7 * 24 * 3600 * 1000
  }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado.' });
  next();
};

// ==========================================================
// Autenticação
// ==========================================================
app.post('/api/auth/register', async (req, res) => {
  const ipKey = 'ip:' + req.ip;
  const limit = registerLimiter.check(ipKey);
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Muitos cadastros. Tente mais tarde.', retryAfter: limit.retryAfter });
  }
  registerLimiter.fail(ipKey); // conta qualquer tentativa de cadastro

  const { username, password } = req.body || {};
  const uname = String(username || '').trim();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(uname))
    return res.status(400).json({ error: 'Usuário deve ter 3–20 caracteres (letras, números ou _).' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 200)
    return res.status(400).json({ error: 'A senha deve ter entre 6 e 200 caracteres.' });

  const users = readJSON(USERS_FILE);
  if (users.some(u => u.username.toLowerCase() === uname.toLowerCase()))
    return res.status(409).json({ error: 'Nome de usuário já está em uso.' });

  const user = {
    id: crypto.randomUUID(),
    username: uname,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: Date.now()
  };
  users.push(user);
  writeJSON(USERS_FILE, users);

  req.session.userId = user.id;
  req.session.username = user.username;
  res.status(201).json({ user: { username: user.username } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Dados inválidos.' });

  const uname = username.trim().toLowerCase();
  if (uname.length > 50 || password.length > 200)
    return res.status(400).json({ error: 'Dados inválidos.' });

  // Duas dimensões de proteção: IP e nome de usuário
  const keys = ['ip:' + req.ip, 'user:' + uname];
  const checks = keys.map(k => ({ key: k, ...loginLimiter.check(k) }));
  const blocked = checks.filter(c => !c.allowed).sort((a, b) => b.retryAfter - a.retryAfter)[0];

  if (blocked) {
    res.set('Retry-After', String(blocked.retryAfter));
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${blocked.retryAfter}s.`,
      retryAfter: blocked.retryAfter
    });
  }

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === uname);
  const ok = user
    ? await bcrypt.compare(password, user.passwordHash)
    : (await bcrypt.compare(password, DUMMY_HASH), false);

  if (!ok) {
    keys.forEach(k => loginLimiter.fail(k));
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  keys.forEach(k => loginLimiter.reset(k));
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ user: { username: user.username } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.session.username } });
});

// ==========================================================
// Tópicos
// ==========================================================
const scoreOf = (t) => t.upvotes.length - t.downvotes.length + t.replies.length;
// Normaliza uma tag: lowercase, espaços viram hífen, 2–20 chars, [a-z0-9-]
function normalizeTag(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (t.length < 2 || t.length > 20) return null;
  if (!/^[a-z0-9-]+$/.test(t)) return null;
  return t;
}

function parseTagsInput(input) {
  const arr = Array.isArray(input)
    ? input
    : typeof input === 'string' ? input.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const t = normalizeTag(raw);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= 5) break; // máx 5 tags
  }
  return out;
}

app.get('/api/tags', (req, res) => {
  const me = req.session.username || null;
  const topics = readJSON(TOPICS_FILE)
    .filter(t => t.visibility === 'public' || t.author === me);

  const counts = {};
  for (const t of topics) {
    for (const tag of (t.tags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  const list = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  res.json(list);
});

app.get('/api/topics', (req, res) => {
  const me = req.session.username || null;
  const topics = readJSON(TOPICS_FILE)
    .filter(t => t.visibility === 'public' || t.author === me)
    .map(t => ({
      id: t.id,
      title: t.title,
      body: t.body,
      author: t.author,
      visibility: t.visibility,
      pinned: !!t.pinned,
      tags: parseTagsInput(t.tags), // ← NOVO
      upvotes: t.upvotes.length,
      downvotes: t.downvotes.length,
      score: scoreOf(t),
      myVote: me ? (t.upvotes.includes(me) ? 1 : t.downvotes.includes(me) ? -1 : 0) : 0,
      replies: t.replies,
      createdAt: t.createdAt
    }));

  // Ordenação: fixados → interações (score) → mais recente
  topics.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAt - a.createdAt;
  });

  res.json(topics);
});

app.post('/api/topics', requireAuth, (req, res) => {
  const { title, body, visibility, tags } = req.body || {};
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  const vis = visibility === 'private' ? 'private' : 'public';

  if (t.length < 5 || t.length > 120)
    return res.status(400).json({ error: 'O título deve ter entre 5 e 120 caracteres.' });
  if (!b || b.length > 5000)
    return res.status(400).json({ error: 'O conteúdo é obrigatório (máx. 5000 caracteres).' });

  const topics = readJSON(TOPICS_FILE);
  const topic = {
    id: crypto.randomUUID(),
    title: t,
    body: b,
    author: req.session.username,
    visibility: vis,
    pinned: false,
    tags: parseTagsInput(tags), // ← NOVO
    upvotes: [],
    downvotes: [],
    replies: [],
    createdAt: Date.now()
  };
  topics.push(topic);
  writeJSON(TOPICS_FILE, topics);
  res.status(201).json({ id: topic.id });
});

app.post('/api/topics/:id/vote', requireAuth, (req, res) => {
  const value = Number(req.body?.value);
  if (![1, -1, 0].includes(value))
    return res.status(400).json({ error: 'Voto inválido.' });

  const topics = readJSON(TOPICS_FILE);
  const topic = topics.find(t => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: 'Tópico não encontrado.' });
  if (topic.visibility === 'private' && topic.author !== req.session.username)
    return res.status(403).json({ error: 'Sem acesso a este tópico.' });

  const me = req.session.username;
  topic.upvotes = topic.upvotes.filter(u => u !== me);
  topic.downvotes = topic.downvotes.filter(u => u !== me);
  if (value === 1) topic.upvotes.push(me);
  if (value === -1) topic.downvotes.push(me);

  writeJSON(TOPICS_FILE, topics);
  res.json({ upvotes: topic.upvotes.length, downvotes: topic.downvotes.length });
});

app.post('/api/topics/:id/reply', requireAuth, (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 1000)
    return res.status(400).json({ error: 'A resposta deve ter entre 1 e 1000 caracteres.' });

  const topics = readJSON(TOPICS_FILE);
  const topic = topics.find(t => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: 'Tópico não encontrado.' });
  if (topic.visibility === 'private' && topic.author !== req.session.username)
    return res.status(403).json({ error: 'Sem acesso a este tópico.' });

  topic.replies.push({
    id: crypto.randomUUID(),
    author: req.session.username,
    body,
    createdAt: Date.now()
  });
  writeJSON(TOPICS_FILE, topics);
  res.status(201).json({ ok: true });
});

// ==========================================================
// Frontend + fallback
// ==========================================================
app.get('/login.html', (req, res, next) => {
  if (req.session.userId) return res.redirect('/');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ==========================================================
// Boot
// ==========================================================
ensureData();
seedIfNeeded()
app.listen(PORT, () => console.log(`DevForum rodando em http://localhost:${PORT}`));


