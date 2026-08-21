import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const dataDirectory = process.env.DATA_DIR || join(here, '..', 'data');
const stateFile = join(dataDirectory, 'state.json');
const publicDirectory = process.env.PUBLIC_DIR || '';
const allowedOrigins = (process.env.APP_ORIGIN || '*').split(',').map((value) => value.trim()).filter(Boolean);
const channels = [
  { id: 'geral', name: 'geral' },
  { id: 'clips', name: 'clips-e-memes' },
  { id: 'setup', name: 'setups' }
];
const sessions = new Map();
const clients = new Set();
const loginAttempts = new Map();
let persistQueue = Promise.resolve();
let state = { users: [], messages: [] };

await mkdir(dataDirectory, { recursive: true });
try {
  const loaded = JSON.parse(await readFile(stateFile, 'utf8'));
  if (Array.isArray(loaded.users) && Array.isArray(loaded.messages)) state = loaded;
} catch (error) {
  if (error.code !== 'ENOENT') console.error('Falha ao carregar o estado:', error);
}

function originAllowed(origin) {
  return allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && originAllowed(origin)) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
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

function bearer(request) {
  const value = request.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function authenticate(request) {
  const userId = sessions.get(bearer(request));
  return state.users.find((user) => user.id === userId) || null;
}

function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, userId);
  return token;
}

