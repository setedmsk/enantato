'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

const channelCopy = {
  geral: { title: 'geral', subtitle: 'Onde tudo acontece', welcome: 'Começo de #geral' },
  clips: { title: 'clips-e-memes', subtitle: 'Os melhores momentos da turma', welcome: 'Começo de #clips-e-memes' },
  setup: { title: 'setups', subtitle: 'Máquinas, periféricos e dicas', welcome: 'Começo de #setups' }
};

const seedMessages = {
  geral: [
    { author: 'Mika', initial: 'M', color: 'cyan', time: '19:42', text: 'Alguém anima testar a transmissão hoje? Ajustei tudo para ficar bem nítido.' },
    { author: 'Lune', initial: 'L', color: 'purple', time: '19:44', text: 'Dentro! 🌙 Vou entrar na sala principal daqui a pouco.' },
    { author: 'Enantato', initial: 'E', color: 'bot', time: '19:45', text: 'Sala pronta. Use “Compartilhar tela” no topo para escolher uma aba, janela ou monitor.' }
  ],
  clips: [
    { author: 'Kairo', initial: 'K', color: 'orange', time: '18:10', text: 'Esse canal vai guardar os melhores momentos. Mandem o primeiro clip!' }
  ],
  setup: [
    { author: 'Nori', initial: 'N', color: 'lime', time: '17:30', text: 'Postem seus setups e as configurações que ajudam na qualidade da transmissão.' }
  ]
};

let profile = storage.get('enantato.profile', null);
let activeChannel = storage.get('enantato.channel', 'geral');
let messages = storage.get('enantato.messages', seedMessages);
let screenStream = null;

function initialsAvatar(name, colorA = '#8b7bff', colorB = '#5ee7d7') {
  const initial = (name || 'E').trim().charAt(0).toUpperCase();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="' + colorA + '"/><stop offset="1" stop-color="' + colorB + '"/></linearGradient></defs><rect width="96" height="96" rx="26" fill="url(%23g)"/><text x="48" y="59" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="800" fill="%23071014">' + initial + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function safeAvatar(img, url, name) {
  img.onerror = () => { img.onerror = null; img.src = initialsAvatar(name); };
  img.src = url || initialsAvatar(name);
}

function toast(message, title = 'Enantato') {
  const item = document.createElement('div');
  item.className = 'toast';
  const strong = document.createElement('strong');
  strong.textContent = title;
  item.append(strong, document.createTextNode(message));
  $('#toastRegion').append(item);
  setTimeout(() => item.remove(), 3600);
}

function enterApp() {
  $('#loginScreen').classList.add('is-hidden');
  $('#appShell').classList.remove('is-hidden');
  applyProfile();
  setChannel(activeChannel);
}

function applyProfile() {
  if (!profile) return;
  $('#dockName').textContent = profile.name;
  $('#dockStatus').textContent = (profile.emoji || '✨') + ' ' + (profile.status || 'Disponível');
  safeAvatar($('#dockAvatar'), profile.avatar, profile.name);
  safeAvatar($('#profileAvatarPreview'), profile.avatar, profile.name);
  $('#profileName').value = profile.name || '';
  $('#profileAvatar').value = profile.avatar || '';
  $('#profileBannerUrl').value = profile.banner || '';
  $('#profileEmoji').value = profile.emoji || '✨';
  $('#profileStatus').value = profile.status || 'Disponível';
  $('#profileBio').value = profile.bio || '';
  $('#profileBanner').style.backgroundImage = profile.banner ? 'linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.18)), url("' + profile.banner.replace(/"/g, '') + '")' : '';
}

function renderMessages() {
  const list = $('#messages');
  list.replaceChildren();
  (messages[activeChannel] || []).forEach((message) => {
    const article = document.createElement('article');
    article.className = 'message' + (message.author === 'Enantato' ? ' bot' : '');
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar ' + (message.color || 'purple');
    if (message.avatar) {
      const image = document.createElement('img');
      safeAvatar(image, message.avatar, message.author);
      avatar.append(image);
    } else {
      avatar.textContent = message.initial || message.author.charAt(0);
    }
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'message-head';
    const author = document.createElement('strong');
    author.textContent = message.author;
    const time = document.createElement('time');
    time.textContent = message.time;
    const text = document.createElement('p');
    text.textContent = message.text;
    head.append(author, time);
    body.append(head, text);
    article.append(avatar, body);
    list.append(article);
  });
  const chat = $('#chatView');
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function setChannel(channel) {
  if (!channelCopy[channel]) return;
  activeChannel = channel;
  storage.set('enantato.channel', channel);
  $$('.channel').forEach((button) => button.classList.toggle('active', button.dataset.channel === channel));
  const copy = channelCopy[channel];
  $('#channelTitle').textContent = copy.title;
  $('#channelSubtitle').textContent = copy.subtitle;
  $('#welcomeTitle').textContent = copy.welcome;
  $('#messageInput').placeholder = 'Conversar em #' + copy.title;
  renderMessages();
}

function nowTime() {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

function qualityConstraints(value) {
  const presets = {
    '720': { width: 1280, height: 720, frameRate: 30 },
    '1080': { width: 1920, height: 1080, frameRate: 60 },
    '1440': { width: 2560, height: 1440, frameRate: 60 },
    '2160': { width: 3840, height: 2160, frameRate: 60 }
  };
  const preset = presets[value] || presets['1080'];
  return {
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate }
  };
}

async function startScreenShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('Este navegador não oferece captura de tela.', 'Indisponível');
    return;
  }
  if (screenStream) stopScreenShare();
  const quality = $('#qualitySelect').value;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: qualityConstraints(quality),
      audio: true,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include'
    });
    const videoTrack = screenStream.getVideoTracks()[0];
    if ('contentHint' in videoTrack) videoTrack.contentHint = 'detail';
    $('#screenPreview').srcObject = screenStream;
    $('#stage').classList.remove('is-hidden');
    $('#videoEmpty').classList.add('is-hidden');
    $('#shareScreen').innerHTML = '<span>●</span> Transmitindo';
    $('#qualityLabel').textContent = $('#qualitySelect').selectedOptions[0].textContent;
    videoTrack.addEventListener('ended', stopScreenShare, { once: true });
    toast('Sua prévia local está ativa. A distribuição aos amigos entra com o servidor LiveKit.', 'Ao vivo');
  } catch (error) {
    if (error.name !== 'NotAllowedError') toast('Não foi possível iniciar a captura: ' + error.message, 'Erro');
  }
}

