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
const authAttempts = new Map(); // IP -> { count: number, lastAttempt: timestamp }

// Константы для ограничения запросов
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 минут
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 часа

// Функция для проверки ограничения запросов
function checkRateLimit(ip) {
    const now = Date.now();
    const attempt = authAttempts.get(ip) || { count: 0, lastAttempt: now };
    
    // Сбрасываем счетчик, если прошло достаточно времени
    if (now - attempt.lastAttempt > AUTH_WINDOW_MS) {
        attempt.count = 0;
    }
    
    attempt.lastAttempt = now;
    attempt.count++;
    authAttempts.set(ip, attempt);
    
    return attempt.count <= MAX_AUTH_ATTEMPTS;
}

// Генерация URL для авторизации через Discord
router.get('/discord', (req, res) => {
    const clientIP = req.ip;
    
    // Проверяем ограничение запросов
    if (!checkRateLimit(clientIP)) {
        console.log(`Rate limit exceeded for IP: ${clientIP}`);
        return res.status(429).json({ error: 'Слишком много попыток авторизации. Попробуйте позже.' });
    }

    // Проверяем существующую сессию
    const existingSessionId = req.cookies.sessionId;
    if (existingSessionId && sessions.has(existingSessionId)) {
        const session = sessions.get(existingSessionId);
        if (session.expiresAt && Date.now() < session.expiresAt) {
            console.log('User already has a valid session, redirecting to main page');
            return res.redirect('/');
        }
    }

    const state = Math.random().toString(36).substring(7);
    const scopes = config.discord.scopes.join(' ');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;
    res.redirect(url);
});

// Обработка callback от Discord
router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        console.error('No code received from Discord');
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
                scope: config.discord.scopes.join(' '),
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        if (!tokens.access_token) {
            console.error('No access token received:', tokens);
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
            console.error('No user data received:', user);
            return res.redirect('/?error=no_user_data');
        }

        // Создание сессии
        const sessionId = Math.random().toString(36).substring(7);
        const session = {
            userId: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + SESSION_DURATION
        };

        // Сохраняем сессию
        sessions.set(sessionId, session);

        // Устанавливаем cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: SESSION_DURATION
        });

        // Отправляем HTML страницу, которая закроет окно авторизации и отправит сообщение родительскому окну
        res.send(`
            <html>
                <body>
                    <script>
                        window.opener.postMessage({
                            type: 'authSuccess',
                            sessionId: '${sessionId}',
                            user: ${JSON.stringify({
                                id: user.id,
                                username: user.username,
                                discriminator: user.discriminator,
                                avatar: user.avatar
                            })}
                        }, '*');
                        window.close();
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Error during Discord authentication:', error);
        res.redirect('/?error=auth_failed');
    }
});

// Проверка сессии
router.get('/session', (req, res) => {
    const sessionId = req.cookies.sessionId;
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.json({ authenticated: false });
    }

    const session = sessions.get(sessionId);

    // Проверяем срок действия сессии
    if (session.expiresAt && Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        res.clearCookie('sessionId');
        return res.json({ authenticated: false });
    }

    // Проверяем валидность токена Discord
    fetch('https://discord.com/api/users/@me', {
        headers: {
            Authorization: `Bearer ${session.accessToken}`,
        },
    }).then(response => {
        if (!response.ok) {
            console.log('Discord token invalid, removing session...');
            sessions.delete(sessionId);
            res.clearCookie('sessionId');
            return res.json({ authenticated: false });
        }

        res.json({
            authenticated: true,
            user: {
                id: session.userId,
                username: session.username,
                discriminator: session.discriminator,
                avatar: session.avatar,
            },
        });
    }).catch(error => {
        console.error('Error checking Discord token:', error);
        res.json({ authenticated: false });
    });
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
