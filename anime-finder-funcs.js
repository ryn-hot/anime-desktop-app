delete globalThis.fetch;

import anitomy from 'anitomyscript';
import fetch from 'node-fetch';
import levenshtein from 'fast-levenshtein';
import { JSDOM } from "jsdom";


async function parse_title(title) {
    let results = await anitomy(title);
    return results;
}

// season_data is the data extracted from parse_title
async function seadex_finder(alID, dub, episode) {
    const rec_url = `https://releases.moe/api/collections/entries/records?filter=alID=${alID}`;
    const response = await fetch(rec_url);
    const data = await response.json();

    const trsList = data.items[0].trs;
    console.log(trsList);

    let entries = [];

    for (const trs of trsList) {
        const url = `https://releases.moe/api/collections/torrents/records/${trs}`;
        console.log(url)
        const response = await fetch(url);
        //console.log(response);
        const data = await response.json();
        if (!(data.url.includes("nyaa"))) {
            continue;
        }
        if (dub === true && data.dualAudio === false) {
            continue;
        }

        const nyaa_response = await fetch(data.url); 
        const html = await nyaa_response.text();
        //console.log(html);
        const mkvFiles = extractMkvFiles(html);
        let containsEpisode = false;
        let targetEpData = null; 

        if (!(episode === undefined)) {

            for (const mkvFile of mkvFiles) {
                console.log(mkvFile);
                const episode_info = await parse_title(mkvFile);
                if (episode_info.episode_number == episode) {
                    containsEpisode = true;
                    targetEpData = episode_info;
                }
            }

            if (!containsEpisode) {
                continue;
            }

        }
    
        
        const num_seeders = extractSeeders(html);
        console.log(num_seeders);
        const infoHash = extractInfoHash(html)
        console.log(infoHash);
        const magnetLink = extractMagnetLink(html);
        console.log(magnetLink);
        const items = data;
        const entry = {
            magnetLink: magnetLink,
            infoHash: infoHash,
            seeders: num_seeders,
            DualAudio: data.dualAudio,
            isBest: data.isBest,
            episodeData: targetEpData,
            
        };
        entries.push(entry);
    }

    console.log(entries);
    return entries
}

async function anime_dex_finder(query, set_title, season_number, episode_number, dub) {

    let page_condition = true;
    let offset = 0;
    let offset_limit = 500;
    let idValue = `1,3`;

    if (dub == true) {
        idValue = `3`;
    }
    else {
        idValue = '1';
    }

    let torrentList = [];
    let ephemTrsList = [];

    while (page_condition) {
        const anidex_query_url = `https://anidex.info/?q=${query}&id=${idValue}&offset=${offset}`;

        console.log(anidex_query_url);

        const response = await fetch(anidex_query_url);

        const html = await response.text();

        console.log(html);

        const parser = new JSDOM(html); //new DOMParser(); change when implemented in browser
        const doc = parser.window.document; //const doc = parser.parseFromString(html, 'text/html');
    
        const trElements = doc.querySelectorAll('tr'); 

        // Iterate over each <tr> element
        trElements.forEach(tr => {
            const data = {};
        
            // Extract the language
            const langTd = tr.querySelector('td.text-center');
            if (langTd) {
            const img = langTd.querySelector('img');
            if (img) {
                data.language = img.getAttribute('title');
            }
            }
        
            // Extract the title
            const titleLink = tr.querySelector('a.torrent');
            if (titleLink) {
            const span = titleLink.querySelector('span');
            if (span) {
                data.title = span.getAttribute('title');
            }
            }
        
            // Extract the magnet link
            const magnetLinkElement = tr.querySelector('a[href^="magnet:"]');
            if (magnetLinkElement) {
            data.magnetLink = magnetLinkElement.getAttribute('href');
            }
        
            // Extract the seeders
            const seedersTd = tr.querySelector('td.text-success.text-right');
            if (seedersTd) {
            data.seeders = seedersTd.textContent.trim();
            }
        
            // Output the extracted data
            console.log(data);
        });
        
        offset = offset + 50;

        if (offset > offset_limit) {
            page_condition = false;
        }

    }
}

