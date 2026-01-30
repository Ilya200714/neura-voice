const SOCKET_URL = window.location.origin;

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

let peer = null;
let myStream, myVideoStream;
let myPeerId, currentRoom = 'default';
let peers = {};
let webrtcConnections = {};
let micOn = true, cameraOn = false;
let userName = 'Ты';
let userAvatar = '';
let currentGroup = null;
let groups = [];
let friends = [];
let friendRequests = [];
let audioFilters = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  lucide.createIcons();
  
  // Экспортируем функции для глобального использования
  window.joinGroupHandler = joinGroup;
  window.deleteGroupHandler = deleteGroup;
  window.inviteFriendToCallHandler = inviteFriendToCall;
  window.sendMessageToFriendHandler = sendMessageToFriend;
  
  console.log('🚀 Neura Voice загружен');
  console.log('🌐 URL сервера:', SOCKET_URL);
});

// Отладка соединения
socket.on('connect', () => {
  console.log('✅ Успешно подключились к серверу Socket.io');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения Socket.io:', error);
});

socket.on('disconnect', (reason) => {
  console.warn('❌ Отключились от сервера:', reason);
});

// Инициализация всех обработчиков событий
function initEventListeners() {
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
      
      socket.emit('register', { name, username, password });
    };
  }

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
      
      socket.emit('login', { username, password });
    };
  }

  // Выход
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      if (confirm('Вы уверены, что хотите выйти?')) {
        location.reload();
      }
    };
  }

  // Микрофон
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) {
    micBtn.onclick = toggleMicrophone;
  }

  // Камера
  const cameraBtn = document.getElementById('camera-btn');
  if (cameraBtn) {
    cameraBtn.onclick = toggleCamera;
  }

  // Демонстрация экрана
  const screenShareBtn = document.getElementById('screen-share-btn');
  if (screenShareBtn) {
    screenShareBtn.onclick = shareScreen;
  }

  // Копирование ссылки
  const copyLinkBtn = document.getElementById('copy-link-btn');
  if (copyLinkBtn) {
    copyLinkBtn.onclick = copyRoomLink;
  }

  // Настройки
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.onclick = openSettings;
  }

  // Добавление друга
  const addFriendBtn = document.getElementById('add-friend-btn');
  if (addFriendBtn) {
    addFriendBtn.onclick = openAddFriendModal;
  }

  // Создание группы
  const createGroupBtn = document.getElementById('create-group-btn');
  if (createGroupBtn) {
    createGroupBtn.onclick = createGroup;
  }

  // Чат
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

  // Эмодзи
  const emojiBtn = document.getElementById('emoji-btn');
  if (emojiBtn) {
    emojiBtn.onclick = () => {
      const emojiPicker = document.getElementById('emoji-picker');
      if (emojiPicker) {
        emojiPicker.classList.toggle('hidden');
      }
    };
  }

  // Загрузка медиа
  const mediaUpload = document.getElementById('media-upload');
  if (mediaUpload) {
    mediaUpload.onchange = handleMediaUpload;
  }

  // Выход из группы
  const leaveGroupBtn = document.getElementById('leave-group-btn');
  if (leaveGroupBtn) {
    leaveGroupBtn.onclick = leaveGroup;
  }

  // Закрытие модалок
  const closeSettingsBtn = document.getElementById('close-settings');
  if (closeSettingsBtn) {
    closeSettingsBtn.onclick = () => {
      document.getElementById('settings-modal').classList.add('hidden');
    };
  }
  
  const cancelSettingsBtn = document.getElementById('cancel-settings');
  if (cancelSettingsBtn) {
    cancelSettingsBtn.onclick = () => {
      document.getElementById('settings-modal').classList.add('hidden');
    };
  }
  
  const closeAddFriendBtn = document.getElementById('close-add-friend');
  if (closeAddFriendBtn) {
    closeAddFriendBtn.onclick = () => {
      document.getElementById('add-friend-modal').classList.add('hidden');
    };
  }
  
  const cancelAddFriendBtn = document.getElementById('cancel-add-friend');
  if (cancelAddFriendBtn) {
    cancelAddFriendBtn.onclick = () => {
      document.getElementById('add-friend-modal').classList.add('hidden');
    };
  }

  // Сохранение настроек
  const saveSettingsBtn = document.getElementById('save-settings');
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = saveSettings;
  }

  // Отправка запроса дружбы
  const sendFriendRequestBtn = document.getElementById('send-friend-request');
  if (sendFriendRequestBtn) {
    sendFriendRequestBtn.onclick = sendFriendRequest;
  }
  
  // Загрузка аватара
  const avatarUpload = document.getElementById('avatar-upload');
  if (avatarUpload) {
    avatarUpload.onchange = handleAvatarUpload;
  }
  
  const removeAvatarBtn = document.getElementById('remove-avatar');
  if (removeAvatarBtn) {
    removeAvatarBtn.onclick = removeAvatar;
  }
  
  const profileAvatarInput = document.getElementById('profile-avatar');
  if (profileAvatarInput) {
    profileAvatarInput.addEventListener('input', updateAvatarPreviewFromUrl);
  }
  
  // Аудио фильтры
  const echoCancellation = document.getElementById('echo-cancellation');
  if (echoCancellation) {
    echoCancellation.addEventListener('change', updateAudioFilters);
  }
  
  const noiseSuppression = document.getElementById('noise-suppression');
  if (noiseSuppression) {
    noiseSuppression.addEventListener('change', updateAudioFilters);
  }
  
  const autoGainControl = document.getElementById('auto-gain-control');
  if (autoGainControl) {
    autoGainControl.addEventListener('change', updateAudioFilters);
  }
}

