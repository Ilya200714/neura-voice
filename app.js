const SOCKET_URL = 'https://neura-voice-production.up.railway.app';
console.log('🔗 Подключение к серверу:', SOCKET_URL);

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

// Простые STUN серверы
const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' }
  ]
};

let myStream;
let myPeerId = 'user_' + Date.now();
let currentRoom = 'room_' + Math.floor(Math.random() * 1000);
let userName = '';
let connections = new Map(); // peerId -> RTCPeerConnection
let remoteStreams = new Map(); // peerId -> MediaStream

// ==================== СОБЫТИЯ СЕРВЕРА ====================
socket.on('connect', () => {
  console.log('✅ Подключен к серверу');
});

socket.on('auth-success', async (userData) => {
  console.log('✅ Вход успешен:', userData);
  userName = userData.name || 'Пользователь';
  
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  document.getElementById('user-name').textContent = userName;
  document.getElementById('user-initial').textContent = userName.slice(0, 2).toUpperCase();
  
  // Инициализация микрофона
  await initMicrophone();
  
  // Присоединение к комнате
  socket.emit('join-room', {
    room: currentRoom,
    peerId: myPeerId,
    name: userName
  });
  
  document.getElementById('current-room-display').textContent = currentRoom;
  alert(`🎤 Вы в комнате: ${currentRoom}\n\nСсылка для друга:\n${window.location.origin}?room=${currentRoom}`);
});

socket.on('user-joined', async (data) => {
  console.log('👤 Новый участник:', data);
  if (data.peerId !== myPeerId) {
    await createPeerConnection(data.peerId, data.name, true);
  }
});

socket.on('user-left', (data) => {
  console.log('👤 Участник вышел:', data);
  removeParticipant(data.peerId);
});

socket.on('webrtc-offer', async (data) => {
  console.log('📥 Получен offer от', data.from);
  await handleOffer(data.from, data.offer);
});

socket.on('webrtc-answer', async (data) => {
  console.log('📥 Получен answer от', data.from);
  const pc = connections.get(data.from);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on('webrtc-ice-candidate', (data) => {
  const pc = connections.get(data.from);
  if (pc && data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on('chat-message', (data) => {
  addMessage(data.name, data.text, data.name === userName);
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', () => {
  // Обработчики входа
  document.getElementById('login-btn').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
      alert('Заполните поля');
      return;
    }
    
    socket.emit('login', { username, password });
  });
  
  document.getElementById('register-btn').addEventListener('click', () => {
    const name = document.getElementById('register-name').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    
    if (!name || !username || !password) {
      alert('Заполните все поля');
      return;
    }
    
    socket.emit('register', { name, username, password });
  });
  
  // Кнопка приватной ссылки
  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const link = `${window.location.origin}?room=${currentRoom}&invite=true`;
    navigator.clipboard.writeText(link).then(() => {
      alert(`✅ Ссылка скопирована:\n${link}\n\nОтправьте другу!`);
    });
  });
  
  // Кнопка микрофона
  document.getElementById('mic-btn').addEventListener('click', toggleMicrophone);
  
  // Отправка сообщений
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  // Автоприсоединение по ссылке
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  if (room) {
    currentRoom = room;
    console.log('🔄 Присоединяюсь к комнате по ссылке:', room);
  }
});

// ==================== МИКРОФОН ====================
async function initMicrophone() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    
    console.log('🎤 Микрофон включен');
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('❌ Ошибка микрофона:', error);
    addParticipant(myPeerId, userName, null, true);
    alert('⚠️ Микрофон недоступен. Вы можете общаться в чате.');
  }
}

function toggleMicrophone() {
  if (!myStream) return;
  
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack) {
    const isEnabled = !audioTrack.enabled;
    audioTrack.enabled = isEnabled;
    
    const icon = document.querySelector('#mic-btn i');
    icon.setAttribute('data-lucide', isEnabled ? 'mic' : 'mic-off');
    if (window.lucide) lucide.createIcons();
    
    const statusEl = document.querySelector(`[data-peer-id="${myPeerId}"] .participant-status`);
    if (statusEl) {
      statusEl.textContent = isEnabled ? '🎤 Включен' : '🔇 Выключен';
    }
    
    alert('Микрофон ' + (isEnabled ? 'включен' : 'выключен'));
  }
}

