const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BANS_FILE = path.join(DATA_DIR, 'bans.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// JSON helper functions
function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Load persisted state
let users = loadJSON(USERS_FILE, []);
let bans = loadJSON(BANS_FILE, { bannedIps: [], bannedUsers: [] });
let settings = loadJSON(SETTINGS_FILE, { chatActive: true, slowMode: 0, filterProfanity: true });

// Ensure default Admin exists
const defaultAdminExists = users.some(u => u.username.toLowerCase() === 'admin');
if (!defaultAdminExists) {
  users.push({
    username: 'Admin',
    passwordHash: bcrypt.hashSync('TKDradio/-2026', 10),
    role: 'admin',
    avatar: '/avatars/gallo_claudio.png',
    isMaster: true,
    createdAt: new Date().toISOString()
  });
  saveJSON(USERS_FILE, users);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer storage for custom avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `avatar_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP, GIF)'));
    }
  }
});

// Avatar upload endpoint (for Admins / Moderators)
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  const avatarUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, avatarUrl });
});

// Status endpoint (useful for Cabina de Control / external check)
app.get('/api/status', (req, res) => {
  res.json({
    onlineUsers: Object.keys(activeSockets).length,
    chatActive: settings.chatActive,
    slowMode: settings.slowMode
  });
});

// Profanity list for filtering
const PROFANITY_LIST = [
  'puto', 'puta', 'mierda', 'concha', 'pelotudo', 'pelotuda', 'forro', 'forra',
  'hdp', 'malparido', 'hijo de puta', 'imbecil', 'idiota', 'culiao', 'pajero',
  'verga', 'pija', 'choto', 'orto', 'boludo', 'boluda'
];

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

function filterBadWords(str) {
  if (!settings.filterProfanity) return str;
  let filtered = str;
  PROFANITY_LIST.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '***');
  });
  return filtered;
}

function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || socket.conn.remoteAddress || '127.0.0.1';
}

// In-memory runtime state
const activeSockets = {}; // socket.id -> user session
const messageHistory = []; // Last 50 messages

io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);

  // Check if IP is banned
  if (bans.bannedIps.includes(clientIP)) {
    socket.emit('banned', { reason: 'Tu dirección IP se encuentra suspendida de la sala.' });
    socket.disconnect(true);
    return;
  }

  // Handle user joining (as listener by default)
  socket.on('user:join', (data) => {
    const rawNick = sanitizeText(data?.nickname || '');
    const nickname = rawNick.slice(0, 25);
    const chosenAvatar = data?.avatar || '/avatars/gallo_claudio.png';

    if (!nickname || nickname.length < 2) {
      return socket.emit('join:error', { message: 'El apodo debe tener entre 2 y 25 caracteres.' });
    }

    // Check if username is banned
    if (bans.bannedUsers.some(u => u.toLowerCase() === nickname.toLowerCase())) {
      socket.emit('banned', { reason: 'Este nombre de usuario está bloqueado.' });
      return socket.disconnect(true);
    }

    // Check reserved names if not authenticated
    const isReserved = users.some(u => u.username.toLowerCase() === nickname.toLowerCase());
    if (isReserved && !data.isStaffAuth) {
      return socket.emit('join:error', {
        message: 'Ese nombre está reservado para el equipo de locución. Por favor iniciá sesión como Locutor/Admin.'
      });
    }

    // Register active user
    activeSockets[socket.id] = {
      id: socket.id,
      username: nickname,
      avatar: chosenAvatar,
      role: 'listener',
      isMaster: false,
      ip: clientIP,
      mutedUntil: 0,
      lastMessageTime: 0
    };

    socket.emit('join:success', {
      user: activeSockets[socket.id],
      settings,
      history: messageHistory.slice(-50),
      onlineCount: Object.keys(activeSockets).length
    });

    // Broadcast user joined
    io.emit('online:update', {
      count: Object.keys(activeSockets).length,
      users: Object.values(activeSockets).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        role: u.role
      }))
    });
  });

  // Handle Staff Login (Admin / Moderator)
  socket.on('auth:login', ({ username, password }) => {
    const cleanUser = (username || '').trim();
    const foundUser = users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase());

    if (!foundUser || !bcrypt.compareSync(password, foundUser.passwordHash)) {
      return socket.emit('auth:error', { message: 'Usuario o contraseña incorrectos.' });
    }

    // Upgrade socket user
    const existingSession = activeSockets[socket.id] || { ip: clientIP, mutedUntil: 0, lastMessageTime: 0 };
    activeSockets[socket.id] = {
      ...existingSession,
      id: socket.id,
      username: foundUser.username,
      avatar: foundUser.avatar || '/avatars/gallo_claudio.png',
      role: foundUser.role, // 'admin' or 'moderator'
      isMaster: !!foundUser.isMaster
    };

    socket.emit('auth:success', {
      user: activeSockets[socket.id],
      settings
    });

    // Notify all clients of updated role
    io.emit('online:update', {
      count: Object.keys(activeSockets).length,
      users: Object.values(activeSockets).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        role: u.role
      }))
    });

    io.emit('chat:system_message', {
      text: `🎙️ ${foundUser.role === 'admin' ? 'Administrador / Locutor' : 'Moderador'} ${foundUser.username} ha ingresado a la cabina.`
    });
  });

  // Handle Chat Message
  socket.on('chat:message', (payload) => {
    const user = activeSockets[socket.id];
    if (!user) return;

    // Check if chat is closed (only admins/mods can speak)
    if (!settings.chatActive && user.role === 'listener') {
      return socket.emit('chat:error', { message: 'El chat se encuentra cerrado temporalmente por la cabina.' });
    }

    // Check mute status
    const now = Date.now();
    if (user.mutedUntil && user.mutedUntil > now) {
      const remainingSecs = Math.ceil((user.mutedUntil - now) / 1000);
      return socket.emit('chat:error', { message: `Estás silenciado por ${remainingSecs} segundos más.` });
    }

    // Anti-Spam / Rate-limiting (listeners only)
    if (user.role === 'listener') {
      const cooldown = Math.max(1500, (settings.slowMode || 0) * 1000);
      if (now - user.lastMessageTime < cooldown) {
        const waitTime = Math.ceil((cooldown - (now - user.lastMessageTime)) / 1000);
        return socket.emit('chat:error', { message: `Modo anti-spam: esperá ${waitTime}s para volver a escribir.` });
      }
    }
    user.lastMessageTime = now;

    // Sanitize and filter
    let cleanText = sanitizeText(payload?.text || '');
    if (!cleanText || cleanText.length === 0) return;
    if (cleanText.length > 300) {
      cleanText = cleanText.slice(0, 300);
    }
    cleanText = filterBadWords(cleanText);

    const messageObj = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      socketId: socket.id,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      isMaster: user.isMaster,
      text: cleanText,
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    };

    messageHistory.push(messageObj);
    if (messageHistory.length > 60) messageHistory.shift();

    io.emit('chat:new_message', messageObj);
  });

  // Master Admin: List staff accounts
  socket.on('admin:list_staff', () => {
    const user = activeSockets[socket.id];
    if (!user || user.role !== 'admin') {
      return socket.emit('admin:error', { message: 'Acceso no autorizado.' });
    }
    const staffList = users.map(u => ({
      username: u.username,
      role: u.role,
      avatar: u.avatar,
      isMaster: !!u.isMaster,
      createdAt: u.createdAt
    }));
    socket.emit('admin:staff_list', { staff: staffList });
  });

  // Master Admin: Create new staff account
  socket.on('admin:create_staff', ({ username, password, role }) => {
    const user = activeSockets[socket.id];
    if (!user || !user.isMaster) {
      return socket.emit('admin:error', { message: 'Solo el Administrador Principal puede crear cuentas de equipo.' });
    }

    const cleanUser = (username || '').trim();
    if (!cleanUser || cleanUser.length < 3) {
      return socket.emit('admin:error', { message: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }
    if (!password || password.length < 5) {
      return socket.emit('admin:error', { message: 'La contraseña debe tener al menos 5 caracteres.' });
    }
    if (!['admin', 'moderator'].includes(role)) {
      return socket.emit('admin:error', { message: 'Rol inválido.' });
    }

    const exists = users.some(u => u.username.toLowerCase() === cleanUser.toLowerCase());
    if (exists) {
      return socket.emit('admin:error', { message: 'Ya existe un usuario con ese nombre.' });
    }

    const newStaff = {
      username: cleanUser,
      passwordHash: bcrypt.hashSync(password, 10),
      role,
      avatar: '/avatars/gallo_claudio.png',
      isMaster: false,
      createdAt: new Date().toISOString()
    };

    users.push(newStaff);
    saveJSON(USERS_FILE, users);

    socket.emit('admin:success', { message: `Cuenta ${cleanUser} (${role}) creada correctamente.` });
    // Resend updated staff list
    socket.emit('admin:staff_list', {
      staff: users.map(u => ({
        username: u.username,
        role: u.role,
        avatar: u.avatar,
        isMaster: !!u.isMaster,
        createdAt: u.createdAt
      }))
    });
  });

  // Master Admin: Delete staff account
  socket.on('admin:delete_staff', ({ username }) => {
    const user = activeSockets[socket.id];
    if (!user || !user.isMaster) {
      return socket.emit('admin:error', { message: 'Solo el Administrador Principal puede eliminar cuentas.' });
    }

    const targetUser = users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    if (!targetUser) {
      return socket.emit('admin:error', { message: 'Usuario no encontrado.' });
    }
    if (targetUser.isMaster) {
      return socket.emit('admin:error', { message: 'No es posible eliminar la cuenta Maestra del Administrador.' });
    }

    users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
    saveJSON(USERS_FILE, users);

    socket.emit('admin:success', { message: `Cuenta ${username} eliminada.` });
    socket.emit('admin:staff_list', {
      staff: users.map(u => ({
        username: u.username,
        role: u.role,
        avatar: u.avatar,
        isMaster: !!u.isMaster,
        createdAt: u.createdAt
      }))
    });
  });

  // Staff: Update custom profile picture
  socket.on('user:update_avatar', ({ avatarUrl }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    user.avatar = avatarUrl;
    // Update persisted record in users
    const record = users.find(u => u.username.toLowerCase() === user.username.toLowerCase());
    if (record) {
      record.avatar = avatarUrl;
      saveJSON(USERS_FILE, users);
    }

    socket.emit('user:avatar_updated', { avatarUrl });
    io.emit('online:update', {
      count: Object.keys(activeSockets).length,
      users: Object.values(activeSockets).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        role: u.role
      }))
    });
  });

  // Moderation: Delete individual message
  socket.on('mod:delete_message', ({ messageId }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    const idx = messageHistory.findIndex(m => m.id === messageId);
    if (idx !== -1) messageHistory.splice(idx, 1);

    io.emit('chat:message_deleted', { messageId });
  });

  // Moderation: Clear entire chat
  socket.on('mod:clear_chat', () => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    messageHistory.length = 0;
    io.emit('chat:cleared', { by: user.username });
  });

  // Moderation: Mute user
  socket.on('mod:mute_user', ({ targetSocketId, minutes }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    const target = activeSockets[targetSocketId];
    if (!target || target.role !== 'listener') return;

    const durationMins = Math.max(1, parseInt(minutes) || 5);
    target.mutedUntil = Date.now() + durationMins * 60 * 1000;

    io.to(targetSocketId).emit('chat:error', {
      message: `🔇 Has sido silenciado por ${durationMins} minuto(s) por un moderador.`
    });
    socket.emit('mod:success', { message: `${target.username} fue silenciado por ${durationMins}m.` });
  });

  // Moderation: Kick user
  socket.on('mod:kick_user', ({ targetSocketId, reason }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    const target = activeSockets[targetSocketId];
    if (!target || target.role !== 'listener') return;

    const kickReason = reason || 'Expulsado por moderación.';
    io.to(targetSocketId).emit('kicked', { reason: kickReason });

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);

    socket.emit('mod:success', { message: `${target.username} fue expulsado de la sala.` });
  });

  // Moderation: Ban user
  socket.on('mod:ban_user', ({ targetSocketId, reason }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    const target = activeSockets[targetSocketId];
    if (!target || target.role !== 'listener') return;

    if (!bans.bannedIps.includes(target.ip)) {
      bans.bannedIps.push(target.ip);
    }
    if (!bans.bannedUsers.includes(target.username)) {
      bans.bannedUsers.push(target.username);
    }
    saveJSON(BANS_FILE, bans);

    io.to(targetSocketId).emit('banned', { reason: reason || 'Has sido suspendido permanentemente de este chat.' });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);

    socket.emit('mod:success', { message: `${target.username} (${target.ip}) fue baneado.` });
  });

  // Moderation: Toggle chat on/off
  socket.on('mod:toggle_chat', ({ active }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    settings.chatActive = !!active;
    saveJSON(SETTINGS_FILE, settings);

    io.emit('settings:updated', settings);
    io.emit('chat:system_message', {
      text: settings.chatActive ? '🟢 El chat al aire ha sido habilitado.' : '🔴 El chat al aire ha sido pausado por la cabina.'
    });
  });

  // Moderation: Set Slow Mode
  socket.on('mod:set_slowmode', ({ seconds }) => {
    const user = activeSockets[socket.id];
    if (!user || user.role === 'listener') return;

    settings.slowMode = Math.max(0, parseInt(seconds) || 0);
    saveJSON(SETTINGS_FILE, settings);

    io.emit('settings:updated', settings);
  });

  // User Leave Room
  socket.on('user:leave', () => {
    if (activeSockets[socket.id]) {
      delete activeSockets[socket.id];
      io.emit('online:update', {
        count: Object.keys(activeSockets).length,
        users: Object.values(activeSockets).map(u => ({
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          role: u.role
        }))
      });
    }
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    if (activeSockets[socket.id]) {
      delete activeSockets[socket.id];
      io.emit('online:update', {
        count: Object.keys(activeSockets).length,
        users: Object.values(activeSockets).map(u => ({
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          role: u.role
        }))
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`📻 TKD Radio Online - Servidor de Chat Activo`);
  console.log(`🌐 Puerto: http://localhost:${PORT}`);
  console.log(`👤 Super Admin configurado: Admin / TKDradio/-2026`);
  console.log(`===============================================`);
});
