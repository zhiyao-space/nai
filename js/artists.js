const ARTIST_DEFAULT_BASE = "https://danbooru.donmai.us";
const ARTIST_TIMEOUT_MS = 10000;
const ARTIST_TAG_LIMIT = 20;
const ARTIST_PREVIEW_COUNT = 3;

const OFFLINE_ARTISTS = [
  { name: "as109", note: "概念构图，光影氛围" },
  { name: "ask", note: "光影构图，氛围感强" },
  { name: "artgerm", note: "精修美型人像" },
  { name: "ciloranko", note: "清新配色，通透质感" },
  { name: "wlop", note: "写实厚涂质感" },
  { name: "miv4t", note: "细腻笔触人像" },
  { name: "reef1600", note: "清新赛璐璐" },
  { name: "quasarcatch", note: "梦幻光效" },
  { name: "infukun", note: "柔和动漫风" },
  { name: "alchemaniac", note: "幻想场景插画" },
  { name: "raana", note: "二次元人像" }
];

function normalizeArtistBase(base) {
  let b = (base || "").trim().replace(/\/+$/, "");
  if (!b) return ARTIST_DEFAULT_BASE;
  if (!/^https?:\/\//i.test(b)) b = "https://" + b;
  return b;
}

function buildArtistTagsUrl(base, q) {
  return normalizeArtistBase(base)
    + "/tags.json?search[name_matches]=*" + encodeURIComponent(q)
    + "*&search[category]=1&search[order]=count&limit=" + ARTIST_TAG_LIMIT;
}

function buildArtistPostsUrl(base, tag) {
  return normalizeArtistBase(base)
    + "/posts.json?tags=" + encodeURIComponent(tag)
    + "&limit=" + ARTIST_PREVIEW_COUNT;
}

async function fetchJsonWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ARTIST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchArtistTags(base, q) {
  const json = await fetchJsonWithTimeout(buildArtistTagsUrl(base, q));
  const list = Array.isArray(json) ? json : [];
  return list
    .filter((t) => t && t.name)
    .map((t) => ({ name: t.name, post_count: +t.post_count || 0 }));
}

async function fetchArtistPreview(base, tag) {
  const json = await fetchJsonWithTimeout(buildArtistPostsUrl(base, tag));
  const list = Array.isArray(json) ? json : [];
  return list.map((p) => p.preview_file_url).filter(Boolean).slice(0, ARTIST_PREVIEW_COUNT);
}

function filterOfflineArtists(q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  return OFFLINE_ARTISTS
    .filter((a) => a.name.toLowerCase().includes(s) || (a.note || "").toLowerCase().includes(s))
    .map((a) => ({ name: a.name, post_count: null, note: a.note, offline: true }));
}