// ==================== WEBRTC ====================
async function createPeerConnection(peerId, name, isInitiator) {
  console.log(`🔗 Создание соединения с ${name}`, isInitiator ? 'инициатор' : 'принимающий');
  
  try {
    const pc = new RTCPeerConnection(PC_CONFIG);
    connections.set(peerId, pc);
    
    // Добавляем наш поток
    if (myStream) {
      myStream.getTracks().forEach(track => {
        pc.addTrack(track, myStream);
      });
    }
    
    // Получение удаленного потока
    pc.ontrack = (event) => {
      console.log('🎵 Получен поток от', name);
      if (event.streams && event.streams[0]) {
        remoteStreams.set(peerId, event.streams[0]);
        updateParticipantWithStream(peerId, event.streams[0]);
      }
    };
    
    // ICE кандидаты
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          to: peerId,
          from: myPeerId,
          candidate: event.candidate
        });
      }
    };
    
    // Отслеживание состояния
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE состояние с ${name}: ${pc.iceConnectionState}`);
      
      if (pc.iceConnectionState === 'connected') {
        console.log(`✅ Соединение установлено с ${name}`);
      } else if (pc.iceConnectionState === 'failed') {
        console.log(`❌ Соединение не удалось с ${name}`);
        removeParticipant(peerId);
      }
    };
    
    // Создание offer если мы инициаторы
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc-offer', {
        to: peerId,
        from: myPeerId,
        offer: pc.localDescription
      });
    }
    
    return pc;
    
  } catch (error) {
    console.error('❌ Ошибка создания соединения:', error);
    return null;
  }
}

async function handleOffer(from, offer) {
  console.log('🔄 Обработка offer от', from);
  
  if (!connections.has(from)) {
    const pc = await createPeerConnection(from, 'Участник', false);
    
    if (!pc) return;
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
      to: from,
      from: myPeerId,
      answer: pc.localDescription
    });
  }
}

// ==================== УЧАСТНИКИ ====================
function addParticipant(id, name, stream, isMe) {
  const existing = document.querySelector(`[data-peer-id="${id}"]`);
  if (existing) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon participant-card';
  
  const initials = name.slice(0, 2).toUpperCase();
  const status = isMe ? (stream ? '🎤 Включен' : '🔇 Выключен') : 'Подключение...';
  
  card.innerHTML = `
    <div class="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-3xl font-bold text-white mb-4">
      ${initials}
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (Вы)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-2 participant-status">${status}</div>
    <div class="text-xs text-cyan-500 mt-2">${id.substring(0, 8)}...</div>
  `;
  
  // Аудио элемент для удаленного потока
  if (stream && !isMe) {
    const audio = document.createElement('audio');
    audio.id = `audio-${id}`;
    audio.autoplay = true;
    audio.controls = false;
    audio.style.display = 'none';
    audio.srcObject = stream;
    card.appendChild(audio);
  }
  
  document.getElementById('participants').appendChild(card);
}

function updateParticipantWithStream(peerId, stream) {
  const card = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (!card) return;
  
  const statusEl = card.querySelector('.participant-status');
  if (statusEl) {
    statusEl.textContent = '🎤 Говорит';
    statusEl.classList.add('speaking');
  }
  
  // Добавляем или обновляем аудио элемент
  let audio = card.querySelector('audio');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `audio-${peerId}`;
    audio.autoplay = true;
    audio.controls = false;
    audio.style.display = 'none';
    card.appendChild(audio);
  }
  
  audio.srcObject = stream;
  
  // Визуальная индикация звука
  const avatar = card.querySelector('.w-24');
  if (avatar) {
    avatar.classList.add('speaking');
  }
}

function removeParticipant(peerId) {
  const element = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (element) element.remove();
  
  const pc = connections.get(peerId);
  if (pc) {
    pc.close();
    connections.delete(peerId);
  }
  
  remoteStreams.delete(peerId);
}

// ==================== ЧАТ ====================
function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  
  if (!text) return;
  
  // Добавляем в наш чат
  addMessage(userName, text, true);
  
  // Отправляем другим
  socket.emit('chat-message', {
    room: currentRoom,
    name: userName,
    text: text
  });
  
  input.value = '';
  input.focus();
}

function addMessage(name, text, isSelf) {
  const container = document.getElementById('chat-messages');
  
  const msg = document.createElement('div');
  msg.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  msg.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
        ${name.slice(0,2).toUpperCase()}
      </div>
      <div>
        <div class="flex items-baseline gap-2">
          <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
          <div class="text-xs text-cyan-500">${time}</div>
        </div>
        <div class="mt-1">${text}</div>
      </div>
    </div>
  `;
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// Глобальные функции
window.addEmojiToInput = function(emoji) {
  const input = document.getElementById('chat-input');
  input.value += emoji;
  input.focus();
};