// Обработчики Socket.io
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
  
  // Показываем основной интерфейс
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('register-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  // Обновляем профиль
  updateUserProfile();
  
  // Инициализируем голосовой чат
  await initVoiceChat();
  
  // Загружаем группы
  loadGroups();
  
  // Загружаем друзей
  loadFriends();
  
  // Загружаем запросы дружбы
  loadFriendRequests();
  
  // Обновляем иконки
  lucide.createIcons();
});

socket.on('profile-updated', (data) => {
  userName = data.name;
  userAvatar = data.avatar;
  updateUserProfile();
  alert('✅ Настройки профиля сохранены!');
});

socket.on('chat-message', ({ name, text }) => {
  if (!currentGroup) {
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

socket.on('group-message', ({ groupId, name, text }) => {
  if (currentGroup && currentGroup.id === groupId) {
    const isMyMessage = (name === userName);
    if (!isMyMessage) {
      addMessage(name, text, false);
    }
  }
});

socket.on('group-history', (messages) => {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  chatMessages.innerHTML = '';
  messages.forEach(msg => {
    addMessage(msg.name, msg.message, msg.name === userName);
  });
});

socket.on('group-created', (group) => {
  groups.push(group);
  updateGroupsList();
});

socket.on('groups-list', (list) => {
  groups = list;
  updateGroupsList();
});

socket.on('group-deleted', (groupId) => {
  groups = groups.filter(g => g.id !== groupId);
  if (currentGroup && currentGroup.id === groupId) {
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    const leaveGroupBtn = document.getElementById('leave-group-btn');
    if (leaveGroupBtn) leaveGroupBtn.classList.add('hidden');
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) chatMessages.innerHTML = '';
  }
  updateGroupsList();
});

socket.on('user-joined-group', ({ userId, name, groupId }) => {
  if (currentGroup && currentGroup.id === groupId) {
    addSystemMessage(`${name} присоединился к группе`);
  }
});

// WebRTC через Socket.io
socket.on('user-joined', async ({ peerId, name }) => {
  console.log('👤 Пользователь присоединился к звонку:', peerId, name);
  
  if (peerId !== myPeerId && myStream) {
    try {
      await createWebRTCOffer(peerId, name);
    } catch (error) {
      console.error('❌ Ошибка при создании WebRTC предложения:', error);
    }
  }
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  console.log('📥 Получено предложение WebRTC от', from);
  
  if (!myStream) {
    console.warn('Нет потока для ответа');
    return;
  }
  
  try {
    await createWebRTCAnswer(from, offer);
  } catch (error) {
    console.error('❌ Ошибка при обработке предложения:', error);
  }
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  console.log('📥 Получен ответ WebRTC от', from);
  
  const pc = webrtcConnections[from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('❌ Ошибка при установке удаленного описания:', error);
    }
  }
});

socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  const pc = webrtcConnections[from];
  if (pc && candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(err => console.error('Ошибка добавления ICE кандидата:', err));
  }
});

