require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { WebSocketServer } = require('ws');
const http = require('http');
const { router: authRouter, sessionsRef, blockedUsersRef } = require('./auth');
const cookieParser = require('cookie-parser');
const { db } = require('./firebase');

// Функция для парсинга cookies
function parseCookies(cookieHeader) {
    if (!cookieHeader) return {};
    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        cookies[name] = value;
    });
    return cookies;
}

// Инициализация Express приложения
const app = express();
const port = process.env.PORT || 3000;

// Создание HTTP сервера
const server = http.createServer(app);

// Инициализация WebSocket сервера
const wss = new WebSocketServer({ server });

// Maps to store active connections and channel mappings
const clients = new Map();
const discordChannelToClient = new Map();
const clientToDiscordChannel = new Map();
const activeConnections = new Set(); // Для отслеживания активных подключений
const userConnections = new Map(); // Для отслеживания подключений по userId

// Ограничения для защиты от перегрузки
const MAX_CONNECTIONS = 100; // Максимальное количество одновременных подключений
const MESSAGE_RATE_LIMIT = 5; // Максимальное количество сообщений в секунду
const MAX_MESSAGE_SIZE = 1000; // Максимальный размер сообщения в байтах
const CONNECTION_TIMEOUT = 30000; // Таймаут неактивного соединения (30 секунд)

// Хранилище для rate limiting
const messageCounts = new Map();

// In-memory storage for announcements
let announcements = []; // { title: string, content: string, imageUrl: string | null }
const MAX_ANNOUNCEMENTS = 4; // Max number of announcements to keep

const announcementsRef = db.ref('announcements');

// Load announcements from Firebase on startup
announcementsRef.once('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        announcements = Object.values(data).slice(0, MAX_ANNOUNCEMENTS);
        console.log('Loaded announcements from Firebase:', announcements);
    }
});

// Load configuration from environment variables or local config.json
// Using environment variables is crucial for production deployments
const config = {
    token: process.env.DISCORD_TOKEN || require('./config.json').token,
    supportChannelId: process.env.DISCORD_SUPPORT_CHANNEL_ID || require('./config.json').supportChannelId,
    clientId: process.env.DISCORD_CLIENT_ID || require('./config.json').clientId,
    guildId: process.env.DISCORD_GUILD_ID || require('./config.json').guildId,
    supportCategoryId: process.env.DISCORD_SUPPORT_CATEGORY_ID || require('./config.json').supportCategoryId,
    announcementCategoryId: process.env.DISCORD_ANNOUNCEMENT_CATEGORY_ID || require('./config.json').announcementCategoryId,
    announcementChannelId: process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || require('./config.json').announcementChannelId,
    deleteAnnouncementChannelId: process.env.DISCORD_DELETE_ANNOUNCEMENT_CHANNEL_ID || require('./config.json').deleteAnnouncementChannelId
};

// Basic check for required environment variables if not running locally
if (!process.env.LOCAL_DEV && (!config.token || !config.guildId || !config.announcementChannelId)) {
    console.error('ERROR: Missing required Discord environment variables. Please set DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_ANNOUNCEMENT_CHANNEL_ID.');
    process.exit(1);
}

// Инициализация Discord бота
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ],
    partials: [Partials.Channel]
});

// Middleware для CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Middleware для парсинга JSON
app.use(express.json());
app.use(express.static('.')); // Разрешаем доступ к статическим файлам
app.use(cookieParser());

// Подключаем роутер авторизации
app.use('/auth', authRouter);

// API endpoint to get announcements
app.get('/api/announcements', (req, res) => {
    res.json(announcements);
});

// Функция для проверки блокировки пользователя
async function checkUserBlocked(userId) {
    try {
        const blockedUsersRef = db.ref('blockedUsers');
        const snapshot = await blockedUsersRef.child(userId).once('value');
        const blockedData = snapshot.val();
        
        if (!blockedData) {
            return false;
        }

        // Проверяем, не истек ли срок блокировки
        if (blockedData.expiresAt && blockedData.expiresAt < Date.now()) {
            // Если срок блокировки истек, удаляем запись
            await blockedUsersRef.child(userId).remove();
            return false;
        }

        return true;
    } catch (error) {
        console.error('[server.js] Error checking user block status:', error);
        return false; // В случае ошибки считаем, что пользователь не заблокирован
    }
}

// Функция для проверки rate limit
function checkRateLimit(userId) {
    const now = Date.now();
    const userMessages = messageCounts.get(userId) || [];
    
    // Удаляем старые сообщения
    const recentMessages = userMessages.filter(time => now - time < 1000);
    
    if (recentMessages.length >= MESSAGE_RATE_LIMIT) {
        return false;
    }
    
    recentMessages.push(now);
    messageCounts.set(userId, recentMessages);
    return true;
}

