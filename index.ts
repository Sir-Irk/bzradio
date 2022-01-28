import { prefix, token } from './config.json';

import * as Discord from 'discord.js';
import playDl, { DeezerAlbum, InfoData } from 'play-dl';
import ytpl from 'ytpl';
import {
    createAudioResource,
    createAudioPlayer,
    joinVoiceChannel,
    NoSubscriberBehavior,
    VoiceConnection,
    AudioPlayerStatus,
    AudioResource,
} from '@discordjs/voice';
const client: Discord.Client = new Discord.Client({ intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_VOICE_STATES'] });

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

client.login(token);

client.once('ready', () => {
    console.log('Ready!');
    update_playback_time();
});

client.once('reconnecting', () => {
    console.log('Reconnecting!');
});
client.once('disconnect', () => {
    console.log('Disconnect!');
});

let songList: playlist_entry[] = [];
let songTempQueue: playlist_entry[] = [];
let curSong = 0;
let isPlaying = false;
let progSymbol = '⚪';
let loadingSymbol = '<a:loading:936525608404545566>';
let voiceConnection: VoiceConnection = null;

function next_song_index(): number {
    return (curSong + 1) % songList.length;
}

function get_next_song(): playlist_entry {
    curSong = next_song_index();
    return songList[curSong];
}

const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
    },
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
    process.abort();
});

function make_duration_hour_str(ms: number) {
    let seconds = ms / 1000;
    const hours = Math.floor(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    const minutes = Math.floor(seconds / 60); // 60 seconds in 1 minute
    seconds = seconds % 60;
    return `${hours}h : ${minutes}m : ${seconds}s`;
}

function make_duration_str(miliseconds: number) {
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

let textChannel: Discord.DMChannel = null;

async function start_playing(member: Discord.GuildMember, url: string = null) {
    if (songList.length === 0 && !url) {
        textChannel.send('no songs in queue');
        return;
    }

    if (voiceConnection && player?.state.status === AudioPlayerStatus.Playing) {
        textChannel.send('already playing');
        return;
    }

    if (!member.voice.channelId) {
        textChannel.send('You must be in a voice channel to use this command');
        return;
    }
    try {
        voiceConnection = joinVoiceChannel({
            channelId: member.voice.channelId,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
        });

        if (voiceConnection) {
            if (url) {
                play_song_url(url, voiceConnection);
            } else {
                play_song(songList[curSong], voiceConnection);
            }
        } else {
            textChannel.send(`Failed to join voice channel`);
        }
    } catch (error) {
        textChannel.send(`Failed to join voice channel`);
        console.log(error);
    }
}

let resource: AudioResource = null;
let currentSongDurationInSeconds = 0;
let playingEmbed: Discord.MessageEmbed = null;
let progressMessage: Discord.Message = null;
let loopMode: boolean = false;
let lastSongPlayed: playlist_entry = null;

class playlist_entry {
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

async function update_playback_time() {
    while (true) {
        if (resource && progressMessage) {
            let str = '▶️ ';
            const prog = resource.playbackDuration / 1000 / currentSongDurationInSeconds;
            const strLen = 40;
            const pos = Math.floor(strLen * prog);
            for (let i = 0; i < strLen; ++i) {
                if (i === pos) {
                    str += progSymbol;
                } else {
                    str += '-';
                }
            }
            str += `| ${make_duration_str(resource.playbackDuration)}/${make_duration_str(currentSongDurationInSeconds * 1000)}`;
            progressMessage.edit(str);
        }
        await delay(2000);
    }
}

async function display_player(song: playlist_entry) {
    playingEmbed = new Discord.MessageEmbed().setTitle(`▶️ ${song.title}`);
    playingEmbed.setImage(`${song.thumbUrl}`);
    if (songTempQueue.length > 0) {
        playingEmbed.addFields({ name: `Up next`, value: `**${songTempQueue[0].title}**` });
    } else if (songList.length > 0) {
        playingEmbed.addFields({ name: `Up next`, value: `**${songList[next_song_index()].title}**` });
    }
    await textChannel.send({ embeds: [playingEmbed] });
    progressMessage = await textChannel.send(`${loadingSymbol}`);
}

async function play_song_url(url: string, connection: VoiceConnection) {
    let info: InfoData = null;
    let stream = null;
    try {
        info = await playDl.video_info(url);
        stream = await playDl.stream(url);
        resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });
        player.play(resource);
        connection.subscribe(player);
    } catch (e) {
        textChannel.send(`Error fetching url: ${url}`);
        await delay(1000);
        play_song(get_next_song(), connection);
        return;
    }
    lastSongPlayed = new playlist_entry(
        url,
        info.video_details?.title,
        info.video_details?.channel?.name,
        info.video_details.thumbnails[0].url,
        info.video_details.durationInSec
    );
    currentSongDurationInSeconds = info.video_details.durationInSec;
    display_player(lastSongPlayed);
    progressMessage = await textChannel.send(`...`);
    const status = player.state.status;
}

async function play_song(song: playlist_entry, connection: VoiceConnection) {
    if (!connection) return;
    let stream = null;
    try {
        stream = await playDl.stream(song.url);
        resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });
        player.play(resource);
        connection.subscribe(player);
    } catch (e) {
        textChannel.send(`Error fetching url: ${song.url}`);
        await delay(1000);
        play_song(get_next_song(), connection);
        return;
    }

    lastSongPlayed = song;
    display_player(song);
    currentSongDurationInSeconds = song.durationInSec;
    const status = player.state.status;
}