// Запросы дружбы
socket.on('friend-request', ({ from, to }) => {
  console.log('🤝 Получен запрос дружбы от:', from);
  
  // Показываем уведомление
  showFriendRequestNotification(from);
  
  // Обновляем список запросов
  loadFriendRequests();
});

socket.on('friend-requests-list', (requests) => {
  friendRequests = requests;
  updateFriendRequestsList();
});

socket.on('friend-request-sent', ({ to }) => {
  alert(`✅ Запрос дружбы отправлен пользователю ${to}`);
});

socket.on('friend-request-rejected', ({ to }) => {
  alert(`❌ Пользователь ${to} отклонил ваш запрос дружбы`);
});

socket.on('friend-error', (error) => {
  alert(`Ошибка друзей: ${error}`);
});

socket.on('friends-list', (list) => {
  friends = list;
  updateFriendsList();
});

// Личные сообщения
socket.on('private-message', ({ from, text }) => {
  alert(`💬 Личное сообщение от ${from}: ${text}`);
});

socket.on('private-message-sent', ({ to, text }) => {
  console.log(`✅ Сообщение отправлено ${to}: ${text}`);
});

// Ошибки
socket.on('peer-error', (error) => {
  console.error('Ошибка PeerJS:', error);
});

socket.on('group-error', (error) => {
  alert(`Ошибка группы: ${error}`);
});

// Приглашение в группу
socket.on('group-invite', ({ groupId, groupName, inviter }) => {
  if (confirm(`${inviter} приглашает вас в группу "${groupName}"`)) {
    joinGroup(groupId);
  }
});

// Функции управления
function updateUserProfile() {
  const userNameDisplay = document.getElementById('user-name');
  const userInitial = document.getElementById('user-initial');
  
  if (userNameDisplay) userNameDisplay.textContent = userName;
  if (userInitial) userInitial.textContent = userName.slice(0, 2).toUpperCase();
  
  const avatarContainer = document.getElementById('user-avatar-container');
  if (avatarContainer) {
    const existingImg = avatarContainer.querySelector('img');
    const existingSpan = avatarContainer.querySelector('span');
    
    if (userAvatar) {
      if (existingImg) {
        existingImg.src = userAvatar;
        existingImg.classList.remove('hidden');
      } else {
        const img = document.createElement('img');
        img.id = 'user-avatar-img';
        img.src = userAvatar;
        img.alt = 'Аватар';
        img.className = 'w-full h-full object-cover';
        avatarContainer.appendChild(img);
      }
      
      if (existingSpan) {
        existingSpan.classList.add('hidden');
      }
    } else {
      if (existingImg) {
        existingImg.classList.add('hidden');
      }
      if (existingSpan) {
        existingSpan.textContent = userName.slice(0, 2).toUpperCase();
        existingSpan.classList.remove('hidden');
      }
    }
  }
}

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
    
    console.log('🎤 Получен аудио поток:', myStream.getTracks().length, 'треков');
    
    // Пробуем PeerJS
    try {
      peer = new Peer({
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true
      });
      
      peer.on('open', (id) => {
        myPeerId = id;
        console.log('✅ Peer ID:', id);
        
        socket.emit('join-room', { 
          room: currentRoom, 
          peerId: id,
          name: userName 
        });
        
        console.log('Отправлен join-room запрос');
        
        addParticipant(id, userName, myStream, true);
      });
      
      peer.on('call', (call) => {
        console.log('📞 Входящий вызов PeerJS от:', call.peer);
        
        if (!myStream) {
          console.warn('Нет потока для ответа');
          return;
        }
        
        call.answer(myStream);
        
        call.on('stream', (remoteStream) => {
          console.log('✅ Получен поток PeerJS от:', call.peer);
          addParticipant(call.peer, 'Участник', remoteStream, false);
        });
        
        call.on('error', (err) => {
          console.error('❌ Ошибка вызова PeerJS:', err);
        });
      });
      
      peer.on('error', (err) => {
        console.error('❌ PeerJS ошибка:', err);
      });
      
    } catch (peerError) {
      console.warn('⚠️ PeerJS не работает, используем WebRTC через Socket.io');
      myPeerId = 'webrtc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      socket.emit('join-room', { 
        room: currentRoom, 
        peerId: myPeerId,
        name: userName 
      });
      
      addParticipant(myPeerId, userName, myStream, true);
    }
    
  } catch (error) {
    console.error('❌ Ошибка инициализации голосового чата:', error);
    
    myPeerId = 'local_' + Date.now();
    addParticipant(myPeerId, userName, null, true);
  }
}