// WebSocket обработчик
wss.on('connection', async (ws, req) => {
    console.log('[server.js] Client connected via WebSocket');
    
    // Проверяем количество активных соединений
    if (activeConnections.size >= MAX_CONNECTIONS) {
        console.log('[server.js] Too many connections, rejecting');
        ws.close(1008, 'Too many connections');
        return;
    }
    
    // Парсим куки из заголовков
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies.sessionId;
    
    // Функция для отправки сообщения клиенту
    const sendMessage = (type, data) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({ type, ...data }));
            } catch (error) {
                console.error('[server.js] Error sending message:', error);
            }
        }
    };

    // Устанавливаем таймаут для неактивных соединений
    let timeout = setTimeout(() => {
        if (!ws.userId) {
            console.log('[server.js] Connection timeout, closing');
            ws.close(1000, 'Connection timeout');
        }
    }, CONNECTION_TIMEOUT);

    // Обработка сообщений от клиента
    ws.on('message', async (message) => {
        try {
            // Проверяем размер сообщения
            if (message.length > MAX_MESSAGE_SIZE) {
                sendMessage('error', { message: 'Сообщение слишком большое' });
                return;
            }

            const data = JSON.parse(message);
            console.log('[server.js] Received message:', data);

            if (data.type === 'init') {
                console.log('[server.js] Received init message with sessionId:', data.sessionId);
                
                if (!data.sessionId) {
                    console.log('[server.js] No sessionId in init message');
                    sendMessage('error', { message: 'Требуется авторизация' });
                    ws.close();
                    return;
                }

                // Проверяем сессию в Firebase
                const sessionSnapshot = await sessionsRef.child(data.sessionId).once('value');
                const sessionData = sessionSnapshot.val();

                if (!sessionData) {
                    console.log('[server.js] Invalid session');
                    sendMessage('error', { message: 'Недействительная сессия' });
                    ws.close();
                    return;
                }

                // Проверяем, не заблокирован ли пользователь
                const isBlocked = await checkUserBlocked(sessionData.user.id);
                if (isBlocked) {
                    console.log('[server.js] User is blocked');
                    sendMessage('error', { message: 'Ваш аккаунт заблокирован' });
                    ws.close();
                    return;
                }

                // Сохраняем информацию о пользователе
                ws.userId = sessionData.user.id;
                ws.username = sessionData.user.username;
                ws.isSupport = sessionData.user.isSupport || false;

                // Добавляем соединение в активные
                activeConnections.add(ws);
                userConnections.set(ws.userId, ws);

                // Отправляем подтверждение авторизации
                sendMessage('status', {
                    authenticated: true,
                    user: sessionData.user,
                    message: 'Вы успешно авторизованы'
                });

                // Отправляем историю сообщений (только последние 20)
                const messagesSnapshot = await messagesRef.limitToLast(20).once('value');
                const messages = [];
                messagesSnapshot.forEach((childSnapshot) => {
                    messages.push(childSnapshot.val());
                });
                sendMessage('history', { messages });

                // Очищаем таймаут после успешной авторизации
                clearTimeout(timeout);

            } else if (data.type === 'message') {
                if (!ws.userId) {
                    sendMessage('error', { message: 'Требуется авторизация' });
                    return;
                }

                // Проверяем rate limit
                if (!checkRateLimit(ws.userId)) {
                    sendMessage('error', { message: 'Слишком много сообщений. Пожалуйста, подождите.' });
                    return;
                }

                const messageData = {
                    id: Date.now().toString(),
                    userId: ws.userId,
                    username: ws.username,
                    message: data.message,
                    timestamp: Date.now(),
                    isSupport: ws.isSupport
                };

                // Сохраняем сообщение в Firebase
                await messagesRef.push(messageData);

                // Отправляем сообщение всем клиентам
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(JSON.stringify({
                                type: 'message',
                                ...messageData
                            }));
                        } catch (error) {
                            console.error('[server.js] Error sending message to client:', error);
                        }
                    }
                });

            } else if (data.type === 'heartbeat') {
                // Просто отвечаем на heartbeat
                sendMessage('heartbeat', { timestamp: Date.now() });
            }
        } catch (error) {
            console.error('[server.js] Error processing message:', error);
            sendMessage('error', { message: 'Ошибка обработки сообщения' });
        }
    });

    // Обработка отключения клиента
    ws.on('close', () => {
        console.log('[server.js] Client disconnected');
        activeConnections.delete(ws);
        if (ws.userId) {
            userConnections.delete(ws.userId);
        }
        clearTimeout(timeout);
    });

    // Обработка ошибок
    ws.on('error', (error) => {
        console.error('[server.js] WebSocket error:', error);
        activeConnections.delete(ws);
        if (ws.userId) {
            userConnections.delete(ws.userId);
        }
        clearTimeout(timeout);
    });
});

