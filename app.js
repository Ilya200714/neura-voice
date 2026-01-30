const SOCKET_URL = window.location.origin;
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log('[DEBUG]', ...args);
}

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10
});

// WebRTC конфигурация с STUN серверами
const PC_CONFIG = {
  iceServers: [
    // Публичные STUN серверы
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.ekiga.net' },
    { urls: 'stun:stun.ideasip.com' },
    { urls: 'stun:stun.schlund.de' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    // Если нужны TURN серверы (для сложных сетей)
    /*
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'username',
      credential: 'password'
    }
    */
  ],
  iceCandidatePoolSize: 10
};

let myStream;
let myPeerId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
let currentRoom = 'default';
let userName = 'Ты';
let userAvatar = '';
let currentGroup = null;
let groups = [];
let friends = [];
let friendRequests = [];
let micOn = true;
let connections = {};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Neura Voice загружен');
  console.log('🌐 URL сервера:', SOCKET_URL);
  console.log('👤 Мой ID:', myPeerId);
  
  initEventListeners();
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  
  // Автоматически войти для тестирования (удалите в продакшене)
  // autoLoginForTesting();
});

function autoLoginForTesting() {
  // Для быстрого тестирования - автоматический вход
  setTimeout(() => {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      document.getElementById('login-username').value = 'test';
      document.getElementById('login-password').value = '123';
      loginBtn.click();
    }
  }, 500);
}

// Socket.io события
socket.on('connect', () => {
  console.log('✅ Подключен к серверу Socket.io');
});

socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения Socket.io:', error);
});

socket.on('auth-error', (error) => {
  const isRegisterScreen = !document.getElementById('register-screen').classList.contains('hidden');
  if (isRegisterScreen) {
    document.getElementById('register-error').textContent = error;
  } else {
    document.getElementById('auth-error').textContent = error;
  }
  console.error('❌ Ошибка аутентификации:', error);
});

socket.on('auth-success', async (userData) => {
  debugLog('✅ Вход успешен:', userData);
  
  if (!userData || !userData.name) {
    console.error('❌ Некорректные данные пользователя:', userData);
    return;
  }
  
  userName = userData.name;
  userAvatar = userData.avatar || '';
  
  // Проверяем элементы DOM
  const loginScreen = document.getElementById('login-screen');
  const mainScreen = document.getElementById('main-screen');
  
  if (!loginScreen || !mainScreen) {
    console.error('❌ Не найдены элементы DOM');
    return;
  }
  
  loginScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  
  updateUserProfile();
  
  try {
    await initVoiceChat();
  } catch (error) {
    console.error('❌ Ошибка инициализации голосового чата:', error);
  }
  
  loadGroups();
  loadFriends();
  loadFriendRequests();
  
  lucide.createIcons();
  debugLog('✅ Интерфейс инициализирован');
});

// WebRTC события
socket.on('user-joined', async ({ peerId, name }) => {
  console.log('👤 Пользователь присоединился:', peerId, name);
  
  if (peerId === myPeerId) {
    console.log('⚠️ Это я сам, игнорирую');
    return;
  }
  
  if (!myStream) {
    console.warn('⚠️ У меня нет аудио потока');
    return;
  }
  
  if (connections[peerId]) {
    console.log('⚠️ Соединение уже существует');
    return;
  }
  
  await createPeerConnection(peerId, name, true);
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  console.log('📥 Получен WebRTC offer от', from);
  
  if (!myStream) {
    console.warn('⚠️ Нет аудио потока для ответа');
    return;
  }
  
  if (connections[from]) {
    console.warn('⚠️ Соединение уже существует');
    return;
  }
  
  await handleOffer(from, offer);
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  console.log('📥 Получен WebRTC answer от', from);
  
  const pc = connections[from];
  if (!pc) {
    console.warn('⚠️ Нет соединения для ответа');
    return;
  }
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('✅ Установлено удаленное описание');
  } catch (error) {
    console.error('❌ Ошибка установки удаленного описания:', error);
  }
});

socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  console.log('❄️ Получен ICE кандидат от', from);
  
  const pc = connections[from];
  if (pc && candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate))
      .then(() => console.log('✅ ICE кандидат добавлен'))
      .catch(err => console.error('❌ Ошибка добавления ICE кандидата:', err));
  }
});

socket.on('user-left', ({ peerId }) => {
  console.log('👤 Пользователь вышел:', peerId);
  removeParticipant(peerId);
  
  if (connections[peerId]) {
    connections[peerId].close();
    delete connections[peerId];
  }
});

// Основные функции
async function initVoiceChat() {
  try {
    // Останавливаем старый поток
    if (myStream) {
      myStream.getTracks().forEach(track => track.stop());
    }
    
    // Запрашиваем доступ к микрофону
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
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
    
    console.log('📨 Отправлен join-room запрос');
    
    // Добавляем себя
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('❌ Ошибка инициализации голосового чата:', error);
    
    // Все равно присоединяемся к комнате
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    addParticipant(myPeerId, userName, null, true);
  }
}

