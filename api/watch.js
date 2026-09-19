import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function resolveUrl(value, baseUrl) { if (!value) return null; try { return new URL(value, baseUrl).href; } catch { return value; } }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function metaContent($, selector) { return cleanText($(selector).first().attr("content")) || null; }

async function fetchPage(url) {
    const response = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error("Failed to fetch watch page");
    return await response.text();
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

export default async function handler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL parameter required" });

    try {
        const html = await fetchPage(url);
        const $ = cheerio.load(html);
        const ogTitle = metaContent($, "meta[property='og:title']");
        const title = cleanText($("div[role='heading']").first().text()) || ogTitle || "Streaming Anime";
        
        const embedded = extractEmbeddedStreamSources(html, url);
        const resolvedVideo = embedded.length > 0 ? await resolveStreamSource(embedded[0]) : null;

        return res.json({
            success: true,
            data: { title, videoUrl: resolvedVideo }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}
