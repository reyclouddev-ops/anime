import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- CORE SCRAPER (By Ryusei Hoshino) ---
const BASE_URL = "https://oploverz.site/";
const API_BASE_URL = "https://backapi.oploverz.ac";
const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function resolveUrl(value, baseUrl) { if (!value) return null; try { return new URL(value, baseUrl).href; } catch { return value; } }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function metaContent($, selector) { return cleanText($(selector).first().attr("content")) || null; }

async function fetchPage(url) {
    const target = new URL(url, BASE_URL).href;
    const response = await fetch(target, { headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error(`Failed to fetch ${target}`);
    return { html: await response.text(), url: response.url || target };
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return await response.json();
}

function findHeading($, text) { return $("h1, h2, h3, p").filter((_, el) => cleanText($(el).text()) === text).first(); }
function carouselRoots($) { return $("[data-embla-container]").toArray(); }
function rootAfterHeading($, roots, headingText) { const heading = findHeading($, headingText).get(0); if (!heading) return roots[0] ?? null; const all = $("*").toArray(); return roots.find(r => all.indexOf(r) > all.indexOf(heading)) ?? null; }

function parseCardSlide($, slide, baseUrl) {
    const imgEl = $(slide).find("img").first();
    const image = resolveUrl(imgEl.attr("src"), baseUrl);
    const title = cleanText(imgEl.attr("alt")) || null;
    const links = $(slide).find("a[href]").toArray().map(el => resolveUrl($(el).attr("href"), baseUrl));
    const url = links.find(l => { try { const p = new URL(l).pathname; return p.startsWith("/series/") || p.startsWith("/movie/"); } catch { return false; } }) ?? null;
    return { title, image, url, type: url && url.includes("/movie/") ? "movie" : "series" };
}

function parseLatestEpisodeCard($, card, baseUrl) {
    const linkEl = $(card).find("a[href]").toArray().find(el => /\/episode\/\d+\/?$/i.test(resolveUrl($(el).attr("href"), baseUrl)));
    const url = resolveUrl(linkEl ? $(linkEl).attr("href") : null, baseUrl);
    const image = resolveUrl($(card).find("img").first().attr("src"), baseUrl);
    const paras = $(card).find("p").toArray().map(el => cleanText($(el).text())).filter(Boolean);
    const episode = paras.find(t => /^Episode\s+\d+$/i.test(t)) ?? null;
    const title = paras.find(t => t !== episode && !/^\d+\s*(?:s|m|h|d)$/i.test(t)) ?? null;
    return { title, episode, image, url };
}

function parseHomepageHtml(html, sourceUrl) {
    const $ = cheerio.load(html);
    const roots = carouselRoots($);
    const trendingRoot = rootAfterHeading($, roots, "Sedang Trending");
    const newlyAddedRoot = rootAfterHeading($, roots, "Tayangan Baru Ditambahkan");
    const latestHeading = findHeading($, "Rilis Terbaru");
    const latestGrid = latestHeading.length ? latestHeading.parent().find(".grid").filter((_, el) => $(el).find(".bg-card").length > 0).first() : $();

    const trending = (trendingRoot ? $(trendingRoot).find("[data-embla-slide]").toArray() : []).map(s => parseCardSlide($, s, sourceUrl));
    const latestEpisodes = latestGrid.length ? latestGrid.find(".bg-card").toArray().map(c => parseLatestEpisodeCard($, c, sourceUrl)) : [];
    const newlyAdded = (newlyAddedRoot ? $(newlyAddedRoot).find("[data-embla-slide]").toArray() : []).map(s => parseCardSlide($, s, sourceUrl));

    return { trending, latestEpisodes, newlyAdded };
}

function parseMetadataList($) {
    const metaEl = $("li").filter((_, el) => /^Type:/i.test(cleanText($(el).text()))).first().parent();
    const metadata = {};
    metaEl.find("li").each((_, el) => {
        const text = cleanText($(el).text());
        const sep = text.indexOf(":");
        if (sep !== -1) metadata[cleanText(text.slice(0, sep)).toLowerCase().replace(/\s+/g, "_")] = cleanText(text.slice(sep + 1));
    });
    return metadata;
}

function parseEpisodeLink($, el, baseUrl) {
    const url = resolveUrl($(el).attr("href"), baseUrl);
    const text = cleanText($(el).text());
    const title = text;
    const number = title.match(/(?:Episode|Movie)\s*(\d+)/i)?.[1] ?? null;
    return { title, episodeNumber: number, url };
}

function parseMovieDetailHtml(html, sourceUrl) {
    const $ = cheerio.load(html);
    const titleEl = $("p.text-2xl").first();
    const ogTitle = metaContent($, "meta[property='og:title']");
    const title = cleanText(titleEl.text()) || ogTitle?.replace(/\s*\|\s*Oploverz$/i, "") || null;
    const japaneseTitle = titleEl.length ? cleanText(titleEl.nextAll("p").first().text()) || null : null;
    const description = titleEl.length ? cleanText(titleEl.nextAll("p").eq(1).text()) || metaContent($, "meta[name='description']") : "";
    const metadata = parseMetadataList($);
    const genres = cleanText(metadata.genre).split(",").map(g => cleanText(g)).filter(Boolean);
    const score = metadata.score?.match(/\d+(?:\.\d+)?/)?.[0] || null;

    const epEls = $("a[href]").toArray().filter(el => {
        const u = resolveUrl($(el).attr("href"), sourceUrl);
        const t = cleanText($(el).text());
        return /\/movie\/[^/]+\/\d+\/?$/i.test(u) && t && !/^Watch Now$/i.test(t);
    });

    const episodes = unique(epEls.map(el => resolveUrl($(el).attr("href"), sourceUrl)))
        .map(u => {
            const el = epEls.find(c => resolveUrl($(c).attr("href"), sourceUrl) === u);
            return el ? parseEpisodeLink($, el, sourceUrl) : null;
        }).filter(Boolean);

    const poster = resolveUrl($("img[src*='/posters/']").first().attr("src"), sourceUrl);
    return { title, japaneseTitle, description, poster, genres, score, type: metadata.type, studio: metadata.studio, status: metadata.status, episodes };
}

function extractEmbeddedStreamSources(html, baseUrl) {
    const sources = [];
    for (const match of html.matchAll(/streamUrl:\s*\[(.*?)\]/gs)) {
        for (const objMatch of match[1].matchAll(/\{[^{}]*\}/gs)) {
            const body = objMatch[0];
            const source = body.match(/source:\s*"([^"]+)"/)?.[1] ?? null;
            const url = body.match(/url:\s*"([^"]+)"/)?.[1] ?? null;
            if (source && url) sources.push({ source, url: resolveUrl(url, baseUrl) });
        }
    }
    return unique(sources.map(s => JSON.stringify(s))).map(s => JSON.parse(s));
}

