const SOCKET_URL = window.location.origin;
console.log('🔗 Подключение к:', SOCKET_URL);

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  timeout: 20000
});

const PC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let myStream;
let myPeerId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
let currentRoom = 'main_room';
let userName = '';
let userAvatar = '';
let currentGroup = null;
let groups = [];
let friends = [];
let friendRequests = [];
let micOn = true;
let cameraOn = false;
let connections = {};
let audioFilters = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

// ==================== ОТЛАДКА ====================
console.log('🚀 Приложение загружено, Peer ID:', myPeerId);

// Отладка всех событий Socket.io
socket.on('connect', () => {
  console.log('✅ Socket подключен к серверу. ID:', socket.id);
  updateConnectionStatus('connected');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения Socket.io:', error);
  console.error('Попытка подключения к:', SOCKET_URL);
  updateConnectionStatus('error', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Отключен от сервера. Причина:', reason);
  updateConnectionStatus('disconnected');
});

// Логирование всех исходящих событий
const originalEmit = socket.emit;
socket.emit = function(event, ...args) {
  console.log(`📤 [OUT] Событие "${event}":`, args.length ? args[0] : 'без данных');
  return originalEmit.call(this, event, ...args);
};

// Логирование всех входящих событий
socket.onAny((event, ...args) => {
  if (event !== 'webrtc-ice-candidate') { // Пропускаем шумные события
    console.log(`📥 [IN] Событие "${event}":`, args.length ? args[0] : 'без данных');
  }
});

function updateConnectionStatus(status, message = '') {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) {
    // Создаем элемент, если его нет
    const statusDiv = document.createElement('div');
    statusDiv.id = 'connection-status';
    statusDiv.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      z-index: 1000;
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(statusDiv);
  }
  
  const el = document.getElementById('connection-status');
  const colors = {
    connected: '#10b981',
    disconnected: '#ef4444',
    error: '#f59e0b',
    connecting: '#3b82f6'
  };
  
  const texts = {
    connected: '✅ Подключено',
    disconnected: '❌ Отключено',
    error: `⚠️ Ошибка: ${message}`,
    connecting: '🔄 Подключение...'
  };
  
  el.textContent = texts[status] || status;
  el.style.backgroundColor = colors[status] || '#6b7280';
  el.style.color = 'white';
}

// ==================== СОБЫТИЯ СЕРВЕРА ====================
socket.on('auth-success', (userData) => {
  console.log('✅ Успешная аутентификация:', userData);
  
  userName = userData.name || 'Пользователь';
  userAvatar = userData.avatar || '';
  
  // Показываем основной интерфейс
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('register-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  updateUserProfile();
  
  // Инициализируем голосовой чат
  setTimeout(() => initVoiceChat(), 100);
  
  // Загружаем данные
  loadGroups();
  loadFriends();
  loadFriendRequests();
  
  // Обновляем иконки
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  alert(`✅ Добро пожаловать, ${userName}!`);
});

socket.on('auth-error', (error) => {
  console.error('❌ Ошибка аутентификации:', error);
  showAuthError(error);
});

socket.on('register-error', (error) => {
  console.error('❌ Ошибка регистрации:', error);
  showAuthError(error, true);
});

// WebRTC события
socket.on('user-joined', async ({ peerId, name }) => {
  console.log('👤 Присоединился пользователь:', name, 'ID:', peerId);
  if (peerId !== myPeerId && myStream) {
    await createPeerConnection(peerId, name, true);
  }
});

socket.on('user-left', ({ peerId }) => {
  console.log('👤 Пользователь вышел:', peerId);
  removeParticipant(peerId);
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  console.log('📥 Получен WebRTC offer от', from);
  await handleOffer(from, offer);
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  console.log('📥 Получен WebRTC answer от', from);
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

// Друзья и группы
socket.on('friends-list', (list) => {
  console.log('👥 Получен список друзей:', list);
  friends = list;
  updateFriendsList();
});

socket.on('friend-request', ({ from }) => {
  console.log('🤝 Получен запрос дружбы от:', from);
  showFriendRequestNotification(from);
  loadFriendRequests();
});

socket.on('friend-requests-list', (requests) => {
  console.log('📨 Получены запросы дружбы:', requests);
  friendRequests = requests;
  updateFriendRequestsList();
});

socket.on('friend-request-sent', ({ to }) => {
  alert(`✅ Запрос дружбы отправлен пользователю ${to}`);
});

socket.on('friend-error', (error) => {
  alert(`❌ Ошибка с друзьями: ${error}`);
});

socket.on('groups-list', (list) => {
  console.log('👥 Получен список групп:', list);
  groups = list;
  updateGroupsList();
});

socket.on('group-invite', ({ groupId, groupName, inviter }) => {
  if (confirm(`${inviter} приглашает вас в группу "${groupName}". Принять?`)) {
    joinGroup(groupId);
  }
});

socket.on('group-message', ({ groupId, name, text, timestamp }) => {
  console.log('💬 Сообщение в группе:', { groupId, name, text });
  if (currentGroup && currentGroup.id === groupId) {
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false, timestamp);
    }
  }
});

socket.on('group-history', (messages) => {
  console.log('📜 История группы загружена:', messages.length, 'сообщений');
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
    messages.forEach(msg => {
      const isMyMessage = (msg.name === userName);
      addMessage(msg.name, msg.message, isMyMessage, msg.timestamp);
    });
  }
});

