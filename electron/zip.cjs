'use strict';

/**
 * Minimal, dependency-free ZIP reader/writer used only for School Bell backups.
 *
 * Supports the two methods that matter for this use case:
 *   - method 0 (stored)  : manifest/checksum JSON and small entries
 *   - method 8 (deflate) : audio binaries
 *
 * The reader accepts both methods so a backup produced here can always be read
 * back, and so a backup produced by an external tool can be restored.
 *
 * This module is intentionally self-contained: B4 introduces no dependencies.
 */

const zlib = require('node:zlib');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time: time & 0xffff, date: day & 0xffff };
}

/**
 * Build a ZIP archive in memory.
 * @param {Array<{name: string, data: Buffer|string, store?: boolean}>} entries
 * @param {Date} now
 * @returns {Buffer}
 */
function createZip(entries, now = new Date()) {
  const { time: dosTime, date: dosDate } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(raw);

    let method = 0;
    let payload = raw;
    if (!entry.store && raw.length > 0) {
      const deflated = zlib.deflateRawSync(raw, { level: 6 });
      if (deflated.length < raw.length) {
        method = 8;
        payload = deflated;
      }
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Read a ZIP archive in memory.
 * @param {Buffer} buf
 * @returns {Array<{name: string, data: Buffer, crc: number}>}
 */
function readZip(buf) {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('ZIP_INVALID: end of central directory not found');

  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = [];

  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(ptr) !== CENTRAL_SIG) throw new Error('ZIP_INVALID: central directory entry mismatch');
    const method = buf.readUInt16LE(ptr + 10);
    const crc = buf.readUInt32LE(ptr + 16);
    const csize = buf.readUInt32LE(ptr + 20);
    const usize = buf.readUInt32LE(ptr + 24);
    const fnlen = buf.readUInt16LE(ptr + 28);
    const extralen = buf.readUInt16LE(ptr + 30);
    const commentlen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + fnlen);

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('ZIP_INVALID: local header mismatch');
    const localFnlen = buf.readUInt16LE(localOffset + 26);
    const localExtralen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localFnlen + localExtralen;
    const payload = buf.subarray(dataStart, dataStart + csize);

    let data;
    if (method === 0) {
      data = Buffer.from(payload);
    } else if (method === 8) {
      data = zlib.inflateRawSync(payload);
    } else {
      throw new Error(`ZIP_INVALID: unsupported compression method ${method}`);
    }

    if (data.length !== usize) throw new Error(`ZIP_INVALID: size mismatch for ${name}`);
    if (crc32(data) !== crc) throw new Error(`ZIP_INVALID: checksum mismatch for ${name}`);

    out.push({ name, data, crc });
    ptr += 46 + fnlen + extralen + commentlen;
  }

  return out;
}

module.exports = { createZip, readZip, crc32 };
