const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const config = require('./config.json');

// Конфигурация Discord OAuth2
const DISCORD_CLIENT_ID = config.discord.clientId;
const DISCORD_CLIENT_SECRET = config.discord.clientSecret;
const REDIRECT_URI = config.discord.redirectUri;
const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Хранилище сессий (в реальном приложении лучше использовать Redis или другое хранилище)
const sessions = new Map();
const blockedUsers = new Map(); // userId -> { until: timestamp, reason: string }

// Генерация URL для авторизации через Discord
router.get('/discord', (req, res) => {
    const state = Math.random().toString(36).substring(7);
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
    res.redirect(url);
});

// Обработка callback от Discord
router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        // Получение токена доступа
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
                scope: 'identify',
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        if (!tokens.access_token) {
            return res.redirect('/?error=no_access_token');
        }

        // Получение информации о пользователе
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const user = await userResponse.json();

        if (!user.id) {
            return res.redirect('/?error=no_user_data');
        }

        // Создание сессии
        const sessionId = Math.random().toString(36).substring(7);
        sessions.set(sessionId, {
            userId: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
        });

        // Установка cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
        });

        res.redirect('/');
    } catch (error) {
        console.error('Ошибка при авторизации:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Проверка сессии
router.get('/session', (req, res) => {
    const sessionId = req.cookies.sessionId;
    const session = sessions.get(sessionId);

    if (session) {
        res.json({
            authenticated: true,
            user: {
                id: session.userId,
                username: session.username,
                discriminator: session.discriminator,
                avatar: session.avatar,
            },
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Выход из системы
router.post('/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
});

// Проверка блокировки пользователя
router.get('/check-block/:userId', (req, res) => {
    const { userId } = req.params;
    const blockData = blockedUsers.get(userId);

    if (!blockData) {
        return res.json({ blocked: false });
    }

    if (Date.now() > blockData.until) {
        blockedUsers.delete(userId);
        return res.json({ blocked: false });
    }

    res.json({
        blocked: true,
        until: blockData.until,
        reason: blockData.reason
    });
});

module.exports = {
    router,
    sessions,
    blockedUsers
}; 
