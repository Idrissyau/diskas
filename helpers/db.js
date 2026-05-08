const { pool } = require('../config/database');

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const [result] = await pool.execute(sql, values);
  return result.insertId;
}

async function update(table, data, where, whereParams = []) {
  const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), ...whereParams];
  const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;
  const [result] = await pool.execute(sql, values);
  return result.affectedRows;
}

async function remove(table, where, whereParams = []) {
  const sql = `DELETE FROM ${table} WHERE ${where}`;
  const [result] = await pool.execute(sql, whereParams);
  return result.affectedRows;
}

module.exports = { query, queryOne, insert, update, remove };