async function createWebRTCOffer(peerId, name) {
  console.log('Создаем WebRTC предложение для', peerId);
  
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  
  webrtcConnections[peerId] = pc;
  
  myStream.getTracks().forEach(track => {
    pc.addTrack(track, myStream);
  });
  
  pc.ontrack = (event) => {
    console.log('🎵 Получен удаленный поток от', peerId);
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
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  socket.emit('webrtc-offer', {
    to: peerId,
    from: myPeerId,
    offer: offer
  });
}

async function createWebRTCAnswer(from, offer) {
  console.log('Создаем WebRTC ответ для', from);
  
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  
  webrtcConnections[from] = pc;
  
  myStream.getTracks().forEach(track => {
    pc.addTrack(track, myStream);
  });
  
  pc.ontrack = (event) => {
    console.log('🎵 Получен удаленный поток от', from);
    addParticipant(from, 'Участник', event.streams[0], false);
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        to: from,
        from: myPeerId,
        candidate: event.candidate
      });
    }
  };
  
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('webrtc-answer', {
    to: from,
    from: myPeerId,
    answer: answer
  });
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
    
    const micBtn = document.getElementById('mic-btn');
    if (!micBtn) return;
    
    const icon = micBtn.querySelector('i');
    const textSpan = micBtn.querySelector('span');
    
    if (icon) {
      if (micOn) {
        icon.setAttribute('data-lucide', 'mic');
        micBtn.classList.remove('bg-red-600');
        micBtn.classList.add('bg-black/60');
      } else {
        icon.setAttribute('data-lucide', 'mic-off');
        micBtn.classList.remove('bg-black/60');
        micBtn.classList.add('bg-red-600');
      }
    }
    
    if (textSpan) {
      textSpan.textContent = micOn ? 'Микрофон' : 'Микрофон выкл.';
    }
    
    lucide.createIcons();
    updateMyStatus();
  }
}

function updateMyStatus() {
  const myCard = document.querySelector('[data-self="true"]');
  if (myCard) {
    const statusDiv = myCard.querySelector('.text-sm');
    if (statusDiv) {
      statusDiv.textContent = micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.';
    }
  }
}

async function toggleCamera() {
  try {
    const cameraBtn = document.getElementById('camera-btn');
    if (!cameraBtn) return;
    
    const icon = cameraBtn.querySelector('i');
    const textSpan = cameraBtn.querySelector('span');
    
    if (!cameraOn) {
      myVideoStream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });
      cameraOn = true;
      
      if (icon) {
        icon.setAttribute('data-lucide', 'video-off');
      }
      cameraBtn.classList.add('bg-red-600');
      
      if (textSpan) {
        textSpan.textContent = 'Камера вкл.';
      }
      
      addCameraCard();
      
    } else {
      if (myVideoStream) {
        myVideoStream.getTracks().forEach(track => track.stop());
        myVideoStream = null;
      }
      cameraOn = false;
      
      if (icon) {
        icon.setAttribute('data-lucide', 'video');
      }
      cameraBtn.classList.remove('bg-red-600');
      
      if (textSpan) {
        textSpan.textContent = 'Камера';
      }
      
      removeCameraCard();
    }
    
    lucide.createIcons();
  } catch (error) {
    console.error('Ошибка камеры:', error);
    alert('Не удалось получить доступ к камере');
  }
}

