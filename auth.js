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
    // Проверяем существующую сессию
    const existingSessionId = req.cookies.sessionId;
    if (existingSessionId && sessions.has(existingSessionId)) {
        console.log('User already has a valid session, redirecting to main page');
        return res.redirect('/');
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
        const sessionData = {
            userId: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
            createdAt: Date.now(),
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + (tokens.expires_in * 1000)
        };
        
        // Удаляем старую сессию пользователя, если она существует
        for (const [oldSessionId, oldSession] of sessions.entries()) {
            if (oldSession.userId === user.id) {
                sessions.delete(oldSessionId);
                console.log(`Removed old session ${oldSessionId} for user ${user.username}`);
            }
        }
        
        sessions.set(sessionId, sessionData);
        console.log(`Created new session ${sessionId} for user ${user.username}`);

        // Установка cookie
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
            path: '/', // Важно: указываем путь
            domain: '.onrender.com'
        });

        // Отправляем скрипт для закрытия окна и обновления родительского окна
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация успешна</title>
                <script>
                    function closeAndNotify() {
                        if (window.opener) {
                            window.opener.postMessage({ 
                                type: 'authSuccess', 
                                sessionId: '${sessionId}',
                                user: ${JSON.stringify({
                                    id: user.id,
                                    username: user.username,
                                    discriminator: user.discriminator,
                                    avatar: sessionData.avatar
                                })}
                            }, '*');
                            window.close();
                        } else {
                            window.location.href = '/';
                        }
                    }
                    // Даем время на установку cookie
                    setTimeout(closeAndNotify, 1000);
                </script>
            </head>
            <body>
                <p>Авторизация успешна. Закрытие окна...</p>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Ошибка при авторизации:', error);
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка авторизации</title>
                <script>
                    if (window.opener) {
                        window.opener.postMessage({ type: 'authError', error: '${error.message}' }, '*');
                        window.close();
                    } else {
                        window.location.href = '/?error=auth_failed';
                    }
                </script>
            </head>
            <body>
                <p>Произошла ошибка при авторизации. Закрытие окна...</p>
            </body>
            </html>
        `);
    }
});

// Проверка сессии
router.get('/session', (req, res) => {
    const sessionId = req.cookies.sessionId;
    console.log('Checking session:', sessionId);
    
    if (!sessionId) {
        console.log('No sessionId in cookies');
        return res.json({ authenticated: false });
    }

    const session = sessions.get(sessionId);
    console.log('Session data:', session);

    if (session) {
        // Проверяем, не истек ли токен
        if (session.expiresAt && Date.now() > session.expiresAt) {
            console.log('Session expired, removing...');
            sessions.delete(sessionId);
            res.clearCookie('sessionId', {
                domain: '.onrender.com',
                secure: true,
                httpOnly: true,
                path: '/'
            });
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
    } else {
        console.log('Session not found');
        res.json({ authenticated: false });
    }
});

// Выход из системы
router.post('/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        sessions.delete(sessionId);
        console.log(`Deleted session ${sessionId}`);
    }
    res.clearCookie('sessionId', {
        domain: '.onrender.com',
        secure: true,
        httpOnly: true
    });
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
