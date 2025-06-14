const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { WebSocketServer } = require('ws');
const http = require('http');

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
// For a real application, this should be replaced with a database
let announcements = []; // { title: string, content: string, imageUrl: string | null }
const MAX_ANNOUNCEMENTS = 4; // Max number of announcements to keep

// Load configuration from environment variables or local config.json
// Using environment variables is crucial for production deployments
const config = {
    token: process.env.DISCORD_TOKEN || require('./config.json').token,
    supportChannelId: process.env.DISCORD_SUPPORT_CHANNEL_ID || require('./config.json').supportChannelId,
    clientId: process.env.DISCORD_CLIENT_ID || require('./config.json').clientId,
    guildId: process.env.DISCORD_GUILD_ID || require('./config.json').guildId,
    supportCategoryId: process.env.DISCORD_SUPPORT_CATEGORY_ID || require('./config.json').supportCategoryId,
    announcementCategoryId: process.env.DISCORD_ANNOUNCEMENT_CATEGORY_ID || require('./config.json').announcementCategoryId,
    announcementChannelId: process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || require('./config.json').announcementChannelId
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

// API endpoint to get announcements
app.get('/api/announcements', (req, res) => {
    res.json(announcements);
});

// WebSocket connection handling
wss.on('connection', ws => {
    console.log('Client connected via WebSocket');

    // On initial connection, client should send their unique ID
    ws.on('message', message => {
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === 'init' && parsedMessage.clientId) {
            const clientId = parsedMessage.clientId;
            clients.set(clientId, ws);
            console.log(`Client ${clientId} initialized WebSocket connection.`);

            // If there's an existing Discord channel for this client, send a confirmation
            if (clientToDiscordChannel.has(clientId)) {
                ws.send(JSON.stringify({ type: 'status', message: 'Connected to existing chat session.' }));
            } else {
                ws.send(JSON.stringify({ type: 'status', message: 'Waiting for your first message...' }));
            }

        } else if (parsedMessage.type === 'chatMessage' && parsedMessage.clientId && parsedMessage.message) {
            // Handle chat messages coming from the website via WebSocket
            const clientId = parsedMessage.clientId;
            const userMessage = parsedMessage.message;

            console.log(`Received chat message from client ${clientId}: ${userMessage}`);

            // Check if a Discord channel already exists for this client
            let discordChannelId = clientToDiscordChannel.get(clientId);

            async function processChatMessage() {
                try {
                    let supportChannel;
                    if (discordChannelId) {
                        supportChannel = await client.channels.fetch(discordChannelId);
                        if (!supportChannel) {
                            console.error(`Mapped Discord channel ${discordChannelId} not found.`);
                            // Fallback: clear mapping and create new channel
                            clientToDiscordChannel.delete(clientId);
                            discordChannelToClient.delete(discordChannelId);
                            discordChannelId = null;
                        }
                    }

                    if (!discordChannelId) {
                        // Create a new Discord channel for this user
                        const guild = client.guilds.cache.get(config.guildId);
                        if (!guild) {
                            console.error('Bot is not in the specified guild or guildId is incorrect.');
                            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера: не удалось найти сервер Discord.' }));
                            return;
                        }

                        // Create a new channel in a specific category (e.g., 'Support Tickets')
                        const category = await guild.channels.fetch(config.supportCategoryId);
                        if (!category || category.type !== ChannelType.GuildCategory) {
                            console.error('Support category not found or is not a category.');
                            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера: не удалось найти категорию поддержки Discord.' }));
                            return;
                        }

                        // Create a unique channel name (e.g., 'support-user-clientId_short')
                        const channelName = `support-${clientId.substring(0, 8)}`;
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
                                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
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
                                title: `Новый чат от пользователя ${clientId}`,
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
                            title: 'Сообщение от пользователя',
                            description: userMessage,
                            color: 0xb891f9,
                            fields: [{ name: 'Пользователь ID', value: clientId, inline: true }],
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
                imageUrl: imageUrl
            };

            // Add new announcement and maintain MAX_ANNOUNCEMENTS
            announcements.unshift(newAnnouncement); // Add to the beginning
            if (announcements.length > MAX_ANNOUNCEMENTS) {
                announcements.pop(); // Remove the oldest if over limit
            }
            console.log('New announcement added:', newAnnouncement);
            console.log('Current announcements:', announcements);

            // Optionally, send a confirmation to the Discord channel
            message.reply('Объявление успешно добавлено на доску объявлений сайта!').catch(console.error);
        } else {
            message.reply('Неверный формат объявления. Используйте: #Заголовок\nТекст\n[ссылка на фото]').catch(console.error);
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