socket.on('group-created', (group) => {
  console.log('✅ Группа создана:', group);
  groups.push(group);
  updateGroupsList();
  alert(`✅ Группа "${group.name}" создана!`);
});

socket.on('group-error', (error) => {
  alert(`❌ Ошибка группы: ${error}`);
});

socket.on('chat-message', ({ name, text, timestamp }) => {
  console.log('💬 Общее сообщение:', { name, text });
  const isMyMessage = (name === userName);
  if (!isMyMessage) {
    addMessage(name, text, false, timestamp);
  }
});

socket.on('private-message', ({ from, text, timestamp }) => {
  console.log('📩 Личное сообщение от', from, ':', text);
  alert(`📩 ${from}: ${text}`);
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM загружен');
  
  // Автоматическое подключение при загрузке
  updateConnectionStatus('connecting');
  
  // Инициализация иконок
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  // Глобальные функции
  window.joinGroupHandler = joinGroup;
  window.deleteGroupHandler = deleteGroup;
  window.inviteFriendToCallHandler = inviteFriendToCall;
  window.sendMessageToFriendHandler = sendMessageToFriend;
  
  // Инициализация обработчиков
  initAllEventListeners();
  
  // Проверяем наличие тестовых данных
  console.log('📋 Тестовые логины:', [
    { username: 'test', password: '123' },
    { username: 'test1', password: '123' },
    { username: 'test2', password: 'password' }
  ]);
});

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
function initAllEventListeners() {
  // 1. Вход и регистрация
  document.getElementById('to-register-btn')?.addEventListener('click', () => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
    clearErrors();
  });
  
  document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    clearErrors();
  });
  
  document.getElementById('register-btn')?.addEventListener('click', handleRegister);
  document.getElementById('login-btn')?.addEventListener('click', handleLogin);
  
  // Автовход по Enter
  ['login-username', 'login-password', 'register-name', 'register-username', 'register-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          if (id.startsWith('login')) {
            handleLogin();
          } else {
            handleRegister();
          }
        }
      });
    }
  });
  
  // 2. Основные кнопки управления
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Выйти из аккаунта?')) {
      location.reload();
    }
  });
  
  document.getElementById('mic-btn')?.addEventListener('click', toggleMicrophone);
  document.getElementById('camera-btn')?.addEventListener('click', toggleCamera);
  document.getElementById('screen-share-btn')?.addEventListener('click', shareScreen);
  document.getElementById('copy-link-btn')?.addEventListener('click', copyRoomLink);
  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('add-friend-btn')?.addEventListener('click', openAddFriendModal);
  document.getElementById('create-group-btn')?.addEventListener('click', createGroup);
  document.getElementById('leave-group-btn')?.addEventListener('click', leaveGroup);
  
  // 3. Чат
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('emoji-btn')?.addEventListener('click', toggleEmojiPicker);
  
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  
  // 4. Загрузка файлов
  document.getElementById('media-upload')?.addEventListener('change', handleMediaUpload);
  document.getElementById('avatar-upload')?.addEventListener('change', handleAvatarUpload);
  document.getElementById('remove-avatar')?.addEventListener('click', removeAvatar);
  
  // 5. Модальные окна
  document.getElementById('close-settings')?.addEventListener('click', () => hideModal('settings-modal'));
  document.getElementById('cancel-settings')?.addEventListener('click', () => hideModal('settings-modal'));
  document.getElementById('close-add-friend')?.addEventListener('click', () => hideModal('add-friend-modal'));
  document.getElementById('cancel-add-friend')?.addEventListener('click', () => hideModal('add-friend-modal'));
  document.getElementById('send-friend-request')?.addEventListener('click', sendFriendRequest);
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);
  
  // 6. Аудио фильтры
  document.getElementById('echo-cancellation')?.addEventListener('change', updateAudioFilters);
  document.getElementById('noise-suppression')?.addEventListener('change', updateAudioFilters);
  document.getElementById('auto-gain-control')?.addEventListener('change', updateAudioFilters);
  
  // 7. Профиль
  document.getElementById('profile-avatar')?.addEventListener('input', updateAvatarPreviewFromUrl);
}

