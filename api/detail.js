import * as cheerio from "cheerio";

const BASE_URL = "https://oploverz.site/";
const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function resolveUrl(value, baseUrl) { if (!value) return null; try { return new URL(value, baseUrl).href; } catch { return value; } }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function metaContent($, selector) { return cleanText($(selector).first().attr("content")) || null; }

async function fetchPage(url) {
    const response = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error("Failed to fetch detail page");
    return await response.text();
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
    const number = text.match(/(?:Episode|Movie)\s*(\d+)/i)?.[1] ?? null;
    return { title: text, episodeNumber: number, url };
}

export default async function handler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL parameter required" });

    try {
        const html = await fetchPage(url);
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
            const u = resolveUrl($(el).attr("href"), url);
            const t = cleanText($(el).text());
            return /\/movie\/[^/]+\/\d+\/?$/i.test(u) && t && !/^Watch Now$/i.test(t);
        });

        const episodes = unique(epEls.map(el => resolveUrl($(el).attr("href"), url)))
            .map(u => {
                const el = epEls.find(c => resolveUrl($(c).attr("href"), url) === u);
                return el ? parseEpisodeLink($, el, url) : null;
            }).filter(Boolean);

        const poster = resolveUrl($("img[src*='/posters/']").first().attr("src"), url);

        return res.json({
            success: true,
            data: { title, japaneseTitle, description, poster, genres, score, type: metadata.type, studio: metadata.studio, status: metadata.status, episodes }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}