// Функция для получения последних сообщений
async function getRecentMessages() {
    try {
        const messagesRef = db.ref('messages');
        const snapshot = await messagesRef.limitToLast(50).once('value');
        const messages = [];
        snapshot.forEach((childSnapshot) => {
            messages.push(childSnapshot.val());
        });
        return messages;
    } catch (error) {
        console.error('[server.js] Error getting messages:', error);
        return [];
    }
}

// Функция для сохранения сообщения
async function saveMessage(message) {
    try {
        const messagesRef = db.ref('messages');
        await messagesRef.push(message);
    } catch (error) {
        console.error('[server.js] Error saving message:', error);
    }
}

// Обработка сообщений из Discord (ответы поддержки и объявления)
client.on('messageCreate', async message => {
    // Игнорируем сообщения от ботов
    if (message.author.bot) return;

    // Обработка ответов поддержки
    if (discordChannelToClient.has(message.channel.id)) {
        // If message is in a support channel, check for commands
        if (message.content.toLowerCase() === '/ticketclose') {
            const clientId = discordChannelToClient.get(message.channel.id);
            const targetWs = clients.get(clientId);

            try {
                // Send a final message to the website user if they are still connected
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ type: 'status', message: 'Чат завершен администратором. Если у вас есть другие вопросы, откройте новый чат.' }));
                    // Give client a moment to receive message before closing WS
                    setTimeout(() => {
                        targetWs.close();
                    }, 1000);
                }

                // Remove mappings
                clientToDiscordChannel.delete(clientId);
                discordChannelToClient.delete(message.channel.id);
                console.log(`Chat for client ${clientId} closed. Mapping removed.`);

                // Delete the Discord channel
                await message.channel.delete('Ticket closed by command.');
                console.log(`Discord channel ${message.channel.name} (${message.channel.id}) deleted.`);

            } catch (deleteError) {
                console.error(`Failed to delete Discord channel ${message.channel.id}:`, deleteError);
                message.reply('Не удалось удалить канал. Проверьте права бота.').catch(console.error);
            }
            return; // Stop processing further if it was a command
        }

        // Original logic for sending support messages to website
        const clientId = discordChannelToClient.get(message.channel.id);
        const targetWs = clients.get(clientId);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            // Send the Discord message back to the correct website client
            targetWs.send(JSON.stringify({
                type: 'message',
                sender: 'support',
                message: message.content,
                author: message.author.username // Optionally include author
            }));
            console.log(`Sent message from Discord channel ${message.channel.id} to website client ${clientId}.`);
        } else {
            console.warn(`WebSocket for client ${clientId} not found or not open.`);
            // TODO: Handle cases where client is offline (e.g., store message for later delivery)
        }
    }

    // Обработка новых объявлений
    if (message.channel.id === config.announcementChannelId) {
        console.log(`Received message in announcement channel: ${message.content}`);
        const lines = message.content.split('\n').map(line => line.trim());
        
        let title = '';
        let content = '';
        let imageUrl = null;

        if (lines[0] && lines[0].startsWith('#')) {
            title = lines[0].substring(1).trim();
        }

        // Text content is everything between title and image URL
        let contentLines = [];
        let foundImageUrl = false;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].startsWith('http://') || lines[i].startsWith('https://')) {
                imageUrl = lines[i];
                foundImageUrl = true;
                break;
            } else {
                contentLines.push(lines[i]);
            }
        }
        content = contentLines.join('\n').trim();

        // Handle attachments as image URL if no URL in text
        if (!imageUrl && message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith('image')) {
                imageUrl = attachment.url;
            }
        }

        if (title && content) {
            const newAnnouncement = {
                title: title,
                content: content,
                imageUrl: imageUrl,
                timestamp: Date.now() // Add timestamp for ordering
            };

            // Save to Firebase
            const newAnnouncementRef = announcementsRef.push();
            newAnnouncementRef.set(newAnnouncement)
                .then(() => {
                    // Update local array
                    announcements.unshift(newAnnouncement);
                    if (announcements.length > MAX_ANNOUNCEMENTS) {
                        announcements.pop();
                    }
                    console.log('New announcement saved to Firebase:', newAnnouncement);
                    message.reply('Объявление успешно добавлено на доску объявлений сайта!').catch(console.error);
                })
                .catch(error => {
                    console.error('Error saving announcement to Firebase:', error);
                    message.reply('Произошла ошибка при сохранении объявления.').catch(console.error);
                });
        } else {
            message.reply('Неверный формат объявления. Используйте: #Заголовок\nТекст\n[ссылка на фото]').catch(console.error);
        }
    }

    // Обработка удаления объявлений
    if (message.channel.id === config.deleteAnnouncementChannelId) {
        if (message.content.startsWith('/deleteannouns')) {
            const title = message.content.replace('/deleteannouns', '').trim();
            
            if (!title) {
                message.reply('Пожалуйста, укажите заголовок объявления для удаления. Пример: /deleteannouns Заголовок объявления').catch(console.error);
                return;
            }

            try {
                // Получаем все объявления из Firebase
                const snapshot = await announcementsRef.once('value');
                const announcementsData = snapshot.val();
                
                if (!announcementsData) {
                    message.reply('Нет доступных объявлений для удаления.').catch(console.error);
                    return;
                }

                // Ищем объявление по заголовку
                let foundAnnouncement = null;
                let announcementKey = null;

                for (const [key, announcement] of Object.entries(announcementsData)) {
                    if (announcement.title.toLowerCase() === title.toLowerCase()) {
                        foundAnnouncement = announcement;
                        announcementKey = key;
                        break;
                    }
                }

                if (!foundAnnouncement) {
                    message.reply(`Объявление с заголовком "${title}" не найдено.`).catch(console.error);
                    return;
                }

                // Удаляем объявление из Firebase
                await announcementsRef.child(announcementKey).remove();

                // Обновляем локальный массив объявлений
                announcements = announcements.filter(a => a.title.toLowerCase() !== title.toLowerCase());

                message.reply(`Объявление "${title}" успешно удалено!`).catch(console.error);
                console.log(`Announcement "${title}" deleted successfully`);

            } catch (error) {
                console.error('Error deleting announcement:', error);
                message.reply('Произошла ошибка при удалении объявления.').catch(console.error);
            }
        }
    }

    // Обработка команд блокировки
    if (message.channel.id === config.supportChannelId) {
        if (message.content.startsWith('/block')) {
            // Проверяем права администратора
            if (!message.member.permissions.has('ADMINISTRATOR')) {
                message.reply('У вас нет прав для использования этой команды.').catch(console.error);
                return;
            }

            const args = message.content.split(' ');
            if (args.length < 3) {
                message.reply('Использование: /block @пользователь <время в минутах> [причина]').catch(console.error);
                return;
            }

            const user = message.mentions.users.first();
            if (!user) {
                message.reply('Пожалуйста, укажите пользователя для блокировки.').catch(console.error);
                return;
            }

            const duration = parseInt(args[2]);
            if (isNaN(duration) || duration <= 0) {
                message.reply('Пожалуйста, укажите корректное время блокировки в минутах.').catch(console.error);
                return;
            }

            const reason = args.slice(3).join(' ') || 'Причина не указана';
            const until = Date.now() + duration * 60 * 1000;

            // Блокируем пользователя
            blockedUsersRef.set({
                until,
                reason,
                blockedBy: message.author.id,
                blockedAt: Date.now()
            });

            message.reply(`Пользователь ${user.tag} заблокирован на ${duration} минут. Причина: ${reason}`).catch(console.error);
        }

        if (message.content.startsWith('/unblock')) {
            // Проверяем права администратора
            if (!message.member.permissions.has('ADMINISTRATOR')) {
                message.reply('У вас нет прав для использования этой команды.').catch(console.error);
                return;
            }

            const user = message.mentions.users.first();
            if (!user) {
                message.reply('Пожалуйста, укажите пользователя для разблокировки.').catch(console.error);
                return;
            }

            if (blockedUsersRef.delete(user.id)) {
                message.reply(`Пользователь ${user.tag} разблокирован.`).catch(console.error);
            } else {
                message.reply(`Пользователь ${user.tag} не был заблокирован.`).catch(console.error);
            }
        }
    }
});


