/// <reference path="./online-streaming-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
    api = "https://gogoanime.by";
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://gogoanime.by/"
    };

    getSettings(): Settings {
        return {
            episodeServers: ["Fast Server", "HD"],
            supportsDub: false // This site appears to be Sub-only based on structure
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

        // GogoAnime.by uses standard WordPress post loops for search
        $(".post-item, article").each((_, el) => {
            const anchor = $(el).find("a.title, h2 a");
            const title = anchor.text().trim();
            const url = anchor.attr("href") || "";
            
            // Check for sub/dub indicators in badges
            const typeText = $(el).find(".type, .badge").text().toLowerCase();
            let subOrDub: SubOrDub = "sub";
            if (typeText.includes("dub")) subOrDub = "dub";

            // Extract ID from URL slug
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
        
        if (!req.ok) throw new Error("Failed to load anime details.");
        
        const html = await req.text();
        const $ = LoadDoc(html);
        const episodes: EpisodeDetails[] = [];

        // Look for episode list in navigation or dedicated episode containers
        // GogoAnime.by often lists episodes in .naveps or specific episode grids
        $(".episode-list li, .naveps a, .episodes-grid a").each((_, el) => {
            const anchor = $(el).find("a") || $(el);
            const url = anchor.attr("href") || "";
            const title = anchor.text().trim() || $(el).attr("title");
            
            // Extract episode number from title or URL
            const epMatch = title.match(/Episode\s*(\d+)/i) || url.match(/episode[-_](\d+)/i);
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

        // Fallback: If no list found, check if current page IS an episode page
        if (episodes.length === 0 && html.includes("player-type-link")) {
            const title = $("h1.entry-title").text().trim();
            const epMatch = title.match(/Episode\s*(\d+)/i);
            episodes.push({
                id: id,
                number: epMatch ? parseInt(epMatch[1], 10) : 1,
                url: targetUrl,
                title: title || "Episode 1"
            });
        }

        return episodes.sort((a, b) => a.number - b.number);
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const targetUrl = episode.id.startsWith("http") ? episode.id : `${this.api}${episode.id}`;
        const req = await fetch(targetUrl, { headers: this.headers });

        if (!req.ok) throw new Error("Could not access episode page.");
        
        const html = await req.text();
        const $ = LoadDoc(html);

        // Find the server button matching the requested name
        let serverBtn: any = null;
        const serverName = _server === "default" ? "Fast Server" : _server;

        $(".player-type-link").each((_, el) => {
            const btn = $(el);
            const name = btn.text().trim();
            if (name.toLowerCase().includes(serverName.toLowerCase())) {
                serverBtn = btn;
                return false;
            }
        });

        if (!serverBtn) throw new Error(`Server [${_server}] not found.`);

        // Extract encrypted data attributes
        const enc1 = serverBtn.attr("data-encrypted-url1") || "";
        const enc2 = serverBtn.attr("data-encrypted-url2") || "";
        const enc3 = serverBtn.attr("data-encrypted-url3") || "";
        const plainUrl = serverBtn.attr("data-plain-url") || "";
        const dataType = serverBtn.attr("data-type") || "Blogger";

        let streamUrl = "";

        // Handle direct embeds (like 'embed' type which uses megaplay.su)
        if (dataType === "embed" && plainUrl) {
            streamUrl = plainUrl;
        } 
        // Handle encrypted servers that use 9animetv.be proxy
        else if (enc1) {
            // Construct the proxy URL exactly as the site's JS does
            const params = new URLSearchParams();
            params.append(dataType, enc1);
            if (enc2) params.append('url2', enc2);
            if (enc3) params.append('url3', enc3);
            params.append('feature_image', '');
            params.append('user_agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1');
            params.append('ref', 'gogoanime.by');
            params.append('postId', '0'); // Default fallback

            streamUrl = `https://9animetv.be/wp-content/plugins/video-player/includes/player/player.php?${params.toString()}`;
        }

        if (!streamUrl) throw new Error("Failed to resolve video source.");

        const videoSources: VideoSource[] = [{
            url: streamUrl,
            type: streamUrl.includes(".m3u8") ? "m3u8" : "unknown",
            quality: serverName,
            subtitles: []
        }];

        return {
            server: serverName,
            headers: { 
                ...this.headers, 
                "Referer": "https://9animetv.be/",
                "Origin": "https://9animetv.be"
            },
            videoSources
        };
    }
}
