/// <reference path="./online-streaming-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
    api = "https://animepahe.ch";
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://animepahe.ch/"
    };

    getSettings(): Settings {
        return {
            episodeServers: ["HD 1", "HD 2", "HD 3"],
            supportsDub: true
        };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const req = await fetch(`${this.api}/?s=${encodeURIComponent(opts.query)}`, {
            headers: this.headers
        });

        if (!req.ok) return [];
        
        const html = await req.text();
        const $ = LoadDoc(html);
        const results: SearchResult[] = [];

        $(".listupd article.bs").each((_, el) => {
            const anchor = $(el).find("a");
            const title = anchor.attr("title") || $(el).find("h2").text();
            const url = anchor.attr("href") || "";
            
            const typeText = $(el).find(".sb").text().toLowerCase();
            let subOrDub: SubOrDub = "sub";
            if (typeText.includes("dub")) subOrDub = "dub";
            if (typeText.includes("both")) subOrDub = "both";

            const id = url.replace(this.api, "").replace(/\/$/, "");

            if (title && id) {
                results.push({ id, title, url, subOrDub });
            }
        });

        return results;
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const targetUrl = id.startsWith("http") ? id : `${this.api}${id}`;
        const req = await fetch(targetUrl, { headers: this.headers });
        
        if (!req.ok) throw new Error("Failed to load episode index mapping details.");
        
        const html = await req.text();
        const $ = LoadDoc(html);
        const episodes: EpisodeDetails[] = [];

        $(".episodelist ul li").each((_, el) => {
            const anchor = $(el).find("a");
            const url = anchor.attr("href") || "";
            const title = anchor.find("h3").text().trim();
            
            const infoText = anchor.find(".playinfo span").text(); 
            const epMatch = infoText.match(/Eps\s*(\d+)/i);
            const epNumber = epMatch ? parseInt(epMatch[1], 10) : episodes.length + 1;

            const epId = url.replace(this.api, "").replace(/\/$/, "");

            if (epId) {
                episodes.push({
                    id: epId,
                    number: epNumber,
                    url,
                    title: title || `Episode ${epNumber}`
                });
            }
        });

        return episodes.reverse();
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const targetUrl = episode.id.startsWith("http") ? episode.id : `${this.api}${episode.id}`;
        const req = await fetch(targetUrl, { headers: this.headers });

        if (!req.ok) throw new Error("Could not access targeted multi-server gateway panel.");
        
        const html = await req.text();
        const $ = LoadDoc(html);

        let targetIndex = 0; 
        if (_server === "HD 2") targetIndex = 1;
        if (_server === "HD 3") targetIndex = 2;

        const embedTab = $(`.gov-all-host .gov-the-embed[data-index='${targetIndex}']`);
        if (!embedTab.length) {
            throw new Error(`Requested video host mirror configuration [${_server}] is unavailable.`);
        }

        const onClickAttr = embedTab.attr("onclick") || "";
        // Safer regex for JSON embedding: matches content between single quotes
        const base64Match = onClickAttr.match(/putMi\(\s*this\s*,\s*'([^']+)'\s*\)/);

        if (!base64Match || !base64Match[1]) {
            throw new Error("Unable to parse inner encrypted server source data strings.");
        }

        const decodedIframeHtml = atob(base64Match[1]);
        const iframe$ = LoadDoc(decodedIframeHtml);
        const videoEmbedUrl = iframe$("iframe").attr("src") || "";

        if (!videoEmbedUrl) {
            throw new Error("Failed to extract external network stream video source context parameters.");
        }

        const videoSources: VideoSource[] = [];

        if (videoEmbedUrl.includes("blogger.com")) {
            videoSources.push({
                url: videoEmbedUrl,
                type: "unknown", 
                quality: "Blogger HD Stream (Default)",
                subtitles: []
            });
        } else if (videoEmbedUrl.includes("ok.ru")) {
            videoSources.push({
                url: videoEmbedUrl.startsWith("//") ? `https:${videoEmbedUrl}` : videoEmbedUrl,
                type: "unknown",
                quality: "OK.ru Mirror Premium",
                subtitles: []
            });
        } else {
            videoSources.push({
                url: videoEmbedUrl,
                type: videoEmbedUrl.includes(".m3u8") ? "m3u8" : "unknown",
                quality: "Alternative Direct Feed",
                subtitles: []
            });
        }

        return {
            server: _server === "default" ? "HD 1" : _server,
            headers: { ...this.headers, "Referer": this.api },
            videoSources
        };
    }
}
