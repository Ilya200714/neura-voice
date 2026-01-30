const SOCKET_URL = 'https://neura-voice-production.up.railway.app';

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

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

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Приложение загружено');
  
  // Инициализируем все обработчики
  initAllEventListeners();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  // Экспорт функций для глобального использования
  window.joinGroupHandler = joinGroup;
  window.deleteGroupHandler = deleteGroup;
  window.inviteFriendToCallHandler = inviteFriendToCall;
  window.sendMessageToFriendHandler = sendMessageToFriend;
});

// Отладка соединения
socket.on('connect', () => {
  console.log('✅ Подключен к серверу');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error);
  showError('Не удалось подключиться к серверу');
});

socket.on('auth-error', (error) => {
  console.error('Ошибка аутентификации:', error);
  showError(error);
});

socket.on('auth-success', async (userData) => {
  console.log('✅ Вход успешен:', userData);
  
  userName = userData.name || 'Пользователь';
  userAvatar = userData.avatar || '';
  
  // Показываем основной интерфейс
  showElement('main-screen');
  hideElement('login-screen');
  hideElement('register-screen');
  
  updateUserProfile();
  
  // Инициализируем голосовой чат
  try {
    await initVoiceChat();
  } catch (error) {
    console.error('Ошибка голосового чата:', error);
  }
  
  // Загружаем данные
  loadGroups();
  loadFriends();
  loadFriendRequests();
  
  // Обновляем иконки
  lucide.createIcons();
  
  alert('✅ Добро пожаловать, ' + userName + '!');
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

// Друзья и группы
socket.on('friends-list', (list) => {
  friends = list;
  updateFriendsList();
});

socket.on('friend-request', ({ from, to }) => {
  console.log('🤝 Запрос дружбы от:', from);
  showFriendRequestNotification(from);
  loadFriendRequests();
});

socket.on('friend-requests-list', (requests) => {
  friendRequests = requests;
  updateFriendRequestsList();
});

socket.on('groups-list', (list) => {
  groups = list;
  updateGroupsList();
});

socket.on('group-message', ({ groupId, name, text }) => {
  if (currentGroup && currentGroup.id === groupId) {
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

socket.on('chat-message', ({ name, text }) => {
  if (!currentGroup) {
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showError(message) {
  const errorEl = document.getElementById('auth-error') || document.getElementById('register-error');
  if (errorEl) errorEl.textContent = message;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ВСЕХ ОБРАБОТЧИКОВ ====================
function initAllEventListeners() {
  // 1. Вход и регистрация
  document.getElementById('to-register-btn')?.addEventListener('click', () => {
    hideElement('login-screen');
    showElement('register-screen');
  });
  
  document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
    hideElement('register-screen');
    showElement('login-screen');
  });
  
  document.getElementById('register-btn')?.addEventListener('click', () => {
    const name = document.getElementById('register-name')?.value.trim() || '';
    const username = document.getElementById('register-username')?.value.trim() || '';
    const password = document.getElementById('register-password')?.value.trim() || '';
    
    if (!name || !username || !password) {
      showError('Заполните все поля');
      return;
    }
    
    socket.emit('register', { name, username, password });
  });
  
  document.getElementById('login-btn')?.addEventListener('click', () => {
    const username = document.getElementById('login-username')?.value.trim() || '';
    const password = document.getElementById('login-password')?.value.trim() || '';
    
    if (!username || !password) {
      showError('Заполните поля');
      return;
    }
    
    socket.emit('login', { username, password });
  });
  
  // 2. Основные кнопки управления
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Выйти?')) location.reload();
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
      if (e.key === 'Enter') sendMessage();
    });
  }
  
  // 4. Загрузка файлов
  document.getElementById('media-upload')?.addEventListener('change', handleMediaUpload);
  document.getElementById('avatar-upload')?.addEventListener('change', handleAvatarUpload);
  document.getElementById('remove-avatar')?.addEventListener('click', removeAvatar);
  
  // 5. Модальные окна
  document.getElementById('close-settings')?.addEventListener('click', () => hideElement('settings-modal'));
  document.getElementById('cancel-settings')?.addEventListener('click', () => hideElement('settings-modal'));
  document.getElementById('close-add-friend')?.addEventListener('click', () => hideElement('add-friend-modal'));
  document.getElementById('cancel-add-friend')?.addEventListener('click', () => hideElement('add-friend-modal'));
  document.getElementById('send-friend-request')?.addEventListener('click', sendFriendRequest);
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);
  
  // 6. Аудио фильтры
  document.getElementById('echo-cancellation')?.addEventListener('change', updateAudioFilters);
  document.getElementById('noise-suppression')?.addEventListener('change', updateAudioFilters);
  document.getElementById('auto-gain-control')?.addEventListener('change', updateAudioFilters);
  
  // 7. Профиль
  document.getElementById('profile-avatar')?.addEventListener('input', updateAvatarPreviewFromUrl);
}

// ==================== ГОЛОСОВОЙ ЧАТ ====================
async function initVoiceChat() {
  try {
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
    
    console.log('🎤 Получен аудио поток');
    
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('❌ Ошибка микрофона:', error);
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
  
  myStream?.getTracks().forEach(track => {
    pc.addTrack(track, myStream);
  });
  
  pc.ontrack = (event) => {
    console.log('🎵 Получен поток от', name);
    addParticipant(peerId, name, event.streams[0], false);
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

// ==================== УПРАВЛЕНИЕ УЧАСТНИКАМИ ====================
function addParticipant(id, name, stream, isMe = false) {
  if (document.querySelector(`[data-peer-id="${id}"]`)) return;
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.dataset.self = isMe ? 'true' : '';
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon`;
  
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
  
  const participantsDiv = document.getElementById('participants');
  if (participantsDiv) {
    participantsDiv.appendChild(card);
  }
}

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================
function updateUserProfile() {
  const userNameDisplay = document.getElementById('user-name');
  const userInitial = document.getElementById('user-initial');
  
  if (userNameDisplay) userNameDisplay.textContent = userName;
  if (userInitial) userInitial.textContent = userName.slice(0, 2).toUpperCase();
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
        lucide.createIcons();
      }
    }
    
    alert('Микрофон ' + (micOn ? 'включен' : 'выключен'));
  }
}

async function toggleCamera() {
  try {
    if (!cameraOn) {
      await navigator.mediaDevices.getUserMedia({ video: true });
      cameraOn = true;
      alert('Камера включена');
    } else {
      cameraOn = false;
      alert('Камера выключена');
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
    alert('Демонстрация экрана начата!');
    
    stream.getVideoTracks()[0].onended = () => {
      alert('Демонстрация экрана завершена');
    };
  } catch (error) {
    console.error('Ошибка демонстрации экрана:', error);
    alert('Не удалось начать демонстрацию экрана');
  }
}

function copyRoomLink() {
  const link = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  navigator.clipboard.writeText(link)
    .then(() => alert('✅ Ссылка скопирована!'))
    .catch(() => alert('❌ Не удалось скопировать ссылку'));
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  
  modal.classList.remove('hidden');
  document.getElementById('profile-name').value = userName;
  document.getElementById('profile-avatar').value = userAvatar;
}

function updateAudioFilters() {
  const echo = document.getElementById('echo-cancellation');
  const noise = document.getElementById('noise-suppression');
  const gain = document.getElementById('auto-gain-control');
  
  if (echo && noise && gain) {
    audioFilters = {
      echoCancellation: echo.checked,
      noiseSuppression: noise.checked,
      autoGainControl: gain.checked
    };
  }
}

function saveSettings() {
  const newName = document.getElementById('profile-name')?.value.trim() || '';
  const newAvatar = document.getElementById('profile-avatar')?.value.trim() || '';
  
  if (!newName) {
    alert('Введите имя');
    return;
  }
  
  userName = newName;
  userAvatar = newAvatar;
  
  socket.emit('update-profile', { name: userName, avatar: userAvatar });
  updateUserProfile();
  hideElement('settings-modal');
  alert('✅ Настройки сохранены!');
}

function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('profile-avatar').value = event.target.result;
  };
  reader.readAsDataURL(file);
}

function updateAvatarPreviewFromUrl() {
  // Функция предпросмотра аватара
}

function removeAvatar() {
  document.getElementById('profile-avatar').value = '';
  userAvatar = '';
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) {
    picker.classList.toggle('hidden');
  }
}

function openAddFriendModal() {
  showElement('add-friend-modal');
}

function sendFriendRequest() {
  const username = document.getElementById('friend-username')?.value.trim() || '';
  
  if (!username) {
    alert('Введите логин друга');
    return;
  }
  
  if (username === userName) {
    alert('Нельзя добавить себя в друзья');
    return;
  }
  
  socket.emit('friend-request', { from: userName, to: username });
  hideElement('add-friend-modal');
  document.getElementById('friend-username').value = '';
  alert('✅ Запрос отправлен!');
}

function createGroup() {
  const name = prompt('Название группы:');
  if (!name) return;
  
  socket.emit('create-group', { name, members: [], creator: userName });
  alert('✅ Группа создана!');
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
    container.innerHTML = '<div class="text-gray-400 py-4 text-center">Нет групп</div>';
    return;
  }
  
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'bg-black/40 rounded-xl p-4 mb-2 hover:bg-black/60';
    div.innerHTML = `
      <div class="font-medium text-cyan-100">${group.name}</div>
      <div class="text-sm text-cyan-400">${group.members?.length || 0} участников</div>
      <button class="mt-2 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-sm join-group-btn">Войти</button>
    `;
    
    div.querySelector('.join-group-btn').addEventListener('click', () => {
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
    container.innerHTML = '<div class="text-gray-400 py-4 text-center">Нет друзей</div>';
    return;
  }
  
  friends.forEach(friend => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between bg-black/40 rounded-xl p-3 mb-2 hover:bg-black/60';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${friend.slice(0,2).toUpperCase()}
        </div>
        <div class="font-medium text-cyan-100">${friend}</div>
      </div>
      <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm invite-btn">Позвать</button>
    `;
    
    div.querySelector('.invite-btn').addEventListener('click', () => {
      inviteFriendToCall(friend);
    });
    
    container.appendChild(div);
  });
}

function showFriendRequestNotification(fromUser) {
  if (confirm(`${fromUser} хочет добавить вас в друзья. Принять?`)) {
    acceptFriendRequest(fromUser);
  }
}

function updateFriendRequestsList() {
  const container = document.getElementById('friend-requests-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-gray-400 py-4 text-center">Нет запросов</div>';
    return;
  }
  
  friendRequests.forEach(request => {
    const fromUser = request.from_user;
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between bg-black/40 rounded-xl p-3 mb-2 hover:bg-black/60';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${fromUser.slice(0,2).toUpperCase()}
        </div>
        <div class="font-medium text-cyan-100">${fromUser}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm accept-btn">✓</button>
        <button class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm reject-btn">✕</button>
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

function addMessage(name, text, isSelf) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
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
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const msg = `<a href="${event.target.result}" download="${file.name}">${file.name}</a>`;
    addMessage(userName, msg, true);
    
    if (currentGroup) {
      socket.emit('group-message', { 
        groupId: currentGroup.id, 
        name: userName, 
        text: msg 
      });
    } else {
      socket.emit('chat-message', { 
        room: currentRoom, 
        name: userName, 
        text: msg 
      });
    }
  };
  reader.readAsDataURL(file);
}

// ==================== ГЛОБАЛЬНЫЕ ФУНКЦИИ ====================
function joinGroup(groupId) {
  currentGroup = groups.find(g => g.id === groupId);
  if (!currentGroup) return;
  
  socket.emit('join-group', { groupId, userId: myPeerId, name: userName });
  document.getElementById('chat-title').textContent = `Группа: ${currentGroup.name}`;
  document.getElementById('leave-group-btn').classList.remove('hidden');
  alert(`Вы в группе "${currentGroup.name}"`);
}

function deleteGroup(groupId) {
  if (confirm('Удалить группу?')) {
    socket.emit('delete-group', { groupId });
  }
}

function inviteFriendToCall(friendUsername) {
  alert(`Приглашение отправлено ${friendUsername}`);
}

function sendMessageToFriend(friendUsername) {
  const message = prompt(`Сообщение для ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', { to: friendUsername, from: userName, text: message });
    alert(`Сообщение отправлено ${friendUsername}`);
  }
}

function leaveGroup() {
  if (!currentGroup) return;
  
  if (confirm('Выйти из группы?')) {
    socket.emit('leave-group', { groupId: currentGroup.id, userId: myPeerId });
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    document.getElementById('leave-group-btn').classList.add('hidden');
  }
}
