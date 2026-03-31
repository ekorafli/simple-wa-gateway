const mysql = require('mysql2/promise');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

let pool;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
    return pool;
}

async function useMysqlAuthState() {
    const currentPool = getPool();

    // Create table if it doesn't exist
    await currentPool.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
            id VARCHAR(255) PRIMARY KEY,
            data LONGTEXT
        )
    `);

    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await currentPool.execute('REPLACE INTO sessions (id, data) VALUES (?, ?)', [id, json]);
    };

    const readData = async (id) => {
        try {
            const [rows] = await currentPool.execute('SELECT data FROM sessions WHERE id = ?', [id]);
            if (rows.length > 0) {
                return JSON.parse(rows[0].data, BufferJSON.reviver);
            }
        } catch (error) {
            console.error(`Error reading session data for ${id}:`, error);
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await currentPool.execute('DELETE FROM sessions WHERE id = ?', [id]);
        } catch (error) {
            console.error(`Error deleting session data for ${id}:`, error);
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
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
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
        clearSession: () => currentPool.execute('DELETE FROM sessions')
    };
}

module.exports = { useMysqlAuthState };
