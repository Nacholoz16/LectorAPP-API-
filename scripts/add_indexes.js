const db = require('../src/config/db');

async function addIndexes() {
  const indexes = [
    { name: 'idx_likes_log_user', table: 'reading_likes', cols: '(reading_log_id, user_id)' },
    { name: 'idx_sessions_user', table: 'reading_sessions', cols: '(user_id)' },
    { name: 'idx_sessions_log', table: 'reading_sessions', cols: '(reading_log_id)' },
    { name: 'idx_logs_public_date', table: 'reading_logs', cols: '(is_log_public, created_at)' },
    { name: 'idx_logs_user_status', table: 'reading_logs', cols: '(user_id, status)' },
    { name: 'idx_logs_book', table: 'reading_logs', cols: '(book_id)' },
    { name: 'idx_users_username', table: 'users', cols: '(username)' },
  ];

  for (const { name, table, cols } of indexes) {
    try {
      const sql = 'CREATE INDEX ' + name + ' ON ' + table + cols;
      await db.execute(sql);
      console.log('OK: ' + name);
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') {
        console.log('SKIP (ya existe): ' + name);
      } else {
        console.error('ERR ' + name + ':', e.message);
      }
    }
  }
  console.log('Done.');
  process.exit(0);
}

addIndexes().catch(e => { console.error(e); process.exit(1); });
