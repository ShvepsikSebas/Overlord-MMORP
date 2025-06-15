const admin = require('firebase-admin');

// Инициализация Firebase
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

// Инициализируем Firebase только если еще не инициализирован
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.DATABASE_URL
    });
}

const db = admin.database();

module.exports = {
    admin,
    db
}; 