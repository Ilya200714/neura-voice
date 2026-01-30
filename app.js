const SOCKET_URL = 'https://neura-voice-production.up.railway.app'; // Замените на ваш Railway URL

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

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  console.log('🚀 Neura Voice загружен');
  
  // Экспортируем функции для глобального использования
  window.joinGroupHandler = joinGroup;
  window.deleteGroupHandler = deleteGroup;
  window.inviteFriendToCallHandler = inviteFriendToCall;
  window.sendMessageToFriendHandler = sendMessageToFriend;
});

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
});

socket.on('auth-success', async (userData) => {
  console.log('✅ Вход успешен:', userData);
  
  userName = userData.name;
  userAvatar = userData.avatar || '';
  
  // Переключаем экраны
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('register-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  updateUserProfile();
  
  // Инициализируем голосовой чат
  await initVoiceChat();
  
  // Загружаем данные
  loadGroups();
  loadFriends();
  loadFriendRequests();
  
  // Обновляем иконки
  lucide.createIcons();
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

// Функция инициализации обработчиков событий
function initEventListeners() {
  // Переключение экранов
  document.getElementById('to-register-btn')?.addEventListener('click', () => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
  });

  document.getElementById('back-to-login-btn')?.addEventListener('click', () => {
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  });

  // Регистрация
  document.getElementById('register-btn')?.addEventListener('click', () => {
    const name = document.getElementById('register-name')?.value.trim();
    const username = document.getElementById('register-username')?.value.trim();
    const password = document.getElementById('register-password')?.value.trim();
    
    if (!name || !username || !password) {
      document.getElementById('register-error').textContent = 'Заполните все поля';
      return;
    }
    
    socket.emit('register', { name, username, password });
  });

  // Вход
  document.getElementById('login-btn')?.addEventListener('click', () => {
    const username = document.getElementById('login-username')?.value.trim();
    const password = document.getElementById('login-password')?.value.trim();
    
    if (!username || !password) {
      document.getElementById('auth-error').textContent = 'Заполните поля';
      return;
    }
    
    socket.emit('login', { username, password });
  });

  // Выход
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите выйти?')) {
      location.reload();
    }
  });

  // Микрофон
  document.getElementById('mic-btn')?.addEventListener('click', toggleMicrophone);

  // Камера
  document.getElementById('camera-btn')?.addEventListener('click', toggleCamera);

  // Демонстрация экрана
  document.getElementById('screen-share-btn')?.addEventListener('click', shareScreen);

  // Копирование ссылки
  document.getElementById('copy-link-btn')?.addEventListener('click', copyRoomLink);

  // Настройки
  document.getElementById('settings-btn')?.addEventListener('click', openSettings);

  // Добавление друга
  document.getElementById('add-friend-btn')?.addEventListener('click', openAddFriendModal);

  // Создание группы
  document.getElementById('create-group-btn')?.addEventListener('click', createGroup);

  // Чат
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  // Эмодзи
  document.getElementById('emoji-btn')?.addEventListener('click', () => {
    const emojiPicker = document.getElementById('emoji-picker');
    if (emojiPicker) {
      emojiPicker.classList.toggle('hidden');
    }
  });

  // Загрузка медиа
  const mediaUpload = document.getElementById('media-upload');
  if (mediaUpload) {
    mediaUpload.addEventListener('change', handleMediaUpload);
  }

  // Выход из группы
  document.getElementById('leave-group-btn')?.addEventListener('click', leaveGroup);

  // Закрытие модалок
  document.getElementById('close-settings')?.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  
  document.getElementById('cancel-settings')?.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });
  
  document.getElementById('close-add-friend')?.addEventListener('click', () => {
    document.getElementById('add-friend-modal').classList.add('hidden');
  });
  
  document.getElementById('cancel-add-friend')?.addEventListener('click', () => {
    document.getElementById('add-friend-modal').classList.add('hidden');
  });

  // Сохранение настроек
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);

  // Отправка запроса дружбы
  document.getElementById('send-friend-request')?.addEventListener('click', sendFriendRequest);
  
  // Загрузка аватара
  const avatarUpload = document.getElementById('avatar-upload');
  if (avatarUpload) {
    avatarUpload.addEventListener('change', handleAvatarUpload);
  }
  
  document.getElementById('remove-avatar')?.addEventListener('click', removeAvatar);
  
  const profileAvatarInput = document.getElementById('profile-avatar');
  if (profileAvatarInput) {
    profileAvatarInput.addEventListener('input', updateAvatarPreviewFromUrl);
  }
  
  // Аудио фильтры
  document.getElementById('echo-cancellation')?.addEventListener('change', updateAudioFilters);
  document.getElementById('noise-suppression')?.addEventListener('change', updateAudioFilters);
  document.getElementById('auto-gain-control')?.addEventListener('change', updateAudioFilters);
}

