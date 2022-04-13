import { prefix, token } from './config.json';

import * as Discord from 'discord.js';
import playDl, { YouTubeVideo } from 'play-dl';
import ytpl from 'ytpl';
import { joinVoiceChannel, VoiceConnection, AudioPlayerStatus } from '@discordjs/voice';
import { display_player, guilds, play_song, user_guild } from './guild';
const client: Discord.Client = new Discord.Client({ intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_VOICE_STATES'] });

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEBUG_MODE: boolean = true;

export class playlist_entry {
    url: string = null;
    title: string = null;
    thumbUrl: string = null;
    durationInSec: number = 0;
    channel: string = null;
    constructor(url: string, title: string, channel: string, thumbUrl: string, durationInSec: number) {
        this.url = url;
        this.title = title;
        this.thumbUrl = thumbUrl;
        this.durationInSec = durationInSec;
        this.channel = channel;
    }
}

client.login(token);

client.once('ready', () => {
    console.log('Ready!');
});

client.once('reconnecting', () => {
    console.log('Reconnecting!');
});
client.once('disconnect', () => {
    console.log('Disconnect!');
});

export function shuffle(array: any[]): any[] {
    let currentIndex = array.length;
    let randomIndex = 0;

    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

process.on('uncaughtException', async function (err: Error) {
    console.log(`ERROR: ${err?.stack}`);
    //process.abort();
});

export function make_duration_hour_str(ms: number) {
    let seconds = ms / 1000;
    const hours = Math.floor(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    const minutes = Math.floor(seconds / 60); // 60 seconds in 1 minute
    seconds = seconds % 60;
    return `${hours}h : ${minutes}m : ${seconds}s`;
}

export function make_duration_str(miliseconds: number) {
    let remainder = miliseconds - Math.floor(miliseconds / 1000 / 60) * 1000 * 60;
    let min = Math.floor(miliseconds / 1000 / 60);
    let sec = Math.floor(remainder / 1000);
    let minStr = min.toLocaleString('en-US', {
        minimumIntegerDigits: 2,
        useGrouping: false,
    });

    let secStr = sec.toLocaleString('en-US', {
        minimumIntegerDigits: 2,
        useGrouping: false,
    });
    return `${minStr}:${secStr}`;
}

async function start_playing(guild: user_guild, member: Discord.GuildMember, url: string = null) {
    if (guild.songList.length === 0 && !url) {
        guild.textChannel.send('no songs in queue');
        return;
    }

    if (guild.voiceConnection && guild.player?.state.status === AudioPlayerStatus.Playing) {
        guild.textChannel.send('already playing');
        return;
    }

    if (!member.voice.channelId) {
        guild.textChannel.send('You must be in a voice channel to use this command');
        return;
    }
    try {
        guild.voiceConnection = joinVoiceChannel({
            channelId: member.voice.channelId,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
        });

        if (guild.voiceConnection) {
            if (url) {
                play_song_url(guild, url, guild.voiceConnection);
            } else {
                play_song(guild, guild.songList[guild.curSong]);
            }
        } else {
            guild.textChannel.send(`Failed to join voice channel`);
        }
    } catch (error) {
        guild.textChannel.send(`Failed to join voice channel`);
        console.log(error);
    }
}

async function make_playlist_entry_from_url(url: string) {
    try {
        const info = await playDl.video_info(url);
        const result = new playlist_entry(
            url,
            info.video_details?.title,
            info.video_details?.channel?.name,
            info.video_details.thumbnails[0].url,
            info.video_details.durationInSec
        );
        return result;
    } catch (e) {
        throw e;
    }
}

async function queue_song(queue: playlist_entry[], song: playlist_entry, msg: Discord.Message) {
    queue.push(song);
    msg.reply(`Added to the queue: ${song.title}\n${queue.length} songs in queue`);
}

async function queue_song_url(queue: playlist_entry[], url: string, connection: VoiceConnection, msg: Discord.Message) {
    let result = null;
    await make_playlist_entry_from_url(url)
        .then((s) => {
            queue_song(queue, s, msg);
        })
        .catch((error) => {
            msg.reply(`Something went wrong fetching that url`);
        });
}

async function play_song_url(guild: user_guild, url: string, connection: VoiceConnection) {
    await make_playlist_entry_from_url(url)
        .then((s) => {
            guild.lastSongPlayed = s;
            guild.currentSongDurationInSeconds = s.durationInSec;
            play_song(guild, s);
        })
        .catch((error) => {
            guild.textChannel.send(`Something went wrong fetching that url`);
        });
}

async function add_url(guild: user_guild, list: playlist_entry[], url: string) {
    const match = list.find((s) => {
        return s.url === url;
    });
    if (match) {
        guild.textChannel.send(`That url is already in the playlist`);
    } else {
        let info = null;
        let stream = null;
        try {
            info = await playDl.video_info(url);
            list.push(
                new playlist_entry(
                    url,
                    info.video_details.title,
                    info.video_details?.channel?.name,
                    info.video_details.thumbnails[0].url,
                    info.video_details.durationInSec
                )
            );
            guild.textChannel.send(`Song added`);
        } catch (e) {
            guild.textChannel.send(`Failed to add url`);
        }
    }
}

async function find_matches(guild: user_guild, songs: playlist_entry[], titleToFind: string): Promise<playlist_entry[]> {
    const title = titleToFind.toLowerCase();
    try {
        const matches = songs.filter((s) => {
            const t = s.title.replace(/\s+/g, ' ').trim().toLowerCase();
            const c = s.channel?.toLowerCase();
            return t.includes(title) || c.includes(title);
        });
        return matches;
    } catch (error) {
        if (guild.textChannel) guild.textChannel.send(`.find error: ${error}`);
    }
    return [];
}
/**
 * @description converts ytpl.Item[] to playlist_entry[] and appends to  "list"
 * @param guild the user's guild
 * @param list playlist to add items to
 * @param items the items received from a ytpl query
 * @returns number of items added to the list.
 */
function add_playlist(guild: user_guild, list: playlist_entry[], items: ytpl.Item[]): number {
    let songsAdded = 0;
    items.forEach((i) => {
        if (!guild.songListMap.has(i.title)) {
            const e = new playlist_entry(i.url, i.title, i.author.name, i.bestThumbnail.url, i.durationSec);
            guild.songListMap.set(i.title, e);
            list.push(e);
            songsAdded++;
        }
    });
    return songsAdded;
}
/**
 * @description Searches a playlist url and adds the results to the current playlist.
 * @param guild the user's guild
 * @param url a playlist url. Can be just the playlist id
 * @param page the playlist page to start on. A page is 100 videos per.
 * @returns the number of items added to the playlist(rejects duplicate titles).
 */
async function load_playlist(guild: user_guild, url: string, page: number = 1): Promise<number> {
    guild.lastPlaylistPageChecked = page;
    let songsAdded = 0;
    await ytpl(url, { pages: page })
        .then(async (pl) => {
            await guild.textChannel.send('Fetching playlist. This may take a bit');
            let msgRef = await guild.textChannel.send(`${guild.loadingSymbol}`);
            songsAdded += add_playlist(guild, guild.songList, pl.items);

            if (pl.continuation) {
                let cont = await ytpl.continueReq(pl.continuation);
                while (true) {
                    guild.lastPlaylistPageChecked++;
                    songsAdded += add_playlist(guild, guild.songList, cont.items);
                    if (!cont.continuation) break;
                    cont = await ytpl.continueReq(cont.continuation);
                }
            }
            let durationSum = 0;
            guild.songList.forEach((s) => {
                durationSum += s.durationInSec * 1000;
            });
            await msgRef.edit(
                `Done! Loaded **${guild.songList.length}** songs for a total playtime duration of **${make_duration_hour_str(
                    durationSum
                )}**`
            );
        })
        .catch((e) => {
            guild.textChannel.send(`Failed to fetch playist`);
        });
    return songsAdded;
}

async function print_matches(guild: user_guild, songs: playlist_entry[], page: number = 1, listLimit: number = 30) {
    if (songs.length > 0) {
        let str = `**Matches found(${songs.length}):** \n\n`;
        const maxLen = listLimit;
        //const startIdx = (songs.length / maxLen) *;
        for (let i = 0; i < songs.length && i < maxLen; ++i) {
            str += `${songs[i].title}\n`;
        }
        if (songs.length > maxLen) {
            str += `...and ${songs.length - maxLen} more`;
        }
        if (str.length > 2000) {
            str.slice(0, 2000 - 1);
        }
        guild.textChannel.send(str);
    } else {
        guild.textChannel.send("Couldn't find that song in the playlist");
    }
}

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    /*
    if (DEBUG_MODE && msg.guildId !== `922243045787852890`) {
        return;
    } else if (!DEBUG_MODE && msg.guildId === `922243045787852890`) {
        return;
    }
    */
    if (!msg.content.startsWith(prefix)) return;

    let guild: user_guild = guilds.find((g) => {
        return g.id === msg.guildId;
    });

    if (!guild) {
        guild = new user_guild(msg.guildId);
        guilds.push(guild);
    }

    guild.textChannel = msg.channel as Discord.DMChannel;

    const body = msg.content.slice(prefix.length);
    const args = body.split(/[\s,]+/);
    const command = args.shift().toLowerCase();

    switch (command.toLowerCase()) {
        case 'ping':
            {
                const timeTaken = Date.now() - msg.createdTimestamp;
                msg.reply(`Pong! Latency: ${timeTaken}ms`);
            }
            break;
        case 'shuffle':
            {
                if (guild.songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }
                shuffle(guild.songList);
                msg.reply(`song list shuffled`);
            }
            break;
        case 'loop':
            {
                guild.loopMode = !guild.loopMode;
                msg.reply(`Loop mode turned **${guild.loopMode ? 'on' : 'off'}**`);
            }
            break;
        case 'next':
        case 'n':
            {
                if (guild.songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }

                if (args.length > 0) {
                    let num = parseInt(args[0]);
                    if (num === NaN || num < 0) {
                        msg.reply(`Invalid argument for <track number>. Input: ${num}`);
                        return;
                    }

                    guild.curSong = (guild.curSong + num) % guild.songList.length;
                    play_song(guild, guild.songList[guild.curSong]);
                } else {
                    guild.curSong = (guild.curSong + 1) % guild.songList.length;
                    if (guild.songTempQueue.length > 0) {
                        play_song(guild, guild.songTempQueue.shift());
                    } else {
                        play_song(guild, guild.songList[guild.curSong]);
                    }
                }
            }
            break;
        case 'back':
        case 'b':
            {
                if (guild.songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }

                if (args.length > 0) {
                    let num = parseInt(args[0]);
                    if (num === NaN || num < 0) {
                        msg.reply(`Invalid argument for <track number>. Input: ${num}`);
                        return;
                    }
                    let idx = guild.curSong - num;
                    if (idx < 0) idx += guild.songList.length;
                    guild.curSong = idx;
                    play_song(guild, guild.songList[guild.curSong]);
                } else {
                    let idx = guild.curSong - 1;
                    if (idx < 0) idx += guild.songList.length;
                    guild.curSong = idx;
                    play_song(guild, guild.songList[guild.curSong]);
                }
            }
            break;
        case 'setprogsymbol':
        case 'setps':
            {
                if (args.length < 1) {
                    msg.reply(`usage: ${prefix}setps <symbol>`);
                    return;
                }
                guild.progSymbol = args.join(' ');
            }
            break;
        case 'link':
            {
                if (guild.lastSongPlayed) {
                    msg.reply(`${guild.lastSongPlayed.url}`);
                } else {
                    msg.reply(`No links to give. Have you played a song?`);
                }
            }
            break;
        case 'find':
            {
                if (args.length < 1) {
                    msg.reply(`Usage: ${prefix}find <title>`);
                    return;
                }
                const matches = await find_matches(guild, guild.songList, args.join(' '));
                print_matches(guild, matches).catch((e) => {
                    msg.reply(`Fuck my tight little ass: ${e.trace}`);
                });
            }
            break;
        case 'add':
            {
                if (args.length < 1) {
                    msg.reply(`usage: ${prefix}add <url>`);
                    return;
                }

                await add_url(guild, guild.songList, args[0]);
            }
            break;
        case 'stop':
        case 'pause':
            {
                guild.player.pause();
                msg.reply('Paused');
            }
            break;
        case 'listp':
            {
                if (guild.songList.length === 0) {
                    msg.reply('No songs in the queue');
                    return;
                }

                const listLen = Math.min(guild.songList.length, 25);
                let str = `**Previous ${listLen} songs: Use ${prefix}back <track number> to play one of the songs listed**\n`;
                for (let i = 1; i <= listLen; ++i) {
                    let idx = guild.curSong - i;
                    if (idx < 0) {
                        idx += guild.songList.length;
                    }
                    str += `${i}. **${guild.songList[idx].title} | ${make_duration_str(guild.songList[idx].durationInSec * 1000)}**\n`;
                }
                msg.reply(str);
            }
            break;
        case 'listq':
            {
                if (guild.songTempQueue.length === 0) {
                    msg.reply(`No songs in the queue`);
                    return;
                }

                const listLen = Math.min(guild.songTempQueue.length, 25);
                let str = `**Songs in queue: ${guild.songTempQueue.length}**\n`;
                for (let i = 0; i < listLen; ++i) {
                    let idx = i;
                    str += `${i + 1}. **${guild.songTempQueue[idx].title} | ${make_duration_str(
                        guild.songTempQueue[idx].durationInSec * 1000
                    )}**\n`;
                }
                if (guild.songTempQueue.length > listLen) {
                    str += `...and ${guild.songTempQueue.length - listLen} more`;
                }
                msg.reply(str);
            }
            break;
        case 'list':
            {
                if (guild.songList.length === 0) {
                    msg.reply('No songs in the playlist');
                    return;
                }

                const listLen = Math.min(guild.songList.length, 25);
                let str = `**Next ${listLen} songs: Use ${prefix}next <track number> to play one of the songs listed**\n`;
                for (let i = 1; i <= listLen; ++i) {
                    let idx = (guild.curSong + i) % guild.songList.length;
                    str += `${i}. **${guild.songList[idx].title} | ${make_duration_str(guild.songList[idx].durationInSec * 1000)}**\n`;
                }
                msg.reply(str);
            }
            break;
        case 'clear':
            {
                msg.reply(`Use ${prefix}clearP to clear the playlist.\nUse ${prefix}clearQ to clear the temporary queue`);
            }
            break;
        case 'clearp':
            {
                guild.songList = [];
                guild.songListMap.clear();
                guild.lastPlaylistPageChecked = 1;
                guild.curSong = 0;
                msg.reply(`Playlist cleared`);
            }
            break;
        case 'clearq':
            {
                guild.songTempQueue = [];
                msg.reply(`Queue cleared`);
            }
            break;
        case 'radio':
            {
                if (guild.songList.length > 0) {
                    await start_playing(guild, msg.member);
                    return;
                }
                await load_playlist(guild, guild.playlistUrl);
                shuffle(guild.songList);
                await start_playing(guild, msg.member);
            }
            break;
        case 'update': {
            msg.reply('updating playlist...');
            let songsAdded = await load_playlist(guild, guild.playlistUrl, guild.lastPlaylistPageChecked);
            msg.reply(`Added **${songsAdded}** new songs`);
        }
        case 'play':
        case 'p':
            {
                if (args.length > 0) {
                    const arg = args[0].trim();
                    if (arg.startsWith('https')) {
                        if (!guild.voiceConnection) {
                            start_playing(guild, msg.member, arg);
                        } else {
                            play_song_url(guild, arg, guild.voiceConnection);
                        }
                        return;
                    } else {
                        const matches = await find_matches(guild, guild.songList, args.join(' ').trim());
                        if (matches.length === 1) {
                            play_song(guild, matches[0]);
                        } else {
                            print_matches(guild, matches);
                        }
                    }
                }
                if (!guild.voiceConnection) {
                    start_playing(guild, msg.member);
                } else {
                    guild.player.unpause();
                }
            }
            break;

        case 'q':
        case 'queue':
            {
                if (args.length < 1) {
                    msg.reply(`Usage: ${prefix}q <song name>/<youtube url>/<song number>`);
                    break;
                }
                const arg = args[0].trim();
                if (arg.startsWith('https')) {
                    await queue_song_url(guild.songTempQueue, arg, guild.voiceConnection, msg);
                    return;
                }

                const num = parseInt(arg);
                if (!isNaN(num)) {
                    let idx = guild.curSong + num;
                    if (idx < 0) {
                        idx += guild.songList.length;
                    }
                    idx %= guild.songList.length;
                    queue_song(guild.songTempQueue, guild.songList[idx], msg);
                    return;
                }

                const query = args.join(' ').trim();
                const matches = await find_matches(guild, guild.songList, query);
                if (matches.length === 1) {
                    guild.songTempQueue.push(matches[0]);
                    msg.reply(`Added to the queue: ${matches[0].title}\n${guild.songTempQueue.length} songs in queue`);
                } else if (matches.length > 0) {
                    print_matches(guild, matches);
                } else {
                    try {
                        const results: YouTubeVideo[] = await playDl.search(query);
                        if (results.length === 1) {
                            queue_song_url(guild.songTempQueue, results[0].url, guild.voiceConnection, msg);
                        } else if (results.length > 0) {
                            let str = `**Found matches on youtube(${results.length}):**\n`;
                            const maxLen = 10;
                            for (let i = 0; i < results.length && i < maxLen; ++i) {
                                str += `**${results[i].title}** | <${results[i].url}>\n`;
                            }
                            if (results.length > maxLen) {
                                str += `...and ${results.length - maxLen} more`;
                            }
                            msg.reply(str);
                        } else {
                            msg.reply(`No results found`);
                        }
                    } catch (e) {
                        msg.reply(`Error fetching that url`);
                    }
                }
            }
            break;
        case 'pl':
        case 'playlist':
            {
                if (args.length < 1) {
                    msg.reply(`Usage: ${prefix}pl <youtube playlist>`);
                    break;
                }
                await load_playlist(guild, args[0]);
            }
            break;
        case 'player':
            {
                if (guild.lastSongPlayed) display_player(guild, guild.lastSongPlayed);
            }
            break;
        default: {
            msg.reply('Invalid command');
        }
    }
});