// ==================== ФУНКЦИИ АУТЕНТИФИКАЦИИ ====================
function handleRegister() {
  const name = document.getElementById('register-name')?.value.trim() || '';
  const username = document.getElementById('register-username')?.value.trim() || '';
  const password = document.getElementById('register-password')?.value.trim() || '';
  
  console.log('📝 Регистрация:', { name, username, passwordLength: password.length });
  
  if (!name || !username || !password) {
    showAuthError('Заполните все поля', true);
    return;
  }
  
  if (password.length < 3) {
    showAuthError('Пароль должен быть не менее 3 символов', true);
    return;
  }
  
  const btn = document.getElementById('register-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Регистрация...';
  btn.disabled = true;
  
  socket.emit('register', { name, username, password });
  
  // Таймаут
  setTimeout(() => {
    if (btn.disabled) {
      btn.textContent = originalText;
      btn.disabled = false;
      showAuthError('Таймаут регистрации', true);
    }
  }, 10000);
}

function handleLogin() {
  const username = document.getElementById('login-username')?.value.trim() || '';
  const password = document.getElementById('login-password')?.value.trim() || '';
  
  console.log('🔑 Вход:', { username, passwordLength: password.length });
  
  if (!username || !password) {
    showAuthError('Заполните поля');
    return;
  }
  
  const btn = document.getElementById('login-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Вход...';
  btn.disabled = true;
  
  socket.emit('login', { username, password });
  
  // Таймаут
  setTimeout(() => {
    if (btn.disabled) {
      btn.textContent = originalText;
      btn.disabled = false;
      showAuthError('Таймаут входа');
    }
  }, 10000);
}

function clearErrors() {
  document.getElementById('auth-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

function showAuthError(message, isRegister = false) {
  const elementId = isRegister ? 'register-error' : 'auth-error';
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.style.display = 'block';
    
    // Включаем кнопки обратно
    if (isRegister) {
      document.getElementById('register-btn').disabled = false;
      document.getElementById('register-btn').textContent = 'Создать аккаунт';
    } else {
      document.getElementById('login-btn').disabled = false;
      document.getElementById('login-btn').textContent = 'Войти';
    }
  }
}

// ==================== ГОЛОСОВОЙ ЧАТ ====================
async function initVoiceChat() {
  try {
    console.log('🎤 Инициализация голосового чата...');
    
    if (myStream) {
      myStream.getTracks().forEach(track => track.stop());
    }
    
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        ...audioFilters,
        sampleRate: 48000,
        channelCount: 1
      },
      video: false 
    });
    
    console.log('✅ Аудио поток получен');
    
    // Подключаемся к комнате
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('❌ Ошибка микрофона:', error);
    
    // Все равно подключаемся к комнате, но без потока
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    addParticipant(myPeerId, userName, null, true);
    alert('⚠️ Микрофон не доступен. Вы можете общаться в чате.');
  }
}

