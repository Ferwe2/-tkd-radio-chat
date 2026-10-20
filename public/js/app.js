// TKD Radio Online - Realtime Chat Application Client Logic
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Application State
  let currentUser = null;
  let currentSettings = { chatActive: true, slowMode: 0 };
  let selectedAvatar = '/avatars/gallo_claudio.png';
  let soundEnabled = true;
  let audioCtx = null;
  let selectedStaffAvatarFile = null;

  // DOM Elements - General & Header
  const onlineCountEl = document.getElementById('onlineCount');
  const soundBtn = document.getElementById('soundBtn');
  const soundIconOn = document.getElementById('soundIconOn');
  const soundIconOff = document.getElementById('soundIconOff');
  const loginTriggerBtn = document.getElementById('loginTriggerBtn');
  const cabinControlBtn = document.getElementById('cabinControlBtn');
  const masterTeamBtn = document.getElementById('masterTeamBtn');
  const userStatusPill = document.getElementById('userStatusPill');
  const myAvatarImg = document.getElementById('myAvatarImg');
  const myUsernameText = document.getElementById('myUsernameText');
  const myRoleBadge = document.getElementById('myRoleBadge');
  const logoutBtn = document.getElementById('logoutBtn');
  const chatPausedBanner = document.getElementById('chatPausedBanner');

  // DOM Elements - Chat & Input
  const chatMessages = document.getElementById('chatMessages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const charCount = document.getElementById('charCount');
  const slowModeIndicator = document.getElementById('slowModeIndicator');
  const emojiToggleBtn = document.getElementById('emojiToggleBtn');
  const emojiPickerPopup = document.getElementById('emojiPickerPopup');

  // DOM Elements - Join Modal
  const joinModalOverlay = document.getElementById('joinModalOverlay');
  const tabListenerBtn = document.getElementById('tabListenerBtn');
  const tabStaffBtn = document.getElementById('tabStaffBtn');
  const tabListenerContent = document.getElementById('tabListenerContent');
  const tabStaffContent = document.getElementById('tabStaffContent');
  const nicknameInput = document.getElementById('nicknameInput');
  const avatarOptions = document.querySelectorAll('.avatar-option');
  const joinAsListenerBtn = document.getElementById('joinAsListenerBtn');
  const staffUserInput = document.getElementById('staffUserInput');
  const staffPassInput = document.getElementById('staffPassInput');
  const staffLoginBtn = document.getElementById('staffLoginBtn');
  const staffLoginError = document.getElementById('staffLoginError');

  // DOM Elements - Cabin Control Modal
  const cabinModalOverlay = document.getElementById('cabinModalOverlay');
  const closeCabinModalBtn = document.getElementById('closeCabinModalBtn');
  const chatActiveToggle = document.getElementById('chatActiveToggle');
  const slowModeSelect = document.getElementById('slowModeSelect');
  const triggerUploadBtn = document.getElementById('triggerUploadBtn');
  const staffAvatarFileInput = document.getElementById('staffAvatarFileInput');
  const staffCurrentAvatarPreview = document.getElementById('staffCurrentAvatarPreview');
  const uploadFileName = document.getElementById('uploadFileName');
  const saveAvatarUploadBtn = document.getElementById('saveAvatarUploadBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');

  // DOM Elements - Team Management Modal
  const teamModalOverlay = document.getElementById('teamModalOverlay');
  const closeTeamModalBtn = document.getElementById('closeTeamModalBtn');
  const newStaffUser = document.getElementById('newStaffUser');
  const newStaffPass = document.getElementById('newStaffPass');
  const newStaffRole = document.getElementById('newStaffRole');
  const saveNewStaffBtn = document.getElementById('saveNewStaffBtn');
  const createStaffSuccess = document.getElementById('createStaffSuccess');
  const createStaffError = document.getElementById('createStaffError');
  const staffListContainer = document.getElementById('staffListContainer');
  const toastContainer = document.getElementById('toastContainer');

  // Initialize Web Audio API for subtle message chime
  function playMessageChime() {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
      // Audio not permitted yet
    }
  }

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  // Sound Toggle Handler
  soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundIconOn.classList.toggle('hidden', !soundEnabled);
    soundIconOff.classList.toggle('hidden', soundEnabled);
    showToast(soundEnabled ? '🔔 Sonido activado' : '🔕 Sonido silenciado');
  });

  // Modal Tab Switching
  tabListenerBtn.addEventListener('click', () => {
    tabListenerBtn.classList.add('active');
    tabStaffBtn.classList.remove('active');
    tabListenerContent.classList.remove('hidden');
    tabStaffContent.classList.add('hidden');
  });

  tabStaffBtn.addEventListener('click', () => {
    tabStaffBtn.classList.add('active');
    tabListenerBtn.classList.remove('active');
    tabStaffContent.classList.remove('hidden');
    tabListenerContent.classList.add('hidden');
  });

  loginTriggerBtn.addEventListener('click', () => {
    joinModalOverlay.classList.remove('hidden');
    tabStaffBtn.click();
    staffUserInput.focus();
  });

  // Logout / Salir de la sala
  logoutBtn.addEventListener('click', () => {
    if (!currentUser) return;
    if (confirm(`¿Querés salir del chat, ${currentUser.username}?`)) {
      socket.emit('user:leave');
      currentUser = null;
      userStatusPill.classList.add('hidden');
      cabinControlBtn.classList.add('hidden');
      masterTeamBtn.classList.add('hidden');
      loginTriggerBtn.classList.remove('hidden');
      nicknameInput.value = '';
      staffUserInput.value = '';
      staffPassInput.value = '';
      joinModalOverlay.classList.remove('hidden');
      tabListenerBtn.click();
      showToast('Has salido de la sala.');
    }
  });

  // Listener Avatar Selection
  avatarOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      avatarOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedAvatar = opt.getAttribute('data-avatar');
    });
  });

  // Join as Listener
  joinAsListenerBtn.addEventListener('click', () => {
    const nick = (nicknameInput.value || '').trim();
    if (!nick || nick.length < 2) {
      showToast('Por favor escribí un apodo de al menos 2 letras.', 'error');
      nicknameInput.focus();
      return;
    }
    socket.emit('user:join', { nickname: nick, avatar: selectedAvatar });
  });

  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinAsListenerBtn.click();
  });

  // Staff Login
  staffLoginBtn.addEventListener('click', () => {
    const username = (staffUserInput.value || '').trim();
    const password = staffPassInput.value || '';
    if (!username || !password) {
      staffLoginError.textContent = 'Completá usuario y contraseña.';
      staffLoginError.classList.remove('hidden');
      return;
    }
    staffLoginError.classList.add('hidden');
    socket.emit('auth:login', { username, password });
  });

  staffPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') staffLoginBtn.click();
  });

  // Socket: Join Success
  socket.on('join:success', ({ user, settings, history, onlineCount }) => {
    currentUser = user;
    currentSettings = settings;
    joinModalOverlay.classList.add('hidden');

    updateUserPill();
    updateCabinSettingsUI(settings);
    if (onlineCount !== undefined) onlineCountEl.textContent = onlineCount;

    // Load message history
    history.forEach(msg => appendMessage(msg));
    scrollToBottom();
    messageInput.focus();
    showToast(`¡Bienvenido al chat, ${user.username}!`, 'success');
  });

  // Socket: Join Error
  socket.on('join:error', ({ message }) => {
    showToast(message, 'error');
  });

  // Socket: Auth Success
  socket.on('auth:success', ({ user, settings }) => {
    currentUser = user;
    currentSettings = settings;
    joinModalOverlay.classList.add('hidden');
    loginTriggerBtn.classList.add('hidden');

    // Show Cabin / Master Admin action pills
    cabinControlBtn.classList.remove('hidden');
    if (user.isMaster) {
      masterTeamBtn.classList.remove('hidden');
    }

    staffCurrentAvatarPreview.src = user.avatar;
    updateUserPill();
    updateCabinSettingsUI(settings);
    showToast(`🎙️ Conectado a la cabina como ${user.username}`, 'success');
  });

  // Socket: Auth Error
  socket.on('auth:error', ({ message }) => {
    staffLoginError.textContent = message;
    staffLoginError.classList.remove('hidden');
  });

  // Update User Status Pill in Top Header
  function updateUserPill() {
    if (!currentUser) return;
    userStatusPill.classList.remove('hidden');
    myAvatarImg.src = currentUser.avatar;
    myUsernameText.textContent = currentUser.username;

    myRoleBadge.className = 'badge-tag';
    if (currentUser.role === 'admin') {
      myRoleBadge.classList.add('admin');
      myRoleBadge.textContent = currentUser.isMaster ? 'Master Admin' : 'Locutor / Admin';
    } else if (currentUser.role === 'moderator') {
      myRoleBadge.classList.add('moderator');
      myRoleBadge.textContent = 'Moderador';
    } else {
      myRoleBadge.classList.add('listener');
      myRoleBadge.textContent = 'Oyente';
    }
  }

  // Socket: Online Count Update
  socket.on('online:update', ({ count }) => {
    onlineCountEl.textContent = count;
  });

  // Socket: Settings Updated
  socket.on('settings:updated', (settings) => {
    currentSettings = settings;
    updateCabinSettingsUI(settings);
  });

  function updateCabinSettingsUI(settings) {
    chatActiveToggle.checked = !!settings.chatActive;
    slowModeSelect.value = settings.slowMode || 0;

    if (!settings.chatActive) {
      chatPausedBanner.classList.remove('hidden');
    } else {
      chatPausedBanner.classList.add('hidden');
    }

    if (settings.slowMode > 0) {
      slowModeIndicator.textContent = `⏱️ Modo lento: ${settings.slowMode}s`;
      slowModeIndicator.classList.remove('hidden');
    } else {
      slowModeIndicator.classList.add('hidden');
    }
  }

  // Socket: New Message Received
  socket.on('chat:new_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();
    if (!currentUser || msg.username !== currentUser.username) {
      playMessageChime();
    }
  });

  // Socket: System Message
  socket.on('chat:system_message', ({ text }) => {
    const sysEl = document.createElement('div');
    sysEl.className = 'system-msg-item';
    sysEl.textContent = text;
    chatMessages.appendChild(sysEl);
    scrollToBottom();
  });

  // Socket: Message Deleted
  socket.on('chat:message_deleted', ({ messageId }) => {
    const el = document.getElementById(messageId);
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.95)';
      el.style.transition = 'all 0.2s';
      setTimeout(() => el.remove(), 200);
    }
  });

  // Socket: Chat Cleared
  socket.on('chat:cleared', ({ by }) => {
    chatMessages.innerHTML = `
      <div class="welcome-chat-bubble">
        <div class="welcome-icon">🧹</div>
        <div class="welcome-title">Chat reiniciado por cabina</div>
        <div class="welcome-desc">El locutor ${by} ha limpiado los mensajes anteriores. ¡Escribí para salir al aire!</div>
      </div>
    `;
    showToast(`El chat fue limpiado por ${by}.`);
  });

  // Socket: Moderation Feedback
  socket.on('chat:error', ({ message }) => showToast(message, 'error'));
  socket.on('mod:success', ({ message }) => showToast(message, 'success'));

  // Socket: Kicked or Banned
  socket.on('kicked', ({ reason }) => {
    alert(`Has sido expulsado del chat: ${reason}`);
    window.location.reload();
  });

  socket.on('banned', ({ reason }) => {
    alert(`Acceso suspendido: ${reason}`);
    document.body.innerHTML = `<div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#080d1a;color:#ef4444;font-family:sans-serif;text-align:center;padding:20px;">
      <div><h2>Acceso Suspendido</h2><p>${reason}</p></div>
    </div>`;
  });

  // Render Single Message in Chat
  function appendMessage(msg) {
    const item = document.createElement('div');
    item.className = 'message-item';
    item.id = msg.id;

    if (msg.role === 'admin') item.classList.add('is-admin');
    if (msg.role === 'moderator') item.classList.add('is-moderator');

    let badgeClass = 'listener';
    let badgeText = 'Oyente';
    if (msg.role === 'admin') {
      badgeClass = 'admin';
      badgeText = msg.isMaster ? 'Master Admin' : 'Locutor';
    } else if (msg.role === 'moderator') {
      badgeClass = 'moderator';
      badgeText = 'Moderador';
    }

    // Is current viewer allowed to moderate?
    const canModerate = currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator');

    item.innerHTML = `
      <div class="message-avatar-wrap">
        <img src="${msg.avatar}" alt="${msg.username}" class="message-avatar">
      </div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-username">${msg.username}</span>
          <span class="badge-tag ${badgeClass}">${badgeText}</span>
          <span class="message-time">${msg.time}</span>
        </div>
        <div class="message-text">${msg.text}</div>
      </div>
      ${canModerate && msg.role === 'listener' ? `
        <div class="mod-tools">
          <button class="mod-btn delete" title="Borrar mensaje" data-action="delete" data-id="${msg.id}">🗑️</button>
          <button class="mod-btn" title="Silenciar 5 min" data-action="mute" data-target="${msg.socketId}">🔇</button>
          <button class="mod-btn" title="Expulsar" data-action="kick" data-target="${msg.socketId}">🚪</button>
          <button class="mod-btn" title="Banear IP" data-action="ban" data-target="${msg.socketId}">🚫</button>
        </div>
      ` : canModerate && msg.role !== 'admin' ? `
        <div class="mod-tools">
          <button class="mod-btn delete" title="Borrar mensaje" data-action="delete" data-id="${msg.id}">🗑️</button>
        </div>
      ` : ''}
    `;

    // Attach moderation button events
    if (canModerate) {
      const delBtn = item.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          socket.emit('mod:delete_message', { messageId: msg.id });
        });
      }
      const muteBtn = item.querySelector('[data-action="mute"]');
      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          if (confirm(`¿Silenciar a ${msg.username} por 5 minutos?`)) {
            socket.emit('mod:mute_user', { targetSocketId: msg.socketId, minutes: 5 });
          }
        });
      }
      const kickBtn = item.querySelector('[data-action="kick"]');
      if (kickBtn) {
        kickBtn.addEventListener('click', () => {
          if (confirm(`¿Expulsar a ${msg.username} de la sala?`)) {
            socket.emit('mod:kick_user', { targetSocketId: msg.socketId, reason: 'Expulsado por moderación de cabina' });
          }
        });
      }
      const banBtn = item.querySelector('[data-action="ban"]');
      if (banBtn) {
        banBtn.addEventListener('click', () => {
          if (confirm(`⚠️ ¿Banear permanentemente a ${msg.username} (IP)?`)) {
            socket.emit('mod:ban_user', { targetSocketId: msg.socketId, reason: 'Suspendido de TKD Radio' });
          }
        });
      }
    }

    chatMessages.appendChild(item);
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Sending Messages
  function sendMessage() {
    const text = (messageInput.value || '').trim();
    if (!text) return;
    if (!currentUser) {
      joinModalOverlay.classList.remove('hidden');
      return;
    }
    socket.emit('chat:message', { text });
    messageInput.value = '';
    charCount.textContent = '0/300';
    emojiPickerPopup.classList.add('hidden');
  }

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener('input', () => {
    charCount.textContent = `${messageInput.value.length}/300`;
  });

  // Emoji Picker Logic
  emojiToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPickerPopup.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!emojiPickerPopup.contains(e.target) && e.target !== emojiToggleBtn) {
      emojiPickerPopup.classList.add('hidden');
    }
  });

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value += btn.textContent;
      charCount.textContent = `${messageInput.value.length}/300`;
      messageInput.focus();
    });
  });

  // Cabin Modal Controls
  cabinControlBtn.addEventListener('click', () => {
    cabinModalOverlay.classList.remove('hidden');
  });

  closeCabinModalBtn.addEventListener('click', () => {
    cabinModalOverlay.classList.add('hidden');
  });

  chatActiveToggle.addEventListener('change', () => {
    socket.emit('mod:toggle_chat', { active: chatActiveToggle.checked });
  });

  slowModeSelect.addEventListener('change', () => {
    socket.emit('mod:set_slowmode', { seconds: slowModeSelect.value });
  });

  clearChatBtn.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que deseas limpiar TODOS los mensajes de la sala?')) {
      socket.emit('mod:clear_chat');
      cabinModalOverlay.classList.add('hidden');
    }
  });

  // Custom Avatar Upload for Staff
  triggerUploadBtn.addEventListener('click', () => {
    staffAvatarFileInput.click();
  });

  staffAvatarFileInput.addEventListener('change', () => {
    if (staffAvatarFileInput.files && staffAvatarFileInput.files[0]) {
      selectedStaffAvatarFile = staffAvatarFileInput.files[0];
      uploadFileName.textContent = selectedStaffAvatarFile.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        staffCurrentAvatarPreview.src = e.target.result;
        saveAvatarUploadBtn.classList.remove('hidden');
      };
      reader.readAsDataURL(selectedStaffAvatarFile);
    }
  });

  saveAvatarUploadBtn.addEventListener('click', async () => {
    if (!selectedStaffAvatarFile) return;

    const formData = new FormData();
    formData.append('avatar', selectedStaffAvatarFile);

    try {
      saveAvatarUploadBtn.textContent = 'Subiendo...';
      const res = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success && data.avatarUrl) {
        socket.emit('user:update_avatar', { avatarUrl: data.avatarUrl });
        currentUser.avatar = data.avatarUrl;
        updateUserPill();
        saveAvatarUploadBtn.classList.add('hidden');
        saveAvatarUploadBtn.textContent = 'Guardar y Aplicar Foto';
        showToast('Foto de perfil actualizada con éxito', 'success');
      } else {
        showToast(data.error || 'Error al subir la imagen', 'error');
        saveAvatarUploadBtn.textContent = 'Guardar y Aplicar Foto';
      }
    } catch (err) {
      showToast('Error de conexión al subir la imagen', 'error');
      saveAvatarUploadBtn.textContent = 'Guardar y Aplicar Foto';
    }
  });

  // Master Admin Team Management Modal
  masterTeamBtn.addEventListener('click', () => {
    teamModalOverlay.classList.remove('hidden');
    socket.emit('admin:list_staff');
  });

  closeTeamModalBtn.addEventListener('click', () => {
    teamModalOverlay.classList.add('hidden');
  });

  saveNewStaffBtn.addEventListener('click', () => {
    const username = (newStaffUser.value || '').trim();
    const password = newStaffPass.value || '';
    const role = newStaffRole.value;

    createStaffError.classList.add('hidden');
    createStaffSuccess.classList.add('hidden');

    socket.emit('admin:create_staff', { username, password, role });
  });

  socket.on('admin:success', ({ message }) => {
    createStaffSuccess.textContent = message;
    createStaffSuccess.classList.remove('hidden');
    newStaffUser.value = '';
    newStaffPass.value = '';
    setTimeout(() => createStaffSuccess.classList.add('hidden'), 4000);
  });

  socket.on('admin:error', ({ message }) => {
    createStaffError.textContent = message;
    createStaffError.classList.remove('hidden');
  });

  socket.on('admin:staff_list', ({ staff }) => {
    staffListContainer.innerHTML = '';
    staff.forEach(member => {
      const card = document.createElement('div');
      card.className = 'staff-card';
      const isMaster = member.isMaster;
      const roleName = member.role === 'admin' ? 'Locutor / Admin' : 'Moderador';

      card.innerHTML = `
        <div class="staff-card-left">
          <img src="${member.avatar}" alt="${member.username}" class="staff-card-avatar">
          <div>
            <div class="staff-card-name">${member.username} ${isMaster ? '👑' : ''}</div>
            <div style="font-size:0.75rem; color: var(--text-dim);">${roleName}</div>
          </div>
        </div>
        ${!isMaster ? `
          <button class="btn btn-danger btn-sm" data-delete-user="${member.username}">Eliminar</button>
        ` : `
          <span class="badge-tag admin">Maestro</span>
        `}
      `;

      if (!isMaster) {
        const delBtn = card.querySelector(`[data-delete-user="${member.username}"]`);
        delBtn.addEventListener('click', () => {
          if (confirm(`¿Eliminar la cuenta de ${member.username}?`)) {
            socket.emit('admin:delete_staff', { username: member.username });
          }
        });
      }

      staffListContainer.appendChild(card);
    });
  });
});
