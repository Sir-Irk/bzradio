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

let songList: ytpl.Item[] = [];
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

async function start_playing(member: Discord.GuildMember) {
    if (songList.length === 0) {
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
            play_song(songList[curSong], voiceConnection);
        } else {
            textChannel.send(`Failed to join voice channel`);
        }
    } catch (error) {
        textChannel.send(`Failed to join voice channel`);
        console.log(error);
    }
}

let resource: AudioResource = null;
let playingEmbed: Discord.MessageEmbed = null;
let progressMessage: Discord.Message = null;

async function update_playback_time() {
    while (true) {
        if (songList[curSong] && resource && progressMessage && !resource.ended) {
            let str = '▶️ ';
            const prog = resource.playbackDuration / 1000 / songList[curSong].durationSec;
            const strLen = 40;
            const pos = Math.floor(strLen * prog);
            for (let i = 0; i < strLen; ++i) {
                if (i === pos) {
                    str += '⚪';
                } else {
                    str += '-';
                }
            }
            str += `| ${make_duration_str(resource.playbackDuration)}/${make_duration_str(songList[curSong].durationSec * 1000)}`;
            progressMessage.edit(str);
        }
        await delay(2000);
    }
}

async function play_song(song: ytpl.Item, connection: VoiceConnection) {
    if (!connection) return;
    const stream = await playDl.stream(song.url);
    resource = createAudioResource(stream.stream, {
        inputType: stream.type,
    });
    player.play(resource);
    connection.subscribe(player);
    playingEmbed = new Discord.MessageEmbed().setTitle(`▶️ ${song.title} | ${song.duration}`);
    playingEmbed.setImage(`${song.bestThumbnail.url}`);
    await textChannel.send({ embeds: [playingEmbed] });
    progressMessage = await textChannel.send(`...`);
    const status = player.state.status;
}

async function load_playlist(url: string) {
    await ytpl(url, { pages: 1 })
        .then(async (pl) => {
            textChannel.send('Fetching playlist. This may take a bit');
            songList = songList.concat(pl.items);
            if (pl.continuation) {
                let cont = await ytpl.continueReq(pl.continuation);
                while (true) {
                    songList = songList.concat(cont.items);
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

function get_next_song(): ytpl.Item {
    curSong = (curSong + 1) % songList.length;
    return songList[curSong];
}

let voiceConnection: VoiceConnection = null;

player.on(AudioPlayerStatus.Idle, () => {
    if (songList.length > 0) {
        play_song(get_next_song(), voiceConnection);
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
                await load_playlist('PLJdv7u2ne9iANURyGydzS2lEdNOXLkccA');
                shuffle(songList);
                await start_playing(msg.member);
            }
            break;
        case 'play':
        case 'p':
            {
                if (args.length > 0) {
                    const matches = songList.filter((s) => {
                        return s.title.toLowerCase().includes(args.join(' ').toLowerCase());
                    });
                    if (matches.length > 0) {
                        if (matches.length === 1) {
                            play_song(matches[0], voiceConnection);
                        } else {
                            let str = 'Matches: \n';
                            matches.forEach((m) => {
                                str += `${m.title}\n`;
                            });
                            msg.reply(str);
                        }
                    } else {
                        msg.reply("Couldn't find that song in the playlist");
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
