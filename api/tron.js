// ================= TronScan API 請求 =================
const https = require('https');
const { formatNumber, formatDate, matchesRange } = require('../utils/helpers');

const TRONSCAN_API = 'https://apilist.tronscanapi.com/api';
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || '';

const FETCH_BATCH = 200;
const FETCH_TIMEOUT = 15000;
const MAX_RAW_FETCH = 3000;

async function fetchAddressBalance(address) {
    return new Promise((resolve) => {
        const headers = { 'Accept': 'application/json' };
        if (TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = TRONGRID_API_KEY;
        const options = {
            hostname: 'api.trongrid.io',
            path: `/v1/accounts/${address}`,
            method: 'GET',
            headers,
            timeout: 15000
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (!json.data || json.data.length === 0) {
                        resolve({ usdt: 0, trx: 0, createTime: null });
                        return;
                    }
                    const account = json.data[0];
                    const trx = (account.balance || 0) / 1e6;
                    let usdt = 0;
                    const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
                    if (account.trc20 && Array.isArray(account.trc20)) {
                        for (const tokenObj of account.trc20) {
                            if (tokenObj[USDT_CONTRACT]) {
                                usdt = parseFloat(tokenObj[USDT_CONTRACT]) / 1e6;
                                break;
                            }
                        }
                    }
                    // 獲取錢包創建時間
                    const createTime = account.create_time || null;
                    resolve({ usdt, trx, createTime });
                } catch (e) {
                    resolve({ usdt: 0, trx: 0, createTime: null });
                }
            });
        });
        req.on('error', () => resolve({ usdt: 0, trx: 0, createTime: null }));
        req.on('timeout', () => { req.destroy(); resolve({ usdt: 0, trx: 0, createTime: null }); });
        req.end();
    });
}

async function fetchTrxTransfers(address, limit = 200, start = 0) {
    return new Promise((resolve) => {
        const apiUrl = `${TRONSCAN_API}/transaction?address=${address}&limit=${limit}&start=${start}`;
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const txs = (json.data || [])
                        .filter(tx => tx.contractType === 1 && tx.toAddress)
                        .map(tx => ({
                            from: tx.ownerAddress,
                            to: tx.toAddress,
                            otherAddr: tx.ownerAddress === address ? tx.toAddress : tx.ownerAddress,
                            direction: tx.ownerAddress === address ? 'out' : 'in',
                            rawAmount: (tx.amount || 0) / 1e6,
                            amount: formatNumber((tx.amount || 0) / 1e6) + ' TRX',
                            token: 'TRX',
                            timestamp: tx.timestamp || 0,
                            time: formatDate(tx.timestamp),
                            hash: tx.hash || ''
                        }));
                    resolve(txs);
                } catch (e) {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

async function fetchUsdtTransfers(address, limit = 200, start = 0) {
    return new Promise((resolve) => {
        const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const apiUrl = `${TRONSCAN_API}/token_trc20/transfers?relatedAddress=${address}&contract_address=${usdt}&limit=${limit}&start=${start}`;
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const txs = (json.token_transfers || []).map(tx => ({
                        from: tx.from_address,
                        to: tx.to_address,
                        otherAddr: tx.from_address === address ? tx.to_address : tx.from_address,
                        direction: tx.from_address === address ? 'out' : 'in',
                        rawAmount: parseFloat(tx.quant || 0) / 1e6,
                        amount: formatNumber(parseFloat(tx.quant || 0) / 1e6) + ' USDT',
                        token: 'USDT',
                        timestamp: tx.block_ts || 0,
                        time: formatDate(tx.block_ts),
                        hash: tx.transaction_id || ''
                    }));
                    resolve(txs);
                } catch (e) {
                    resolve([]);
                }
            });
        }).on('error', () => resolve([]));
    });
}

