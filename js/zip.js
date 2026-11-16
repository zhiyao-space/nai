const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function _matchAt(bytes, offset, sig) {
  if (offset + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function scanRawPngs(bytes) {
  const out = [];
  for (let i = 0; i <= bytes.length - 8; i++) {
    if (!_matchAt(bytes, i, PNG_SIG)) continue;
    for (let j = i + 8; j <= bytes.length - 8; j++) {
      if (_matchAt(bytes, j, [0x49, 0x45, 0x4e, 0x44])) {
        out.push(new Blob([bytes.slice(i, j + 8)], { type: "image/png" }));
        i = j + 8;
        break;
      }
    }
  }
  return out;
}

async function inflateRaw(comp) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持 ZIP 解压 (decompress)，请使用新版 Chrome / Edge / Firefox");
  }
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const ab = await new Response(stream).arrayBuffer();
  return new Blob([ab], { type: "image/png" });
}

async function extractPngsFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (_matchAt(bytes, i, [0x50, 0x4b, 0x05, 0x06])) { eocd = i; break; }
  }

  if (eocd < 0) {
    const raw = scanRawPngs(bytes);
    if (raw.length) return raw;
    throw new Error("响应内容不是有效的 ZIP 或 PNG 图像数据");
  }

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const results = [];

  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (!_matchAt(bytes, p, [0x50, 0x4b, 0x01, 0x02])) break;
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commLen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commLen;

    if (!/\.png$/i.test(name)) continue;
    if (lho + 30 > bytes.length) continue;

    const lfhMethod = view.getUint16(lho + 8, true);
    const lfhNameLen = view.getUint16(lho + 26, true);
    const lfhExtraLen = view.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lfhNameLen + lfhExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + csize);

    const m = lfhMethod || method;
    if (m === 0) {
      results.push(new Blob([comp], { type: "image/png" }));
    } else if (m === 8) {
      results.push(await inflateRaw(comp));
    } else {
      throw new Error("ZIP 内使用了不支持的压缩方式: " + m);
    }
  }

  if (!results.length) {
    const raw = scanRawPngs(bytes);
    if (raw.length) return raw;
  }
  return results;
}

/* ---------- 官方同款 ZIP 打包 (store 无压缩, 用于导出多个 .naiv4vibe) ---------- */
const _CRC_TABLE = (() => {
 const t = new Uint32Array(256);
 for (let n = 0; n < 256; n++) {
 let c = n;
 for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
 t[n] = c >>> 0;
 }
 return t;
})();

function _crc32(bytes) {
 let c = 0xFFFFFFFF;
 for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
 return (c ^ 0xFFFFFFFF) >>> 0;
}

/* files: [{ name, data(Uint8Array|string) }] -> Blob(zip) */
function buildZipStore(files) {
 const enc = new TextEncoder();
 const chunks = [];
 const central = [];
 let offset = 0;
 /* 合法 DOS 时间: 2024-01-01 00:00:00, 避免日期字段为 0 被严格解压器拒绝 */
 const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
 for (const f of files) {
 const nameBytes = enc.encode(f.name);
 const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
 const crc = _crc32(data);
 const lh = new DataView(new ArrayBuffer(30));
 lh.setUint32(0, 0x04034b50, true);
 lh.setUint16(4, 20, true);
 lh.setUint16(6, 0x0800, true); /* UTF-8 文件名 */
 lh.setUint16(8, 0, true); /* store */
 lh.setUint16(10, 0, true); /* time */
 lh.setUint16(12, dosDate, true);
 lh.setUint32(14, crc, true);
 lh.setUint32(18, data.length, true);
 lh.setUint32(22, data.length, true);
 lh.setUint16(26, nameBytes.length, true);
 chunks.push(new Uint8Array(lh.buffer), nameBytes, data);
 central.push({ nameBytes, crc, size: data.length, offset });
 offset += 30 + nameBytes.length + data.length;
 }
 const cdStart = offset;
 for (const c of central) {
 const cd = new DataView(new ArrayBuffer(46));
 cd.setUint32(0, 0x02014b50, true);
 cd.setUint16(4, 20, true);
 cd.setUint16(6, 0x0800, true);
 cd.setUint16(8, 0, true);
 cd.setUint16(12, 0, true);
 cd.setUint16(14, dosDate, true);
 cd.setUint32(16, c.crc, true);
 cd.setUint32(20, c.size, true);
 cd.setUint32(24, c.size, true);
 cd.setUint16(28, c.nameBytes.length, true);
 cd.setUint32(42, c.offset, true);
 chunks.push(new Uint8Array(cd.buffer), c.nameBytes);
 offset += 46 + c.nameBytes.length;
 }
 const eocd = new DataView(new ArrayBuffer(22));
 eocd.setUint32(0, 0x06054b50, true);
 eocd.setUint16(8, central.length, true);
 eocd.setUint16(10, central.length, true);
 eocd.setUint32(12, offset - cdStart, true);
 eocd.setUint32(16, cdStart, true);
 chunks.push(new Uint8Array(eocd.buffer));
 return new Blob(chunks, { type: "application/zip" });
}

/* 通用 ZIP 解包: 返回 [{ name, blob }] (支持 store 与 deflate) */
async function extractZipEntries(buffer) {
 const bytes = new Uint8Array(buffer);
 const view = new DataView(buffer);
 let eocd = -1;
 for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
 if (_matchAt(bytes, i, [0x50, 0x4b, 0x05, 0x06])) { eocd = i; break; }
 }
 if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
 const count = view.getUint16(eocd + 10, true);
 let p = view.getUint32(eocd + 16, true);
 const decoder = new TextDecoder();
 const out = [];
 for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
 if (!_matchAt(bytes, p, [0x50, 0x4b, 0x01, 0x02])) break;
 const method = view.getUint16(p + 10, true);
 const csize = view.getUint32(p + 20, true);
 const nameLen = view.getUint16(p + 28, true);
 const extraLen = view.getUint16(p + 30, true);
 const commentLen = view.getUint16(p + 32, true);
 const lho = view.getUint32(p + 42, true);
 const name = decoder.decode(bytes.slice(p + 46, p + 46 + nameLen));
 const lNameLen = view.getUint16(lho + 26, true);
 const lExtraLen = view.getUint16(lho + 28, true);
 const dataStart = lho + 30 + lNameLen + lExtraLen;
 const comp = bytes.slice(dataStart, dataStart + csize);
 if (method === 0) {
 out.push({ name, blob: new Blob([comp]) });
 } else if (method === 8) {
 const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
 out.push({ name, blob: new Blob([await new Response(stream).arrayBuffer()]) });
 }
 p += 46 + nameLen + extraLen + commentLen;
 }
 return out;
}