async function passwordRecord(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

async function passwordMatches(password, user) {
  const candidate = await passwordRecord(password, user.passwordSalt);
  return timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  const temporary = stateFile + '.tmp';
  persistQueue = persistQueue
    .then(() => writeFile(temporary, snapshot, 'utf8'))
    .then(() => rename(temporary, stateFile))
    .catch((error) => console.error('Falha ao salvar o estado:', error));
  return persistQueue;
}

function limited(ip) {
  const now = Date.now();
  const history = (loginAttempts.get(ip) || []).filter((time) => now - time < 60_000);
  history.push(now);
  loginAttempts.set(ip, history);
  return history.length > 12;
}

function parseIceServers() {
  if (!process.env.ICE_SERVERS) return [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const parsed = JSON.parse(process.env.ICE_SERVERS);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error('ICE_SERVERS precisa ser um array JSON.');
    return [];
  }
}

const iceServers = parseIceServers();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(request, response, pathname) {
  if (!publicDirectory || request.method !== 'GET') return false;
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const safe = normalize(requested).replace(/^([.][.][/\\])+/, '');
  if (safe.includes('..')) return false;
  try {
    const body = await readFile(join(publicDirectory, safe));
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(safe)] || 'application/octet-stream',
      'Cache-Control': safe === 'service-worker.js' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  applyCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || '/', 'http://localhost');
  if (!originAllowed(request.headers.origin)) {
    sendJson(response, 403, { error: 'Origem não autorizada.' });
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, users: state.users.length, connected: clients.size });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      sendJson(response, 200, { apiVersion: 1, channels, iceServers });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/register') {
      if (limited(request.socket.remoteAddress || 'unknown')) {
        sendJson(response, 429, { error: 'Muitas tentativas. Aguarde um minuto.' });
        return;
      }
      const body = await readJson(request);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || username).trim().slice(0, 24);
      const emoji = String(body.emoji || '🎮').trim().slice(0, 8);
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
        sendJson(response, 400, { error: 'Use de 3 a 24 letras minúsculas, números, ponto, traço ou sublinhado.' });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        sendJson(response, 400, { error: 'A senha precisa ter entre 6 e 128 caracteres.' });
        return;
      }
      if (state.users.some((user) => user.username === username)) {
        sendJson(response, 409, { error: 'Este usuário já existe.' });
        return;
      }
      const record = await passwordRecord(password);
      const user = {
        id: randomBytes(12).toString('hex'),
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
      state.users.push(user);
      await persist();
      sendJson(response, 201, { token: createSession(user.id), user: publicUser(user) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      if (limited(request.socket.remoteAddress || 'unknown')) {
        sendJson(response, 429, { error: 'Muitas tentativas. Aguarde um minuto.' });
        return;
      }
      const body = await readJson(request);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = state.users.find((candidate) => candidate.username === username);
      if (!user || !(await passwordMatches(password, user))) {
        sendJson(response, 401, { error: 'Usuário ou senha inválidos.' });
        return;
      }
      sendJson(response, 200, { token: createSession(user.id), user: publicUser(user) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/me') {
      const user = authenticate(request);
      if (!user) {
        sendJson(response, 401, { error: 'Sessão inválida.' });
        return;
      }
      sendJson(response, 200, { user: publicUser(user) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const user = authenticate(request);
      if (!user) {
        sendJson(response, 401, { error: 'Sessão inválida.' });
        return;
      }
      const channel = channels.some((item) => item.id === url.searchParams.get('channel'))
        ? url.searchParams.get('channel')
        : 'geral';
      sendJson(response, 200, {
        channels,
        messages: state.messages.filter((message) => message.channel === channel).slice(-100),
        users: [...new Map([...clients].map((client) => [client.userId, state.users.find((item) => item.id === client.userId)])).values()].filter(Boolean).map(publicUser)
      });
      return;
    }

    if (await serveStatic(request, response, url.pathname)) return;
    sendJson(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
    console.error(error);
    sendJson(response, status, { error: status === 500 ? 'Erro interno.' : 'Requisição inválida.' });
  }
});

function frame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function send(client, payload) {
  if (!client.socket.destroyed) client.socket.write(frame(JSON.stringify(payload)));
}

function channelClients(channel) {
  return [...clients].filter((client) => client.channel === channel);
}

function broadcast(channel, payload, except = null) {
  for (const client of channelClients(channel)) if (client !== except) send(client, payload);
}

function presence(channel) {
  const unique = new Map();
  for (const client of channelClients(channel)) {
    const user = state.users.find((item) => item.id === client.userId);
    if (user) unique.set(user.id, publicUser(user));
  }
  return [...unique.values()];
}

function broadcastPresence(channel) {
  broadcast(channel, { type: 'presence', users: presence(channel) });
}

function decodeFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const long = client.buffer.readBigUInt64BE(2);
      if (long > 1_048_576n) {
        client.socket.destroy();
        return;
      }
      length = Number(long);
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (client.buffer.length < offset + maskLength + length) return;
    let payload = client.buffer.subarray(offset + maskLength, offset + maskLength + length);
    if (masked) {
      const mask = client.buffer.subarray(offset, offset + 4);
      payload = Buffer.from(payload);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    client.buffer = client.buffer.subarray(offset + maskLength + length);
    if (opcode === 8) {
      client.socket.end(frame(Buffer.alloc(0), 8));
      return;
    }
    if (opcode === 9) {
      client.socket.write(frame(payload, 10));
      continue;
    }
    if (opcode !== 1) continue;
    handleSocketMessage(client, payload.toString('utf8'));
  }
}

async function handleSocketMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === 'join') {
    const target = channels.some((channel) => channel.id === message.channel) ? message.channel : 'geral';
    const previous = client.channel;
    client.channel = target;
    send(client, {
      type: 'history',
      channel: target,
      messages: state.messages.filter((item) => item.channel === target).slice(-100)
    });
    broadcastPresence(previous);
    broadcastPresence(target);
    return;
  }

  if (message.type === 'chat') {
    const text = String(message.text || '').trim().slice(0, 1200);
    if (!text) return;
    const user = state.users.find((item) => item.id === client.userId);
    if (!user) return;
    const chat = {
      id: randomBytes(10).toString('hex'),
      channel: client.channel,
      authorId: user.id,
      author: user.name,
      initial: user.name.charAt(0).toUpperCase(),
      avatar: user.avatar || '',
      color: 'red',
      time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date()),
      text,
      createdAt: new Date().toISOString()
    };
    state.messages.push(chat);
    if (state.messages.length > 5000) state.messages = state.messages.slice(-5000);
    persist();
    broadcast(client.channel, { type: 'chat', message: chat });
    return;
  }

  if (message.type === 'signal') {
    const targetId = String(message.to || '');
    for (const target of channelClients(client.channel)) {
      if (target.userId === targetId) send(target, { type: 'signal', from: client.userId, data: message.data });
    }
    return;
  }

  if (message.type === 'screen-start' || message.type === 'screen-stop') {
    broadcast(client.channel, { type: message.type, userId: client.userId }, client);
    return;
  }

  if (message.type === 'profile') {
    const user = state.users.find((item) => item.id === client.userId);
    if (!user) return;
    user.name = String(message.profile?.name || user.name).trim().slice(0, 24);
    user.emoji = String(message.profile?.emoji || user.emoji).trim().slice(0, 8);
    user.status = String(message.profile?.status || user.status).trim().slice(0, 32);
    user.avatar = String(message.profile?.avatar || '').trim().slice(0, 2048);
    user.banner = String(message.profile?.banner || '').trim().slice(0, 2048);
    user.bio = String(message.profile?.bio || '').trim().slice(0, 160);
    persist();
    broadcastPresence(client.channel);
  }
}

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const userId = sessions.get(token);
  const key = request.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !userId || !key || !originAllowed(request.headers.origin)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + accept,
    '\r\n'
  ].join('\r\n'));

  const client = { socket, userId, channel: 'geral', buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on('data', (chunk) => decodeFrames(client, chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    clients.delete(client);
    broadcastPresence(client.channel);
  });
  const user = state.users.find((item) => item.id === userId);
  send(client, {
    type: 'hello',
    user: publicUser(user),
    channels,
    iceServers,
    channel: client.channel,
    messages: state.messages.filter((item) => item.channel === client.channel).slice(-100),
    users: presence(client.channel)
  });
  broadcastPresence(client.channel);
});

const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (client.socket.destroyed) clients.delete(client);
    else client.socket.write(frame(Buffer.from('enantato'), 9));
  }
}, 25_000);
heartbeat.unref();

server.listen(port, '0.0.0.0', () => {
  console.log('Enantato server listening on http://0.0.0.0:' + port);
});
