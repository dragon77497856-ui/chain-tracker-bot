// ================= 地址監控邏輯 =================
const { fetchAddressBalance, fetchFilteredTransactions } = require('../api/tron');

const MONITOR_INTERVAL = 30000;
let monitorTimer = null;

function startMonitoring(bot, store) {
    if (monitorTimer) return;
    console.log('🔔 交易監控已啟動');
    monitorTimer = setInterval(() => checkAllAddresses(bot, store), MONITOR_INTERVAL);
    setTimeout(() => checkAllAddresses(bot, store), 10000);
}

function stopMonitoring() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
        console.log('🔔 交易監控已停止');
    }
}

function getAllMonitoredAddresses(userData) {
    const map = new Map();
    for (const userId of Object.keys(userData)) {
        const user = userData[userId];
        if (!user.addresses || user.addresses.length === 0) continue;
        for (const addr of user.addresses) {
            if (!map.has(addr)) map.set(addr, []);
            map.get(addr).push(userId);
        }
    }
    return map;
}

async function checkAllAddresses(bot, store) {
    const { userData } = store;
    const map = getAllMonitoredAddresses(userData);
    const addrs = Array.from(map.keys());

    if (addrs.length === 0) return;

    for (const addr of addrs) {
        try {
            await checkAddressTransactions(bot, addr, map.get(addr), store);
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error(`監控失敗:`, e.message);
        }
    }
}

async function checkAddressTransactions(bot, address, userIds, store) {
    const { balanceCache, dailyStats } = store;

    if (!balanceCache[address]) {
        balanceCache[address] = { addedAt: Date.now(), lastCheck: Date.now() };
        initDailyStats(address, dailyStats);
        return;
    }

    const cache = balanceCache[address];
    const recentTxs = await fetchRecentTransactions(address, 10);

    if (recentTxs.length === 0) return;

    const newTxs = recentTxs.filter(tx =>
        tx.timestamp > cache.addedAt &&
        tx.timestamp > cache.lastCheck &&
        tx.rawAmount >= 1
    );

    if (newTxs.length === 0) return;

    const balance = await fetchAddressBalance(address);
    newTxs.sort((a, b) => a.timestamp - b.timestamp);

    for (const tx of newTxs) {
        updateDailyStats(address, tx, dailyStats);
        for (const userId of userIds) {
            await sendTransactionAlert(bot, userId, address, tx, balance, dailyStats);
        }
    }

    cache.lastCheck = Date.now();
}

function initDailyStats(address, dailyStats) {
    dailyStats[address] = {
        date: new Date().toISOString().slice(0, 10),
        income: 0,
        expense: 0
    };
}

function updateDailyStats(address, tx, dailyStats) {
    const today = new Date().toISOString().slice(0, 10);

    if (!dailyStats[address] || dailyStats[address].date !== today) {
        dailyStats[address] = { date: today, income: 0, expense: 0 };
    }

    if (tx.token === 'USDT') {
        if (tx.direction === 'in') dailyStats[address].income += tx.rawAmount;
        else dailyStats[address].expense += tx.rawAmount;
    }
}

async function fetchRecentTransactions(address, limit = 5) {
    return await fetchFilteredTransactions(address, limit, {
        mode: 'simple',
        unified: { min: 0, max: 0 }
    }, false);
}

async function sendTransactionAlert(bot, userId, address, tx, balance, dailyStats) {
    const isOut = tx.direction === 'out';
    const today = new Date().toISOString().slice(0, 10);

    let stats = dailyStats[address];
    if (!stats || stats.date !== today) {
        stats = { date: today, income: 0, expense: 0 };
        const recentTxs = await fetchRecentTransactions(address, 50);
        const todayStart = new Date(today).getTime();
        recentTxs.forEach(t => {
            if (t.timestamp >= todayStart && t.token === 'USDT') {
                if (t.direction === 'in') stats.income += t.rawAmount;
                else stats.expense += t.rawAmount;
            }
        });
        dailyStats[address] = stats;
    }

    const profit = stats.income - stats.expense;

    let message = `交易類型：${isOut ? '⬆️' : '⬇️'} <b>${isOut ? '支出' : '收入'}</b>\n`;
    message += `交易金額：<b>${isOut ? '-' : '+'}${tx.rawAmount.toFixed(0)} ${tx.token}</b>\n`;
    message += `出賬地址：<code>${isOut ? address : tx.otherAddr}</code>${isOut ? ' ← 監控地址' : ''}\n`;
    message += `入賬地址：<code>${isOut ? tx.otherAddr : address}</code>${!isOut ? ' ← 監控地址' : ''}\n`;
    message += `交易時間：${tx.time}\n`;
    message += `交易哈希：<code>${tx.hash.slice(0, 4)}...${tx.hash.slice(-4)}</code>\n`;
    message += `今日收入：${stats.income.toFixed(0)}\n`;
    message += `今日支出：${stats.expense.toFixed(0)}\n`;
    message += `今日利潤：${profit.toFixed(0)}\n`;
    message += `USDT餘額：${Math.floor(balance.usdt)}點${Math.floor((balance.usdt % 1) * 100)}`;

    const keyboard = {
        inline_keyboard: [[
            { text: '🔍 查看詳情', callback_data: `monitor_detail_${address}` },
            { text: '🔗 TronScan', url: `https://tronscan.org/#/transaction/${tx.hash}` }
        ]]
    };

    try {
        await bot.sendMessage(userId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
            disable_web_page_preview: true
        });
    } catch (e) {
        console.error(`通知失敗:`, e.message);
    }
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    initDailyStats
};