function addCameraCard() {
  if (document.getElementById('camera-card')) return;
  
  const card = document.createElement('div');
  card.id = 'camera-card';
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon col-span-2';
  card.innerHTML = `
    <div class="text-xl font-semibold text-cyan-100 mb-4">📹 Ваша камера</div>
    <video autoplay playsinline muted class="w-full h-auto rounded-xl max-h-96 bg-black"></video>
    <div class="text-sm text-cyan-400 mt-2">${userName} (вы)</div>
  `;
  
  const video = card.querySelector('video');
  video.srcObject = myVideoStream;
  
  document.getElementById('participants').appendChild(card);
}

function removeCameraCard() {
  const card = document.getElementById('camera-card');
  if (card) {
    card.remove();
  }
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: {
        displaySurface: 'monitor',
        cursor: 'always'
      },
      audio: false 
    });
    
    alert('Демонстрация экрана начата!');
    
    addScreenShareCard(screenStream);
    
    screenStream.getVideoTracks()[0].onended = () => {
      alert('Демонстрация экрана завершена');
      removeScreenShareCard();
    };
  } catch (error) {
    console.error('Ошибка демонстрации экрана:', error);
  }
}

function addScreenShareCard(stream) {
  const card = document.createElement('div');
  card.id = 'screen-share-card';
  card.className = 'glass rounded-3xl p-6 flex flex-col items-center text-center neon col-span-2';
  card.innerHTML = `
    <div class="text-xl font-semibold text-cyan-100 mb-4">📺 Демонстрация экрана</div>
    <video autoplay playsinline class="w-full h-auto rounded-xl max-h-96"></video>
    <div class="text-sm text-cyan-400 mt-2">${userName} показывает экран</div>
  `;
  
  const video = card.querySelector('video');
  video.srcObject = stream;
  
  document.getElementById('participants').appendChild(card);
}

function removeScreenShareCard() {
  const card = document.getElementById('screen-share-card');
  if (card) {
    card.remove();
  }
}

function copyRoomLink() {
  const link = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  navigator.clipboard.writeText(link)
    .then(() => {
      alert('✅ Приватная ссылка скопирована в буфер обмена!\n\nОтправьте ее друзьям, чтобы они могли присоединиться.');
    })
    .catch(err => {
      console.error('Ошибка копирования:', err);
      alert('Не удалось скопировать ссылку');
    });
}

function openSettings() {
  const settingsModal = document.getElementById('settings-modal');
  if (!settingsModal) return;
  
  settingsModal.classList.remove('hidden');
  document.getElementById('profile-name').value = userName;
  document.getElementById('profile-avatar').value = userAvatar;
  
  const echoCancellation = document.getElementById('echo-cancellation');
  const noiseSuppression = document.getElementById('noise-suppression');
  const autoGainControl = document.getElementById('auto-gain-control');
  
  if (echoCancellation) echoCancellation.checked = audioFilters.echoCancellation;
  if (noiseSuppression) noiseSuppression.checked = audioFilters.noiseSuppression;
  if (autoGainControl) autoGainControl.checked = audioFilters.autoGainControl;
  
  const avatarPreview = document.getElementById('avatar-preview');
  if (userAvatar && avatarPreview) {
    avatarPreview.src = userAvatar;
    avatarPreview.classList.remove('hidden');
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
    
    console.log('Аудио фильтры обновлены:', audioFilters);
    
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
    alert('Пожалуйста, выберите изображение (JPG, PNG, GIF)');
    e.target.value = '';
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    alert('Файл слишком большой. Максимальный размер: 5MB');
    e.target.value = '';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const avatarPreview = document.getElementById('avatar-preview');
    const defaultAvatar = document.getElementById('default-avatar');
    const removeBtn = document.getElementById('remove-avatar');
    
    if (avatarPreview && defaultAvatar && removeBtn) {
      avatarPreview.src = event.target.result;
      avatarPreview.classList.remove('hidden');
      defaultAvatar.classList.add('hidden');
      removeBtn.classList.remove('hidden');
      
      document.getElementById('profile-avatar').value = event.target.result;
    }
  };
  
  reader.readAsDataURL(file);
}

