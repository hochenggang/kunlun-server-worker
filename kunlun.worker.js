export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        const routes = {
            'POST /status': handlePostStatus,
            'GET /status/latest': handleGetLatestStatus,
            'GET /status/seconds': handleGetStatusSeconds,
            'GET /status/minutes': handleGetStatusMinutes,
            'GET /status/hours': handleGetStatusHours,
            'GET /': handleGetIndex,
            'GET /status': handleGetStatus,
            'GET /init': handleInitDB,
            'GET /admin/client': handleAdminGetClients,
            'PUT /admin/client/{client_id}': handleAdminUpdateClient,
            'DELETE /admin/client/{client_id}': handleAdminDeleteClient,
        };

        try {
            let routeKey = `${method} ${path}`;

            const clientId = url.searchParams.get('client_id');
            if (clientId) {
                if (path === '/status/seconds') {
                    routeKey = 'GET /status/seconds';
                    url.clientId = clientId;
                } else if (path === '/status/minutes') {
                    routeKey = 'GET /status/minutes';
                    url.clientId = clientId;
                } else if (path === '/status/hours') {
                    routeKey = 'GET /status/hours';
                    url.clientId = clientId;
                }
            }

            const adminClientIdMatch = path.match(/^\/admin\/client\/(\d+)$/);
            if (adminClientIdMatch) {
                url.adminClientId = parseInt(adminClientIdMatch[1], 10);
                if (method === 'GET') {
                    routeKey = 'GET /admin/client';
                } else if (method === 'PUT') {
                    routeKey = 'PUT /admin/client/{client_id}';
                } else if (method === 'DELETE') {
                    routeKey = 'DELETE /admin/client/{client_id}';
                }
            }

            const handler = routes[routeKey];

            if (handler) {
                return await handler(request, env, url);
            } else {
                return new Response('Not Found', { status: 404 });
            }
        } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    },
};

function parseTableResponse(jsonResponse) {
    const data = typeof jsonResponse === 'string' ? JSON.parse(jsonResponse) : jsonResponse;
    if (!Array.isArray(data) || data.length === 0) {
        return { headers: [], rows: [] };
    }
    const headers = data[0];
    const rows = data.slice(1);
    return { headers, rows };
}

function rowsToTable(rows) {
    if (!rows || rows.length === 0) {
        return [];
    }
    const headers = Object.keys(rows[0]);
    const table = [headers];
    for (const row of rows) {
        table.push(Object.values(row));
    }
    return table;
}

function JSONResponse(content, statusCode = 200) {
    return new Response(JSON.stringify(content), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
    });
}


