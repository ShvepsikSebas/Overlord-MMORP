const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Конфигурация Discord OAuth2
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || require('./config.json').clientId;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://overlord-mmorp.onrender.com/auth/discord/callback';
const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';

// Хранилище сессий (в реальном проекте лучше использовать Redis или базу данных)
const sessions = new Map();
const blockedUsers = new Map(); // userId -> { until: timestamp, reason: string }

// Генерация URL для авторизации
router.get('/discord', (req, res) => {
    const state = Math.random().toString(36).substring(7);
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
    res.json({ url });
});

// Обработка callback от Discord
router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        // Получаем токен доступа
        const tokenResponse = await fetch(`${DISCORD_API_ENDPOINT}/oauth2/token`, {
            method: 'POST',
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        // Получаем информацию о пользователе
        const userResponse = await fetch(`${DISCORD_API_ENDPOINT}/users/@me`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const user = await userResponse.json();

        // Создаем сессию
        const sessionId = Math.random().toString(36).substring(7);
        sessions.set(sessionId, {
            userId: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
        });

        // Перенаправляем на главную страницу с токеном сессии
        res.redirect(`/?session=${sessionId}`);
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Проверка сессии
router.get('/check', (req, res) => {
    const { session } = req.query;
    if (!session || !sessions.has(session)) {
        return res.json({ authenticated: false });
    }

    const sessionData = sessions.get(session);
    if (Date.now() > sessionData.expiresAt) {
        sessions.delete(session);
        return res.json({ authenticated: false });
    }

    res.json({
        authenticated: true,
        user: {
            id: sessionData.userId,
            username: sessionData.username,
            discriminator: sessionData.discriminator,
            avatar: sessionData.avatar,
        }
    });
});

// Выход из системы
router.post('/logout', (req, res) => {
    const { session } = req.body;
    if (session) {
        sessions.delete(session);
    }
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