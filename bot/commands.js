// ================= Bot 命令 =================
const { shortAddr, formatNumber, formatExactNumber, formatRange, formatWalletDate, getDefaultSettings, escapeHtml } = require('../utils/helpers');
const { fetchAddressBalance, fetchFilteredTransactions } = require('../api/tron');

const MAX_FREE_ADDRESSES = 5;
const SUPER_ADMIN = '5666999482';
const MEMBER_BOT_LINK = 'https://t.me/YOUR_MEMBER_BOT'; // 母機器連結

// 無權限提示訊息
const NO_PERMISSION_MSG = `❌ <b>您尚未開通會員</b>

此功能需要會員權限才能使用。

請前往會員管理中心購買會員：
👉 @TronMemberBot

購買後即可使用所有功能！`;

// 主鍵盤
const mainKeyboard = {
    keyboard: [[{ text: '📍 地址監控' }, { text: '📈 圖表' }, { text: '👤 個人中心' }]],
    resize_keyboard: true,
    persistent: true
};

// 權限檢查（本地快取 + 母機器檢查）
function isSuperAdmin(userId) {
    return String(userId) === SUPER_ADMIN;
}

function isAdmin(userId, store) {
    return store.admins.has(String(userId)) || isSuperAdmin(userId);
}

// 檢查用戶是否有權限（從母機器 Supabase）
async function hasPermission(userId, db) {
    // 超級管理員直接通過
    if (isSuperAdmin(userId)) return true;

    // 檢查是否為管理員（從母機器 admins 表）
    const isAdminUser = await db.checkIsAdmin(String(userId));
    if (isAdminUser) return true;

    // 檢查母機器權限（permissions 表）
    const result = await db.checkPermission(String(userId), 'chain-tracker-bot');
    return result.hasPermission;
}