async function createPeerConnection(peerId, name, isInitiator = false) {
  console.log(`🔗 Создание соединения с ${name} (${peerId})`, isInitiator ? 'инициатор' : 'принимающий');
  
  const pc = new RTCPeerConnection(PC_CONFIG);
  connections[peerId] = pc;
  
  // Добавляем наши треки
  if (myStream) {
    myStream.getTracks().forEach(track => {
      pc.addTrack(track, myStream);
    });
  }
  
  pc.ontrack = (event) => {
    console.log('🎵 Получен аудио поток от', name);
    if (event.streams && event.streams[0]) {
      addParticipant(peerId, name, event.streams[0], false);
    }
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        to: peerId,
        from: myPeerId,
        candidate: event.candidate
      });
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log(`Состояние соединения с ${name}:`, pc.connectionState);
  };
  
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE состояние с ${name}:`, pc.iceConnectionState);
  };
  
  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc-offer', {
        to: peerId,
        from: myPeerId,
        offer: offer
      });
      
      console.log('📤 Отправлен offer к', peerId);
    } catch (error) {
      console.error('❌ Ошибка создания offer:', error);
    }
  }
  
  return pc;
}

async function handleOffer(from, offer) {
  console.log('📥 Обработка offer от', from);
  
  if (!connections[from]) {
    const pc = await createPeerConnection(from, 'Участник', false);
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socket.emit('webrtc-answer', {
        to: from,
        from: myPeerId,
        answer: answer
      });
      
      console.log('📤 Отправлен answer к', from);
    } catch (error) {
      console.error('❌ Ошибка обработки offer:', error);
    }
  }
}

// ==================== УЧАСТНИКИ ====================
function addParticipant(id, name, stream, isMe = false) {
  if (document.querySelector(`[data-peer-id="${id}"]`)) return;
  
  console.log('👤 Добавление участника:', { id, name, isMe, hasStream: !!stream });
  
  const participantsDiv = document.getElementById('participants');
  if (!participantsDiv) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${
    isMe ? 'border-2 border-cyan-500' : ''
  }`;
  
  const initials = name.slice(0, 2).toUpperCase();
  const status = isMe ? (micOn ? '🎤 Включен' : '🔇 Выключен') : 'Участник';
  
  card.innerHTML = `
    <div class="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-3xl font-bold text-white mb-4 relative">
      ${initials}
      ${isMe ? '<div class="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-2 border-cyan-900"></div>' : ''}
    </div>
    <div class="text-xl font-semibold text-cyan-100 truncate max-w-full">${name}${isMe ? ' (Вы)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-2">${status}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = isMe;
    audio.controls = false;
    audio.style.display = 'none';
    audio.srcObject = stream;
    
    audio.onloadedmetadata = () => {
      console.log('🎵 Аудио загружено для', name);
    };
    
    card.appendChild(audio);
  }
  
  participantsDiv.appendChild(card);
  
  // Ограничиваем количество участников на экране
  const children = participantsDiv.children;
  if (children.length > 10) {
    participantsDiv.removeChild(children[0]);
  }
}

function removeParticipant(peerId) {
  const element = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (element) {
    element.remove();
  }
  
  if (connections[peerId]) {
    connections[peerId].close();
    delete connections[peerId];
  }
}

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================
function updateUserProfile() {
  document.getElementById('user-name').textContent = userName;
  document.getElementById('user-initial').textContent = userName.slice(0, 2).toUpperCase();
  
  if (userAvatar) {
    document.getElementById('user-avatar-img').src = userAvatar;
    document.getElementById('user-avatar-img').classList.remove('hidden');
    document.getElementById('user-initial').classList.add('hidden');
  }
}

function toggleMicrophone() {
  if (!myStream) {
    alert('Сначала войдите в систему');
    return;
  }
  
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack) {
    micOn = !audioTrack.enabled;
    audioTrack.enabled = micOn;
    
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) {
      const icon = micBtn.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', micOn ? 'mic' : 'mic-off');
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      }
    }
    
    // Обновляем статус на нашей карточке
    const myCard = document.querySelector(`[data-peer-id="${myPeerId}"]`);
    if (myCard) {
      const statusEl = myCard.querySelector('.text-sm');
      if (statusEl) {
        statusEl.textContent = micOn ? '🎤 Включен' : '🔇 Выключен';
      }
    }
    
    console.log('Микрофон', micOn ? 'включен' : 'выключен');
  }
}

async function toggleCamera() {
  try {
    if (!cameraOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraOn = true;
      
      const cameraBtn = document.getElementById('camera-btn');
      if (cameraBtn) {
        const icon = cameraBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', 'video-off');
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      }
      
      alert('📹 Камера включена');
    } else {
      cameraOn = false;
      
      const cameraBtn = document.getElementById('camera-btn');
      if (cameraBtn) {
        const icon = cameraBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', 'video');
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      }
      
      alert('📹 Камера выключена');
    }
  } catch (error) {
    console.error('Ошибка камеры:', error);
    alert('Не удалось получить доступ к камере');
  }
}

async function shareScreen() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ 
      video: true,
      audio: false 
    });
    
    alert('🖥️ Демонстрация экрана начата!');
    
    stream.getVideoTracks()[0].onended = () => {
      alert('🖥️ Демонстрация экрана завершена');
    };
  } catch (error) {
    console.error('Ошибка демонстрации экрана:', error);
    alert('Не удалось начать демонстрацию экрана');
  }
}

function copyRoomLink() {
  const link = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  navigator.clipboard.writeText(link)
    .then(() => alert('✅ Ссылка на комнату скопирована в буфер!'))
    .catch(() => alert('❌ Не удалось скопировать ссылку'));
}

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('profile-name').value = userName;
  document.getElementById('profile-avatar').value = userAvatar;
  updateAvatarPreview();
}

function updateAudioFilters() {
  audioFilters = {
    echoCancellation: document.getElementById('echo-cancellation').checked,
    noiseSuppression: document.getElementById('noise-suppression').checked,
    autoGainControl: document.getElementById('auto-gain-control').checked
  };
  
  console.log('🎚️ Обновлены аудио фильтры:', audioFilters);
}

function saveSettings() {
  const newName = document.getElementById('profile-name').value.trim();
  const newAvatar = document.getElementById('profile-avatar').value.trim();
  
  if (!newName) {
    alert('Введите имя');
    return;
  }
  
  userName = newName;
  userAvatar = newAvatar;
  
  socket.emit('update-profile', { name: userName, avatar: userAvatar });
  updateUserProfile();
  hideModal('settings-modal');
  
  alert('✅ Настройки сохранены!');
}

function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 5 * 1024 * 1024) {
    alert('Файл слишком большой (макс. 5MB)');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('profile-avatar').value = event.target.result;
    updateAvatarPreview();
  };
  reader.readAsDataURL(file);
}

function updateAvatarPreview() {
  const url = document.getElementById('profile-avatar').value.trim();
  const preview = document.getElementById('avatar-preview');
  const removeBtn = document.getElementById('remove-avatar');
  
  if (url) {
    preview.src = url;
    preview.classList.remove('hidden');
    document.getElementById('default-avatar').classList.add('hidden');
    removeBtn.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    document.getElementById('default-avatar').classList.remove('hidden');
    removeBtn.classList.add('hidden');
  }
}

function updateAvatarPreviewFromUrl() {
  updateAvatarPreview();
}

function removeAvatar() {
  document.getElementById('profile-avatar').value = '';
  updateAvatarPreview();
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) {
    picker.classList.toggle('hidden');
  }
}

function openAddFriendModal() {
  showModal('add-friend-modal');
  document.getElementById('friend-username').focus();
}

function sendFriendRequest() {
  const username = document.getElementById('friend-username').value.trim();
  
  if (!username) {
    alert('Введите логин друга');
    return;
  }
  
  if (username === userName) {
    alert('Нельзя добавить себя в друзья');
    return;
  }
  
  socket.emit('friend-request', { from: userName, to: username });
  hideModal('add-friend-modal');
  document.getElementById('friend-username').value = '';
}

function createGroup() {
  const name = prompt('Введите название группы:');
  if (!name) return;
  
  const membersStr = prompt('Введите логины участников через запятую (необязательно):');
  const members = membersStr ? membersStr.split(',').map(m => m.trim()).filter(m => m) : [];
  
  socket.emit('create-group', { name, members, creator: userName });
}

function loadGroups() {
  socket.emit('get-groups');
}

function loadFriends() {
  socket.emit('get-friends');
}

function loadFriendRequests() {
  socket.emit('get-friend-requests');
}

function updateGroupsList() {
  const container = document.getElementById('groups-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = '<div class="text-cyan-500 py-4 text-center">Нет групп</div>';
    return;
  }
  
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'bg-black/40 rounded-xl p-4 mb-3 hover:bg-black/60 transition cursor-pointer';
    div.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <div class="font-medium text-cyan-100 text-lg">${group.name}</div>
          <div class="text-sm text-cyan-400 mt-1">${group.members?.length || 0} участников</div>
          <div class="text-xs text-cyan-500 mt-1">Создатель: ${group.creator}</div>
        </div>
        <button class="mt-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium join-group-btn">
          Войти
        </button>
      </div>
    `;
    
    div.querySelector('.join-group-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      joinGroup(group.id);
    });
    
    div.addEventListener('click', () => {
      joinGroup(group.id);
    });
    
    container.appendChild(div);
  });
}

