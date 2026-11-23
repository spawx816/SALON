#!/usr/bin/env node
'use strict';

/**
 * Etereas Ops Telegram Triage CLI (local operator tool — never stores secrets in Git).
 * Reads bot_token and authorized chat_id from %USERPROFILE%\.etereas_ops\telegram.json
 *
 * Usage:
 *   node ops/telegram_triage_cli.cjs pair
 *   node ops/telegram_triage_cli.cjs poll
 *   node ops/telegram_triage_cli.cjs send <error_id|info> "<message>"
 *   node ops/telegram_triage_cli.cjs status <error_id> <triaged|approved|resolved|ignored> ["<summary>"]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), '.etereas_ops', 'telegram.json');
const SSH_HOST = process.env.ETEREAS_OPS_SSH_HOST || 'staging-salon';
const PROD_DB = process.env.ETEREAS_OPS_PROD_DB || 'salon_saas_prod';

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Missing Telegram config at ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

async function tgApi(token, method, body = null) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || res.status}`);
  }
  return data.result;
}

function queryProdSql(sql) {
  const out = execFileSync(
    'ssh',
    [SSH_HOST, `docker exec -i salonpro_db psql -U salonpro -d ${PROD_DB} -t -A`],
    { input: sql, encoding: 'utf8', timeout: 20000 }
  );
  return out.trim();
}

function sqlLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function cmdPair() {
  const cfg = loadConfig();
  const updates = await tgApi(cfg.bot_token, 'getUpdates');
  let chat = null;
  let maxUpdateId = Number(cfg.last_update_id || 0);
  for (const u of updates) {
    if (u.update_id > maxUpdateId) maxUpdateId = u.update_id;
    if (u.message?.chat?.id) {
      chat = u.message.chat;
    }
  }
  if (!chat) {
    console.log(JSON.stringify({ paired: false, reason: 'NO_MESSAGES_YET', bot_username: cfg.bot_username }));
    return;
  }
  cfg.chat_id = String(chat.id);
  cfg.chat_first_name = chat.first_name || '';
  cfg.chat_username = chat.username || '';
  cfg.last_update_id = maxUpdateId;
  saveConfig(cfg);

  await tgApi(cfg.bot_token, 'sendMessage', {
    chat_id: cfg.chat_id,
    text: `✅ Conectado a Etereas Ops (@${cfg.bot_username}).\n\nEste chat (ID ${cfg.chat_id}) quedó autorizado como único operador. Cuando detecte un error en producción, te enviaré el diagnóstico y esperaré tu confirmación (SI <ID> o NO <ID>) antes de aplicar cualquier cambio.`,
  });

  console.log(JSON.stringify({ paired: true, chat_id: cfg.chat_id, chat_first_name: cfg.chat_first_name, chat_username: cfg.chat_username }));
}

async function cmdPoll() {
  const cfg = loadConfig();
  if (!cfg.chat_id) {
    throw new Error('Telegram chat_id not paired yet. Ask the user to message the bot and run "pair".');
  }

  // 1. Fetch new Telegram replies strictly from authorized chat_id
  const offset = Number(cfg.last_update_id || 0) + 1;
  const updates = await tgApi(cfg.bot_token, `getUpdates?offset=${offset}&timeout=0`);
  const userReplies = [];
  let maxUpdateId = Number(cfg.last_update_id || 0);

  for (const u of updates) {
    if (u.update_id > maxUpdateId) maxUpdateId = u.update_id;
    const msg = u.message;
    if (!msg || !msg.chat) continue;
    if (String(msg.chat.id) !== String(cfg.chat_id)) continue; // Strict chat_id authorization
    if (msg.text) {
      userReplies.push({
        update_id: u.update_id,
        date: new Date((msg.date || 0) * 1000).toISOString(),
        text: msg.text.trim(),
      });
    }
  }
  if (maxUpdateId > Number(cfg.last_update_id || 0)) {
    cfg.last_update_id = maxUpdateId;
    saveConfig(cfg);
  }

  // 2. Fetch open and triaged alerts from production PostgreSQL
  const sql = `
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT error_id, env, source, type, method, path, status_code, tenant_id,
             user_email, user_role, message, stack, occurrences, status, triage_summary, created_at
      FROM ops_error_alerts
      WHERE status IN ('open', 'triaged')
      ORDER BY created_at DESC
      LIMIT 20
    ) t;
  `;
  let alerts = [];
  try {
    const raw = queryProdSql(sql);
    alerts = raw ? JSON.parse(raw) : [];
  } catch (err) {
    if (!String(err.message || '').includes('does not exist')) {
      throw err;
    }
  }

  const openAlerts = alerts.filter((a) => a.status === 'open');
  const triagedAlerts = alerts.filter((a) => a.status === 'triaged');

  console.log(JSON.stringify({ open_alerts: openAlerts, triaged_alerts: triagedAlerts, user_replies: userReplies }, null, 2));
}

async function cmdSend(errorId, messageText) {
  const cfg = loadConfig();
  if (!cfg.chat_id) throw new Error('Telegram chat_id not paired yet.');
  const sent = await tgApi(cfg.bot_token, 'sendMessage', {
    chat_id: cfg.chat_id,
    text: messageText,
  });

  if (errorId && errorId !== 'info') {
    const sql = `
      UPDATE ops_error_alerts
      SET status = 'triaged',
          telegram_message_id = ${Number(sent.message_id || 0)},
          triage_summary = ${sqlLiteral(messageText.slice(0, 1500))},
          updated_at = NOW()
      WHERE error_id = ${sqlLiteral(errorId)};
    `;
    try {
      queryProdSql(sql);
    } catch {
      // ignore if table not created yet
    }
  }
  console.log(JSON.stringify({ sent: true, message_id: sent.message_id, error_id: errorId }));
}

async function cmdStatus(errorId, nextStatus, summary = '') {
  const allowed = ['open', 'triaged', 'approved', 'resolved', 'ignored'];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid status "${nextStatus}". Allowed: ${allowed.join(', ')}`);
  }
  const sql = `
    UPDATE ops_error_alerts
    SET status = ${sqlLiteral(nextStatus)},
        triage_summary = COALESCE(NULLIF(${sqlLiteral(summary)}, ''), triage_summary),
        updated_at = NOW()
    WHERE error_id = ${sqlLiteral(errorId)};
  `;
  queryProdSql(sql);
  console.log(JSON.stringify({ updated: true, error_id: errorId, status: nextStatus }));
}

(async () => {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'pair') return cmdPair();
  if (cmd === 'poll') return cmdPoll();
  if (cmd === 'send') return cmdSend(args[0], args.slice(1).join(' '));
  if (cmd === 'status') return cmdStatus(args[0], args[1], args.slice(2).join(' '));
  console.error('Usage: node ops/telegram_triage_cli.cjs <pair|poll|send|status> ...');
  process.exit(1);
})().catch((err) => {
  console.error('[TELEGRAM_TRIAGE_ERROR]:', err.message || err);
  process.exit(1);
});
