// ================= 按鈕回調處理 =================
const { shortAddr, formatRange, formatExactNumber, getDefaultSettings, escapeHtml } = require('../utils/helpers');
const { fetchFilteredTransactions, fetchAddressBalance } = require('../api/tron');
const { showAddressMonitor, buildOverviewMessage, buildMainKeyboard, MAX_FREE_ADDRESSES, isSuperAdmin, isAdmin } = require('./commands');

const PAGE_SIZE = 10;
const MAX_RESULTS = 500;

function setupCallbacks(bot, store, PUBLIC_URL, db) {
    const { userSettings, userCache, userInputState, userData, balanceCache, dailyStats } = store;

    function getUserData(userId) {
        if (!userData[userId]) userData[userId] = { addresses: [], membership: 'none' };
        return userData[userId];
    }

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const userId = String(query.from.id);
        const data = query.data;
        const messageId = query.message.message_id;

        try {
            // ================= 管理員功能 =================

            // 用戶管理
            if (data === 'settings_users') {
                if (!isAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '➕ 添加用戶', callback_data: 'user_add' }],
                        [{ text: '➖ 移除用戶', callback_data: 'user_remove' }],
                        [{ text: '◀️ 返回', callback_data: 'settings_back' }]
                    ]
                };
                await bot.editMessageText(`👤 <b>用戶管理</b>\n\n目前用戶數: ${store.users.size}`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                return bot.answerCallbackQuery(query.id);
            }

            // 用戶列表
            if (data === 'settings_userlist') {
                if (!isAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                let text = `📋 <b>用戶列表</b>\n\n`;
                const userArray = Array.from(store.users);
                if (userArray.length === 0) {
                    text += '尚無用戶';
                } else {
                    for (const uid of userArray.slice(0, 20)) {
                        let userName = uid;
                        try {
                            const chat = await bot.getChat(uid);
                            userName = chat.first_name + (chat.last_name ? ' ' + chat.last_name : '');
                            if (chat.username) userName += ` (@${chat.username})`;
                        } catch (e) {}
                        text += `• <b>${escapeHtml(userName)}</b>\n  ID: <code>${uid}</code>\n\n`;
                    }
                    if (userArray.length > 20) {
                        text += `...還有 ${userArray.length - 20} 個用戶`;
                    }
                }
                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '◀️ 返回', callback_data: 'settings_back' }]] }
                });
                return bot.answerCallbackQuery(query.id);
            }

            // 管理員管理（僅超級管理員）
            if (data === 'settings_admins') {
                if (!isSuperAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                let text = `👑 <b>管理員管理</b>\n\n`;
                text += `管理員數: ${store.admins.size}\n`;
                text += `超級管理員數: ${store.superAdmins.size}\n\n`;

                if (store.admins.size > 0) {
                    text += `<b>管理員列表:</b>\n`;
                    for (const uid of store.admins) {
                        let name = uid;
                        try {
                            const chat = await bot.getChat(uid);
                            name = chat.first_name || uid;
                        } catch (e) {}
                        text += `• ${escapeHtml(name)} (<code>${uid}</code>)\n`;
                    }
                }

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '➕ 添加管理員', callback_data: 'admin_add' }],
                        [{ text: '➖ 移除管理員', callback_data: 'admin_remove' }],
                        [{ text: '◀️ 返回', callback_data: 'settings_back' }]
                    ]
                };
                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                return bot.answerCallbackQuery(query.id);
            }

            // 添加用戶
            if (data === 'user_add') {
                if (!isAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                userInputState[userId] = { waiting: 'add_user' };
                await bot.sendMessage(chatId, '👇 請輸入要添加的用戶 UID');
                return bot.answerCallbackQuery(query.id);
            }

            // 移除用戶
            if (data === 'user_remove') {
                if (!isAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                const userArray = Array.from(store.users).slice(0, 10);
                if (userArray.length === 0) {
                    return bot.answerCallbackQuery(query.id, { text: '沒有可移除的用戶', show_alert: true });
                }
                const buttons = [];
                for (const uid of userArray) {
                    let name = uid;
                    try {
                        const chat = await bot.getChat(uid);
                        name = chat.first_name || uid;
                    } catch (e) {}
                    buttons.push([{ text: `${name} (${uid})`, callback_data: `deluser_${uid}` }]);
                }
                buttons.push([{ text: '◀️ 返回', callback_data: 'settings_users' }]);
                await bot.editMessageText('選擇要移除的用戶:', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: buttons }
                });
                return bot.answerCallbackQuery(query.id);
            }

            // 執行移除用戶
            if (data.startsWith('deluser_')) {
                if (!isAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                const uid = data.replace('deluser_', '');
                store.users.delete(uid);
                await db.saveData(store);
                await bot.answerCallbackQuery(query.id, { text: `✅ 已移除用戶 ${uid}`, show_alert: true });
                await bot.deleteMessage(chatId, messageId);
                return;
            }

            // 添加管理員
            if (data === 'admin_add') {
                if (!isSuperAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                userInputState[userId] = { waiting: 'add_admin' };
                await bot.sendMessage(chatId, '👇 請輸入要添加的管理員 UID');
                return bot.answerCallbackQuery(query.id);
            }

            // 移除管理員
            if (data === 'admin_remove') {
                if (!isSuperAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                const adminArray = Array.from(store.admins);
                if (adminArray.length === 0) {
                    return bot.answerCallbackQuery(query.id, { text: '沒有可移除的管理員', show_alert: true });
                }
                const buttons = [];
                for (const uid of adminArray) {
                    let name = uid;
                    try {
                        const chat = await bot.getChat(uid);
                        name = chat.first_name || uid;
                    } catch (e) {}
                    buttons.push([{ text: `${name} (${uid})`, callback_data: `deladmin_${uid}` }]);
                }
                buttons.push([{ text: '◀️ 返回', callback_data: 'settings_admins' }]);
                await bot.editMessageText('選擇要移除的管理員:', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: buttons }
                });
                return bot.answerCallbackQuery(query.id);
            }

            // 執行移除管理員
            if (data.startsWith('deladmin_')) {
                if (!isSuperAdmin(userId, store)) {
                    return bot.answerCallbackQuery(query.id, { text: '❌ 無權限', show_alert: true });
                }
                const uid = data.replace('deladmin_', '');
                store.admins.delete(uid);
                await db.saveData(store);
                await bot.answerCallbackQuery(query.id, { text: `✅ 已移除管理員 ${uid}`, show_alert: true });
                await bot.deleteMessage(chatId, messageId);
                return;
            }

            // 返回設置主頁
            if (data === 'settings_back') {
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '👤 用戶管理', callback_data: 'settings_users' }],
                        [{ text: '📋 用戶列表', callback_data: 'settings_userlist' }]
                    ]
                };
                if (isSuperAdmin(userId, store)) {
                    keyboard.inline_keyboard.push([{ text: '👑 管理員管理', callback_data: 'settings_admins' }]);
                }
                await bot.editMessageText('⚙️ <b>系統設置</b>', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                return bot.answerCallbackQuery(query.id);
            }

            // ================= 地址監控功能 =================

            // 添加監控地址
            if (data === 'monitor_add') {
                const user = getUserData(userId);
                if (user.addresses.length >= MAX_FREE_ADDRESSES) {
                    await bot.answerCallbackQuery(query.id, {
                        text: `❌ 已達到最大監控數量 (${MAX_FREE_ADDRESSES} 個)`,
                        show_alert: true
                    });
                    return;
                }
                userInputState[userId] = { waiting: 'add_address' };
                await bot.sendMessage(chatId, '👇 請發送要添加的地址');
                await bot.answerCallbackQuery(query.id);
                return;
            }

            // 刪除監控地址選單
            if (data === 'monitor_delete') {
                const user = getUserData(userId);
                if (user.addresses.length === 0) {
                    await bot.answerCallbackQuery(query.id, { text: '❌ 沒有可刪除的地址', show_alert: true });
                    return;
                }
                const buttons = user.addresses.map((addr, i) => ([
                    { text: `[${i + 1}] ${shortAddr(addr)}`, callback_data: `delete_${i}` }
                ]));
                buttons.push([{ text: '◀️ 返回', callback_data: 'monitor_refresh' }]);
                await bot.editMessageText('選擇要刪除的地址:', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: buttons }
                });
                await bot.answerCallbackQuery(query.id);
                return;
            }

            // 執行刪除地址
            if (data.startsWith('delete_')) {
                const index = parseInt(data.replace('delete_', ''));
                const user = getUserData(userId);
                if (index >= 0 && index < user.addresses.length) {
                    const deleted = user.addresses.splice(index, 1)[0];
                    await db.saveData(store);
                    await bot.answerCallbackQuery(query.id, {
                        text: `✅ 已刪除 ${shortAddr(deleted)}`,
                        show_alert: true
                    });
                }
                await bot.deleteMessage(chatId, messageId);
                await showAddressMonitor(bot, chatId, userId, store);
                return;
            }

            // 刷新監控列表
            if (data === 'monitor_refresh') {
                await bot.deleteMessage(chatId, messageId);
                await showAddressMonitor(bot, chatId, userId, store);
                await bot.answerCallbackQuery(query.id);
                return;
            }

            // 關閉監控面板
            if (data === 'monitor_close') {
                await bot.deleteMessage(chatId, messageId);
                await bot.answerCallbackQuery(query.id);
                return;
            }

            // 監控詳情
            if (data.startsWith('monitor_detail_')) {
                const address = data.replace('monitor_detail_', '');
                userCache[userId] = { address, txs: null, lastFetch: 0 };
                if (!userSettings[userId]) userSettings[userId] = getDefaultSettings();
                const loadingMsg = await bot.sendMessage(chatId, '⏳ 正在查詢...');
                try {
                    const settings = userSettings[userId];
                    const statsSettings = { mode: 'simple', unified: { min: 0, max: 0 } };
                    const [balanceInfo, recentTxs, allTxs] = await Promise.all([
                        fetchAddressBalance(address),
                        fetchFilteredTransactions(address, 10, settings),
                        fetchFilteredTransactions(address, 100, statsSettings)
                    ]);
                    const message = buildOverviewMessage(address, recentTxs, settings, balanceInfo, allTxs);
                    const keyboard = buildMainKeyboard(address, PUBLIC_URL);
                    await bot.deleteMessage(chatId, loadingMsg.message_id);
                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'HTML',
                        reply_markup: keyboard,
                        disable_web_page_preview: true
                    });
                } catch (e) {
                    await bot.editMessageText('❌ 查詢失敗: ' + e.message, {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id
                    });
                }
                await bot.answerCallbackQuery(query.id);
                return;
            }

            // ================= 交易查詢功能 =================

            // 完整列表（分頁）
            if (data.startsWith('list_')) {
                const parts = data.split('_');
                const address = parts[1];
                const page = parseInt(parts[2]) || 1;
                await handleListView(bot, chatId, userId, address, page, messageId, store, PUBLIC_URL);
            }

            // 範圍設置菜單
            else if (data.startsWith('range_')) {
                const address = data.replace('range_', '');
                await handleRangeMenu(bot, chatId, userId, address, messageId, store);
            }

            // 進階設置菜單
            else if (data.startsWith('advanced_')) {
                const address = data.replace('advanced_', '');
                await handleAdvancedMenu(bot, chatId, userId, address, messageId, store);
            }

            // 簡易模式
            else if (data.startsWith('simple_')) {
                const address = data.replace('simple_', '');
                userSettings[userId].mode = 'simple';
                await handleRangeMenu(bot, chatId, userId, address, messageId, store);
            }

            // 設置最小值
            else if (data.startsWith('setmin_')) {
                const parts = data.split('_');
                const type = parts[1], address = parts[2];
                userInputState[userId] = { waiting: `${type}_min`, address };
                await bot.sendMessage(chatId, `✏️ 請輸入${type === 'unified' ? '統一' : type.toUpperCase()}最小值\n\n輸入 0 表示不限制`);
            }

            // 設置最大值
            else if (data.startsWith('setmax_')) {
                const parts = data.split('_');
                const type = parts[1], address = parts[2];
                userInputState[userId] = { waiting: `${type}_max`, address };
                await bot.sendMessage(chatId, `✏️ 請輸入${type === 'unified' ? '統一' : type.toUpperCase()}最大值\n\n輸入 0 表示無上限`);
            }

            // 返回/刷新
            else if (data.startsWith('back_')) {
                await handleRefresh(bot, chatId, userId, data.replace('back_', ''), messageId, store, PUBLIC_URL);
            }
            else if (data.startsWith('refresh_')) {
                await handleRefresh(bot, chatId, userId, data.replace('refresh_', ''), messageId, store, PUBLIC_URL);
            }

            // 空操作
            else if (data === 'noop') {}

            await bot.answerCallbackQuery(query.id);
        } catch (e) {
            console.error('Callback error:', e);
            await bot.answerCallbackQuery(query.id, { text: '❌ 操作失敗' });
        }
    });
}