// 構建總覽消息
function buildOverviewMessage(address, recentTxs, settings, balanceInfo = null, allTxs = []) {
    let message = `🏦 <b>錢包查詢</b>\n\n📍 地址: <code>${address}</code>\n`;

    // 顯示餘額
    if (balanceInfo) {
        message += `💰 餘額\n`;
        message += `<code>   USDT: </code><b>${formatExactNumber(balanceInfo.usdt)}</b>\n`;
        message += `<code>   TRX:  </code><b>${formatExactNumber(balanceInfo.trx)}</b>\n`;
    }

    // 計算 30 天內 USDT 支出和收入
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let usdtIn = 0, usdtOut = 0;
    allTxs.forEach(tx => {
        if (tx.token === 'USDT' && tx.timestamp >= thirtyDaysAgo) {
            if (tx.direction === 'in') usdtIn += tx.rawAmount;
            else usdtOut += tx.rawAmount;
        }
    });
    message += `📊 30天活動\n`;
    message += `<code>   支出: </code><b>${formatExactNumber(usdtOut)}</b>\n`;
    message += `<code>   收入: </code><b>${formatExactNumber(usdtIn)}</b>\n`;

    if (balanceInfo && balanceInfo.createTime) {
        message += `📆 創建時間: ${formatWalletDate(balanceInfo.createTime)}\n`;
    }

    if (recentTxs.length > 0) message += `⏰ 最後活動: ${recentTxs[0].time}\n`;

    let rangeStr = settings.mode === 'simple'
        ? `所有 ${formatRange(settings.unified.min, settings.unified.max)}`
        : `USDT ${formatRange(settings.usdt.min, settings.usdt.max)} | TRX ${formatRange(settings.trx.min, settings.trx.max)}`;

    if (recentTxs.length === 0) {
        message += `\n無符合條件的交易\n`;
    } else {
        message += `\n<code>|   時間    |  類型 | 地址 | 金額</code>（第1頁）\n`;
        recentTxs.forEach((tx) => {
            const type = tx.direction === 'out' ? '支出' : '收入';
            const shortTime = tx.time.replace(/\d{4}\//, '').replace(/\s*(上午|下午)/, ' ');
            const exactAmount = formatExactNumber(tx.rawAmount) + ' ' + tx.token;
            message += `<blockquote><code>|${shortTime} |${type}|    |${exactAmount}</code></blockquote><code>${tx.otherAddr}</code>\n`;
        });
    }
    return message;
}

// 構建主鍵盤（第一頁）
function buildMainKeyboard(address, PUBLIC_URL) {
    return {
        inline_keyboard: [
            [
                { text: '下一頁 ➡️', callback_data: `list_${address}_2` },
                { text: '⚙️ 設置範圍', callback_data: `range_${address}` }
            ]
        ]
    };
}

// 設置命令處理
function setupCommands(bot, store, PUBLIC_URL, db) {
    const { userSettings, userCache, userInputState, userData, balanceCache, dailyStats } = store;

    function getUserData(userId) {
        if (!userData[userId]) userData[userId] = { addresses: [], membership: 'none' };
        return userData[userId];
    }

    // /start 命令
    bot.onText(/\/start/, async (msg) => {
        const userId = String(msg.from.id);

        // 自動加入用戶列表
        if (!store.users.has(userId) && !isAdmin(userId, store)) {
            store.users.add(userId);
            await db.saveData(store);
        }

        bot.sendMessage(msg.chat.id,
            `🔍 <b>TRON 錢包追蹤器</b>\n\n` +
            `追蹤任意地址的資產與交易記錄\n\n` +
            `<b>使用方法：</b>\n直接發送地址即可查詢\n\n` +
            `<b>功能：</b>\n` +
            `• 📋 近10筆交易記錄\n` +
            `• 📈 可視化資金流向圖\n` +
            `• ⚙️ 自定金額範圍過濾\n` +
            `• 📄 分頁瀏覽半年內交易\n` +
            `• 📍 地址監控（餘額追蹤）`,
            { parse_mode: 'HTML', reply_markup: mainKeyboard }
        );
    });

    // /settings 命令（管理員專用）
    bot.onText(/\/settings/, async (msg) => {
        const userId = String(msg.from.id);
        if (!isAdmin(userId, store)) {
            return bot.sendMessage(msg.chat.id, '❌ 此功能僅限管理員使用');
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '👤 用戶管理', callback_data: 'settings_users' }],
                [{ text: '📋 用戶列表', callback_data: 'settings_userlist' }]
            ]
        };

        // 超級管理員可見的選項
        if (isSuperAdmin(userId, store)) {
            keyboard.inline_keyboard.push(
                [{ text: '👑 管理員管理', callback_data: 'settings_admins' }]
            );
        }

        await bot.sendMessage(msg.chat.id, '⚙️ <b>系統設置</b>', {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    });

    // /track 命令
    bot.onText(/\/track(?:\s+(\S+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const address = match[1];

        // 檢查權限
        const hasPerm = await hasPermission(userId, db);
        if (!hasPerm) {
            return bot.sendMessage(chatId, NO_PERMISSION_MSG, { parse_mode: 'HTML' });
        }

        if (!address) {
            return bot.sendMessage(chatId, '❌ 請提供地址\n\n示例：<code>/track TXyz...</code>', { parse_mode: 'HTML' });
        }
        if (!address.startsWith('T') || address.length !== 34) {
            return bot.sendMessage(chatId, '❌ 無效的 TRON 地址');
        }
        await handleTrackAddress(bot, chatId, userId, address, store, PUBLIC_URL);
    });

    // 地址監控按鈕
    bot.onText(/📍 地址監控/, async (msg) => {
        // 檢查權限
        const hasPerm = await hasPermission(msg.from.id, db);
        if (!hasPerm) {
            return bot.sendMessage(msg.chat.id, NO_PERMISSION_MSG, { parse_mode: 'HTML' });
        }
        await showAddressMonitor(bot, msg.chat.id, msg.from.id, store);
    });

    // 個人中心按鈕
    bot.onText(/👤 個人中心/, async (msg) => {
        await showUserCenter(bot, msg.chat.id, msg.from, store);
    });

    // 圖表按鈕
    bot.onText(/📈 圖表/, async (msg) => {
        const userId = msg.from.id;
        const cache = userCache[userId];
        if (cache && cache.address) {
            const chartUrl = `${PUBLIC_URL}/chart?address=${cache.address}`;
            await bot.sendMessage(msg.chat.id, `📈 <b>可視化圖表</b>\n\n<a href="${chartUrl}">點擊查看 ${cache.address.slice(0, 8)}... 的資金流向圖</a>`, {
                parse_mode: 'HTML',
                disable_web_page_preview: false
            });
        } else {
            await bot.sendMessage(msg.chat.id, '❌ 請先查詢一個地址');
        }
    });

    // 處理用戶輸入
    bot.on('message', async (msg) => {
        if (!msg.text) return;
        if (msg.text.startsWith('/')) return;
        if (msg.text === '📍 地址監控' || msg.text === '👤 個人中心' || msg.text === '📈 圖表') return;

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.trim();
        const inputState = userInputState[userId];

        // 處理添加地址
        if (inputState && inputState.waiting === 'add_address') {
            if (!text.startsWith('T') || text.length !== 34) {
                return bot.sendMessage(chatId, '❌ 無效的 TRON 地址，請重新輸入');
            }
            const user = getUserData(userId);
            if (user.addresses.includes(text)) {
                userInputState[userId] = null;
                return bot.sendMessage(chatId, '❌ 該地址已在監控列表中');
            }
            user.addresses.push(text);
            userInputState[userId] = null;
            balanceCache[text] = { addedAt: Date.now(), lastCheck: Date.now() };
            initDailyStats(text, dailyStats);
            await db.saveData(store);
            await bot.sendMessage(chatId, `✅ 已添加地址: <code>${shortAddr(text)}</code>`, { parse_mode: 'HTML' });
            await showAddressMonitor(bot, chatId, userId, store);
            return;
        }

        // 處理添加用戶 UID
        if (inputState && inputState.waiting === 'add_user') {
            const uid = text.trim();
            if (!/^\d+$/.test(uid)) {
                return bot.sendMessage(chatId, '❌ 請輸入有效的用戶 UID（純數字）');
            }
            store.users.add(uid);
            userInputState[userId] = null;
            await db.saveData(store);
            await bot.sendMessage(chatId, `✅ 已添加用戶: <code>${uid}</code>`, { parse_mode: 'HTML' });
            return;
        }

        // 處理添加管理員 UID
        if (inputState && inputState.waiting === 'add_admin') {
            const uid = text.trim();
            if (!/^\d+$/.test(uid)) {
                return bot.sendMessage(chatId, '❌ 請輸入有效的用戶 UID（純數字）');
            }
            store.admins.add(uid);
            userInputState[userId] = null;
            await db.saveData(store);
            await bot.sendMessage(chatId, `✅ 已添加管理員: <code>${uid}</code>`, { parse_mode: 'HTML' });
            return;
        }

        // 處理範圍設置輸入
        if (inputState && inputState.waiting && inputState.waiting.includes('_')) {
            const value = parseInt(text);
            if (isNaN(value) || value < 0) {
                return bot.sendMessage(chatId, '❌ 請輸入有效的數字（≥0）');
            }
            const [type, minmax] = inputState.waiting.split('_');
            const settings = userSettings[userId] || getDefaultSettings();

            if (type === 'unified') settings.unified[minmax] = value;
            else if (type === 'usdt') { settings.usdt[minmax] = value; settings.mode = 'advanced'; }
            else if (type === 'trx') { settings.trx[minmax] = value; settings.mode = 'advanced'; }

            userSettings[userId] = settings;
            userInputState[userId] = null;
            if (userCache[userId]) userCache[userId].txs = null;

            const rangeStr = type === 'unified'
                ? formatRange(settings.unified.min, settings.unified.max)
                : formatRange(settings[type].min, settings[type].max);

            await bot.sendMessage(chatId,
                `✅ ${type === 'unified' ? '統一' : type.toUpperCase()}範圍已設置：${rangeStr}\n\n請點擊「返回」查看結果`,
                { reply_markup: { inline_keyboard: [[{ text: '◀️ 返回', callback_data: `back_${inputState.address}` }]] } }
            );
            return;
        }

        // 直接發送地址查詢
        if (text.startsWith('T') && text.length === 34) {
            // 檢查權限
            const hasPerm = await hasPermission(userId, db);
            if (!hasPerm) {
                return bot.sendMessage(chatId, NO_PERMISSION_MSG, { parse_mode: 'HTML' });
            }
            await handleTrackAddress(bot, chatId, userId, text, store, PUBLIC_URL);
            return;
        }
    });
}

// 處理地址查詢
async function handleTrackAddress(bot, chatId, userId, address, store, PUBLIC_URL) {
    const { userSettings, userCache } = store;

    if (!userSettings[userId]) userSettings[userId] = getDefaultSettings();
    const loadingMsg = await bot.sendMessage(chatId, '⏳ 正在查詢鏈上數據...');

    try {
        const settings = userSettings[userId];
        // 並行獲取餘額和交易記錄（獲取更多用於 30 天統計）
        const statsSettings = { mode: 'simple', unified: { min: 0, max: 0 } };
        const [balanceInfo, recentTxs, allTxs] = await Promise.all([
            fetchAddressBalance(address),
            fetchFilteredTransactions(address, 10, settings),
            fetchFilteredTransactions(address, 100, statsSettings)
        ]);
        userCache[userId] = { address, txs: null, lastFetch: 0 };
        const message = buildOverviewMessage(address, recentTxs, settings, balanceInfo, allTxs);
        const keyboard = buildMainKeyboard(address, PUBLIC_URL);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
    } catch (e) {
        console.error('Track error:', e);
        await bot.editMessageText('❌ 查詢失敗: ' + e.message, {
            chat_id: chatId,
            message_id: loadingMsg.message_id
        });
    }
}

// 顯示地址監控
async function showAddressMonitor(bot, chatId, userId, store) {
    const { userData, balanceCache, dailyStats } = store;

    function getUserData(id) {
        if (!userData[id]) userData[id] = { addresses: [], membership: 'none' };
        return userData[id];
    }

    const user = getUserData(userId);
    const addresses = user.addresses;
    let message = `📍 <b>地址監控</b>\n🔔 狀態: 運行中 \n\n`;

    if (addresses.length === 0) {
        message += `尚未添加任何監控地址\n\n請點擊「添加地址」或直接發送地址`;
    } else {
        let totalUsdt = 0, totalTrx = 0, totalIncome = 0, totalExpense = 0;

        for (let i = 0; i < addresses.length; i++) {
            const addr = addresses[i];
            if (i > 0) await new Promise(r => setTimeout(r, 500));
            const balance = await fetchAddressBalance(addr);

            if (!balanceCache[addr]) {
                balanceCache[addr] = { addedAt: Date.now(), lastCheck: Date.now() };
            }

            const today = new Date().toISOString().slice(0, 10);
            let stats = dailyStats[addr];

            if (!stats || stats.date !== today || (stats.income === 0 && stats.expense === 0)) {
                await new Promise(r => setTimeout(r, 300));
                stats = { date: today, income: 0, expense: 0 };
                const recentTxs = await fetchFilteredTransactions(addr, 50, { mode: 'simple', unified: { min: 0, max: 0 } }, false);
                const todayStart = new Date(today).getTime();
                recentTxs.forEach(tx => {
                    if (tx.timestamp >= todayStart && tx.token === 'USDT') {
                        if (tx.direction === 'in') stats.income += tx.rawAmount;
                        else stats.expense += tx.rawAmount;
                    }
                });
                dailyStats[addr] = stats;
            }

            message += `<b>[${i + 1}]</b> 監控中\n<blockquote><code>${addr}</code></blockquote>`;
            message += `   💰 ${formatNumber(balance.usdt)} USDT | ${formatNumber(balance.trx)} TRX\n`;
            message += `   📈 +${formatNumber(stats.income)} | 📉 -${formatNumber(stats.expense)}\n`;
            totalUsdt += balance.usdt;
            totalTrx += balance.trx;
            totalIncome += stats.income;
            totalExpense += stats.expense;
        }
        message += `\n━━━ 今日總計 ━━━\n`;
        message += `💰 餘額: ${formatNumber(totalUsdt)} USDT\n`;
        message += `📈 收入: ${formatNumber(totalIncome)} USDT\n`;
        message += `📉 支出: ${formatNumber(totalExpense)} USDT\n`;
        message += `💵 利潤: ${formatNumber(totalIncome - totalExpense)} USDT`;
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: '➕ 添加地址', callback_data: 'monitor_add' },
                { text: '🗑️ 刪除地址', callback_data: 'monitor_delete' }
            ],
            [{ text: '🔄 刷新列表', callback_data: 'monitor_refresh' }],
            [{ text: '❌ 關閉', callback_data: 'monitor_close' }]
        ]
    };

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        disable_web_page_preview: true
    });
}

