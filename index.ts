import { prefix, token } from './config.json';

import * as Discord from 'discord.js';
import playDl from 'play-dl';
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
let curSong = 0;
let isPlaying = false;

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
    constructor(url: string, title: string, thumbUrl: string, durationInSec: number) {
        this.url = url;
        this.title = title;
        this.thumbUrl = thumbUrl;
        this.durationInSec = durationInSec;
    }
}

async function update_playback_time() {
    while (true) {
        if (resource && progressMessage && !resource.ended) {
            let str = '▶️ ';
            const prog = resource.playbackDuration / 1000 / currentSongDurationInSeconds;
            const strLen = 40;
            const pos = Math.floor(strLen * prog);
            for (let i = 0; i < strLen; ++i) {
                if (i === pos) {
                    str += '⚪';
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
async function play_song_url(url: string, connection: VoiceConnection) {
    let info = null;
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
        return;
    }
    lastSongPlayed = new playlist_entry(
        url,
        info.video_details?.title,
        info.video_details.thumbnails[0].url,
        info.video_details.durationInSec
    );
    currentSongDurationInSeconds = info.video_details.durationInSec;
    playingEmbed = new Discord.MessageEmbed().setTitle(
        `▶️ ${info.video_details?.title} | ${make_duration_str(info.video_details?.durationInSec * 1000)}`
    );
    playingEmbed.setImage(`${info.video_details?.thumbnails[0].url}`);
    await textChannel.send({ embeds: [playingEmbed] });
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
        return;
    }

    lastSongPlayed = song;
    currentSongDurationInSeconds = song.durationInSec;
    playingEmbed = new Discord.MessageEmbed().setTitle(`▶️ ${song.title} | ${song.durationInSec}`);
    playingEmbed.setImage(`${song.thumbUrl}`);
    await textChannel.send({ embeds: [playingEmbed] });
    progressMessage = await textChannel.send(`...`);
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
                new playlist_entry(url, info.video_details.title, info.video_details.thumbnails[0].url, info.video_details.durationInSec)
            );
            textChannel.send(`Song added`);
        } catch (e) {
            textChannel.send(`Failed to add url`);
        }
    }
}

function add_playlist(list: playlist_entry[], items: ytpl.Item[]) {
    const map = new Map<string, playlist_entry>();
    list.forEach((i) => {
        if (!map.has(i.url)) {
            map.set(i.url, new playlist_entry(i.url, i.title, i.thumbUrl, i.durationInSec));
        }
    });
    items.forEach((i) => {
        if (!map.has(i.url)) {
            map.set(i.url, new playlist_entry(i.url, i.title, i.bestThumbnail.url, i.durationSec));
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
            textChannel.send('Fetching playlist. This may take a bit');
            add_playlist(songList, pl.items);

            if (pl.continuation) {
                let cont = await ytpl.continueReq(pl.continuation);
                while (true) {
                    add_playlist(songList, pl.items);
                    if (!cont.continuation) break;
                    cont = await ytpl.continueReq(cont.continuation);
                }
            }
            textChannel.send(`Done! Loaded ${songList.length} songs`);
        })
        .catch((e) => {
            textChannel.send(`Failed to fetch playist`);
        });
}

function get_next_song(): playlist_entry {
    curSong = (curSong + 1) % songList.length;
    return songList[curSong];
}

let voiceConnection: VoiceConnection = null;

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
            play_song(get_next_song(), voiceConnection);
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
            {
                if (songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }
                curSong = (curSong + 1) % songList.length;
                play_song(songList[curSong], voiceConnection);
            }
            break;
        case 'prev':
            {
                if (songList.length === 0) {
                    msg.reply(`There are no songs in the playlist`);
                    return;
                }
                curSong = (curSong - 1) % songList.length;
                play_song(songList[curSong], voiceConnection);
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
        case 'pause':
            {
                player.pause();
                msg.reply('Paused');
            }
            break;
        case 'clear':
            {
                songList = [];
                curSong = 0;
                msg.reply('Playlist has been cleared');
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
                        const matches = songList.filter((s) => {
                            return s.title.toLowerCase().includes(args.join(' ').toLowerCase());
                        });
                        if (matches.length > 0) {
                            if (matches.length === 1) {
                                play_song(matches[0], voiceConnection);
                            } else {
                                let str = 'Matches: \n';
                                const maxLen = 40;
                                for (let i = 0; i < matches.length && i < maxLen; ++i) {
                                    str += `${matches[i].title}\n`;
                                }
                                if (matches.length > maxLen) {
                                    str += `...and ${matches.length - maxLen} more`;
                                }
                                msg.reply(str);
                            }
                        } else {
                            msg.reply("Couldn't find that song in the playlist");
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
        case 'pl':
        case 'playlist':
            {
                if (args.length < 1) {
                    msg.reply(`Usage: ${prefix}q <youtube playlist>`);
                    break;
                }
                await load_playlist(args[0]);
            }
            break;
        default: {
            msg.reply('Invalid command');
        }
    }
});