// Основные функции WebRTC
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
  card.dataset.self = isMe ? 'true' : '';
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${isMe ? 'speaking' : ''}`;
  
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

// Функции управления
function updateUserProfile() {
  const userNameDisplay = document.getElementById('user-name');
  const userInitial = document.getElementById('user-initial');
  
  if (userNameDisplay) userNameDisplay.textContent = userName;
  if (userInitial) userInitial.textContent = userName.slice(0, 2).toUpperCase();
}

function toggleMicrophone() {
  if (!myStream) {
    alert('Микрофон не инициализирован');
    return;
  }
  
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

async function toggleCamera() {
  try {
    if (!cameraOn) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: true
      });
      cameraOn = true;
      alert('Камера включена');
    } else {
      cameraOn = false;
      alert('Камера выключена');
    }
  } catch (error) {
    console.error('Ошибка камеры:', error);
  }
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: true,
      audio: false 
    });
    alert('Демонстрация экрана начата!');
  } catch (error) {
    console.error('Ошибка демонстрации экрана:', error);
  }
}

function copyRoomLink() {
  const link = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  navigator.clipboard.writeText(link)
    .then(() => {
      alert('✅ Ссылка скопирована!');
    })
    .catch(err => {
      console.error('Ошибка копирования:', err);
    });
}

function openSettings() {
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal) {
    settingsModal.classList.remove('hidden');
    document.getElementById('profile-name').value = userName;
    document.getElementById('profile-avatar').value = userAvatar;
  }
}

function updateAudioFilters() {
  const echoCancellation = document.getElementById('echo-cancellation');
  const noiseSuppression = document.getElementById('noise-suppression');
  const autoGainControl = document.getElementById('auto-gain-control');
  
  if (echoCancellation && noiseSuppression && autoGainControl) {
    audioFilters = {
      echoCancellation: echoCancellation.checked,
      noiseSuppression: noiseSuppression.checked,
      autoGainControl: autoGainControl.checked
    };
    
    if (myStream) {
      initVoiceChat();
    }
  }
}

function saveSettings() {
  const newName = document.getElementById('profile-name')?.value.trim();
  const newAvatar = document.getElementById('profile-avatar')?.value.trim();
  
  if (!newName) {
    alert('Введите имя');
    return;
  }
  
  let hasChanges = false;
  
  if (newName !== userName) {
    userName = newName;
    hasChanges = true;
  }
  
  if (newAvatar !== userAvatar) {
    userAvatar = newAvatar;
    hasChanges = true;
  }
  
  if (hasChanges) {
    socket.emit('update-profile', { 
      name: userName, 
      avatar: userAvatar 
    });
    updateUserProfile();
  }
  
  document.getElementById('settings-modal').classList.add('hidden');
}

function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    alert('Выберите изображение');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const avatarPreview = document.getElementById('avatar-preview');
    if (avatarPreview) {
      avatarPreview.src = event.target.result;
      document.getElementById('profile-avatar').value = event.target.result;
    }
  };
  reader.readAsDataURL(file);
}

function updateAvatarPreviewFromUrl() {
  const url = document.getElementById('profile-avatar')?.value.trim();
  const avatarPreview = document.getElementById('avatar-preview');
  if (url && avatarPreview) {
    avatarPreview.src = url;
  }
}

function removeAvatar() {
  const avatarPreview = document.getElementById('avatar-preview');
  const avatarInput = document.getElementById('profile-avatar');
  if (avatarPreview) avatarPreview.src = '';
  if (avatarInput) avatarInput.value = '';
}

function openAddFriendModal() {
  document.getElementById('add-friend-modal').classList.remove('hidden');
}

function sendFriendRequest() {
  const friendUsername = document.getElementById('friend-username')?.value.trim();
  if (!friendUsername) {
    alert('Введите логин друга');
    return;
  }
  
  if (friendUsername === userName) {
    alert('Нельзя добавить себя в друзья');
    return;
  }
  
  socket.emit('friend-request', { 
    from: userName, 
    to: friendUsername 
  });
  
  document.getElementById('add-friend-modal').classList.add('hidden');
  document.getElementById('friend-username').value = '';
}

function createGroup() {
  const groupName = prompt('Введите название группы:');
  if (!groupName) return;

  socket.emit('create-group', { 
    name: groupName, 
    members: [], 
    creator: userName 
  });
  
  alert(`Группа "${groupName}" создана!`);
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
    container.innerHTML = '<div class="text-center text-gray-400 py-4">У вас пока нет групп</div>';
    return;
  }
  
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-4 bg-black/40 rounded-xl cursor-pointer hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex-1">
        <div class="font-medium text-cyan-100">${group.name}</div>
        <div class="text-sm text-cyan-400">${group.members ? group.members.length : 0} участников</div>
      </div>
      <button class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm join-group-btn" data-group-id="${group.id}">
        Войти
      </button>
    `;
    container.appendChild(div);
    
    div.querySelector('.join-group-btn').addEventListener('click', () => {
      joinGroup(group.id);
    });
  });
}