function updateAvatarPreviewFromUrl() {
  const url = document.getElementById('profile-avatar')?.value.trim();
  const avatarPreview = document.getElementById('avatar-preview');
  const defaultAvatar = document.getElementById('default-avatar');
  const removeBtn = document.getElementById('remove-avatar');
  
  if (!url || !avatarPreview || !defaultAvatar || !removeBtn) return;
  
  if (url) {
    if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i) || url.startsWith('data:image')) {
      avatarPreview.src = url;
      avatarPreview.classList.remove('hidden');
      defaultAvatar.classList.add('hidden');
      removeBtn.classList.remove('hidden');
    } else {
      alert('Пожалуйста, введите ссылку на изображение (JPG, PNG, GIF)');
      document.getElementById('profile-avatar').value = '';
    }
  } else {
    avatarPreview.classList.add('hidden');
    defaultAvatar.classList.remove('hidden');
    removeBtn.classList.add('hidden');
  }
}

function removeAvatar() {
  const avatarPreview = document.getElementById('avatar-preview');
  const defaultAvatar = document.getElementById('default-avatar');
  const removeBtn = document.getElementById('remove-avatar');
  const avatarInput = document.getElementById('profile-avatar');
  
  if (!avatarPreview || !defaultAvatar || !removeBtn || !avatarInput) return;
  
  avatarPreview.src = '';
  avatarPreview.classList.add('hidden');
  defaultAvatar.classList.remove('hidden');
  removeBtn.classList.add('hidden');
  avatarInput.value = '';
  
  const avatarUpload = document.getElementById('avatar-upload');
  if (avatarUpload) avatarUpload.value = '';
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

  const selectedFriends = prompt('Введите логины друзей через запятую (например: user1, user2, user3):');
  if (!selectedFriends) return;

  const members = selectedFriends.split(',').map(m => m.trim()).filter(m => m);

  socket.emit('create-group', { 
    name: groupName, 
    members, 
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
    container.innerHTML = '<div class="text-center text-gray-400 py-4">У вас пока нет групп. Создайте первую!</div>';
    return;
  }
  
  groups.forEach(group => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between p-4 bg-black/40 rounded-xl cursor-pointer hover:bg-black/60 mb-2';
    div.innerHTML = `
      <div class="flex-1">
        <div class="font-medium text-cyan-100">${group.name}</div>
        <div class="text-sm text-cyan-400">${group.members ? group.members.length : 0} участников</div>
        <div class="text-xs text-gray-400">Создатель: ${group.creator}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm join-group-btn" data-group-id="${group.id}">
          Войти
        </button>
        ${group.creator === userName ? 
          `<button class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm delete-group-btn" data-group-id="${group.id}">
            Удалить
          </button>` : ''
        }
      </div>
    `;
    container.appendChild(div);
    
    div.querySelector('.join-group-btn').onclick = () => {
      joinGroup(group.id);
    };
    
    const deleteBtn = div.querySelector('.delete-group-btn');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        deleteGroup(group.id);
      };
    }
  });
}

