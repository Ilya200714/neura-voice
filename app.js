const SOCKET_URL = window.location.origin;
const socket = io(SOCKET_URL);

let myStream;
let myPeerId = 'user_' + Date.now();
let currentRoom = 'default';
let userName = 'Ты';
let micOn = true;
let connections = {};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  lucide.createIcons();
});

// Socket обработчики
socket.on('auth-success', async (userData) => {
  userName = userData.name;
  
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  await initVoiceChat();
});

socket.on('user-joined', ({ peerId, name }) => {
  console.log('👤 Присоединился:', name);
  if (peerId !== myPeerId && myStream) {
    createWebRTCConnection(peerId, name);
  }
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  await handleWebRTCOffer(from, offer);
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

// Основные функции
async function initVoiceChat() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false 
    });
    
    socket.emit('join-room', { 
      room: currentRoom, 
      peerId: myPeerId,
      name: userName 
    });
    
    addParticipant(myPeerId, userName, myStream, true);
    
  } catch (error) {
    console.error('Ошибка микрофона:', error);
    addParticipant(myPeerId, userName, null, true);
  }
}

async function createWebRTCConnection(peerId, name) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  
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
  
  // Создаем предложение
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  socket.emit('webrtc-offer', {
    to: peerId,
    from: myPeerId,
    offer: offer
  });
}

async function handleWebRTCOffer(from, offer) {
  if (!myStream) return;
  
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  
  connections[from] = pc;
  
  // Добавляем наш поток
  myStream.getTracks().forEach(track => {
    pc.addTrack(track, myStream);
  });
  
  // Получаем удаленный поток
  pc.ontrack = (event) => {
    console.log('🎵 Получен поток от участника');
    addParticipant(from, 'Участник', event.streams[0], false);
  };
  
  // ICE кандидаты
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        to: from,
        from: myPeerId,
        candidate: event.candidate
      });
    }
  };
  
  // Устанавливаем удаленное описание
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  
  // Создаем ответ
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

function removeParticipant(peerId) {
  const card = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (card) card.remove();
  
  if (connections[peerId]) {
    connections[peerId].close();
    delete connections[peerId];
  }
}

// Остальные функции (toggleMicrophone, sendMessage и т.д.) можно оставить как есть