async function add_url(list: playlist_entry[], url: string) {
    const match = list.find((s) => {
        return s.url === url;
    });
    if (match) {
        textChannel.send(`That url is already in the playlist`);
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
            textChannel.send(`Song added`);
        } catch (e) {
            textChannel.send(`Failed to add url`);
        }
    }
}

async function find_matches(songs: playlist_entry[], titleToFind: string): Promise<playlist_entry[]> {
    const title = titleToFind.toLowerCase();
    const matches = songs.filter((s) => {
        const t = s.title.toLowerCase();
        const c = s.channel.toLowerCase();
        return t.includes(title) || c.includes(title);
    });
    return matches;
}

function add_playlist(list: playlist_entry[], items: ytpl.Item[]) {
    const map = new Map<string, playlist_entry>();
    list.forEach((i) => {
        if (!map.has(i.title)) {
            map.set(i.title, new playlist_entry(i.url, i.title, i.channel, i.thumbUrl, i.durationInSec));
        }
    });
    items.forEach((i) => {
        if (!map.has(i.title)) {
            map.set(i.title, new playlist_entry(i.url, i.title, i.author.name, i.bestThumbnail.url, i.durationSec));
        }
    });
    songList = [];
    map.forEach((i) => {
        songList.push(i);
    });
}

async function load_playlist(url: string) {
    await ytpl(url, { pages: 1 })
        .then(async (pl) => {
            await textChannel.send('Fetching playlist. This may take a bit');
            let msgRef = await textChannel.send(`${loadingSymbol}`);
            add_playlist(songList, pl.items);

            if (pl.continuation) {
                let cont = await ytpl.continueReq(pl.continuation);
                while (true) {
                    add_playlist(songList, cont.items);
                    if (!cont.continuation) break;
                    cont = await ytpl.continueReq(cont.continuation);
                }
            }
            let durationSum = 0;
            songList.forEach((s) => {
                durationSum += s.durationInSec * 1000;
            });
            msgRef.edit(
                `Done! Loaded **${songList.length}** songs for a total playtime duration of **${make_duration_hour_str(durationSum)}**`
            );
        })
        .catch((e) => {
            textChannel.send(`Failed to fetch playist`);
        });
}

async function print_matches(songs: playlist_entry[], page: number = 1, listLimit: number = 40) {
    if (songs.length > 0) {
        let str = `**Matches found(${songs.length}):** \n\n`;
        const maxLen = listLimit;
        //const startIdx = (songs.length / maxLen) *;
        for (let i = 0; i < songs.length && i < maxLen; ++i) {
            str += `${songs[i].title} | ${songs[i]?.channel}\n`;
        }
        if (songs.length > maxLen) {
            str += `...and ${songs.length - maxLen} more`;
        }
        textChannel.send(str);
    } else {
        textChannel.send("Couldn't find that song in the playlist");
    }
}

