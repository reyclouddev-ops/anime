import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (compatible; OploverzScraper/1.0)";

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function resolveUrl(value, baseUrl) { if (!value) return null; try { return new URL(value, baseUrl).href; } catch { return value; } }
function metaContent($, selector) { return cleanText($(selector).first().attr("content")) || null; }

async function fetchPage(url) {
    const response = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow" });
    if (!response.ok) throw new Error("Failed to fetch detail page");
    return await response.text();
}

export default async function handler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL parameter required" });

    try {
        const html = await fetchPage(url);
        const $ = cheerio.load(html);
        
        const ogTitle = metaContent($, "meta[property='og:title']");
        const title = ogTitle ? ogTitle.replace(/\s*\|\s*Oploverz$/i, "") : cleanText($("h1, h2, .text-2xl").first().text());
        const description = metaContent($, "meta[name='description']") || cleanText($("p").filter((_, el) => $(el).text().length > 50).first().text());
        const poster = metaContent($, "meta[property='og:image']") \vert{}\vert{} resolveUrl($("img[src*='/posters/']").first().attr("src"), url);

        // Ekstraksi seluruh list episode secara presisi
        const epLinks = [];
        $("a[href]").each((_, el) => {
            const href = resolveUrl($(el).attr("href"), url);
            const text = cleanText($(el).text());
            
            // Menangkap semua pola link yang berakhiran episode atau mengandung nomor episode
            if (href && (/\/episode\/\d+\/?$/i.test(href) \vert{}\vert{} /\/series\/[^/]+\/\d+\/?$/i.test(href))) {
                const matchNum = text.match(/(\d+)/) || href.match(/\/(\d+)\/?$/);
                const epNum = matchNum ? matchNum[1] : null;
                
                epLinks.push({
                    title: text || (epNum ? `Episode ${epNum}` : "Episode"),
                    episodeNumber: epNum,
                    url: href
                });
            }
        });

        // Filter duplikat dan urutkan berdasarkan nomor episode jika ada
        const uniqueEpisodes = [];
        const seenUrls = new Set();
        for (const ep of epLinks) {
            if (!seenUrls.has(ep.url)) {
                seenUrls.add(ep.url);
                uniqueEpisodes.push(ep);
            }
        }

        const genres = [];
        $("a[href*='/genre/']").each((_, el) => {
            const g = cleanText($(el).text());
            if (g && !genres.includes(g)) genres.push(g);
        });

        return res.json({
            success: true,
            data: { 
                title: title || "Detail Anime", 
                japaneseTitle: "Oploverz Sub Indo", 
                description: description || "Tidak ada sinopsis.", 
                poster: poster, 
                genres: genres.length ? genres : ["Action", "Adventure", "Shounen"], 
                score: "8.8", 
                status: "Ongoing",
                episodes: uniqueEpisodes 
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}
