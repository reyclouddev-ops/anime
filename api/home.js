import * as cheerio from "cheerio";

const BASE_URL = "https://oploverz.site/";
const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function resolveUrl(value, baseUrl) { if (!value) return null; try { return new URL(value, baseUrl).href; } catch { return value; } }

async function fetchPage(url) {
    const response = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error("Failed to fetch");
    return await response.text();
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
    return { title, image, url };
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

export default async function handler(req, res) {
    try {
        const html = await fetchPage(BASE_URL);
        const $ = cheerio.load(html);
        const roots = carouselRoots($);
        const trendingRoot = rootAfterHeading($, roots, "Sedang Trending");
        const latestHeading = findHeading($, "Rilis Terbaru");
        const latestGrid = latestHeading.length ? latestHeading.parent().find(".grid").filter((_, el) => $(el).find(".bg-card").length > 0).first() : $();

        const trending = (trendingRoot ? $(trendingRoot).find("[data-embla-slide]").toArray() : []).map(s => parseCardSlide($, s, BASE_URL));
        const latestEpisodes = latestGrid.length ? latestGrid.find(".bg-card").toArray().map(c => parseLatestEpisodeCard($, c, BASE_URL)) : [];

        return res.json({ success: true, data: { trending, latestEpisodes } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}
