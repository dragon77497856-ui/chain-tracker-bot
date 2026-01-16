// ================= 工具函數 =================

function shortAddr(addr) {
    if (!addr) return '???';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

function formatDate(timestamp) {
    if (!timestamp) return '未知';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei'
    });
}

function getDefaultSettings() {
    return {
        mode: 'simple',
        unified: { min: 1, max: 0 },
        usdt: { min: 1, max: 0 },
        trx: { min: 1, max: 0 }
    };
}

function formatRange(min, max) {
    return `${min || 0} ~ ${max > 0 ? max : '無上限'}`;
}

function matchesRange(amount, range) {
    if (amount < range.min) return false;
    if (range.max > 0 && amount > range.max) return false;
    return true;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
    shortAddr,
    formatNumber,
    formatDate,
    getDefaultSettings,
    formatRange,
    matchesRange,
    escapeHtml
};
