const SOCKET_URL = 'https://neura-voice-production.up.railway.app'; // ИЛИ ваш Railway URL

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

// WebRTC конфигурация
const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let myStream;
let myPeerId = 'user_' + Date.now();
let currentRoom = 'default';
let userName = 'Ты';
let micOn = true;
let connections = {};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  console.log('🚀 Приложение загружено');
});

// ДОБАВЬТЕ ЭТУ ФУНКЦИЮ В APP.JS:
function initEventListeners() {
  // Вход
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.onclick = () => {
      const username = document.getElementById('login-username')?.value.trim();
      const password = document.getElementById('login-password')?.value.trim();
      
      if (!username || !password) {
        document.getElementById('auth-error').textContent = 'Заполните поля';
        return;
      }
      
      console.log('Вход:', username);
      socket.emit('login', { username, password });
    };
  }

  // Регистрация
  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) {
    registerBtn.onclick = () => {
      const name = document.getElementById('register-name')?.value.trim();
      const username = document.getElementById('register-username')?.value.trim();
      const password = document.getElementById('register-password')?.value.trim();
      
      if (!name || !username || !password) {
        document.getElementById('register-error').textContent = 'Заполните все поля';
        return;
      }
      
      console.log('Регистрация:', username);
      socket.emit('register', { name, username, password });
    };
  }

  // Переключение экранов
  const toRegisterBtn = document.getElementById('to-register-btn');
  if (toRegisterBtn) {
    toRegisterBtn.onclick = () => {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('register-screen').classList.remove('hidden');
    };
  }

  const backToLoginBtn = document.getElementById('back-to-login-btn');
  if (backToLoginBtn) {
    backToLoginBtn.onclick = () => {
      document.getElementById('register-screen').classList.add('hidden');
      document.getElementById('login-screen').classList.remove('hidden');
    };
  }

  // Микрофон
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) {
    micBtn.onclick = toggleMicrophone;
  }

  // Отправка сообщения
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.onclick = sendMessage;
  }
  
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter') sendMessage();
    };
  }
}

// Socket обработчики
socket.on('connect', () => {
  console.log('✅ Подключен к серверу');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error);
  document.getElementById('auth-error').textContent = 'Не удалось подключиться к серверу';
});

socket.on('auth-error', (error) => {
  const isRegisterScreen = !document.getElementById('register-screen').classList.contains('hidden');
  if (isRegisterScreen) {
    document.getElementById('register-error').textContent = error;
  } else {
    document.getElementById('auth-error').textContent = error;
  }
  console.error('Ошибка аутентификации:', error);
});

socket.on('auth-success', async (userData) => {
  console.log('✅ Вход успешен:', userData);
  
  userName = userData.name;
  
  // Переключаем экраны
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('register-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  // Инициализируем голосовой чат
  await initVoiceChat();
});

// WebRTC события
socket.on('user-joined', async ({ peerId, name }) => {
  console.log('👤 Присоединился:', name);
  if (peerId !== myPeerId && myStream) {
    await createPeerConnection(peerId, name, true);
  }
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  console.log('📥 Получен offer от', from);
  await handleOffer(from, offer);
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = connections[from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  const pc = connections[from];
  if (pc && candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

// Основные функции WebRTC
async function initVoiceChat() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false 
    });
    
    console.log('🎤 Получен аудио поток');
    
    // Присоединяемся к комнате
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    // Добавляем себя
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('❌ Ошибка микрофона:', error);
    // Добавляем себя без потока
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    addParticipant(myPeerId, userName, null, true);
  }
}

async function createPeerConnection(peerId, name, isInitiator = false) {
  const pc = new RTCPeerConnection(PC_CONFIG);
  connections[peerId] = pc;
  
  // Добавляем наш поток
  myStream.getTracks().forEach(track => {
    pc.addTrack(track, myStream);
  });
  
  // Получаем удаленный поток
  pc.ontrack = (event) => {
    console.log('🎵 Получен поток от', name);
    addParticipant(peerId, name, event.streams[0], false);
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
  
  // Если мы инициатор
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('webrtc-offer', {
      to: peerId,
      from: myPeerId,
      offer: offer
    });
  }
  
  return pc;
}

async function handleOffer(from, offer) {
  if (!myStream) return;
  
  const pc = await createPeerConnection(from, 'Участник', false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('webrtc-answer', {
    to: from,
    from: myPeerId,
    answer: answer
  });
}

function addParticipant(id, name, stream, isMe = false) {
  if (document.querySelector(`[data-peer-id="${id}"]`)) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon';
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4">
      ${name.slice(0,2).toUpperCase()}
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1">${isMe ? (micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.') : 'Участник'}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = isMe;
    audio.srcObject = stream;
    card.appendChild(audio);
  }
  
  document.getElementById('participants').appendChild(card);
}

function toggleMicrophone() {
  if (!myStream) return;
  
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack) {
    micOn = !audioTrack.enabled;
    audioTrack.enabled = micOn;
    
    console.log('Микрофон:', micOn ? 'ВКЛ' : 'ВЫКЛ');
    
    // Обновляем статус
    const myCard = document.querySelector('[data-self="true"]');
    if (myCard) {
      const statusDiv = myCard.querySelector('.text-sm');
      if (statusDiv) {
        statusDiv.textContent = micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.';
      }
    }
  }
}

function sendMessage() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput?.value.trim();
  
  if (!text) return;

  // Добавляем сообщение
  addMessage(userName, text, true);
  
  // Отправляем на сервер
  socket.emit('chat-message', { 
    room: currentRoom, 
    name: userName, 
    text 
  });

  chatInput.value = '';
  chatInput.focus();
}

function addMessage(name, text, isSelf) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  const msg = document.createElement('div');
  msg.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
  msg.innerHTML = `
    <div class="flex items-start gap-2">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
        ${name.slice(0,2).toUpperCase()}
      </div>
      <div>
        <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
        <div class="mt-1">${text}</div>
      </div>
    </div>
  `;
  
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Экспорт для глобального использования
window.joinGroupHandler = function(groupId) {
  console.log('Войти в группу:', groupId);
};

window.sendMessageToFriendHandler = function(friendUsername) {
  const message = prompt(`Отправить сообщение ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', {
      to: friendUsername,
      from: userName,
      text: message
    });
    alert(`Сообщение отправлено ${friendUsername}`);
  }
};
