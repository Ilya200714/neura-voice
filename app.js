const SOCKET_URL = 'https://neura-voice-production.up.railway.app';  // ← твоя ссылка

const socket = io(SOCKET_URL);
const peer = new Peer();

let myStream, myPeerId, currentRoom;
let peers = {};
let micOn = true, deafened = false;
let userName = 'Ты';
let userAvatar = '';

// DOM
const participantsDiv = document.getElementById('participants');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const headsetBtn = document.getElementById('headset-btn');
const copyLinkBtn = document.getElementById('copy-link');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const cancelSettings = document.getElementById('cancel-settings');
const saveSettings = document.getElementById('save-settings');
const profileNameInput = document.getElementById('profile-name');
const profileAvatarInput = document.getElementById('profile-avatar');
const avatarPreview = document.getElementById('avatar-preview');
const noiseChk = document.getElementById('noise');
const echoChk = document.getElementById('echo');

// Чат
sendBtn.onclick = sendMessage;
chatInput.onkeypress = e => { if (e.key === 'Enter') sendMessage(); };

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { room: currentRoom, name: userName, text });
  addMessage(userName, text, true);
  chatInput.value = '';
}

socket.on('chat-message', ({ name, text }) => addMessage(name, text, false));

function addMessage(name, text, isSelf) {
  const msg = document.createElement('div');
  msg.className = `msg p-3 rounded-xl ${isSelf ? 'msg-self' : 'msg-other'}`;
  msg.innerHTML = `<span class="font-medium">${name}:</span> ${text}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Кнопки
micBtn.onclick = () => {
  micOn = !micOn;
  if (myStream) myStream.getAudioTracks()[0].enabled = micOn;
  micBtn.innerHTML = `<i data-lucide="${micOn ? 'mic' : 'mic-off'}" class="w-7 h-7 ${micOn ? 'text-cyan-300' : 'text-red-400'}"></i>`;
  lucide.createIcons();
};

headsetBtn.onclick = () => {
  deafened = !deafened;
  document.querySelectorAll('audio').forEach(a => a.muted = deafened);
  headsetBtn.innerHTML = `<i data-lucide="${deafened ? 'headphones-off' : 'headphones'}" class="w-7 h-7 ${deafened ? 'text-red-400' : 'text-cyan-300'}"></i>`;
  lucide.createIcons();
};

copyLinkBtn.onclick = () => {
  navigator.clipboard.writeText(location.href);
  alert('Ссылка скопирована');
};

// Настройки
settingsBtn.onclick = () => {
  settingsModal.classList.remove('hidden');
  profileNameInput.value = userName;
  profileAvatarInput.value = userAvatar;
  if (userAvatar) {
    avatarPreview.src = userAvatar;
    avatarPreview.classList.remove('hidden');
  }
};

const closeModal = () => settingsModal.classList.add('hidden');
closeSettings.onclick = closeModal;
cancelSettings.onclick = closeModal;
settingsModal.onclick = e => { if (e.target === settingsModal) closeModal(); };

profileAvatarInput.oninput = () => {
  const v = profileAvatarInput.value.trim();
  if (v) {
    avatarPreview.src = v;
    avatarPreview.classList.remove('hidden');
  } else avatarPreview.classList.add('hidden');
};

saveSettings.onclick = () => {
  userName = profileNameInput.value.trim() || 'Ты';
  userAvatar = profileAvatarInput.value.trim();

  const selfAv = document.querySelector('#participants [data-self] .avatar');
  const selfName = document.querySelector('#participants [data-self] .name');
  if (selfName) selfName.textContent = userName + ' · ты';
  if (selfAv) {
    if (userAvatar) {
      selfAv.style.backgroundImage = `url(${userAvatar})`;
      selfAv.style.backgroundSize = 'cover';
      selfAv.textContent = '';
    } else {
      selfAv.style.backgroundImage = '';
      selfAv.textContent = userName.slice(0,2).toUpperCase();
    }
  }

  closeModal();
};

// Голосовой чат
async function init() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: noiseChk.checked,
        echoCancellation: echoChk.checked
      }
    });

    peer.on('open', id => {
      myPeerId = id;
      socket.emit('join-room', { room: currentRoom, peerId: id });
      addParticipant(id, userName, myStream, true);
    });

    peer.on('call', call => {
      call.answer(myStream);
      call.on('stream', s => addParticipant(call.peer, 'Участник', s));
    });

    socket.on('user-joined', ({ peerId }) => {
      if (peerId === myPeerId) return;
      peer.call(peerId, myStream);
    });

    socket.on('user-left', ({ peerId }) => {
      document.getElementById(`p-${peerId}`)?.remove();
    });

  } catch (e) {
    console.error(e);
    alert('Нет доступа к микрофону');
  }
}

function addParticipant(id, name, stream, isMe = false) {
  if (document.getElementById(`p-${id}`)) return;

  const card = document.createElement('div');
  card.id = `p-${id}`;
  card.dataset.self = isMe ? 'true' : '';
  card.className = `participant glass rounded-2xl p-5 flex flex-col items-center text-center neon-border`;

  const av = document.createElement('div');
  av.className = 'avatar w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-3 bg-gradient-to-br from-cyan-600 to-blue-700';
  if (isMe && userAvatar) {
    av.style.backgroundImage = `url(${userAvatar})`;
    av.style.backgroundSize = 'cover';
    av.textContent = '';
  } else {
    av.textContent = name.slice(0,2).toUpperCase();
  }

  const nm = document.createElement('div');
  nm.className = 'name text-lg font-semibold text-cyan-100';
  nm.textContent = name + (isMe ? ' · ты' : '');

  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.srcObject = stream;
  if (deafened) audio.muted = true;

  card.append(av, nm, audio);
  participantsDiv.appendChild(card);

  if (!isMe) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);

    function checkVol() {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const vol = data.reduce((a,b)=>a+b,0) / data.length;
      card.classList.toggle('speaking', vol > 25);
      requestAnimationFrame(checkVol);
    }
    checkVol();
  }
}

[noiseChk, echoChk].forEach(chk => chk.onchange = () => {
  if (myStream) myStream.getTracks().forEach(t => t.stop());
  init();
});

window.addEventListener('beforeunload', () => {
  if (myPeerId) socket.emit('leave-room', { room: currentRoom, peerId: myPeerId });
});

init();
lucide.createIcons();