function updateFriendsList() {
  const container = document.getElementById('friends-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friends.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Добавьте друзей</div>';
    return;
  }
  
  friends.forEach(friend => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-3 bg-black/40 rounded-xl hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${friend.slice(0,2).toUpperCase()}
        </div>
        <div class="font-medium text-cyan-100">${friend}</div>
      </div>
      <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm invite-friend-btn" data-friend="${friend}">
        Позвать
      </button>
    `;
    
    container.appendChild(div);
    
    div.querySelector('.invite-friend-btn').addEventListener('click', () => {
      inviteFriendToCall(friend);
    });
  });
}

function showFriendRequestNotification(fromUser) {
  if (confirm(`${fromUser} хочет добавить вас в друзья. Принять?`)) {
    acceptFriendRequest(fromUser);
  }
}

function updateFriendRequestsList() {
  const container = document.getElementById('friend-requests-list');
  const countBadge = document.getElementById('friend-requests-count');
  
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Нет запросов</div>';
    if (countBadge) countBadge.classList.add('hidden');
    return;
  }
  
  if (countBadge) {
    countBadge.textContent = friendRequests.length;
    countBadge.classList.remove('hidden');
  }
  
  friendRequests.forEach(request => {
    const fromUser = request.from_user;
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-3 bg-black/40 rounded-xl hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
          ${fromUser.slice(0,2).toUpperCase()}
        </div>
        <div class="font-medium text-cyan-100">${fromUser}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm accept-friend-request-btn" data-from="${fromUser}">
          ✓
        </button>
        <button class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded-lg text-sm reject-friend-request-btn" data-from="${fromUser}">
          ✕
        </button>
      </div>
    `;
    
    container.appendChild(div);
    
    div.querySelector('.accept-friend-request-btn').addEventListener('click', () => {
      acceptFriendRequest(fromUser);
    });
    
    div.querySelector('.reject-friend-request-btn').addEventListener('click', () => {
      rejectFriendRequest(fromUser);
    });
  });
}

function acceptFriendRequest(fromUser) {
  socket.emit('accept-friend-request', { 
    from: fromUser, 
    to: userName 
  });
  alert(`✅ Вы приняли запрос от ${fromUser}`);
  loadFriends();
  loadFriendRequests();
}

function rejectFriendRequest(fromUser) {
  if (confirm(`Отклонить запрос от ${fromUser}?`)) {
    socket.emit('reject-friend-request', { 
      from: fromUser, 
      to: userName 
    });
    loadFriendRequests();
  }
}

function removeFriend(friendUsername) {
  if (confirm(`Удалить ${friendUsername} из друзей?`)) {
    socket.emit('remove-friend', { 
      user1: userName, 
      user2: friendUsername 
    });
    loadFriends();
  }
}

function sendMessage() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput?.value.trim();
  
  if (!text) {
    if (chatInput) chatInput.focus();
    return;
  }

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

  if (chatInput) {
    chatInput.value = '';
    chatInput.focus();
  }
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

function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const isImage = file.type.startsWith('image/');
    
    let msg = '';
    if (isImage) {
      msg = `<img src="${event.target.result}" class="media-preview" alt="Изображение">`;
    } else {
      msg = `<a href="${event.target.result}" download="${file.name}">${file.name}</a>`;
    }
    
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
  
  e.target.value = '';
}

// Глобальные функции
function joinGroup(groupId) {
  currentGroup = groups.find(g => g.id === groupId);
  if (!currentGroup) return;

  socket.emit('join-group', { 
    groupId, 
    userId: myPeerId, 
    name: userName 
  });
  
  document.getElementById('chat-title').textContent = `Группа: ${currentGroup.name}`;
  document.getElementById('leave-group-btn').classList.remove('hidden');
  
  alert(`Вы присоединились к группе "${currentGroup.name}"`);
}

function deleteGroup(groupId) {
  if (confirm('Удалить группу?')) {
    socket.emit('delete-group', { groupId });
  }
}

function inviteFriendToCall(friendUsername) {
  const roomLink = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  alert(`Приглашение отправлено ${friendUsername}\nСсылка: ${roomLink}`);
}

function sendMessageToFriend(friendUsername) {
  const message = prompt(`Отправить сообщение ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', {
      to: friendUsername,
      from: userName,
      text: message
    });
    alert(`Сообщение отправлено ${friendUsername}`);
  }
}

function leaveGroup() {
  if (!currentGroup) return;
  
  if (confirm(`Выйти из группы "${currentGroup.name}"?`)) {
    socket.emit('leave-group', { 
      groupId: currentGroup.id, 
      userId: myPeerId 
    });
    
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    document.getElementById('leave-group-btn').classList.add('hidden');
  }
}