function updateFriendsList() {
  const container = document.getElementById('friends-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friends.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Добавьте друзей, чтобы общаться вместе!</div>';
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
        <div>
          <div class="font-medium text-cyan-100">${friend}</div>
          <div class="text-xs text-cyan-400">Друг</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm invite-friend-btn" data-friend="${friend}">
          Позвать
        </button>
        <button class="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm message-friend-btn" data-friend="${friend}">
          Чат
        </button>
        <button class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded-lg text-sm remove-friend-btn" data-friend="${friend}">
          ✕
        </button>
      </div>
    `;
    
    container.appendChild(div);
    
    div.querySelector('.invite-friend-btn').onclick = () => {
      inviteFriendToCall(friend);
    };
    
    div.querySelector('.message-friend-btn').onclick = () => {
      sendMessageToFriend(friend);
    };
    
    div.querySelector('.remove-friend-btn').onclick = () => {
      removeFriend(friend);
    };
  });
}

function showFriendRequestNotification(fromUser) {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 glass rounded-2xl p-4 neon z-50 animate-slideInRight';
  notification.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold">
        ${fromUser.slice(0,2).toUpperCase()}
      </div>
      <div class="flex-1">
        <div class="font-semibold text-cyan-100">Новый запрос дружбы!</div>
        <div class="text-sm text-cyan-300">${fromUser} хочет добавить вас в друзья</div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-sm accept-friend-notification-btn" data-from="${fromUser}">
          Принять
        </button>
        <button class="px-3 py-1 bg-red-600 hover:bg-red-500 rounded-lg text-sm reject-friend-notification-btn" data-from="${fromUser}">
          Отклонить
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  notification.querySelector('.accept-friend-notification-btn').onclick = () => {
    acceptFriendRequest(fromUser);
    notification.remove();
  };
  
  notification.querySelector('.reject-friend-notification-btn').onclick = () => {
    rejectFriendRequest(fromUser);
    notification.remove();
  };
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 10000);
}

function updateFriendRequestsList() {
  const container = document.getElementById('friend-requests-list');
  const countBadge = document.getElementById('friend-requests-count');
  
  if (!container) return;
  
  container.innerHTML = '';
  
  if (friendRequests.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">Нет новых запросов</div>';
    if (countBadge) {
      countBadge.classList.add('hidden');
    }
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
        <div>
          <div class="font-medium text-cyan-100">${fromUser}</div>
          <div class="text-xs text-cyan-400">Хочет добавить вас в друзья</div>
        </div>
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
    
    div.querySelector('.accept-friend-request-btn').onclick = () => {
      acceptFriendRequest(fromUser);
    };
    
    div.querySelector('.reject-friend-request-btn').onclick = () => {
      rejectFriendRequest(fromUser);
    };
  });
}

function acceptFriendRequest(fromUser) {
  socket.emit('accept-friend-request', { 
    from: fromUser, 
    to: userName 
  });
  
  alert(`✅ Вы приняли запрос дружбы от ${fromUser}`);
  
  loadFriends();
  loadFriendRequests();
}

function rejectFriendRequest(fromUser) {
  if (confirm(`Отклонить запрос дружбы от ${fromUser}?`)) {
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
    
    alert(`❌ ${friendUsername} удален из друзей`);
    
    loadFriends();
  }
}

function addParticipant(id, name, stream, isMe = false) {
  if (document.querySelector(`[data-peer-id="${id}"]`)) {
    console.log('Участник уже добавлен:', id);
    return;
  }
  
  console.log('Добавляем участника:', { id, name, isMe, hasStream: !!stream });
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.dataset.self = isMe ? 'true' : '';
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${isMe ? 'speaking' : ''}`;
  
  let avatarHTML = `<span class="text-white text-2xl font-bold">${name.slice(0,2).toUpperCase()}</span>`;
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4 overflow-hidden">
      ${avatarHTML}
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1">${isMe ? (micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.') : 'Участник'}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = isMe;
    audio.srcObject = stream;
    
    audio.onloadedmetadata = () => {
      console.log('🎵 Аудио готово для', name);
      audio.play().catch(e => console.log('Автовоспроизведение заблокировано:', e));
    };
    
    audio.onerror = (e) => {
      console.error('🔇 Ошибка аудио для', name, e);
    };
    
    card.appendChild(audio);
  }
  
  const participantsDiv = document.getElementById('participants');
  if (participantsDiv) {
    participantsDiv.appendChild(card);
    console.log('Карточка участника добавлена в DOM');
  }
  
  if (isMe && stream) {
    startAudioAnalysis(stream, card);
  }
}