function extractFiledonMediaUrl(html) {
    const $ = cheerio.load(html);
    const dataPage = $("#app[data-page]").first().attr("data-page");
    if (!dataPage) return null;
    try {
        const payload = JSON.parse(dataPage);
        return payload?.props?.media?.hls_url || payload?.props?.url || null;
    } catch { return null; }
}

async function resolveStreamSource(source) {
    try {
        const res = await fetch(source.url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
        if (!res.ok) return source.url;
        const html = await res.text();
        return extractFiledonMediaUrl(html) || res.url || source.url;
    } catch { return source.url; }
}

async function parseWatchHtml(html, sourceUrl) {
    const $ = cheerio.load(html);
    const ogTitle = metaContent($, "meta[property='og:title']");
    const title = cleanText($("div[role='heading']").first().text()) || ogTitle || "Streaming Anime";
    const embedded = extractEmbeddedStreamSources(html, sourceUrl);
    const resolvedVideo = embedded.length > 0 ? await resolveStreamSource(embedded[0]) : null;
    return { title, videoUrl: resolvedVideo };
}

// --- API ROUTES ---
app.get("/api/home", async (req, res) => {
    try {
        const page = await fetchPage(BASE_URL);
        const data = parseHomepageHtml(page.html, page.url);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get("/api/search", async (req, res) => {
    try {
        const q = req.query.q;
        if (!q) return res.json({ success: true, data: [] });
        const payload = await fetchJson(`${API_BASE_URL}/api/series?q=${encodeURIComponent(q)}`);
        const data = (payload?.data || []).map(s => ({
            title: s.title,
            image: s.poster || s.banner,
            url: s.slug ? resolveUrl(`/series/${s.slug}`, BASE_URL) : null
        }));
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get("/api/detail", async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ success: false, message: "URL required" });
        const page = await fetchPage(url);
        const data = parseMovieDetailHtml(page.html, page.url);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get("/api/watch", async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ success: false, message: "URL required" });
        const page = await fetchPage(url);
        const data = await parseWatchHtml(page.html, page.url);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Jalankan server lokal jika dijalankan di PC
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🔥 Website AnimeKu berjalan di http://localhost:${PORT}`);
    });
}

// Export agar bisa dibaca oleh Vercel Serverless Function
export default app;
