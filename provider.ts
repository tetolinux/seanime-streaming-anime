/// <reference path="./online-streaming-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
    api = "https://aniwaves.ru";
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://aniwaves.ru/",
        "X-Requested-With": "XMLHttpRequest"
    };

    getSettings(): Settings {
        return {
            episodeServers: ["VidCloud", "UpCloud", "StreamSB"],
            supportsDub: true
        };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        // Aniwaves uses a specific search endpoint that returns HTML fragments
        const req = await fetch(`${this.api}/ajax/search/suggest?keyword=${encodeURIComponent(opts.query)}`, {
            headers: this.headers
        });

        if (!req.ok) return [];
        
        const html = await req.text();
        const $ = LoadDoc(html);
        const results: SearchResult[] = [];

        // Parse search results from the suggestion dropdown/list
        $(".nav-item").each((_, el) => {
            const anchor = $(el).find("a");
            const title = anchor.find(".film-title").text().trim() || anchor.attr("title");
            const url = anchor.attr("href") || "";
            
            // Determine sub/dub status from badges or text
            const typeText = $(el).find(".tick-sub, .tick-dub").text().toLowerCase();
            let subOrDub: SubOrDub = "sub";
            if (typeText.includes("dub")) subOrDub = "dub";
            if (typeText.includes("sub") && typeText.includes("dub")) subOrDub = "both";

            // Extract ID from URL (usually /watch/{slug}-{id})
            const idMatch = url.match(/\/watch\/([^?]+)/);
            const id = idMatch ? idMatch[1] : url.replace(this.api, "");

            if (title && id) {
                results.push({ id, title, url: `${this.api}${url}`, subOrDub });
            }
        });

        return results;
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        // Extract anime ID from the full URL or raw ID
        const animeId = id.includes("-") ? id.split("-").pop() : id;
        const targetUrl = id.startsWith("http") ? id : `${this.api}/watch/${id}`;
        
        // Fetch main page to get initial data and verify existence
        const req = await fetch(targetUrl, { headers: this.headers });
        if (!req.ok) throw new Error("Failed to load anime details.");
        
        const html = await req.text();
        const $ = LoadDoc(html);
        const episodes: EpisodeDetails[] = [];

        // Aniwaves loads episodes via AJAX: /ajax/v2/episode/list/{animeId}
        const epReq = await fetch(`${this.api}/ajax/v2/episode/list/${animeId}`, {
            headers: this.headers
        });

        if (!epReq.ok) throw new Error("Failed to fetch episode list.");
        
        const epHtml = await epReq.text();
        const ep$ = LoadDoc(epHtml);

        // Parse episodes from the AJAX response
        ep$(".item").each((_, el) => {
            const link = $(el).find("a");
            const epNum = parseInt(link.attr("data-number") || "0", 10);
            const epId = link.attr("data-id") || "";
            const title = link.attr("title") || `Episode ${epNum}`;
            
            if (epId && epNum > 0) {
                episodes.push({
                    id: epId, // Store episode ID for server fetching
                    number: epNum,
                    url: `${this.api}/ajax/v2/episode/servers?episodeId=${epId}`,
                    title: title
                });
            }
        });

        return episodes.sort((a, b) => a.number - b.number);
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        // Fetch server list for this episode
        const req = await fetch(episode.url, { headers: this.headers });
        if (!req.ok) throw new Error("Could not access episode server list.");

        const html = await req.text();
        const $ = LoadDoc(html);
        
        // Map server names to their data attributes
        let serverBtn: any = null;
        const serverName = _server === "default" ? "VidCloud" : _server;
        
        // Find the button matching the requested server
        $(".item").each((_, el) => {
            const btn = $(el);
            const name = btn.attr("data-type") || btn.text().trim();
            if (name.toLowerCase().includes(serverName.toLowerCase())) {
                serverBtn = btn;
                return false; // break loop
            }
        });

        if (!serverBtn) throw new Error(`Server [${_server}] not found for this episode.`);

        const serverId = serverBtn.attr("data-id");
        const serverType = serverBtn.attr("data-type"); // 'sub' or 'dub'

        // Fetch actual source links: /ajax/v2/episode/sources?id={serverId}
        const sourceReq = await fetch(`${this.api}/ajax/v2/episode/sources?id=${serverId}`, {
            headers: this.headers
        });

        if (!sourceReq.ok) throw new Error("Failed to fetch video sources.");
        
        const sourceData = await sourceReq.json() as { link: string; type?: string };
        let streamUrl = sourceData.link || "";

        // Handle encrypted links (common on Aniwaves/Zoro clones)
        if (streamUrl && !streamUrl.startsWith("http")) {
            try {
                // Simple decryption for standard Zoro/Aniwaves encryption
                // Note: Real implementation might need CryptoJS if heavily encrypted
                const decoded = atob(streamUrl);
                streamUrl = decoded;
            } catch (e) {
                console.warn("Decryption failed, using raw link");
            }
        }

        const videoSources: VideoSource[] = [{
            url: streamUrl,
            type: streamUrl.includes(".m3u8") ? "m3u8" : "mp4",
            quality: "Auto",
            subtitles: []
        }];

        return {
            server: serverName,
            headers: { 
                ...this.headers, 
                "Referer": `${this.api}/`,
                "Origin": this.api
            },
            videoSources
        };
    }
}
