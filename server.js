require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { WebSocketServer } = require('ws');
const http = require('http');
const admin = require('firebase-admin');
const { router: authRouter, sessions, blockedUsers } = require('./auth');
const cookieParser = require('cookie-parser');

// Initialize Firebase
const serviceAccount = {
  "type": "service_account",
  "project_id": "bfysup",
  "private_key_id": "25607f30c9",
  "private_key": Buffer.from(process.env.FIREBASE_PRIVATE_KEY, 'base64').toString('utf8'),
  "client_email": "firebase-adminsdk-fbsvc@bfysup.iam.gserviceaccount.com",
  "client_id": "115735123456789012345",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40bfysup.iam.gserviceaccount.com"
};

console.log('Firebase Private Key (decoded):', serviceAccount.private_key);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.DATABASE_URL
});

const app = express();
// Use process.env.PORT for Render, fallback to 3000 locally
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Maps to store active connections and channel mappings
// clientId -> ws (WebSocket connection for a specific website user)
const clients = new Map();
// discordChannelId -> clientId (mapping Discord channel to website user)
const discordChannelToClient = new Map();
// clientId -> discordChannelId (mapping website user to Discord channel)
const clientToDiscordChannel = new Map();

// In-memory storage for announcements
let announcements = []; // { title: string, content: string, imageUrl: string | null }
const MAX_ANNOUNCEMENTS = 4; // Max number of announcements to keep