player.on(AudioPlayerStatus.Idle, () => {
    if (songList.length > 0) {
        if (loopMode) {
            if (lastSongPlayed) {
                play_song(lastSongPlayed, voiceConnection);
            } else {
                textChannel.send(`Something went wrong with loop mode`);
                play_song(get_next_song(), voiceConnection);
            }
        } else {
            if (songTempQueue.length > 0) {
                play_song(songTempQueue.shift(), voiceConnection);
            } else {
                play_song(get_next_song(), voiceConnection);
            }
        }
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith(prefix)) return;

    textChannel = msg.channel as Discord.DMChannel;

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
                if (songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }
                shuffle(songList);
                msg.reply(`song list shuffled`);
            }
            break;
        case 'loop':
            {
                loopMode = !loopMode;
                msg.reply(`Loop mode turned **${loopMode ? 'on' : 'off'}**`);
            }
            break;
        case 'next':
        case 'n':
            {
                if (songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }

                if (args.length > 0) {
                    let num = parseInt(args[0]);
                    if (num === NaN || num < 0) {
                        msg.reply(`Invalid argument for <track number>. Input: ${num}`);
                        return;
                    }

                    curSong = (curSong + num) % songList.length;
                    play_song(songList[curSong], voiceConnection);
                } else {
                    curSong = (curSong + 1) % songList.length;
                    if (songTempQueue.length > 0) {
                        play_song(songTempQueue.shift(), voiceConnection);
                    } else {
                        play_song(songList[curSong], voiceConnection);
                    }
                }
            }
            break;
        case 'prev':
            {
                if (songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }

                if (args.length > 0) {
                    let num = parseInt(args[0]);
                    if (num === NaN || num < 0) {
                        msg.reply(`Invalid argument for <track number>. Input: ${num}`);
                        return;
                    }
                    let idx = curSong - num;
                    if (idx < 0) idx += songList.length;
                    curSong = idx;
                    play_song(songList[curSong], voiceConnection);
                } else {
                    let idx = curSong - 1;
                    if (idx < 0) idx += songList.length;
                    curSong = idx;
                    play_song(songList[curSong], voiceConnection);
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
                progSymbol = args.join(' ');
            }
            break;
        case 'link':
            {
                if (lastSongPlayed) {
                    msg.reply(`${lastSongPlayed.url}`);
                } else {
                    msg.reply(`No links to give. Have you played a song?`);
                }
            }
            break;
        case 'find':
            {
                print_matches(await find_matches(songList, args.join(' ')));
            }
            break;
        case 'add':
            {
                if (args.length < 1) {
                    msg.reply(`usage: ${prefix}add <url>`);
                    return;
                }

                await add_url(songList, args[0]);
            }
            break;
        case 'stop':
        case 'pause':
            {
                player.pause();
                msg.reply('Paused');
            }
            break;
        case 'listp':
            {
                if (songList.length === 0) {
                    msg.reply('No songs in the queue');
                    return;
                }

                const listLen = Math.min(songList.length, 25);
                let str = `**Prev ${listLen} songs: Use ${prefix}prev <track number> to play one of the songs listed**\n`;
                for (let i = 1; i <= listLen; ++i) {
                    let idx = curSong - i;
                    if (idx < 0) {
                        idx += songList.length;
                    }
                    str += `${i}. **${songList[idx].title} | ${make_duration_str(songList[idx].durationInSec * 1000)}**\n`;
                }
                msg.reply(str);
            }
            break;
        case 'listq':
            {
                if (songTempQueue.length === 0) {
                    msg.reply(`No songs in the queue`);
                    return;
                }

                const listLen = Math.min(songTempQueue.length, 25);
                let str = `**Songs in queue: ${songTempQueue.length}**\n`;
                for (let i = 0; i < listLen; ++i) {
                    let idx = i;
                    str += `${i + 1}. **${songTempQueue[idx].title} | ${make_duration_str(songTempQueue[idx].durationInSec * 1000)}**\n`;
                }
                if (songTempQueue.length > listLen) {
                    str += `...and ${songTempQueue.length - listLen} more`;
                }
                msg.reply(str);
            }
            break;
        case 'list':
            {
                if (songList.length === 0) {
                    msg.reply('No songs in the playlist');
                    return;
                }

                const listLen = Math.min(songList.length, 25);
                let str = `**Next ${listLen} songs: Use ${prefix}next <track number> to play one of the songs listed**\n`;
                for (let i = 1; i <= listLen; ++i) {
                    let idx = (curSong + i) % songList.length;
                    str += `${i}. **${songList[idx].title} | ${make_duration_str(songList[idx].durationInSec * 1000)}**\n`;
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
                songList = [];
                curSong = 0;
                msg.reply(`Playlist cleared`);
            }
            break;
        case 'clearq':
            {
                songTempQueue = [];
                msg.reply(`Queue cleared`);
            }
            break;
        case 'radio':
            {
                if (songList.length > 0) {
                    await start_playing(msg.member);
                    return;
                }
                await load_playlist('PLJdv7u2ne9iANURyGydzS2lEdNOXLkccA');
                shuffle(songList);
                await start_playing(msg.member);
            }
            break;
        case 'play':
        case 'p':
            {
                if (args.length > 0) {
                    if (args[0].includes('https')) {
                        if (!voiceConnection) {
                            start_playing(msg.member, args[0]);
                        } else {
                            play_song_url(args[0], voiceConnection);
                        }
                        return;
                    } else {
                        const matches = await find_matches(songList, args.join(' '));
                        if (matches.length === 1) {
                            play_song(matches[0], voiceConnection);
                        } else {
                            print_matches(matches);
                        }
                    }
                }
                if (!voiceConnection) {
                    start_playing(msg.member);
                } else {
                    player.unpause();
                }
            }
            break;

        case 'q':
        case 'queue':
            {
                if (args.length < 1) {
                    msg.reply(`Usage: ${prefix}q <song name>`);
                    break;
                }

                const matches = await find_matches(songList, args.join(' '));
                if (matches.length === 1) {
                    songTempQueue.push(matches[0]);
                    msg.reply(`Added to the queue: ${matches[0].title}\n${songTempQueue.length} songs in queue`);
                } else {
                    print_matches(matches);
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
                await load_playlist(args[0]);
            }
            break;
        case 'player':
            {
                if (lastSongPlayed) display_player(lastSongPlayed);
            }
            break;
        default: {
            msg.reply('Invalid command');
        }
    }
});
