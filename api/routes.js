// ================= HTTP 路由 =================
const url = require('url');
const fs = require('fs');
const path = require('path');
const { fetchTransactionsForChart } = require('./tron');

function setupRoutes(server, bot, BOT_TOKEN) {
    server.on('request', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        // Webhook 路由
        if (pathname === `/webhook/${BOT_TOKEN}` && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    bot.processUpdate(JSON.parse(body));
                    res.writeHead(200);
                    res.end('OK');
                } catch (e) {
                    res.writeHead(400);
                    res.end('Bad Request');
                }
            });
            return;
        }

        // 健康檢查路由
        if (pathname === '/' || pathname === '/health') {
            res.writeHead(200);
            res.end('TRON Chain Tracker Bot Running');
            return;
        }

        // 圖表頁面路由 - 返回靜態 HTML
        if (pathname === '/chart') {
            const chartPath = path.join(__dirname, '../public/chart.html');
            try {
                const html = fs.readFileSync(chartPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch (e) {
                res.writeHead(500);
                res.end('Chart page not found');
            }
            return;
        }

        // API 路由 - 返回 JSON 數據
        if (pathname === '/api/trace') {
            const { address, umin, umax, tmin, tmax } = parsedUrl.query;
            if (!address) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing address parameter' }));
                return;
            }
            try {
                const settings = {
                    mode: 'advanced',
                    unified: { min: 1, max: 0 },
                    usdt: { min: parseInt(umin) || 1, max: parseInt(umax) || 0 },
                    trx: { min: parseInt(tmin) || 1, max: parseInt(tmax) || 0 }
                };
                const data = await fetchTransactionsForChart(address, settings);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // 404
        res.writeHead(404);
        res.end('Not Found');
    });
}

module.exports = { setupRoutes };
