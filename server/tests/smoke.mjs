import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDirectory = join(here, '..');
const dataDirectory = await mkdtemp(join(tmpdir(), 'enantato-test-'));
const port = 18787;
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['src/server.mjs'], {
  cwd: serverDirectory,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDirectory, APP_ORIGIN: '*' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverError = '';
child.stderr.on('data', (chunk) => { serverError += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Servidor não iniciou. ' + serverError);
}

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
  return body;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws?token=' + encodeURIComponent(token));
    const queue = [];
    const waiters = [];
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(payload));
      if (waiterIndex >= 0) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        waiter.resolve(payload);
      } else {
        queue.push(payload);
      }
    });
    socket.addEventListener('open', () => {
      resolve({
        socket,
        wait(predicate, timeout = 3000) {
          const queuedIndex = queue.findIndex(predicate);
          if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
          return new Promise((waitResolve, waitReject) => {
            const waiter = { predicate, resolve: waitResolve };
            waiters.push(waiter);
            setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              waitReject(new Error('Tempo esgotado aguardando evento WebSocket.'));
            }, timeout);
          });
        }
      });
    });
    socket.addEventListener('error', () => reject(new Error('Falha ao conectar WebSocket.')));
  });
}

try {
  await waitForServer();

  const alice = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'segredo123', name: 'Alice', emoji: '🎮' })
  });
  const bob = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'bob_teste', password: 'segredo456', name: 'Bob', emoji: '🔥' })
  });
  const login = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'segredo123' })
  });
  if (login.user.id !== alice.user.id) throw new Error('Login retornou usuário incorreto.');

  const aliceConnection = await connect(alice.token);
  const bobConnection = await connect(bob.token);
  await aliceConnection.wait((message) => message.type === 'hello');
  await bobConnection.wait((message) => message.type === 'hello');

  aliceConnection.socket.send(JSON.stringify({ type: 'chat', text: 'mensagem em tempo real' }));
  const chat = await bobConnection.wait((message) => message.type === 'chat');
  if (chat.message.text !== 'mensagem em tempo real' || chat.message.author !== 'Alice') {
    throw new Error('Mensagem não foi transmitida corretamente.');
  }

  aliceConnection.socket.send(JSON.stringify({
    type: 'signal',
    to: bob.user.id,
    data: { description: { type: 'offer', sdp: 'teste' } }
  }));
  const signal = await bobConnection.wait((message) => message.type === 'signal');
  if (signal.from !== alice.user.id || signal.data.description.type !== 'offer') {
    throw new Error('Sinalização WebRTC não foi entregue corretamente.');
  }

  aliceConnection.socket.close();
  bobConnection.socket.close();
  console.log('Multiuser integration test passed.');
} finally {
  child.kill();
  await rm(dataDirectory, { recursive: true, force: true });
}