function updateFriendsList() {
  const container = document.getElementById('friends-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friends.length === 0) {
    container.innerHTML = '<div class="text-cyan-500 py-4 text-center">Нет друзей</div>';
    return;
  }
  
  friends.forEach(friend => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between bg-black/40 rounded-xl p-4 mb-3 hover:bg-black/60';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-lg">
          ${friend.slice(0,2).toUpperCase()}
        </div>
        <div>
          <div class="font-medium text-cyan-100 text-lg">${friend}</div>
          <div class="text-sm text-cyan-400">Онлайн</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm invite-btn" title="Позвать в звонок">
          <i data-lucide="phone" class="w-4 h-4"></i>
        </button>
        <button class="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm message-btn" title="Написать">
          <i data-lucide="message-circle" class="w-4 h-4"></i>
        </button>
      </div>
    `;
    
    div.querySelector('.invite-btn').addEventListener('click', () => {
      inviteFriendToCall(friend);
    });
    
    div.querySelector('.message-btn').addEventListener('click', () => {
      sendMessageToFriend(friend);
    });
    
    container.appendChild(div);
  });
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function updateFriendRequestsList() {
  const container = document.getElementById('friend-requests-list');
  const countEl = document.getElementById('friend-requests-count');
  
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-cyan-500 py-4 text-center">Нет запросов</div>';
    if (countEl) {
      countEl.classList.add('hidden');
    }
    return;
  }
  
  if (countEl) {
    countEl.textContent = friendRequests.length;
    countEl.classList.remove('hidden');
  }
  
  friendRequests.forEach(request => {
    const fromUser = request.from_user;
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between bg-black/40 rounded-xl p-4 mb-3 hover:bg-black/60';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-lg">
          ${fromUser.slice(0,2).toUpperCase()}
        </div>
        <div class="font-medium text-cyan-100 text-lg">${fromUser}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm accept-btn">
          ✓ Принять
        </button>
        <button class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm reject-btn">
          ✕ Отклонить
        </button>
      </div>
    `;
    
    div.querySelector('.accept-btn').addEventListener('click', () => {
      acceptFriendRequest(fromUser);
    });
    
    div.querySelector('.reject-btn').addEventListener('click', () => {
      rejectFriendRequest(fromUser);
    });
    
    container.appendChild(div);
  });
}