function startAudioAnalysis(stream, card) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    
    microphone.connect(analyser);
    analyser.fftSize = 256;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function detectSpeaking() {
      analyser.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      const isSpeaking = average > 20 && micOn;
      
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
      
      requestAnimationFrame(detectSpeaking);
    }
    
    detectSpeaking();
  } catch (e) {
    console.error('Ошибка анализа аудио:', e);
  }
}

function removeParticipant(peerId) {
  const participantCard = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (participantCard) {
    participantCard.remove();
  }
  
  // Закрываем WebRTC соединения
  if (webrtcConnections[peerId]) {
    webrtcConnections[peerId].close();
    delete webrtcConnections[peerId];
  }
  
  // Закрываем PeerJS соединения
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
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
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        ${name.slice(0,2).toUpperCase()}
      </div>
      <div>
        <div class="font-semibold text-sm ${isSelf ? 'text-cyan-300' : 'text-cyan-200'}">${name}</div>
        <div class="mt-1">${text}</div>
        <div class="text-xs ${isSelf ? 'text-cyan-400' : 'text-gray-400'} mt-1">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
      </div>
    </div>
  `;
  
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  const msg = document.createElement('div');
  msg.className = 'message text-center text-gray-400 italic bg-black/20 py-2';
  msg.textContent = `⚡ ${text}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleMediaUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 10 * 1024 * 1024) {
    alert('Файл слишком большой. Максимальный размер: 10MB');
    e.target.value = '';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    let type = 'Файл';
    if (isImage) type = 'Изображение';
    if (isVideo) type = 'Видео';
    
    const msg = `<div class="media-message">
      <strong>${userName}:</strong> ${type}<br>
      ${isImage ? `<img src="${event.target.result}" class="media-preview" alt="${type}">` : ''}
      ${isVideo ? `<video src="${event.target.result}" class="media-preview" controls></video>` : ''}
      ${!isImage && !isVideo ? `<a href="${event.target.result}" download="${file.name}">${file.name}</a>` : ''}
    </div>`;
    
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
  const leaveGroupBtn = document.getElementById('leave-group-btn');
  if (leaveGroupBtn) leaveGroupBtn.classList.remove('hidden');
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) chatMessages.innerHTML = '';
  
  addSystemMessage(`Вы присоединились к группе "${currentGroup.name}"`);
}

function deleteGroup(groupId) {
  if (confirm('Вы уверены, что хотите удалить группу? Все сообщения будут потеряны.')) {
    socket.emit('delete-group', { groupId });
  }
}

function inviteFriendToCall(friendUsername) {
  const roomLink = `${window.location.origin}?room=${currentRoom}&user=${encodeURIComponent(userName)}`;
  
  if (confirm(`Отправить приглашение ${friendUsername} в голосовой чат?\n\nСсылка: ${roomLink}`)) {
    alert(`✅ Приглашение отправлено ${friendUsername}`);
  }
}

function sendMessageToFriend(friendUsername) {
  const message = prompt(`Отправить личное сообщение ${friendUsername}:`);
  if (message) {
    socket.emit('private-message', {
      to: friendUsername,
      from: userName,
      text: message
    });
    alert(`✅ Сообщение отправлено ${friendUsername}`);
  }
}

function leaveGroup() {
  if (!currentGroup) return;
  
  if (confirm(`Вы уверены, что хотите выйти из группы "${currentGroup.name}"?`)) {
    socket.emit('leave-group', { 
      groupId: currentGroup.id, 
      userId: myPeerId 
    });
    
    currentGroup = null;
    document.getElementById('chat-title').textContent = 'Чат';
    const leaveGroupBtn = document.getElementById('leave-group-btn');
    if (leaveGroupBtn) leaveGroupBtn.classList.add('hidden');
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) chatMessages.innerHTML = '';
    
    addSystemMessage('Вы вышли из группы');
  }
}
