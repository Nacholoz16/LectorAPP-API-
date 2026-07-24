const db = require('../src/config/db');

async function setupMaintenance() {
  // Limpiar tokens expirados
  const [cleanResult] = await db.execute(
    'DELETE FROM token_blacklist WHERE expires_at < NOW()'
  );
  console.log('Tokens expirados eliminados:', cleanResult.affectedRows);

  // Crear evento MySQL para limpieza automática (si el scheduler está habilitado)
  try {
    await db.execute('SET GLOBAL event_scheduler = ON');
    await db.execute(`
      CREATE EVENT IF NOT EXISTS cleanup_expired_tokens
      ON SCHEDULE EVERY 1 HOUR
      STARTS NOW()
      DO DELETE FROM token_blacklist WHERE expires_at < NOW()
    `);
    console.log('Evento MySQL de limpieza creado correctamente.');
  } catch (e) {
    // El event scheduler puede estar deshabilitado en algunos servidores (ej. hosting compartido)
    console.warn('Evento MySQL no creado (puede requerir permisos de SUPER):', e.message);
    console.log('Alternativa: ejecutar "node scripts/cleanup_tokens.js" periódicamente.');
  }

  process.exit(0);
}

setupMaintenance().catch(e => { console.error(e); process.exit(1); });