function showFriendRequestNotification(fromUser) {
  if (confirm(`${fromUser} хочет добавить вас в друзья. Принять?`)) {
    acceptFriendRequest(fromUser);
  }
}

function acceptFriendRequest(fromUser) {
  socket.emit('accept-friend-request', { from: fromUser, to: userName });
  alert(`✅ Вы приняли запрос от ${fromUser}`);
  loadFriends();
  loadFriendRequests();
}

function rejectFriendRequest(fromUser) {
  socket.emit('reject-friend-request', { from: fromUser, to: userName });
  loadFriendRequests();
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  
  if (!text) return;
  
  addMessage(userName, text, true);
  
  if (currentGroup) {
    socket.emit('group-message', { 
      groupId: currentGroup.id, 
      name: userName, 
      text 
    });
  } else {
    socket.emit('chat-message', { 
      room: currentRoom, 
      name: userName, 
      text 
    });
  }
  
  if (input) {
    input.value = '';
    input.focus();
  }
}

function addMessage(name, text, isSelf, timestamp = new Date().toISOString()) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const msg = document.createElement('div');
  msg.className = `message ${isSelf ? 'message-self' : 'message-other'} animate-fadeIn`;
  msg.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        ${name.slice(0,2).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
          <div class="text-xs text-cyan-500">${time}</div>
        </div>
        <div class="mt-1 text-gray-100 break-words">${text}</div>
      </div>
    </div>
  `;
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    let msg = '';
    if (isImage) {
      msg = `<div class="media-container"><img src="${event.target.result}" alt="${file.name}" class="media-content"></div>`;
    } else if (isVideo) {
      msg = `<div class="media-container"><video src="${event.target.result}" controls class="media-content"></video></div>`;
    } else {
      msg = `<a href="${event.target.result}" download="${file.name}" class="text-cyan-400 underline">${file.name}</a>`;
    }
    
    addMessage(userName, msg, true);
    
    if (currentGroup) {
      socket.emit('group-message', { 
        groupId: currentGroup.id, 
        name: userName, 
        text: `[Файл: ${file.name}]` 
      });
    } else {
      socket.emit('chat-message', { 
        room: currentRoom, 
        name: userName, 
        text: `[Файл: ${file.name}]` 
      });
    }
  };
  reader.readAsDataURL(file);
  
  // Сбросить input
  e.target.value = '';
}

// ==================== ГЛОБАЛЬНЫЕ ФУНКЦИИ ====================
function joinGroup(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  
  currentGroup = group;
  currentRoom = `group_${groupId}`;
  
  socket.emit('join-group', { groupId, userId: myPeerId, name: userName });
  document.getElementById('chat-title').textContent = `Группа: ${group.name}`;
  document.getElementById('leave-group-btn').classList.remove('hidden');
  
  // Очищаем чат
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = '<div class="text-cyan-500 text-center py-4">Загрузка истории чата...</div>';
  }
  
  console.log(`✅ Присоединились к группе: ${group.name}`);
}

function deleteGroup(groupId) {
  if (confirm('Удалить эту группу? Это действие нельзя отменить.')) {
    socket.emit('delete-group', { groupId });
    alert('Группа удалена');
    loadGroups();
  }
}

function inviteFriendToCall(friendUsername) {
  const message = `${userName} приглашает вас в голосовой чат. Присоединиться: ${window.location.origin}?room=${currentRoom}`;
  socket.emit('private-message', { to: friendUsername, from: userName, text: message });
  alert(`📞 Приглашение отправлено ${friendUsername}`);
}

function sendMessageToFriend(friendUsername) {
  const message = prompt(`Сообщение для ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', { to: friendUsername, from: userName, text: message });
    alert(`📩 Сообщение отправлено ${friendUsername}`);
  }
}

function leaveGroup() {
  if (!currentGroup) return;
  
  if (confirm('Выйти из группы?')) {
    socket.emit('leave-group', { groupId: currentGroup.id, userId: myPeerId });
    currentGroup = null;
    currentRoom = 'main_room';
    
    document.getElementById('chat-title').textContent = 'Чат';
    document.getElementById('leave-group-btn').classList.add('hidden');
    
    // Очищаем чат
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) {
      chatMessages.innerHTML = '<div class="text-cyan-500 text-center py-4">Чат комнаты</div>';
    }
    
    // Возвращаемся в основную комнату
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    console.log('✅ Вышли из группы');
  }
}

// Глобальная функция для эмодзи
window.addEmojiToInput = function(emoji) {
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value += emoji;
    chatInput.focus();
    const emojiPicker = document.getElementById('emoji-picker');
    if (emojiPicker) {
      emojiPicker.classList.add('hidden');
    }
  }
};