const db = admin.database();
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

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('[server.js] Client connected via WebSocket');

    // Parse cookies from the WebSocket handshake request
    const cookies = req.headers.cookie;
    let sessionIdFromCookie = null;
    if (cookies) {
        const cookieParts = cookies.split(';');
        for (const part of cookieParts) {
            const trimmedPart = part.trim();
            if (trimmedPart.startsWith('sessionId=')) {
                sessionIdFromCookie = trimmedPart.substring('sessionId='.length);
                break;
            }
        }
    }
    console.log(`[server.js] Session ID extracted from cookie in handshake: ${sessionIdFromCookie}`);

    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        
        if (parsedMessage.type === 'init' && parsedMessage.clientId) {
            const clientId = parsedMessage.clientId;
            // const session = parsedMessage.session; // No longer relying on client sending session in init message
            const session = sessionIdFromCookie; // Use session ID from handshake cookie

            console.log(`[server.js] Received init message from client ${clientId}. Using Session ID from handshake: ${session}`);

            // Проверяем авторизацию
            if (!session) {
                console.warn(`[server.js] Session ID is missing (not found in handshake cookie) for client ${clientId}.`);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Требуется авторизация через Discord'
                }));
                return;
            }

            if (!sessions.has(session)) {
                console.warn(`[server.js] Session ID ${session} not found in sessions map for client ${clientId}. Current sessions:`, Array.from(sessions.keys()));
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Требуется авторизация через Discord'
                }));
                return;
            }

            const sessionData = sessions.get(session);
            console.log(`[server.js] Session data found for ${session}:`, sessionData);
            
            // Store the user data directly on the WebSocket object for later use
            ws.userData = {
                id: sessionData.userId,
                username: sessionData.username,
                discriminator: sessionData.discriminator,
                avatar: sessionData.avatar
            };
            console.log(`[server.js] WebSocket for client ${clientId} initialized with user data:`, ws.userData);

            // Проверяем блокировку
            const blockData = blockedUsers.get(sessionData.userId);
            if (blockData && Date.now() < blockData.until) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Вы заблокированы. Причина: ${blockData.reason}. Разблокировка: ${new Date(blockData.until).toLocaleString()}`
                }));
                return;
            }

            clients.set(clientId, ws);
            console.log(`[server.js] Client ${clientId} initialized WebSocket connection.`);

            // Отправляем клиенту подтверждение об успешной инициализации WebSocket и авторизации
            ws.send(JSON.stringify({
                type: 'status',
                message: 'Авторизация и подключение к чату успешно завершены.',
                authenticated: true // Индикатор успешной инициализации
            }));

            // Если есть существующий Discord канал для этого клиента, отправляем подтверждение
            if (clientToDiscordChannel.has(clientId)) {
                ws.send(JSON.stringify({ 
                    type: 'status', 
                    message: 'Подключено к существующему чату.',
                    user: {
                        id: sessionData.userId,
                        username: sessionData.username,
                        discriminator: sessionData.discriminator,
                        avatar: sessionData.avatar
                    }
                }));
            } else {
                ws.send(JSON.stringify({ 
                    type: 'status', 
                    message: 'Ожидаем ваше первое сообщение...',
                    user: {
                        id: sessionData.userId,
                        username: sessionData.username,
                        discriminator: sessionData.discriminator,
                        avatar: sessionData.avatar
                    }
                }));
            }
        } else if (parsedMessage.type === 'chatMessage' && parsedMessage.clientId && parsedMessage.message) {
            // Handle chat messages coming from the website via WebSocket
            const clientId = parsedMessage.clientId;
            const userMessage = parsedMessage.message;
            // Retrieve userData from the WebSocket connection itself
            const userData = ws.userData; // <-- CHANGE HERE

            if (!userData) { // Add a check in case userData wasn't set (e.g., if init failed or not sent)
                console.error(`Received chat message from client ${clientId} but no user data found on WebSocket connection.`);
                ws.send(JSON.stringify({ type: 'error', message: 'Не удалось определить пользователя. Пожалуйста, попробуйте авторизоваться снова.' }));
                return;
            }

            console.log(`Received chat message from client ${clientId}: ${userMessage}. User data from WS: ${JSON.stringify(userData)}`);
            console.log('Full parsed message from client:', parsedMessage); 

            // Check if a Discord channel already exists for this client
            let discordChannelId = clientToDiscordChannel.get(clientId);

            async function processChatMessage() {
                try {
                    let supportChannel;
                    if (discordChannelId) {
                        try {
                            console.log(`Attempting to fetch mapped Discord channel: ${discordChannelId}`);
                            supportChannel = await client.channels.fetch(discordChannelId);
                            console.log(`Successfully fetched mapped Discord channel: ${supportChannel.name}`);
                        } catch (fetchError) {
                            if (fetchError.code === 10003) { // DiscordAPIError[10003]: Unknown Channel
                                console.warn(`Mapped Discord channel ${discordChannelId} is unknown/deleted. Clearing mapping and attempting new channel creation.`);
                                clientToDiscordChannel.delete(clientId);
                                discordChannelToClient.delete(discordChannelId);
                                discordChannelId = null; // Force new channel creation
                            } else {
                                console.error(`Unexpected error fetching mapped Discord channel ${discordChannelId}:`, fetchError);
                                throw fetchError; // Re-throw other errors
                            }
                        }
                        if (!supportChannel && discordChannelId !== null) {
                            console.error(`Mapped Discord channel ${discordChannelId} not found after fetch attempt (should be null now if deleted).`);
                            // Fallback: clear mapping and create new channel (already handled by catch block now, but good fallback)
                            clientToDiscordChannel.delete(clientId);
                            discordChannelToClient.delete(discordChannelId);
                            discordChannelId = null;
                        }
                    }

                    if (!discordChannelId) {
                        console.log(`No existing Discord channel for client ${clientId}. Attempting to create a new one.`);
                        // Create a new Discord channel for this user
                        const guild = client.guilds.cache.get(config.guildId);
                        if (!guild) {
                            console.error('Bot is not in the specified guild or guildId is incorrect.');
                            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера: не удалось найти сервер Discord.' }));
                            return;
                        }
                        console.log(`Guild found: ${guild.name}`);

                        // Create a new channel in a specific category (e.g., 'Support Tickets')
                        const category = await guild.channels.fetch(config.supportCategoryId);
                        if (!category || category.type !== ChannelType.GuildCategory) {
                            console.error('Support category not found or is not a category. ID:', config.supportCategoryId);
                            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера: не удалось найти категорию поддержки Discord.' }));
                            return;
                        }
                        console.log(`Support category found: ${category.name}`);

                        // Create a unique channel name (e.g., 'support-user-clientId_short')
                        const channelName = `support-${userData.username}-${userData.discriminator || userData.id.substring(0,4)}`; // Используем никнейм и дискриминатор/ID
                        console.log(`Attempting to create Discord channel with name: ${channelName} in category ${category.name} (${category.id})`);
                        supportChannel = await guild.channels.create({
                            name: channelName,
                            type: ChannelType.GuildText,
                            parent: category.id,
                            permissionOverwrites: [
                                {
                                    id: guild.roles.everyone, // @everyone role
                                    deny: ['ViewChannel']
                                },
                                {
                                    id: client.user.id, // Bot itself
                                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels']
                                }
                                // You might want to add specific roles for support staff here
                            ]
                        });
                        console.log(`Created new Discord channel: ${supportChannel.name} (${supportChannel.id})`);
                        
                        discordChannelId = supportChannel.id;
                        clientToDiscordChannel.set(clientId, discordChannelId);
                        discordChannelToClient.set(discordChannelId, clientId);

                        // Send initial message to the newly created Discord channel
                        await supportChannel.send({
                            embeds: [{
                                title: `Новый чат от ${userData.username}#${userData.discriminator || '0000'} (ID: ${userData.id})`,
                                description: `**Первое сообщение:** ${userMessage}`,
                                color: 0x00ff00,
                                timestamp: new Date()
                            }]
                        });

                        ws.send(JSON.stringify({ type: 'message', sender: 'bot', message: 'Ваше сообщение отправлено. Администратор скоро свяжется с вами.' }));
                        return; // Exit after handling first message
                    }

                    // If channel already exists, send message to it
                    await supportChannel.send({
                        embeds: [{
                            title: `Сообщение от ${userData.username}#${userData.discriminator || '0000'}`,
                            description: userMessage,
                            color: 0xb891f9,
                            fields: [
                                { name: 'Пользователь ID', value: userData.id, inline: true }
                            ],
                            timestamp: new Date()
                        }]
                    });
                    // ws.send(JSON.stringify({ type: 'message', sender: 'bot', message: 'Ваше сообщение отправлено. Ожидайте ответа.' })); // Отключено для последующих сообщений

                } catch (error) {
                    console.error('Error processing chat message from website:', error);
                    ws.send(JSON.stringify({ type: 'error', message: 'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте позже.' }));
                }
            }
            processChatMessage();

        } else {
            console.warn('Unknown WebSocket message type or missing data:', parsedMessage);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
        // Remove client from map if it was stored
        for (let [clientId, connection] of clients.entries()) {
            if (connection === ws) {
                clients.delete(clientId);
                console.log(`Client ${clientId} removed from active connections.`);
                break;
            }
        }
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});


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
            blockedUsers.set(user.id, {
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

            if (blockedUsers.delete(user.id)) {
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
