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
