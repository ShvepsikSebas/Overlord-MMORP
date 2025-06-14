const { Client, GatewayIntentBits, Partials } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const config = require('./config.json');

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    // Игнорируем сообщения от ботов
    if (message.author.bot) return;

    // Проверяем, является ли сообщение личным
    if (message.channel.type === 'DM') {
        try {
            // Отправляем сообщение в канал поддержки
            const supportChannel = await client.channels.fetch(config.supportChannelId);
            if (supportChannel) {
                await supportChannel.send({
                    embeds: [{
                        title: 'Новое сообщение от пользователя',
                        description: message.content,
                        color: 0xb891f9,
                        fields: [
                            {
                                name: 'Пользователь',
                                value: `${message.author.tag} (${message.author.id})`,
                                inline: true
                            }
                        ],
                        timestamp: new Date()
                    }]
                });
                
                // Отправляем подтверждение пользователю
                await message.reply('Ваше сообщение получено! Мы ответим вам в ближайшее время.');
            }
        } catch (error) {
            console.error('Error handling DM:', error);
            await message.reply('Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте позже.');
        }
    }
});

client.login(config.token); 