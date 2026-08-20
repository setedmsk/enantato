'use strict';

(() => {
  const loginForm = document.querySelector('#loginForm');
  const messageForm = document.querySelector('#messageForm');
  const serverInput = document.querySelector('#serverUrl');
  const passwordInput = document.querySelector('#loginPassword');
  const displayNameInput = document.querySelector('#registerDisplayName');
  const displayNameLabel = document.querySelector('#displayNameLabel');
  const loginModeButton = document.querySelector('#loginMode');
  const registerModeButton = document.querySelector('#registerMode');
  const submitLabel = document.querySelector('#authSubmitLabel');
  const connectionHint = document.querySelector('#connectionHint');
  const connectionDot = document.querySelector('.connection-dot');

  if (!loginForm || !serverInput || !passwordInput) return;

  let authMode = 'login';
  let socket = null;
  let token = localStorage.getItem('enantato.token') || '';
  let currentUser = null;
  let onlineUsers = [];
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let remotePresenter = null;
  const peers = new Map();

  const savedServer = localStorage.getItem('enantato.server') || '';
  const hostedHere = !location.hostname.endsWith('github.io');
  serverInput.value = savedServer || (hostedHere ? location.origin : '');

  function baseUrl() {
    return serverInput.value.trim().replace(/\/+$/, '');
  }

  function setConnection(label, state = 'offline') {
    connectionHint.textContent = label;
    connectionDot.dataset.state = state;
    connectionDot.title = label;
  }

  function setAuthMode(mode) {
    authMode = mode;
    loginModeButton.classList.toggle('active', mode === 'login');
    registerModeButton.classList.toggle('active', mode === 'register');
    displayNameLabel.classList.toggle('is-hidden', mode !== 'register');
    displayNameInput.required = mode === 'register';
    submitLabel.textContent = mode === 'register' ? 'Criar conta' : 'Entrar no espaço';
  }

  loginModeButton.addEventListener('click', () => setAuthMode('login'));
  registerModeButton.addEventListener('click', () => setAuthMode('register'));

  async function api(path, options = {}) {
    const response = await fetch(baseUrl() + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Falha ao falar com o servidor.');
    return body;
  }

  function socketUrl() {
    const url = new URL(baseUrl());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = new URLSearchParams({ token }).toString();
    return url.toString();
  }

  function send(payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function applyRemoteMessages(channel, remoteMessages) {
    messages[channel] = remoteMessages.map((message) => ({ ...message, color: 'red' }));
    storage.set('enantato.messages', messages);
    if (activeChannel === channel) renderMessages();
  }

  function updateRoster(users) {
    onlineUsers = users;
    const heading = document.querySelector('.panel-heading span');
    if (heading) heading.textContent = 'NA SALA — ' + users.length;
    const voiceCount = document.querySelector('.voice-channel.active small');
    if (voiceCount) voiceCount.textContent = users.length + (users.length === 1 ? ' conectado' : ' conectados');
    document.querySelectorAll('.voice-users').forEach((list) => {
      list.replaceChildren();
      users.slice(0, 6).forEach((user) => {
        const avatar = document.createElement('span');
        avatar.className = 'mini-avatar';
        avatar.textContent = user.name.charAt(0).toUpperCase();
        const name = document.createElement('span');
        name.textContent = user.name;
        list.append(avatar, name);
        if (user.id === currentUser?.id) {
          const you = document.createElement('i');
          you.textContent = 'você';
          list.append(you);
        }
      });
    });

    if (screenStream) {
      users.filter((user) => user.id !== currentUser?.id && !peers.has(user.id)).forEach((user) => offerScreenTo(user.id));
    }
  }

  function closePeer(userId) {
    const entry = peers.get(userId);
    if (!entry) return;
    entry.pc.close();
    peers.delete(userId);
  }

  function showRemoteStream(stream, userId) {
    remotePresenter = userId;
    const preview = document.querySelector('#screenPreview');
    preview.srcObject = stream;
    preview.muted = false;
    preview.controls = true;
    document.querySelector('#stage').classList.remove('is-hidden');
    document.querySelector('#videoEmpty').classList.add('is-hidden');
    document.querySelector('#shareScreen').innerHTML = '<span>●</span> Assistindo';
  }

  function createPeer(userId) {
    if (peers.has(userId)) return peers.get(userId).pc;
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, stream: new MediaStream() };
    peers.set(userId, entry);

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) send({ type: 'signal', to: userId, data: { candidate: event.candidate } });
    });
    pc.addEventListener('track', (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!entry.stream.getTracks().some((current) => current.id === track.id)) entry.stream.addTrack(track);
      });
      showRemoteStream(event.streams[0] || entry.stream, userId);
    });
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        closePeer(userId);
        if (remotePresenter === userId) {
          remotePresenter = null;
          stopRemotePreview();
        }
      }
    });
    return pc;
  }

  async function offerScreenTo(userId) {
    if (!screenStream || userId === currentUser?.id) return;
    const pc = createPeer(userId);
    for (const track of screenStream.getTracks()) {
      if (!pc.getSenders().some((sender) => sender.track?.id === track.id)) pc.addTrack(track, screenStream);
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'signal', to: userId, data: { description: pc.localDescription } });
  }

  async function handleSignal(message) {
    const pc = createPeer(message.from);
    const data = message.data || {};
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: 'signal', to: message.from, data: { description: pc.localDescription } });
      }
    }
    if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
  }

  function stopRemotePreview() {
    if (screenStream) return;
    const preview = document.querySelector('#screenPreview');
    if (preview.srcObject) preview.srcObject.getTracks().forEach((track) => track.stop());
    preview.srcObject = null;
    preview.controls = false;
    preview.muted = true;
    document.querySelector('#stage').classList.add('is-hidden');
    document.querySelector('#videoEmpty').classList.remove('is-hidden');
    document.querySelector('#shareScreen').innerHTML = '<span>▣</span> Compartilhar tela';
  }

  async function syncScreenShare() {
    for (let attempt = 0; attempt < 20 && !screenStream; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!screenStream) return;
    send({ type: 'screen-start' });
    for (const user of onlineUsers) await offerScreenTo(user.id);
    const track = screenStream.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      send({ type: 'screen-stop' });
      for (const userId of peers.keys()) closePeer(userId);
    }, { once: true });
  }

  function handleSocketMessage(event) {
    const payload = JSON.parse(event.data);
    if (payload.type === 'hello') {
      currentUser = payload.user;
      iceServers = payload.iceServers || iceServers;
      applyRemoteMessages(payload.channel, payload.messages || []);
      updateRoster(payload.users || []);
      setConnection('Conectado ao servidor da turma', 'online');
      return;
    }
    if (payload.type === 'history') {
      applyRemoteMessages(payload.channel, payload.messages || []);
      return;
    }
    if (payload.type === 'chat') {
      const channel = payload.message.channel;
      if (!messages[channel]) messages[channel] = [];
      messages[channel].push({ ...payload.message, color: 'red' });
      storage.set('enantato.messages', messages);
      if (activeChannel === channel) renderMessages();
      return;
    }
    if (payload.type === 'presence') {
      updateRoster(payload.users || []);
      return;
    }
    if (payload.type === 'signal') {
      handleSignal(payload).catch((error) => toast(error.message, 'Transmissão'));
      return;
    }
    if (payload.type === 'screen-start') {
      const presenter = onlineUsers.find((user) => user.id === payload.userId);
      toast((presenter?.name || 'Alguém') + ' começou a compartilhar a tela.', 'Ao vivo');
      return;
    }
    if (payload.type === 'screen-stop') {
      closePeer(payload.userId);
      if (remotePresenter === payload.userId) {
        remotePresenter = null;
        stopRemotePreview();
      }
    }
  }

  function connect() {
    socket?.close();
    setConnection('Conectando…', 'connecting');
    socket = new WebSocket(socketUrl());
    socket.addEventListener('open', () => send({ type: 'join', channel: activeChannel }));
    socket.addEventListener('message', (event) => {
      try { handleSocketMessage(event); } catch (error) { console.error(error); }
    });
    socket.addEventListener('close', () => {
      setConnection('Desconectado — tentando novamente', 'offline');
      setTimeout(() => {
        if (token && baseUrl()) connect();
      }, 2500);
    });
    socket.addEventListener('error', () => setConnection('Servidor indisponível', 'offline'));
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!baseUrl()) {
      toast('Informe o endereço HTTPS do servidor da turma.', 'Servidor');
      return;
    }
    const username = document.querySelector('#loginName').value.trim().toLowerCase();
    const password = passwordInput.value;
    const emoji = document.querySelector('#loginEmoji').value.trim() || '🎮';
    try {
      setConnection('Autenticando…', 'connecting');
      const body = authMode === 'register'
        ? { username, password, name: displayNameInput.value.trim() || username, emoji }
        : { username, password };
      const result = await api('/api/' + authMode, { method: 'POST', body: JSON.stringify(body) });
      token = result.token;
      currentUser = result.user;
      profile = {
        name: result.user.name,
        emoji: result.user.emoji,
        status: result.user.status,
        avatar: result.user.avatar,
        banner: result.user.banner,
        bio: result.user.bio
      };
      localStorage.setItem('enantato.server', baseUrl());
      localStorage.setItem('enantato.token', token);
      storage.set('enantato.profile', profile);
      enterApp();
      connect();
      toast(authMode === 'register' ? 'Conta criada e conectada.' : 'Sessão iniciada.', 'Enantato');
    } catch (error) {
      setConnection(error.message, 'offline');
      toast(error.message, 'Não foi possível entrar');
    }
  }, { capture: true });

  messageForm.addEventListener('submit', (event) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input = document.querySelector('#messageInput');
    const text = input.value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    input.value = '';
    input.style.height = '';
  }, { capture: true });

  document.querySelectorAll('.channel').forEach((button) => button.addEventListener('click', () => {
    if (socket?.readyState === WebSocket.OPEN) send({ type: 'join', channel: button.dataset.channel });
  }));

  document.querySelector('#profileForm').addEventListener('submit', () => {
    setTimeout(() => send({ type: 'profile', profile }), 0);
  });

  document.querySelector('#shareScreen').addEventListener('click', () => {
    if (socket?.readyState === WebSocket.OPEN) syncScreenShare().catch((error) => toast(error.message, 'Transmissão'));
  });
  document.querySelector('#stopShare').addEventListener('click', () => {
    send({ type: 'screen-stop' });
    for (const userId of peers.keys()) closePeer(userId);
  });

  async function restoreSession() {
    if (!token || !baseUrl()) {
      setConnection(hostedHere ? 'Pronto para conectar' : 'Informe o servidor da turma', 'offline');
      return;
    }
    try {
      const result = await api('/api/me');
      currentUser = result.user;
      profile = {
        name: result.user.name,
        emoji: result.user.emoji,
        status: result.user.status,
        avatar: result.user.avatar,
        banner: result.user.banner,
        bio: result.user.bio
      };
      storage.set('enantato.profile', profile);
      if (document.querySelector('#appShell').classList.contains('is-hidden')) enterApp();
      connect();
    } catch {
      token = '';
      localStorage.removeItem('enantato.token');
      setConnection('Sessão expirada — entre novamente', 'offline');
    }
  }

  setAuthMode('login');
  restoreSession();
})();