async function nyaa_html_finder(query, set_title, season_number, episode_number, dub) {
    let page_number = 1;
    let page_condition = true;
    let page_limit = 0;
    let torrentList = [];
    let ephemTrsList = [];

    while (page_condition) {
        const nyaa_query_url = `https://nyaa.si/?f=0&c=1_2&q=${query}&s=seeders&o=desc&p=${page_number}`; //&s=seeders&o=desc     `https://nyaa.si/?f=0&c=1_2&q=${query}&p=${page_number}`
        console.log(nyaa_query_url);
        const response = await fetch(nyaa_query_url);
        const html = await response.text();
        

        console.log(`processing page number ${page_number}`);

        ephemTrsList = ephemTrsList.concat(extractTorrentData(html));


        if (page_number == 1) {
            const last_page_num = extractPageNumberNyaa(html)
            //console.log(last_page_num);
            page_limit = last_page_num + 1;
        }

        page_number += 1;

        if (page_number >= page_limit) {
            page_condition = false;
        }

    }

    for (const torrent of ephemTrsList) {
        console.log(`\nTitle Eval: ${torrent.title}`);
        console.log(typeof torrent.title);
        let title = replaceTildeWithHyphen(torrent.title);
        title = removeSpacesAroundHyphens(title);
        const torrent_info = await parse_title(title);
        
        const lev_distance  = levenshtein.get(set_title.toLowerCase(), torrent_info.anime_title.toLowerCase());

        if (lev_distance > 1) {
            console.log("Title Mismatch");
            console.log(`Set Title: ${set_title}, Torrent Info Title: ${torrent_info.anime_title}`)
            continue;
        }

        if (season_number != torrent_info.anime_season) {
            if ((season_number != 1 && season_number != undefined) || torrent_info.anime_season != undefined) {
                console.log("Season Number Mismatch");
                continue; 
            }
        } 


        const episode_int = convertToIntegers(torrent_info.episode_number);

        if (episode_int.length >= 1) {
            const range = getRange(episode_int);

            if (!range.includes(episode_number)) {
                console.log(`Episode Not in Range: ${range}, Episode Number: ${episode_number}`);
                continue;
            }
        }
        else {

            if (season_number != undefined && episode_number != undefined) {
                    console.log(`Episode Not in Range: Query for TV Series`);
                    continue;
            }
            
        }


        if (dub === true && !hasDualAudioOrEnglishDub(torrent.title)) {
            console.log(`Episode does not have English Dub`);
            continue;
        }

        console.log(`Torrent Added`);
        torrentList.push(torrent); 

    }

    return torrentList;

}



async function test_server_id() {
    const server_url = `https://watch.hikaritv.xyz/ajax/embedserver/16498/1`;
    const server_response = await fetch(server_url);
    const data = await server_response.json();
    const embedID = data.embedFirst;
    console.log(embedID);

    const response = await fetch(`https://watch.hikaritv.xyz/ajax/embed/16498/1/${embedID}`);
    const embedData = await response.json();
    console.log(embedData);
}

async function hikaritv_anime_extract(alID, title_romanji, episode) {
    try {

        const server_url = `https://watch.hikaritv.xyz/ajax/embedserver/${alID}/${episode}`;
        const server_response = await fetch(server_url);
        const serverData = await server_response.json();
        const embedID = serverData.embedFirst;
        console.log(embedID);

        if (embedID) {
            const response = await fetch(`https://watch.hikaritv.xyz/ajax/embed/${alID}/${episode}/${embedID}`);
            const embedData = response.json();
            console.log(embedData);
            const embeddedLink = extractSrcUsingRegex(embedData);
            return [embeddedLink];
        }
        else {
            return []
        }
    }
    catch (error) {
        console.error('Error extracting iframe src:', error);
        throw error; // Re-throw the error after logging it
    }
}


function replaceTildeWithHyphen(title) {
    if (typeof title !== 'string') {
        throw new TypeError('The input must be a string.');
    }
    return title.replace(/~/g, '-');
}

function getRange(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) {
      throw new Error("Input must be a non-empty array of numbers");
    }
  
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
  
    const range = [];
    for (let i = min; i <= max; i++) {
      range.push(i);
    }
  
    return range;
}

function spaceToUnderscore(str) {
    return str.replace(/\s/g, '_');
}

function extractSrcUsingRegex(iframeHtml) {
    const srcRegex = /src="([^"]+)"/;
    const match = iframeHtml.match(srcRegex);
    return match ? match[1] : null;
}

function convertToIntegers(input) {
    // Helper function to convert a single string to an integer
    function stringToInt(str) {
      return parseInt(str, 10);
    }
  
    // Helper function to handle interval strings
    function handleInterval(str) {
      const [start, end] = str.split('-').map(stringToInt);
      return [start, end];
    }
    
    if (input == undefined) {
        return 0;
    }
    // If input is a string
    if (typeof input === 'string') {
      // Check if it's an interval
      if (input.includes('-')) {
        return handleInterval(input);
      }
      // Otherwise, it's a single number
      return [stringToInt(input)];
    }
  
    // If input is an array
    if (Array.isArray(input)) {
      return input.map(stringToInt);
    }
  
    // If input is neither a string nor an array
    throw new Error('Input must be a string or an array of strings');
}

function hasDualAudioOrEnglishDub(title) {
    // Define the regex pattern
    const pattern = /\b(?:dual\s*[-_]?\s*audio|english\s*[-_]?\s*dub)\b/i;
    
    // Test the title against the regex
    return pattern.test(title);
}