async function fetchFilteredTransactions(address, targetCount, settings, halfYear = false) {
    const startTime = Date.now();
    const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
    let allFiltered = [], trxOffset = 0, usdtOffset = 0, totalFetched = 0;
    let noMoreTrx = false, noMoreUsdt = false;

    while (allFiltered.length < targetCount && totalFetched < MAX_RAW_FETCH) {
        if (Date.now() - startTime > FETCH_TIMEOUT) break;
        let trxResult = [], usdtResult = [];

        if (!noMoreTrx) {
            trxResult = await fetchTrxTransfers(address, FETCH_BATCH, trxOffset).catch(() => []);
            await new Promise(r => setTimeout(r, 800));
        }
        if (!noMoreUsdt) {
            usdtResult = await fetchUsdtTransfers(address, FETCH_BATCH, usdtOffset).catch(() => []);
        }

        if (trxResult.length === 0 && usdtResult.length === 0 && noMoreTrx && noMoreUsdt) break;

        if (!noMoreTrx) {
            if (trxResult.length < FETCH_BATCH) noMoreTrx = true;
            trxOffset += trxResult.length;
            totalFetched += trxResult.length;
            const range = settings.mode === 'simple' ? settings.unified : settings.trx;
            trxResult.forEach(tx => {
                if (halfYear && tx.timestamp < sixMonthsAgo) return;
                if (matchesRange(tx.rawAmount, range)) allFiltered.push(tx);
            });
        }

        if (!noMoreUsdt) {
            if (usdtResult.length < FETCH_BATCH) noMoreUsdt = true;
            usdtOffset += usdtResult.length;
            totalFetched += usdtResult.length;
            const range = settings.mode === 'simple' ? settings.unified : settings.usdt;
            usdtResult.forEach(tx => {
                if (halfYear && tx.timestamp < sixMonthsAgo) return;
                if (matchesRange(tx.rawAmount, range)) allFiltered.push(tx);
            });
        }

        if (noMoreTrx && noMoreUsdt) break;
    }

    allFiltered.sort((a, b) => b.timestamp - a.timestamp);
    return allFiltered.slice(0, targetCount);
}

async function fetchTransactionsForChart(address, settings) {
    const { shortAddr, formatNumber } = require('../utils/helpers');
    const txs = await fetchFilteredTransactions(address, 50, settings, true);
    const nodes = [], addedNodes = new Set();
    const centerId = `${address}_center`;

    nodes.push({
        id: centerId,
        label: shortAddr(address),
        realAddress: address,
        level: 1,
        isTarget: true
    });
    addedNodes.add(centerId);

    const edgeMap = new Map();
    txs.forEach((tx) => {
        const isIn = tx.direction === 'in';
        const suffix = isIn ? '_in' : '_out';
        const nodeId = `${tx.otherAddr}${suffix}`;

        if (!addedNodes.has(nodeId)) {
            nodes.push({
                id: nodeId,
                label: shortAddr(tx.otherAddr),
                realAddress: tx.otherAddr,
                level: isIn ? 0 : 2,
                isTarget: false
            });
            addedNodes.add(nodeId);
        }

        const key = `${tx.otherAddr}-${tx.direction}-${tx.token}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, {
                from: isIn ? nodeId : centerId,
                to: isIn ? centerId : nodeId,
                token: tx.token,
                direction: tx.direction,
                sum: 0,
                txList: []
            });
        }
        const edge = edgeMap.get(key);
        edge.sum += tx.rawAmount;
        edge.txList.push({
            amount: tx.rawAmount,
            amountStr: tx.amount,
            time: tx.time,
            hash: tx.hash
        });
    });

    const edges = [];
    edgeMap.forEach((e, key) => {
        edges.push({
            id: key,
            from: e.from,
            to: e.to,
            amount: formatNumber(e.sum) + ' ' + e.token + (e.txList.length > 1 ? ` (${e.txList.length}筆)` : ''),
            rawAmount: e.sum,
            token: e.token,
            count: e.txList.length,
            txList: e.txList,
            direction: e.direction
        });
    });

    return { nodes, edges, centerAddress: address };
}

module.exports = {
    fetchAddressBalance,
    fetchTrxTransfers,
    fetchUsdtTransfers,
    fetchFilteredTransactions,
    fetchTransactionsForChart
};