function stopScreenShare() {
  if (screenStream) screenStream.getTracks().forEach((track) => track.stop());
  screenStream = null;
  $('#screenPreview').srcObject = null;
  $('#videoEmpty').classList.remove('is-hidden');
  $('#stage').classList.add('is-hidden');
  $('#shareScreen').innerHTML = '<span>▣</span> Compartilhar tela';
}

$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  profile = {
    name: $('#loginName').value.trim(),
    emoji: $('#loginEmoji').value.trim() || '✨',
    status: 'Disponível',
    avatar: '',
    banner: '',
    bio: ''
  };
  storage.set('enantato.profile', profile);
  enterApp();
  toast('Perfil criado. Clique nele no canto inferior para personalizar.');
});

$('#messageForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text || !profile) return;
  if (!messages[activeChannel]) messages[activeChannel] = [];
  messages[activeChannel].push({
    author: profile.name,
    initial: profile.name.charAt(0).toUpperCase(),
    avatar: profile.avatar,
    color: 'purple',
    time: nowTime(),
    text
  });
  storage.set('enantato.messages', messages);
  input.value = '';
  input.style.height = '';
  renderMessages();
});

$('#messageInput').addEventListener('input', (event) => {
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(event.target.scrollHeight, 110) + 'px';
});
$('#messageInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('#messageForm').requestSubmit();
  }
});

$$('.channel').forEach((button) => button.addEventListener('click', () => setChannel(button.dataset.channel)));
$$('.nav-item').forEach((button) => button.addEventListener('click', () => {
  $$('.nav-item').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  toast(button.dataset.view === 'eventos' ? 'Calendário compartilhado entra na próxima versão.' : 'Você já está na visão geral.');
}));
$$('.voice-channel').forEach((button) => button.addEventListener('click', () => {
  $$('.voice-channel').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  toast('Conectado visualmente à sala “' + button.dataset.room + '”. A voz em grupo entra com LiveKit.');
}));

$('#openProfile').addEventListener('click', () => {
  applyProfile();
  $('#profileModal').showModal();
});
$('#settingsButton').addEventListener('click', () => {
  applyProfile();
  $('#profileModal').showModal();
});
$('#profileAvatar').addEventListener('input', (event) => safeAvatar($('#profileAvatarPreview'), event.target.value, $('#profileName').value));
$('#profileBannerUrl').addEventListener('input', (event) => {
  $('#profileBanner').style.backgroundImage = event.target.value ? 'url("' + event.target.value.replace(/"/g, '') + '")' : '';
});
$('#profileForm').addEventListener('submit', (event) => {
  event.preventDefault();
  profile = {
    name: $('#profileName').value.trim() || profile.name,
    avatar: $('#profileAvatar').value.trim(),
    banner: $('#profileBannerUrl').value.trim(),
    emoji: $('#profileEmoji').value.trim() || '✨',
    status: $('#profileStatus').value.trim() || 'Disponível',
    bio: $('#profileBio').value.trim()
  };
  storage.set('enantato.profile', profile);
  applyProfile();
  $('#profileModal').close();
  toast('Avatar, banner e status foram atualizados.', 'Perfil salvo');
});

function toggleControl(button, mutedLabel, activeLabel) {
  button.classList.toggle('muted');
  button.setAttribute('aria-label', button.classList.contains('muted') ? mutedLabel : activeLabel);
  toast(button.classList.contains('muted') ? mutedLabel : activeLabel);
}
$('#micButton').addEventListener('click', (event) => toggleControl(event.currentTarget, 'Microfone desligado', 'Microfone ligado'));
$('#deafenButton').addEventListener('click', (event) => toggleControl(event.currentTarget, 'Áudio desligado', 'Áudio ligado'));
$('#addServer').addEventListener('click', () => toast('Criação de servidores será conectada ao banco na etapa multiusuário.'));
$$('.server-button[data-server]').forEach((button) => button.addEventListener('click', () => {
  $$('.server-button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $('#serverName').textContent = button.dataset.server;
  toast('Espaço “' + button.dataset.server + '” selecionado.');
}));
$('#shareScreen').addEventListener('click', startScreenShare);
$('#stopShare').addEventListener('click', stopScreenShare);
$('#qualitySelect').addEventListener('change', () => {
  $('#qualityLabel').textContent = $('#qualitySelect').selectedOptions[0].textContent;
  if (screenStream) toast('Encerre e inicie novamente para aplicar a nova resolução.');
});

window.addEventListener('beforeunload', stopScreenShare);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));

if (profile?.name) enterApp();
