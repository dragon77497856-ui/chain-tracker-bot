// ================= TRON 資金追蹤 Bot v4.0 =================
// 整合 Supabase + 管理員系統
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

// 引入模組
const { setupRoutes } = require('./api/routes');
const { setupCommands } = require('./bot/commands');
const { setupCallbacks } = require('./bot/callbacks');
const { startMonitoring } = require('./bot/monitors');
const db = require('./utils/database');

// ================= 配置 =================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '';
const USE_POLLING = !PUBLIC_URL || PUBLIC_URL.startsWith('http://127') || PUBLIC_URL.startsWith('http://localhost');

// ================= 初始超級管理員 =================
const SUPER_ADMIN = '5666999482';

// ================= 共享數據存儲 =================
const store = {
    userSettings: {},
    userCache: {},
    userInputState: {},
    userData: {},
    balanceCache: {},
    dailyStats: {},
    admins: new Set(),
    superAdmins: new Set([SUPER_ADMIN]),
    users: new Set()
};

// ================= 初始化 Bot =================
const bot = new TelegramBot(BOT_TOKEN, { polling: USE_POLLING });

// ================= 初始化 HTTP Server =================
const server = http.createServer();

// ================= 啟動服務 =================
async function start() {
    console.log('🔎 TRON 資金追蹤 Bot v4.0 啟動中...');

    // 從 Supabase 載入資料
    try {
        const data = await db.loadData();
        if (data) {
            store.admins = new Set(data.admins || []);
            // 合併初始超級管理員
            const loadedSuperAdmins = new Set(data.superAdmins || []);
            loadedSuperAdmins.add(SUPER_ADMIN);
            store.superAdmins = loadedSuperAdmins;
            store.users = new Set(data.users || []);
            store.userData = data.userData || {};
            console.log(`✅ 已載入 ${store.users.size} 個用戶, ${store.admins.size} 個管理員`);
        }
    } catch (e) {
        console.error('載入資料失敗:', e.message);
    }

    // 設置模組
    setupRoutes(server, bot, BOT_TOKEN);
    setupCommands(bot, store, PUBLIC_URL, db);
    setupCallbacks(bot, store, PUBLIC_URL, db);

    // 啟動 HTTP 服務
    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`🚀 Server: http://0.0.0.0:${PORT}`);

        if (USE_POLLING) {
            console.log(`📡 使用 Polling 模式`);
            // 確保刪除舊的 webhook
            try {
                await bot.deleteWebHook();
            } catch (e) {}
        } else {
            // 設置 Webhook
            try {
                await bot.setWebHook(`${PUBLIC_URL}/webhook/${BOT_TOKEN}`);
                console.log(`🔗 Webhook 已設置: ${PUBLIC_URL}`);
            } catch (e) {
                console.error('Webhook 設置失敗:', e.message);
            }
        }
    });

    // 啟動監控
    startMonitoring(bot, store);

    console.log('✅ TRON 資金追蹤 Bot v4.0 已啟動！');
}

start();
