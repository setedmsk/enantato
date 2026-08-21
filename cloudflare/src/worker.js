const CHANNELS = [
  { id: 'geral', name: 'geral' },
  { id: 'clips', name: 'clips-e-memes' },
  { id: 'setup', name: 'setups' }
];

const encoder = new TextEncoder();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 5000;

function randomHex(bytes = 16) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(value) {
  return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function passwordRecord(password, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: encoder.encode(salt),
    iterations: 120000
  }, key, 256);
  return { salt, hash: bytesToHex(bits) };
}

async function passwordMatches(password, user) {
  const candidate = await passwordRecord(password, user.passwordSalt);
  return safeEqual(candidate.hash, user.passwordHash);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    emoji: user.emoji || '🎮',
    status: user.status || 'Disponível',
    avatar: user.avatar || '',
    banner: user.banner || '',
    bio: user.bio || ''
  };
}

function configuredOrigins(env) {
  return String(env.APP_ORIGINS || 'https://setedmsk.github.io')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const allowed = configuredOrigins(env);
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = configuredOrigins(env);
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  };
  if (origin && originAllowed(request, env)) {
    headers['Access-Control-Allow-Origin'] = allowed.includes('*') ? '*' : origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function json(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env)
  });
}

async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function parseIceServers(env) {
  if (!env.ICE_SERVERS) return [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const parsed = JSON.parse(env.ICE_SERVERS);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

export class EnantatoServer {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') {
      if (!originAllowed(request, this.env)) return json(request, this.env, { error: 'Origem não autorizada.' }, 403);
      return new Response(null, { status: 204, headers: corsHeaders(request, this.env) });
    }

    if (!originAllowed(request, this.env)) {
      return json(request, this.env, { error: 'Origem não autorizada.' }, 403);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
        return await this.upgrade(request, url);
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        const users = Number(await this.ctx.storage.get('userCount') || 0);
        return json(request, this.env, { ok: true, users, connected: this.ctx.getWebSockets().length });
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json(request, this.env, {
          apiVersion: 1,
          channels: CHANNELS,
          iceServers: parseIceServers(this.env)
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/register') {
        return await this.register(request);
      }

      if (request.method === 'POST' && url.pathname === '/api/login') {
        return await this.login(request);
      }

      if (request.method === 'GET' && url.pathname === '/api/me') {
        const user = await this.authenticate(request);
        return user
          ? json(request, this.env, { user: publicUser(user) })
          : json(request, this.env, { error: 'Sessão inválida.' }, 401);
      }

      if (request.method === 'GET' && url.pathname === '/api/state') {
        const user = await this.authenticate(request);
        if (!user) return json(request, this.env, { error: 'Sessão inválida.' }, 401);
        const channel = this.validChannel(url.searchParams.get('channel'));
        return json(request, this.env, {
          channels: CHANNELS,
          messages: await this.messages(channel),
          users: await this.connectedUsers(channel)
        });
      }

      return json(request, this.env, { error: 'Rota não encontrada.' }, 404);
    } catch (error) {
      console.error(error);
      const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
      return json(request, this.env, {
        error: status === 500 ? 'Erro interno.' : 'Requisição inválida.'
      }, status);
    }
  }

  async rateLimited(request) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = 'attempt:' + ip;
    const now = Date.now();
    const attempt = await this.ctx.storage.get(key);
    const next = !attempt || attempt.resetAt <= now
      ? { count: 1, resetAt: now + 60000 }
      : { count: attempt.count + 1, resetAt: attempt.resetAt };
    await this.ctx.storage.put(key, next);
    return next.count > 12;
  }

  async register(request) {
    if (await this.rateLimited(request)) {
      return json(request, this.env, { error: 'Muitas tentativas. Aguarde um minuto.' }, 429);
    }

    const body = await readJson(request);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || username).trim().slice(0, 24);
    const emoji = String(body.emoji || '🎮').trim().slice(0, 8);

    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      return json(request, this.env, {
        error: 'Use de 3 a 24 letras minúsculas, números, ponto, traço ou sublinhado.'
      }, 400);
    }
    if (password.length < 6 || password.length > 128) {
      return json(request, this.env, { error: 'A senha precisa ter entre 6 e 128 caracteres.' }, 400);
    }
    if (await this.ctx.storage.get('username:' + username)) {
      return json(request, this.env, { error: 'Este usuário já existe.' }, 409);
    }

    const record = await passwordRecord(password);
    const user = {
      id: randomHex(12),
      username,
      name,
      emoji,
      status: 'Disponível',
      avatar: '',
      banner: '',
      bio: '',
      passwordSalt: record.salt,
      passwordHash: record.hash,
      createdAt: new Date().toISOString()
    };

    const count = Number(await this.ctx.storage.get('userCount') || 0);
    await this.ctx.storage.put({
      ['user:' + user.id]: user,
      ['username:' + username]: user.id,
      userCount: count + 1
    });

    const token = await this.createSession(user.id);
    return json(request, this.env, { token, user: publicUser(user) }, 201);
  }

  async login(request) {
    if (await this.rateLimited(request)) {
      return json(request, this.env, { error: 'Muitas tentativas. Aguarde um minuto.' }, 429);
    }

    const body = await readJson(request);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const userId = await this.ctx.storage.get('username:' + username);
    const user = userId ? await this.ctx.storage.get('user:' + userId) : null;

    if (!user || !(await passwordMatches(password, user))) {
      return json(request, this.env, { error: 'Usuário ou senha inválidos.' }, 401);
    }

    const token = await this.createSession(user.id);
    return json(request, this.env, { token, user: publicUser(user) });
  }

  async createSession(userId) {
    const token = randomHex(32);
    await this.ctx.storage.put('session:' + token, {
      userId,
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
  }

  bearer(request) {
    const value = request.headers.get('Authorization') || '';
    return value.startsWith('Bearer ') ? value.slice(7) : '';
  }

  async sessionUser(token) {
    if (!token) return null;
    const session = await this.ctx.storage.get('session:' + token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await this.ctx.storage.delete('session:' + token);
      return null;
    }
    return await this.ctx.storage.get('user:' + session.userId) || null;
  }

  async authenticate(request) {
    return await this.sessionUser(this.bearer(request));
  }

  validChannel(channel) {
    return CHANNELS.some((item) => item.id === channel) ? channel : 'geral';
  }

  async messages(channel) {
    const value = await this.ctx.storage.get('messages:' + channel);
    return Array.isArray(value) ? value.slice(-100) : [];
  }

  attachment(socket) {
    try {
      return socket.deserializeAttachment() || null;
    } catch {
      return null;
    }
  }

  sockets(channel) {
    return this.ctx.getWebSockets().filter((socket) => this.attachment(socket)?.channel === channel);
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {}
  }

  broadcast(channel, payload, except = null) {
    for (const socket of this.sockets(channel)) {
      if (socket !== except) this.send(socket, payload);
    }
  }

  async connectedUsers(channel) {
    const ids = [...new Set(this.sockets(channel)
      .map((socket) => this.attachment(socket)?.userId)
      .filter(Boolean))];
    const users = await Promise.all(ids.map((id) => this.ctx.storage.get('user:' + id)));
    return users.filter(Boolean).map(publicUser);
  }

  async broadcastPresence(channel) {
    this.broadcast(channel, {
      type: 'presence',
      users: await this.connectedUsers(channel)
    });
  }

  async upgrade(request, url) {
    const user = await this.sessionUser(url.searchParams.get('token') || '');
    if (!user) return json(request, this.env, { error: 'Sessão inválida.' }, 401);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const channel = 'geral';
    server.serializeAttachment({ userId: user.id, channel });
    this.ctx.acceptWebSocket(server);

    this.send(server, {
      type: 'hello',
      user: publicUser(user),
      channels: CHANNELS,
      iceServers: parseIceServers(this.env),
      channel,
      messages: await this.messages(channel),
      users: await this.connectedUsers(channel)
    });
    await this.broadcastPresence(channel);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, raw) {
    if (typeof raw !== 'string' || raw.length > 256 * 1024) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const attachment = this.attachment(socket);
    if (!attachment?.userId) return;

    if (message.type === 'join') {
      const previous = attachment.channel;
      const channel = this.validChannel(message.channel);
      socket.serializeAttachment({ ...attachment, channel });
      this.send(socket, {
        type: 'history',
        channel,
        messages: await this.messages(channel)
      });
      await this.broadcastPresence(previous);
      if (channel !== previous) await this.broadcastPresence(channel);
      return;
    }

    if (message.type === 'chat') {
      const text = String(message.text || '').trim().slice(0, 1200);
      if (!text) return;
      const user = await this.ctx.storage.get('user:' + attachment.userId);
      if (!user) return;
      const channel = attachment.channel;
      const chat = {
        id: randomHex(10),
        channel,
        authorId: user.id,
        author: user.name,
        initial: user.name.charAt(0).toUpperCase(),
        avatar: user.avatar || '',
        color: 'red',
        time: new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo'
        }).format(new Date()),
        text,
        createdAt: new Date().toISOString()
      };
      const stored = await this.ctx.storage.get('messages:' + channel);
      const messages = Array.isArray(stored) ? stored : [];
      messages.push(chat);
      await this.ctx.storage.put('messages:' + channel, messages.slice(-MAX_MESSAGES));
      this.broadcast(channel, { type: 'chat', message: chat });
      return;
    }

    if (message.type === 'signal') {
      const targetId = String(message.to || '');
      for (const target of this.sockets(attachment.channel)) {
        if (this.attachment(target)?.userId === targetId) {
          this.send(target, { type: 'signal', from: attachment.userId, data: message.data });
        }
      }
      return;
    }

    if (message.type === 'screen-start' || message.type === 'screen-stop') {
      this.broadcast(attachment.channel, {
        type: message.type,
        userId: attachment.userId
      }, socket);
      return;
    }

    if (message.type === 'profile') {
      const user = await this.ctx.storage.get('user:' + attachment.userId);
      if (!user) return;
      const profile = message.profile || {};
      user.name = String(profile.name || user.name).trim().slice(0, 24);
      user.emoji = String(profile.emoji || user.emoji).trim().slice(0, 8);
      user.status = String(profile.status || user.status).trim().slice(0, 32);
      user.avatar = String(profile.avatar || '').trim().slice(0, 2048);
      user.banner = String(profile.banner || '').trim().slice(0, 2048);
      user.bio = String(profile.bio || '').trim().slice(0, 160);
      await this.ctx.storage.put('user:' + user.id, user);
      await this.broadcastPresence(attachment.channel);
    }
  }

  async webSocketClose(socket) {
    const channel = this.attachment(socket)?.channel;
    if (channel) await this.broadcastPresence(channel);
  }

  async webSocketError(socket) {
    const channel = this.attachment(socket)?.channel;
    if (channel) await this.broadcastPresence(channel);
  }
}

export default {
  async fetch(request, env) {
    const id = env.ENANTATO.idFromName('principal');
    return env.ENANTATO.get(id).fetch(request);
  }
};