async function createPeerConnection(peerId, name, isInitiator = false) {
  console.log(`🔗 Создаем PeerConnection для ${peerId}, инициатор: ${isInitiator}`);
  
  try {
    const pc = new RTCPeerConnection(PC_CONFIG);
    connections[peerId] = pc;
    
    // Добавляем наш аудио поток
    if (myStream) {
      myStream.getTracks().forEach(track => {
        pc.addTrack(track, myStream);
        console.log('🎤 Добавлен трек:', track.kind);
      });
    }
    
    // Обработка удаленного потока
    pc.ontrack = (event) => {
      console.log('🎵 Получен удаленный поток от', peerId);
      if (event.streams && event.streams[0]) {
        addParticipant(peerId, name, event.streams[0], false);
      }
    };
    
    // ICE кандидаты
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('❄️ Отправляю ICE кандидат');
        socket.emit('webrtc-ice-candidate', {
          to: peerId,
          from: myPeerId,
          candidate: event.candidate
        });
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`🔄 ICE состояние для ${peerId}:`, pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || 
          pc.iceConnectionState === 'completed') {
        console.log('✅ WebRTC соединение установлено!');
      } else if (pc.iceConnectionState === 'failed' ||
                 pc.iceConnectionState === 'disconnected' ||
                 pc.iceConnectionState === 'closed') {
        console.warn('⚠️ WebRTC соединение потеряно:', pc.iceConnectionState);
        removeParticipant(peerId);
      }
    };
    
    // Если мы инициатор, создаем offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        
        socket.emit('webrtc-offer', {
          to: peerId,
          from: myPeerId,
          offer: offer
        });
        
        console.log('📤 Отправлен WebRTC offer');
      } catch (error) {
        console.error('❌ Ошибка создания offer:', error);
      }
    }
    
    return pc;
    
  } catch (error) {
    console.error('❌ Ошибка создания PeerConnection:', error);
    throw error;
  }
}

async function handleOffer(from, offer) {
  console.log('🤝 Обрабатываю offer от', from);
  
  try {
    const pc = await createPeerConnection(from, 'Участник', false);
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
      to: from,
      from: myPeerId,
      answer: answer
    });
    
    console.log('📤 Отправлен WebRTC answer');
    
  } catch (error) {
    console.error('❌ Ошибка обработки offer:', error);
  }
}

function addParticipant(id, name, stream, isMe = false) {
  // Проверяем, не добавлен ли уже
  if (document.querySelector(`[data-peer-id="${id}"]`)) {
    console.log('⚠️ Участник уже добавлен:', id);
    return;
  }
  
  console.log('➕ Добавляем участника:', { id, name, isMe, hasStream: !!stream });
  
  const card = document.createElement('div');
  card.dataset.peerId = id;
  card.dataset.self = isMe ? 'true' : '';
  card.className = `glass rounded-3xl p-6 flex flex-col items-center text-center neon ${isMe ? 'speaking' : ''}`;
  
  card.innerHTML = `
    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-4xl font-bold text-white mb-4 overflow-hidden">
      <span class="text-white text-2xl font-bold">${name.slice(0,2).toUpperCase()}</span>
    </div>
    <div class="text-xl font-semibold text-cyan-100">${name}${isMe ? ' (ты)' : ''}</div>
    <div class="text-sm text-cyan-400 mt-1">${isMe ? (micOn ? '🎤 Говорит' : '🔇 Микрофон выкл.') : 'Участник'}</div>
  `;
  
  if (stream) {
    const audio = document.createElement('audio');
    audio.id = `audio-${id}`;
    audio.autoplay = true;
    audio.playsinline = true;
    audio.muted = isMe;
    audio.srcObject = stream;
    
    audio.onloadedmetadata = () => {
      console.log(`🎵 Аудио метаданные загружены для ${name}`);
      audio.play().catch(e => {
        console.log(`⚠️ Автовоспроизведение заблокировано для ${name}:`, e.message);
      });
    };
    
    audio.onplay = () => {
      console.log(`▶️ Аудио воспроизводится для ${name}`);
    };
    
    audio.onerror = (e) => {
      console.error(`🔇 Ошибка аудио для ${name}:`, e);
    };
    
    card.appendChild(audio);
    
    // Анализ аудио для индикации речи
    if (!isMe) {
      startAudioAnalysis(stream, card);
    }
  }
  
  const participantsDiv = document.getElementById('participants');
  if (participantsDiv) {
    participantsDiv.appendChild(card);
  }
}

function removeParticipant(peerId) {
  const card = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (card) {
    card.remove();
    console.log('➖ Удален участник:', peerId);
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
      
      const isSpeaking = average > 10;
      
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

// Остальные функции (initEventListeners, updateUserProfile, и т.д.)
// Оставьте их как в предыдущем коде, но убедитесь что они есть
