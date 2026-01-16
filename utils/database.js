// ================= Supabase 資料庫 =================
const https = require('https');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://npafcozxfnzvrbapvpgh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wYWZjb3p4Zm56dnJiYXB2cGdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MjI1MjksImV4cCI6MjA2NTE5ODUyOX0.e49B4cUkmzcBPFLmONYCv3qKMEH7vOIl8T8pjxmJLMw';
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

module.exports = {
    loadData,
    saveData
};