// Обработка ошибок Discord бота
client.on('error', error => {
    console.error('Discord client error:', error);
});

// Обработка успешного подключения Discord бота
client.on('ready', async () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    console.log(`Bot is in ${client.guilds.cache.size} guilds`);

    // Optional: Fetch the support category to ensure it exists and get its ID
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (guild) {
            const category = await guild.channels.fetch(config.supportCategoryId);
            if (category) {
                console.log(`Support category "${category.name}" found with ID: ${category.id}`);
            } else {
                console.warn(`Support category with ID ${config.supportCategoryId} not found.`);
            }

            const announcementChannel = await guild.channels.fetch(config.announcementChannelId);
            if (announcementChannel) {
                console.log(`Announcement input channel "${announcementChannel.name}" found with ID: ${announcementChannel.id}`);
            } else {
                console.warn(`Announcement input channel with ID ${config.announcementChannelId} not found.`);
            }
        } else {
            console.warn(`Bot is not in the guild with ID ${config.guildId}.`);
        }
    } catch (e) {
        console.error('Error fetching categories/channels on ready:', e);
    }
});

// Подключение Discord бота
console.log('Attempting to login to Discord...');
client.login(config.token).catch(error => {
    console.error('Failed to login to Discord:', error);
});

// Запуск HTTP и WebSocket сервера
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`WebSocket server is also running.`);
});

