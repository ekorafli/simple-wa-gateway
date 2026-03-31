const { Pool } = require('pg');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

let pool;

function getPool() {
    if (!pool) {
        pool = new Pool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 5432,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }
    return pool;
}

async function usePostgresAuthState() {
    const currentPool = getPool();

    // Retry logic to wait for DB to be ready
    let connected = false;
    for (let i = 0; i < 10; i++) {
        try {
            await currentPool.query('SELECT 1');
            connected = true;
            break;
        } catch (err) {
            console.log(`[DB] Waiting for database connection... (Attempt ${i + 1}/10)`);
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    if (!connected) {
        throw new Error('[DB] Failed to connect to PostgreSQL after 10 attempts');
    }

    // Create table if it doesn't exist
    await currentPool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(255) PRIMARY KEY,
            data TEXT
        )
    `);

    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await currentPool.query(
            'INSERT INTO sessions (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
            [id, json]
        );
    };

    const readData = async (id) => {
        try {
            const res = await currentPool.query('SELECT data FROM sessions WHERE id = $1', [id]);
            if (res.rows.length > 0) {
                return JSON.parse(res.rows[0].data, BufferJSON.reviver);
            }
        } catch (error) {
            // Silence common read errors during initial connection
            if (process.env.NODE_ENV !== 'production') {
                console.error(`[DB] Error reading session data for ${id}:`, error.message);
            }
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await currentPool.query('DELETE FROM sessions WHERE id = $1', [id]);
        } catch (error) {
            console.error(`[DB] Error deleting session data for ${id}:`, error);
        }
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (value) {
                                if (type === 'app-state-sync-key') {
                                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                }
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds'),
        clearSession: () => currentPool.query('DELETE FROM sessions')
    };
}

module.exports = { usePostgresAuthState };