// 顯示個人中心
async function showUserCenter(bot, chatId, fromUser, store) {
    const { userData } = store;

    function getUserData(id) {
        if (!userData[id]) userData[id] = { addresses: [], membership: 'none' };
        return userData[id];
    }

    const userId = fromUser.id;
    const user = getUserData(userId);
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Taipei'
    });
    const userName = escapeHtml(fromUser.first_name + (fromUser.last_name ? ' ' + fromUser.last_name : ''));

    let role = '一般用戶';
    if (isSuperAdmin(userId, store)) role = '超級管理員';
    else if (isAdmin(userId, store)) role = '管理員';

    let message = `🕐 當前時間: ${timeStr}\n\n`;
    message += `用戶: ${userName}\n`;
    message += `用戶ID: ${userId}\n`;
    message += `身份: ${role}\n`;
    message += `可監控地址數: ${MAX_FREE_ADDRESSES}\n`;
    message += `當前監控地址數: ${user.addresses.length}`;

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: mainKeyboard });
}

// 初始化每日統計
function initDailyStats(address, dailyStats) {
    dailyStats[address] = {
        date: new Date().toISOString().slice(0, 10),
        income: 0,
        expense: 0
    };
}

module.exports = {
    setupCommands,
    handleTrackAddress,
    showAddressMonitor,
    showUserCenter,
    buildOverviewMessage,
    buildMainKeyboard,
    mainKeyboard,
    MAX_FREE_ADDRESSES,
    isSuperAdmin,
    isAdmin,
    hasPermission
};