// 初始化数据库
async function initDB(env) {
    try {
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS client (
                id INTEGER PRIMARY KEY NOT NULL,
                ip TEXT,
                machine_id TEXT UNIQUE NOT NULL,
                hostname TEXT NOT NULL,
                status INTEGER NOT NULL DEFAULT 0,
                last_update INTEGER NOT NULL,
                create_ts INTEGER NOT NULL
            )
        `).run();

        const columns = `
            timestamp INTEGER NOT NULL,
            uptime_s INTEGER NOT NULL,
            load_1min REAL NOT NULL,
            load_5min REAL NOT NULL,
            load_15min REAL NOT NULL,
            running_tasks INTEGER NOT NULL,
            total_tasks INTEGER NOT NULL,
            cpu_user REAL NOT NULL,
            cpu_system REAL NOT NULL,
            cpu_nice REAL NOT NULL,
            cpu_idle REAL NOT NULL,
            cpu_iowait REAL NOT NULL,
            cpu_irq REAL NOT NULL,
            cpu_softirq REAL NOT NULL,
            cpu_steal REAL NOT NULL,
            mem_total_mib REAL NOT NULL,
            mem_free_mib REAL NOT NULL,
            mem_used_mib REAL NOT NULL,
            mem_buff_cache_mib REAL NOT NULL,
            tcp_connections INTEGER NOT NULL,
            udp_connections INTEGER NOT NULL,
            default_interface_net_rx_bytes INTEGER NOT NULL,
            default_interface_net_tx_bytes INTEGER NOT NULL,
            cpu_num_cores INTEGER NOT NULL,
            root_disk_total_kb INTEGER NOT NULL,
            root_disk_avail_kb INTEGER NOT NULL,
            reads_completed INTEGER NOT NULL,
            writes_completed INTEGER NOT NULL,
            reading_ms INTEGER NOT NULL,
            writing_ms INTEGER NOT NULL,
            iotime_ms INTEGER NOT NULL,
            ios_in_progress INTEGER NOT NULL,
            weighted_io_time INTEGER NOT NULL
        `;

        // 创建 status_latest 表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS status_latest (
                client_id INTEGER PRIMARY KEY,
                ${columns},
                FOREIGN KEY (client_id) REFERENCES client(id)
            )
        `).run();

        // 创建 status_seconds 表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS status_seconds (
                client_id INTEGER NOT NULL,
                ${columns},
                PRIMARY KEY (client_id, timestamp),
                FOREIGN KEY (client_id) REFERENCES client(id)
            )
        `).run();

        // 创建 status_minutes 表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS status_minutes (
                client_id INTEGER NOT NULL,
                ${columns},
                PRIMARY KEY (client_id, timestamp),
                FOREIGN KEY (client_id) REFERENCES client(id)
            )
        `).run();

        // 创建 status_hours 表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS status_hours (
                client_id INTEGER NOT NULL,
                ${columns},
                PRIMARY KEY (client_id, timestamp),
                FOREIGN KEY (client_id) REFERENCES client(id)
            )
        `).run();

        return true;
    } catch (error) {
        console.error('Failed to initialize database:', error);
        return false;
    }
}

// 处理 /init 请求
async function handleInitDB(request, env, url) {
    const success = await initDB(env);
    if (success) {
        return new Response('Database initialized successfully', {
            headers: { 'Content-Type': 'text/plain' },
        });
    } else {
        return new Response('Failed to initialize database', { status: 500 });
    }
}


// 处理 GET / 请求
async function handleGetIndex(request, env, url) {
    // 尝试从KV获取 html 缓存
    const html = await env.KV.get("index.html");
    if (html === null) {
        const htmlUrl = 'https://github.com/hochenggang/kunlun-frontend/raw/refs/heads/main/dist/index.html';
        const response = await fetch(htmlUrl);
        if (response.ok) {
            const html = await response.text();
            env.KV.put('index.html', html);
            return new Response(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        } else {
            return new Response('Failed to download HTML file', { status: 500 });
        }
    } else {
        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }


}

// 处理 GET /status 请求
async function handleGetStatus(request, env, url) {
    return new Response('kunlun', {
        headers: { 'Content-Type': 'text/plain' },
    });
}



const FIELDS_LIST = [
    "timestamp", "uptime_s", "load_1min", "load_5min", "load_15min",
    "running_tasks", "total_tasks", "cpu_user", "cpu_system", "cpu_nice",
    "cpu_idle", "cpu_iowait", "cpu_irq", "cpu_softirq", "cpu_steal",
    "mem_total_mib", "mem_free_mib", "mem_used_mib", "mem_buff_cache_mib",
    "tcp_connections", "udp_connections", "default_interface_net_rx_bytes",
    "default_interface_net_tx_bytes", "cpu_num_cores", "root_disk_total_kb",
    "root_disk_avail_kb", "reads_completed", "writes_completed", "reading_ms",
    "writing_ms", "iotime_ms", "ios_in_progress", "weighted_io_time",
    "machine_id", "hostname"
];

const NON_CUMULATIVE_FIELDS = [
    'timestamp', 'uptime_s', 'load_1min', 'load_5min', 'load_15min',
    'running_tasks', 'total_tasks', 'mem_total_mib', 'mem_free_mib',
    'mem_used_mib', 'mem_buff_cache_mib', 'tcp_connections', 'udp_connections',
    'cpu_num_cores', 'root_disk_total_kb', 'root_disk_avail_kb',
    'ios_in_progress', 'machine_id', 'hostname'
];

const COUNTER_FIELDS = [
    'cpu_user', 'cpu_system', 'cpu_nice', 'cpu_idle', 'cpu_iowait',
    'cpu_irq', 'cpu_softirq', 'cpu_steal', 'default_interface_net_rx_bytes',
    'default_interface_net_tx_bytes', 'reads_completed', 'writes_completed',
    'reading_ms', 'writing_ms', 'iotime_ms', 'weighted_io_time'
];

// 计算差值
function calculateDelta(newData, previousData) {
    const deltaData = newData.map((value, index) => {
        const fieldName = FIELDS_LIST[index];

        // 如果是非累计型字段，直接返回新数据
        if (NON_CUMULATIVE_FIELDS.includes(fieldName)) {
            return value;
        }

        // 如果是累计型字段，计算差值
        return parseFloat(value) - parseFloat(previousData[fieldName]);
    });
    return deltaData;
}

// 处理 POST /status 请求
async function handlePostStatus(request, env, url) {
    const formData = await request.formData();
    const values = formData.get('values');
    let valuesList = values.split(',');

    const EXCLUDED_FIELDS = ['machine_id', 'hostname'];
    const machineId = valuesList[valuesList.length - 2];
    const hostname = valuesList[valuesList.length - 1];

    valuesList = valuesList.slice(0, -2);

    if (valuesList.length !== 35) {
        return new Response(`Invalid number of fields: ${valuesList.length}`, { status: 400 });
    }

    const timestamp = parseInt(valuesList[0], 10);
    if (timestamp % 10 !== 0) {
        return new Response('Invalid timestamp', { status: 400 });
    }

    let clientId;
    let clientStatus = 0;
    let rows_read = 0;
    let rows_written = 0;

    const clientIp = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || request.headers.get('X-Real-IP')?.trim()
        || request.client?.host
        || 'unknown';

    try {
        const { meta: metaQueryMachineId, results } = await env.DB
            .prepare('SELECT id, hostname, status FROM client WHERE machine_id = ?')
            .bind(machineId)
            .run();

        rows_read += metaQueryMachineId.rows_read;
        rows_written += metaQueryMachineId.rows_written;

        const currentTs = Math.floor(Date.now() / 1000);

        if (results && results.length > 0) {
            clientId = results[0].id;
            clientStatus = results[0].status;
            if (results[0].hostname !== hostname) {
                const { meta: metaUpdateClient } = await env.DB
                    .prepare('UPDATE client SET hostname = ?, ip = ?, last_update = ? WHERE id = ?')
                    .bind(hostname, clientIp, currentTs, clientId)
                    .run();
                rows_read += metaUpdateClient.rows_read;
                rows_written += metaUpdateClient.rows_written;
            } else {
                const { meta: metaUpdateClient } = await env.DB
                    .prepare('UPDATE client SET ip = ?, last_update = ? WHERE id = ?')
                    .bind(clientIp, currentTs, clientId)
                    .run();
                rows_read += metaUpdateClient.rows_read;
                rows_written += metaUpdateClient.rows_written;
            }
        } else {
            const { meta: metaCountResults, results: countResults } = await env.DB
                .prepare('SELECT MAX(id) AS max_id FROM client')
                .run();

            rows_read += metaCountResults.rows_read;
            rows_written += metaCountResults.rows_written;

            clientId = countResults[0].max_id ? countResults[0].max_id + 1 : 1;
            const { meta: metaInsertClient } = await env.DB
                .prepare('INSERT INTO client (id, machine_id, hostname, status, ip, last_update, create_ts) VALUES (?, ?, ?, 0, ?, ?, ?)')
                .bind(clientId, machineId, hostname, clientIp, currentTs, currentTs)
                .run();
            rows_read += metaInsertClient.rows_read;
            rows_written += metaInsertClient.rows_written;
        }
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }

    if (clientStatus !== 1) {
        return JSONResponse({ error: 'client not approved, status=0, waiting for admin approval' }, 403);
    }

    let previousData;
    try {
        const { meta: metaLatestResults, results: statusLatestResults } = await env.DB
            .prepare('SELECT * FROM status_latest WHERE client_id = ? ORDER BY timestamp DESC LIMIT 1')
            .bind(clientId)
            .run();

        rows_read += metaLatestResults.rows_read;
        rows_written += metaLatestResults.rows_written;

        if (statusLatestResults && statusLatestResults.length > 0) {
            previousData = statusLatestResults[0];
        }
    } catch (error) {
        return new Response(`Failed to fetch previous data: ${error.message}`, { status: 500 });
    }

    try {
        const { meta: metaInsertLatestResults } = await env.DB
            .prepare(`
                INSERT OR REPLACE INTO status_latest (
                    client_id, timestamp, uptime_s, load_1min, load_5min, load_15min,
                    running_tasks, total_tasks, cpu_user, cpu_system, cpu_nice, cpu_idle,
                    cpu_iowait, cpu_irq, cpu_softirq, cpu_steal, mem_total_mib, mem_free_mib,
                    mem_used_mib, mem_buff_cache_mib, tcp_connections, udp_connections,
                    default_interface_net_rx_bytes, default_interface_net_tx_bytes,
                    cpu_num_cores, root_disk_total_kb, root_disk_avail_kb,
                    reads_completed, writes_completed, reading_ms, writing_ms,
                    iotime_ms, ios_in_progress, weighted_io_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(clientId, ...valuesList)
            .run();

        rows_read += metaInsertLatestResults.rows_read;
        rows_written += metaInsertLatestResults.rows_written;
    } catch (error) {
        return new Response(`Failed to insert status_latest data: ${error.message}`, { status: 500 });
    }

    if (!previousData) {
        return new Response(JSON.stringify({ ok: 1 }), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    }

    const deltaData = calculateDelta(valuesList, previousData);

    try {
        const { meta: metaInsertSencondsResults } = await env.DB
            .prepare(`
                INSERT INTO status_seconds (
                    client_id, timestamp, uptime_s, load_1min, load_5min, load_15min,
                    running_tasks, total_tasks, cpu_user, cpu_system, cpu_nice, cpu_idle,
                    cpu_iowait, cpu_irq, cpu_softirq, cpu_steal, mem_total_mib, mem_free_mib,
                    mem_used_mib, mem_buff_cache_mib, tcp_connections, udp_connections,
                    default_interface_net_rx_bytes, default_interface_net_tx_bytes,
                    cpu_num_cores, root_disk_total_kb, root_disk_avail_kb,
                    reads_completed, writes_completed, reading_ms, writing_ms,
                    iotime_ms, ios_in_progress, weighted_io_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(clientId, ...deltaData)
            .run();

        rows_read += metaInsertSencondsResults.rows_read;
        rows_written += metaInsertSencondsResults.rows_written;

        const { meta: metaDeleteSencondsResults } = await env.DB
            .prepare(`
                DELETE FROM status_seconds
                WHERE (client_id, timestamp) IN (
                    SELECT client_id, timestamp FROM status_seconds
                    WHERE client_id = ? ORDER BY timestamp DESC LIMIT -1 OFFSET 360
                )
            `)
            .bind(clientId)
            .run();

        rows_read += metaDeleteSencondsResults.rows_read;
        rows_written += metaDeleteSencondsResults.rows_written;
    } catch (error) {
        return new Response(`Failed to insert delta data: ${error.message}`, { status: 500 });
    }

    if (timestamp % 60 === 0) {
        try {
            const { meta: metaInsertMinutesResults } = await env.DB
                .prepare(`
                    INSERT INTO status_minutes (
                        client_id, timestamp, uptime_s, load_1min, load_5min, load_15min,
                        running_tasks, total_tasks, cpu_user, cpu_system, cpu_nice, cpu_idle,
                        cpu_iowait, cpu_irq, cpu_softirq, cpu_steal, mem_total_mib, mem_free_mib,
                        mem_used_mib, mem_buff_cache_mib, tcp_connections, udp_connections,
                        default_interface_net_rx_bytes, default_interface_net_tx_bytes,
                        cpu_num_cores, root_disk_total_kb, root_disk_avail_kb,
                        reads_completed, writes_completed, reading_ms, writing_ms,
                        iotime_ms, ios_in_progress, weighted_io_time
                    )
                    SELECT
                        client_id,
                        MAX(timestamp),
                        ROUND(AVG(uptime_s), 2),
                        ROUND(AVG(load_1min), 2), ROUND(AVG(load_5min), 2), ROUND(AVG(load_15min), 2),
                        ROUND(AVG(running_tasks), 2), ROUND(AVG(total_tasks), 2),
                        ROUND(SUM(cpu_user), 2), ROUND(SUM(cpu_system), 2), ROUND(SUM(cpu_nice), 2),
                        ROUND(SUM(cpu_idle), 2), ROUND(SUM(cpu_iowait), 2), ROUND(SUM(cpu_irq), 2), ROUND(SUM(cpu_softirq), 2), ROUND(SUM(cpu_steal), 2),
                        ROUND(AVG(mem_total_mib), 2), ROUND(AVG(mem_free_mib), 2), ROUND(AVG(mem_used_mib), 2), ROUND(AVG(mem_buff_cache_mib), 2),
                        ROUND(AVG(tcp_connections), 2), ROUND(AVG(udp_connections), 2),
                        SUM(default_interface_net_rx_bytes), SUM(default_interface_net_tx_bytes),
                        ROUND(AVG(cpu_num_cores), 2),
                        ROUND(AVG(root_disk_total_kb), 2), ROUND(AVG(root_disk_avail_kb), 2),
                        SUM(reads_completed), SUM(writes_completed),
                        SUM(reading_ms), SUM(writing_ms), SUM(iotime_ms),
                        ROUND(AVG(ios_in_progress), 2), ROUND(SUM(weighted_io_time), 2)
                    FROM status_seconds
                    WHERE client_id = ? AND timestamp >= ? - 60
                    GROUP BY client_id
                `)
                .bind(clientId, timestamp)
                .run();

            rows_read += metaInsertMinutesResults.rows_read;
            rows_written += metaInsertMinutesResults.rows_written;

            const { meta: metaDeleteMinutesResults } = await env.DB
                .prepare(`
                    DELETE FROM status_minutes
                    WHERE (client_id, timestamp) IN (
                        SELECT client_id, timestamp FROM status_minutes
                        WHERE client_id = ? ORDER BY timestamp DESC LIMIT -1 OFFSET 1440
                    )
                `)
                .bind(clientId)
                .run();

            rows_read += metaDeleteMinutesResults.rows_read;
            rows_written += metaDeleteMinutesResults.rows_written;
        } catch (error) {
            return new Response(`Failed to insert minute data: ${error.message}`, { status: 500 });
        }
    }

    if (timestamp % 3600 === 0) {
        try {
            const { meta: metaInsertHoursResults } = await env.DB
                .prepare(`
                    INSERT INTO status_hours (
                        client_id, timestamp, uptime_s, load_1min, load_5min, load_15min,
                        running_tasks, total_tasks, cpu_user, cpu_system, cpu_nice, cpu_idle,
                        cpu_iowait, cpu_irq, cpu_softirq, cpu_steal, mem_total_mib, mem_free_mib,
                        mem_used_mib, mem_buff_cache_mib, tcp_connections, udp_connections,
                        default_interface_net_rx_bytes, default_interface_net_tx_bytes,
                        cpu_num_cores, root_disk_total_kb, root_disk_avail_kb,
                        reads_completed, writes_completed, reading_ms, writing_ms,
                        iotime_ms, ios_in_progress, weighted_io_time
                    )
                    SELECT
                        client_id,
                        MAX(timestamp),
                        ROUND(AVG(uptime_s), 2),
                        ROUND(AVG(load_1min), 2), ROUND(AVG(load_5min), 2), ROUND(AVG(load_15min), 2),
                        ROUND(AVG(running_tasks), 2), ROUND(AVG(total_tasks), 2),
                        ROUND(SUM(cpu_user), 2), ROUND(SUM(cpu_system), 2), ROUND(SUM(cpu_nice), 2),
                        ROUND(SUM(cpu_idle), 2), ROUND(SUM(cpu_iowait), 2), ROUND(SUM(cpu_irq), 2), ROUND(SUM(cpu_softirq), 2), ROUND(SUM(cpu_steal), 2),
                        ROUND(AVG(mem_total_mib), 2), ROUND(AVG(mem_free_mib), 2), ROUND(AVG(mem_used_mib), 2), ROUND(AVG(mem_buff_cache_mib), 2),
                        ROUND(AVG(tcp_connections), 2), ROUND(AVG(udp_connections), 2),
                        SUM(default_interface_net_rx_bytes), SUM(default_interface_net_tx_bytes),
                        ROUND(AVG(cpu_num_cores), 2),
                        ROUND(AVG(root_disk_total_kb), 2), ROUND(AVG(root_disk_avail_kb), 2),
                        SUM(reads_completed), SUM(writes_completed),
                        SUM(reading_ms), SUM(writing_ms), SUM(iotime_ms),
                        ROUND(AVG(ios_in_progress), 2), ROUND(SUM(weighted_io_time), 2)
                    FROM status_minutes
                    WHERE client_id = ? AND timestamp >= ? - 3600
                    GROUP BY client_id
                `)
                .bind(clientId, timestamp)
                .run();
            rows_read += metaInsertHoursResults.rows_read;
            rows_written += metaInsertHoursResults.rows_written;

            const { meta: metaDeleteHoursResults } = await env.DB
                .prepare(`
                    DELETE FROM status_hours
                    WHERE (client_id, timestamp) IN (
                        SELECT client_id, timestamp FROM status_hours
                        WHERE client_id = ? ORDER BY timestamp DESC LIMIT -1 OFFSET 8760
                    )
                `)
                .bind(clientId)
                .run();
            rows_read += metaDeleteHoursResults.rows_read;
            rows_written += metaDeleteHoursResults.rows_written;
        } catch (error) {
            return new Response(`Failed to insert hour data: ${error.message}`, { status: 500 });
        }
    }

    return new Response(JSON.stringify({ ok: 2 }), {
        headers: {
            'Content-Type': 'application/json',
            'X-d1-rows-read': String(rows_read),
            'X-d1-rows-written': String(rows_written),
        },
    });
}


// 处理 GET /status/latest 请求
async function handleGetLatestStatus(request, env, url) {
    let rows_read = 0;
    let rows_written = 0;
    try {
        const { meta, results } = await env.DB
            .prepare(`
                SELECT sl.*, c.machine_id, c.hostname
                FROM status_latest sl
                JOIN client c ON sl.client_id = c.id
                WHERE sl.timestamp = (
                    SELECT MAX(timestamp)
                    FROM status_latest
                    WHERE client_id = sl.client_id
                )
            `)
            .run();

        rows_read += meta.rows_read;
        rows_written += meta.rows_written;

        return new Response(JSON.stringify(rowsToTable(results)), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 GET /status/seconds 请求
async function handleGetStatusSeconds(request, env, url) {
    const clientId = url.clientId;
    const limit = url.searchParams.get('limit') || 360;

    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta, results } = await env.DB
            .prepare('SELECT * FROM status_seconds WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?')
            .bind(clientId, limit)
            .run();

        rows_read += meta.rows_read;
        rows_written += meta.rows_written;

        return new Response(JSON.stringify(rowsToTable(results)), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 GET /status/minutes 请求
async function handleGetStatusMinutes(request, env, url) {
    const clientId = url.clientId;
    const limit = url.searchParams.get('limit') || 1440;

    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta, results } = await env.DB
            .prepare('SELECT * FROM status_minutes WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?')
            .bind(clientId, limit)
            .run();

        rows_read += meta.rows_read;
        rows_written += meta.rows_written;
        return new Response(JSON.stringify(rowsToTable(results)), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 GET /status/hours 请求
async function handleGetStatusHours(request, env, url) {
    const clientId = url.clientId;
    const limit = url.searchParams.get('limit') || 8760;

    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta, results } = await env.DB
            .prepare('SELECT * FROM status_hours WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?')
            .bind(clientId, limit)
            .run();

        rows_read += meta.rows_read;
        rows_written += meta.rows_written;
        return new Response(JSON.stringify(rowsToTable(results)), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 GET /admin/client 请求
async function handleAdminGetClients(request, env, url) {
    const authHeader = request.headers.get('Authorization');
    const adminToken = env.ADMIN_TOKEN || 'Admin123';

    if (!authHeader || !verifyAdminToken(authHeader, adminToken)) {
        return JSONResponse({ error: 'unauthorized' }, 401);
    }

    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta, results } = await env.DB
            .prepare('SELECT * FROM client ORDER BY id')
            .run();

        rows_read += meta.rows_read;
        rows_written += meta.rows_written;

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 PUT /admin/client/{client_id} 请求
async function handleAdminUpdateClient(request, env, url) {
    const authHeader = request.headers.get('Authorization');
    const adminToken = env.ADMIN_TOKEN || 'Admin123';

    if (!authHeader || !verifyAdminToken(authHeader, adminToken)) {
        return JSONResponse({ error: 'unauthorized' }, 401);
    }

    const clientId = url.adminClientId;
    const body = await request.json();
    const { machine_id, hostname, status } = body;

    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta: metaSelect, results: clientResults } = await env.DB
            .prepare('SELECT * FROM client WHERE id = ?')
            .bind(clientId)
            .run();

        rows_read += metaSelect.rows_read;
        rows_written += metaSelect.rows_written;

        if (!clientResults || clientResults.length === 0) {
            return JSONResponse({ error: 'client not found' }, 404);
        }

        const updates = {};
        if (machine_id !== undefined) updates.machine_id = machine_id;
        if (hostname !== undefined) updates.hostname = hostname;
        if (status !== undefined) updates.status = status;

        if (Object.keys(updates).length === 0) {
            return JSONResponse({ ok: true, message: 'no fields to update' });
        }

        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), clientId];

        const { meta: metaUpdate } = await env.DB
            .prepare(`UPDATE client SET ${setClause} WHERE id = ?`)
            .bind(...values)
            .run();

        rows_read += metaUpdate.rows_read;
        rows_written += metaUpdate.rows_written;

        const { meta: metaSelectUpdated, results: updatedClient } = await env.DB
            .prepare('SELECT * FROM client WHERE id = ?')
            .bind(clientId)
            .run();

        rows_read += metaSelectUpdated.rows_read;
        rows_written += metaSelectUpdated.rows_written;

        return new Response(JSON.stringify({ ok: true, client: updatedClient[0] }), {
            headers: {
                'Content-Type': 'application/json',
                'X-d1-rows-read': String(rows_read),
                'X-d1-rows-written': String(rows_written),
            },
        });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理 DELETE /admin/client/{client_id} 请求
async function handleAdminDeleteClient(request, env, url) {
    const authHeader = request.headers.get('Authorization');
    const adminToken = env.ADMIN_TOKEN || 'Admin123';

    if (!authHeader || !verifyAdminToken(authHeader, adminToken)) {
        return JSONResponse({ error: 'unauthorized' }, 401);
    }

    const clientId = url.adminClientId;
    let rows_read = 0;
    let rows_written = 0;

    try {
        const { meta: metaSelect, results: clientResults } = await env.DB
            .prepare('SELECT * FROM client WHERE id = ?')
            .bind(clientId)
            .run();

        rows_read += metaSelect.rows_read;
        rows_written += metaSelect.rows_written;

        if (!clientResults || clientResults.length === 0) {
            return JSONResponse({ error: 'client not found' }, 404);
        }

        const queries = [
            'DELETE FROM status_latest WHERE client_id = ?',
            'DELETE FROM status_seconds WHERE client_id = ?',
            'DELETE FROM status_minutes WHERE client_id = ?',
            'DELETE FROM status_hours WHERE client_id = ?',
            'DELETE FROM client WHERE id = ?'
        ];

        for (const query of queries) {
            const { meta } = await env.DB
                .prepare(query)
                .bind(clientId)
                .run();
            rows_read += meta.rows_read;
            rows_written += meta.rows_written;
        }

        return JSONResponse({ ok: true, message: `client ${clientId} and all related data deleted` });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

function verifyAdminToken(authHeader, adminToken) {
    if (!authHeader) return false;
    authHeader = authHeader.trim();
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7) === adminToken;
    }
    return authHeader === adminToken;
}