// 完整列表視圖
async function handleListView(bot, chatId, userId, address, page, messageId, store, PUBLIC_URL) {
    const { userSettings, userCache } = store;
    const settings = userSettings[userId] || getDefaultSettings();

    await bot.editMessageText('⏳ 正在載入交易記錄...', { chat_id: chatId, message_id: messageId });

    try {
        let txs;
        const cache = userCache[userId];

        if (cache && cache.address === address && cache.txs && Date.now() - cache.lastFetch < 60000) {
            txs = cache.txs;
        } else {
            txs = await fetchFilteredTransactions(address, MAX_RESULTS, settings, true);
            userCache[userId] = { address, txs, lastFetch: Date.now() };
        }

        const totalPages = Math.ceil(txs.length / PAGE_SIZE) || 1;
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const startIdx = (currentPage - 1) * PAGE_SIZE;
        const pageTxs = txs.slice(startIdx, startIdx + PAGE_SIZE);

        let rangeStr = settings.mode === 'simple'
            ? `所有 ${formatRange(settings.unified.min, settings.unified.max)}`
            : `USDT ${formatRange(settings.usdt.min, settings.usdt.max)} | TRX ${formatRange(settings.trx.min, settings.trx.max)}`;

        let message = `📋 <b>半年內交易記錄</b>\n`;
        message += `📍 <code>${address}</code>\n`;
        message += `📐 ${rangeStr}\n`;
        message += `📊 共 ${txs.length} 筆（第 ${currentPage}/${totalPages} 頁）\n\n`;

        if (pageTxs.length === 0) {
            message += `無符合條件的交易記錄`;
        } else {
            message += `<code>|   時間    |  類型 | 地址 | 金額</code>\n`;
            pageTxs.forEach((tx) => {
                const type = tx.direction === 'out' ? '支出' : '收入';
                const shortTime = tx.time.replace(/\d{4}\//, '').replace(/\s*(上午|下午)/, ' ');
                const exactAmount = formatExactNumber(tx.rawAmount) + ' ' + tx.token;
                message += `<blockquote><code>|${shortTime} |${type}|    |${exactAmount}</code></blockquote><code>${tx.otherAddr}</code>\n`;
            });
        }

        const navButtons = [];
        if (currentPage > 1) navButtons.push({ text: '⬅️ 上一頁', callback_data: `list_${address}_${currentPage - 1}` });
        navButtons.push({ text: `${currentPage} / ${totalPages}`, callback_data: 'noop' });
        if (currentPage < totalPages) navButtons.push({ text: '下一頁 ➡️', callback_data: `list_${address}_${currentPage + 1}` });

        const keyboard = {
            inline_keyboard: [
                navButtons,
                [
                    { text: '⚙️ 設置範圍', callback_data: `range_${address}` },
                    { text: '◀️ 返回', callback_data: `back_${address}` }
                ]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
    } catch (e) {
        await bot.editMessageText('❌ 載入失敗: ' + e.message, { chat_id: chatId, message_id: messageId });
    }
}

// 範圍設置菜單
async function handleRangeMenu(bot, chatId, userId, address, messageId, store) {
    const { userSettings } = store;
    const settings = userSettings[userId] || getDefaultSettings();
    userSettings[userId] = settings;
    settings.mode = 'simple';

    const message = `⚙️ <b>範圍設置</b>\n\n當前模式：統一範圍\n所有幣種：${formatRange(settings.unified.min, settings.unified.max)}`;
    const keyboard = {
        inline_keyboard: [
            [{ text: `✏️ 設置最小值（當前：${settings.unified.min}）`, callback_data: `setmin_unified_${address}` }],
            [{ text: `✏️ 設置最大值（當前：${settings.unified.max || '無上限'}）`, callback_data: `setmax_unified_${address}` }],
            [
                { text: '🔧 進階設置', callback_data: `advanced_${address}` },
                { text: '◀️ 返回', callback_data: `back_${address}` }
            ]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// 進階設置菜單
async function handleAdvancedMenu(bot, chatId, userId, address, messageId, store) {
    const { userSettings } = store;
    const settings = userSettings[userId] || getDefaultSettings();
    userSettings[userId] = settings;
    settings.mode = 'advanced';

    const message = `⚙️ <b>進階範圍設置</b>\n\n💵 USDT：${formatRange(settings.usdt.min, settings.usdt.max)}\n💎 TRX：${formatRange(settings.trx.min, settings.trx.max)}`;
    const keyboard = {
        inline_keyboard: [
            [{ text: '── 💵 USDT ──', callback_data: 'noop' }],
            [
                { text: `✏️ 最小（${settings.usdt.min}）`, callback_data: `setmin_usdt_${address}` },
                { text: `✏️ 最大（${settings.usdt.max || '無上限'}）`, callback_data: `setmax_usdt_${address}` }
            ],
            [{ text: '── 💎 TRX ──', callback_data: 'noop' }],
            [
                { text: `✏️ 最小（${settings.trx.min}）`, callback_data: `setmin_trx_${address}` },
                { text: `✏️ 最大（${settings.trx.max || '無上限'}）`, callback_data: `setmax_trx_${address}` }
            ],
            [
                { text: '📋 簡易模式', callback_data: `simple_${address}` },
                { text: '◀️ 返回', callback_data: `back_${address}` }
            ]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// 刷新
async function handleRefresh(bot, chatId, userId, address, messageId, store, PUBLIC_URL) {
    const { userSettings, userCache } = store;
    const settings = userSettings[userId] || getDefaultSettings();

    await bot.editMessageText('⏳ 正在刷新...', { chat_id: chatId, message_id: messageId });
    if (userCache[userId]) userCache[userId].txs = null;

    try {
        const statsSettings = { mode: 'simple', unified: { min: 0, max: 0 } };
        const [balanceInfo, recentTxs, allTxs] = await Promise.all([
            fetchAddressBalance(address),
            fetchFilteredTransactions(address, 10, settings),
            fetchFilteredTransactions(address, 100, statsSettings)
        ]);
        const message = buildOverviewMessage(address, recentTxs, settings, balanceInfo, allTxs);
        const keyboard = buildMainKeyboard(address, PUBLIC_URL);
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
    } catch (e) {
        await bot.editMessageText('❌ 刷新失敗: ' + e.message, { chat_id: chatId, message_id: messageId });
    }
}

module.exports = { setupCallbacks };
