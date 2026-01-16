// ================= Supabase 資料庫 =================
const https = require('https');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hqbznevamhbmpevmwjuw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_secret_PzVNgx38g3Px1YgXEsAUGg_x8L0wrzz';
const BOT_ID = 'chain_tracker_bot';

async function supabaseRequest(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400 && res.statusCode !== 404) {
                    reject(new Error(`Supabase error: ${res.statusCode} - ${data}`));
                    return;
                }
                try {
                    resolve(data ? JSON.parse(data) : null);
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function loadData() {
    try {
        const result = await supabaseRequest('GET', `bot_data?bot_id=eq.${BOT_ID}&select=data`);
        if (result && result.length > 0) {
            return result[0].data;
        }
        return null;
    } catch (e) {
        console.error('loadData error:', e.message);
        return null;
    }
}

async function saveData(store) {
    const data = {
        admins: Array.from(store.admins),
        superAdmins: Array.from(store.superAdmins),
        users: Array.from(store.users),
        userData: store.userData
    };

    try {
        // 嘗試更新
        const existing = await supabaseRequest('GET', `bot_data?bot_id=eq.${BOT_ID}&select=id`);
        if (existing && existing.length > 0) {
            await supabaseRequest('PATCH', `bot_data?bot_id=eq.${BOT_ID}`, {
                data,
                updated_at: new Date().toISOString()
            });
        } else {
            await supabaseRequest('POST', 'bot_data', {
                bot_id: BOT_ID,
                data,
                updated_at: new Date().toISOString()
            });
        }
        return true;
    } catch (e) {
        console.error('saveData error:', e.message);
        return false;
    }
}

// ================= 母機器權限檢查 =================
// 連接母機器的 Supabase 檢查 permissions 表
async function checkPermission(telegramId, botName = 'chain-tracker-bot') {
    try {
        // 先檢查是否有全部機器人權限 (*)
        const allPerms = await supabaseRequest('GET',
            `permissions?telegram_id=eq.${telegramId}&bot_name=eq.*&select=expires_at`);

        if (allPerms && allPerms.length > 0) {
            const perm = allPerms[0];
            // 檢查是否過期
            if (!perm.expires_at || new Date(perm.expires_at) > new Date()) {
                return { hasPermission: true, expiresAt: perm.expires_at };
            }
        }

        // 檢查特定機器人權限
        const botPerms = await supabaseRequest('GET',
            `permissions?telegram_id=eq.${telegramId}&bot_name=eq.${botName}&select=expires_at`);

        if (botPerms && botPerms.length > 0) {
            const perm = botPerms[0];
            if (!perm.expires_at || new Date(perm.expires_at) > new Date()) {
                return { hasPermission: true, expiresAt: perm.expires_at };
            }
        }

        return { hasPermission: false, expiresAt: null };
    } catch (e) {
        console.error('checkPermission error:', e.message);
        return { hasPermission: false, expiresAt: null };
    }
}

// 檢查是否為管理員（從母機器的 admins 表）
async function checkIsAdmin(telegramId) {
    try {
        const result = await supabaseRequest('GET',
            `admins?telegram_id=eq.${telegramId}&select=telegram_id`);
        return result && result.length > 0;
    } catch (e) {
        console.error('checkIsAdmin error:', e.message);
        return false;
    }
}

module.exports = {
    loadData,
    saveData,
    checkPermission,
    checkIsAdmin
};
