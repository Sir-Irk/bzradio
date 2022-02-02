import {
    AudioPlayerStatus,
    AudioResource,
    createAudioPlayer,
    createAudioResource,
    NoSubscriberBehavior,
    VoiceConnection,
} from '@discordjs/voice';
import { delay, make_duration_str, playlist_entry } from '.';
import * as Discord from 'discord.js';
import playDl, { DeezerAlbum, InfoData, YouTubeVideo } from 'play-dl';

export class user_guild {
    id: string;
    songList: playlist_entry[] = [];
    songTempQueue: playlist_entry[] = [];
    curSong = 0;
    isPlaying = false;
    progSymbol = '⚪';
    loadingSymbol = '<a:loading:936525608404545566>';
    voiceConnection: VoiceConnection = null;

    resource: AudioResource = null;
    currentSongDurationInSeconds = 0;
    playingEmbed: Discord.MessageEmbed = null;
    progressMessage: Discord.Message = null;
    loopMode: boolean = false;
    lastSongPlayed: playlist_entry = null;

    textChannel: Discord.DMChannel = null;
    player = null;

    constructor(id: string) {
        this.id = id;

        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause,
            },
        });
        this.player.on(AudioPlayerStatus.Idle, () => {
            if (this.songList.length > 0) {
                if (this.loopMode) {
                    if (this.lastSongPlayed) {
                        play_song(this, this.lastSongPlayed, this.voiceConnection);
                    } else {
                        this.textChannel.send(`Something went wrong with loop mode`);
                        play_song(this, this.get_next_song(), this.voiceConnection);
                    }
                } else {
                    if (this.songTempQueue.length > 0) {
                        play_song(this, this.songTempQueue.shift(), this.voiceConnection);
                    } else {
                        play_song(this, this.get_next_song(), this.voiceConnection);
                    }
                }
            }
        });

        this.update_playback_time();
    }

    next_song_index(): number {
        return (this.curSong + 1) % this.songList.length;
    }
    get_next_song(): playlist_entry {
        this.curSong = this.next_song_index();
        return this.songList[this.curSong];
    }

    updatePlaybackTimeIsRunning: boolean = false;

    async update_playback_time() {
        if (this.updatePlaybackTimeIsRunning) return;
        this.updatePlaybackTimeIsRunning = true;

        while (true) {
            if (this.resource && this.progressMessage) {
                try {
                    let str = '▶️ ';
                    const prog = this.resource.playbackDuration / 1000 / this.currentSongDurationInSeconds;
                    const strLen = 40;
                    const pos = Math.floor(strLen * prog);
                    for (let i = 0; i < strLen; ++i) {
                        if (i === pos) {
                            str += this.progSymbol;
                        } else {
                            str += '-';
                        }
                    }
                    str += `| ${make_duration_str(this.resource.playbackDuration)}/${make_duration_str(
                        this.currentSongDurationInSeconds * 1000
                    )}`;
                    await this.progressMessage.edit(str);
                } catch (e) {
                    //TODO: don't just throw the error away
                    console.log(e.trace);
                }
            } else {
                if (!this.resource) {
                    //console.log('resource is null');
                }
                if (!this.progressMessage) {
                    //console.log('prog message is null');
                }
            }
            await delay(2000);
        }
    }
}

export async function play_song(guild: user_guild, song: playlist_entry, connection: VoiceConnection) {
    if (!connection) return;
    let stream = null;
    try {
        stream = await playDl.stream(song.url);
        guild.resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });
        guild.player.play(guild.resource);
        connection.subscribe(guild.player);
    } catch (e) {
        guild.textChannel.send(`Error fetching url: ${song.url}`);
        await delay(1000);
        play_song(guild, guild.get_next_song(), connection);
        return;
    }

    guild.lastSongPlayed = song;
    display_player(guild, song);
    guild.currentSongDurationInSeconds = song.durationInSec;
    const status = guild.player.state.status;
}

export async function display_player(guild: user_guild, song: playlist_entry) {
    guild.playingEmbed = new Discord.MessageEmbed().setTitle(`▶️ ${song.title}`).setURL(`${song.url})`);
    guild.playingEmbed.setImage(`${song.thumbUrl}`);
    if (guild.songTempQueue.length > 0 || guild.songList.length > 1) {
        const nextSong = guild.songTempQueue.length > 0 ? guild.songTempQueue[0] : guild.songList[guild.next_song_index()];
        guild.playingEmbed.setFooter({ text: `Up next: ${nextSong.title}`, iconURL: `${nextSong.thumbUrl}` });
    }

    await guild.textChannel.send({ embeds: [guild.playingEmbed] });
    guild.progressMessage = await guild.textChannel.send(`${guild.loadingSymbol}`);
}

export const guilds: user_guild[] = [];

for (let i = 0; i < guilds.length; ++i) {
    const g = guilds[i];
}