function extractTorrentData(html) {
    const results = [];

    // Regex to match each <tr> with class default, danger, or success
    const trRegex = /<tr\s+class="(?:default|danger|success)">([\s\S]*?)<\/tr>/g;
    let trMatch;

    while ((trMatch = trRegex.exec(html)) !== null) {
        const trContent = trMatch[1];

        //console.log(trContent);

        // Extract the title and href from the <a> tag within the second <td colspan="2">
        // Use negative lookahead to skip <a> tags with class="comments"
        const titleHrefRegex = /<td\s+colspan="2">[\s\S]*?<a(?![^>]*class=["']comments["'])[^>]*href="([^"#]+)"[^>]*title="([^"]+)">[^<]+<\/a>/;
        const titleHrefMatch = trContent.match(titleHrefRegex);
        const href = titleHrefMatch ? titleHrefMatch[1] : null;
        const title = titleHrefMatch ? titleHrefMatch[2] : null;
        const url = `https://nyaa.si` + href;

        //console.log(`Title: ${title}`);
        //console.log(`URL: ${url}`);

        // Extract the magnet link
        const magnetRegex = /<a[^>]*href="(magnet:\?xt=urn:btih:[^"]+)"[^>]*><i[^>]*class="fa fa-fw fa-magnet"><\/i><\/a>/;
        const magnetMatch = trContent.match(magnetRegex);
        const magnetLink = magnetMatch ? magnetMatch[1] : null;

        //console.log(`magnetLink: ${magnetLink}`);

        // Extract the first text-center value after data-timestamp
        const timestampRegex = /data-timestamp="\d+">[^<]+<\/td>\s*<td\s+class="text-center">([^<]+)<\/td>/;
        const timestampMatch = trContent.match(timestampRegex);
        const firstTextAfterTimestamp = timestampMatch ? timestampMatch[1].trim() : null;

        if (firstTextAfterTimestamp == 0) {
            continue;
        }
        //console.log(`Seeders: ${firstTextAfterTimestamp}\n`);

        //break;

        // Push the extracted data to the results array
        if (title && url && magnetLink && firstTextAfterTimestamp !== null) {
            /*console.log(`Torrent Entry:`);
            console.log(`Title: ${title}`);
            console.log(`URL: ${url}`);
            console.log(`magnetLink: ${magnetLink}`);
            console.log(`Seeders: ${firstTextAfterTimestamp}\n`);*/

            results.push({
                title: title,
                url: url,
                magnetLink: magnetLink,
                seeders : firstTextAfterTimestamp
            });
        }
    }

    //console.log(`Results: ${results}`); 
    return results;
}


function extractPageNumberNyaa(html) {
    const regex = /<a href="[^"]*p=(\d+)">(\d+)<\/a>/g;
    let lastNumber = null;
    let match;
    
    // Iterate through all matches and keep updating lastNumber
    while ((match = regex.exec(html)) !== null) {
        lastNumber = parseInt(match[1], 10); // or match[2] since both capture the same number
    }
    
    return lastNumber;
}

function extractMkvFiles(html) {
    const regex = /(?<=i>)[^\/]+\.mkv/g;
    return html.match(regex) || [];
}

function extractSeeders(html) {
    const regex = /Seeders:<\/div>\s*<div[^>]*><span[^>]*>(\d+)<\/span>/;
    const match = html.match(regex);
    return match ? parseInt(match[1], 10) : null;
}

function extractInfoHash(html) {
    const regex = /Info hash:<\/div>\s*<div[^>]*><kbd>([a-fA-F0-9]+)<\/kbd>/;
    const match = html.match(regex);
    return match ? match[1] : null;
}

function extractMagnetLink(html) {
    const magnetRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/gi;
    const links = [];
    let match;

    while ((match = magnetRegex.exec(html)) !== null) {
        // Replace HTML entities with their corresponding characters
        const magnetLink = match[1].replace(/&amp;/g, '&');
        links.push(magnetLink);
    }

    return links;
}

function removeSpacesAroundHyphens(str) {
    return str.replace(/(\b[+-]?\d+(?:\.\d+)?\b)\s*([-–—])\s*(\b[+-]?\d+(?:\.\d+)?\b)/g, '$1$2$3');
}


const query = `One%20Piece`;
anime_dex_finder(query);

/*const title_romanji = `Shingeki no Kyojin`;
const result = hikaritv_anime_extract( 16498, title_romanji, 1);
//Add looser title matching, strict matching but not exact.
//let query = `One+Piece`;
//let output = await nyaa_html_finder(query, `One Piece`, 1, 1, true);
// output = await seadex_finder(16498, true, 1);

console.log(result);
//console.log(output)
//let results  = await parse_title(title); let title = "[tlacatlc6] Natsume Yuujinchou Shi Vol. 1v2 & Vol. 2 (BD 1280x720 x264 AAC)"; */
