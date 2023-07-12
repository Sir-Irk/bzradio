import {
    AudioPlayerStatus,
    AudioResource,
    createAudioPlayer,
    createAudioResource,
    NoSubscriberBehavior,
    VoiceConnection,
} from '@discordjs/voice';
import { delay, make_duration_str, playlist_entry, shuffle, queue_song_to_front } from '.';
import * as Discord from 'discord.js';
import playDl from 'play-dl';

export class user_guild {
    id: string;

    playlistUrl: string = null;
    commercialPlaylistUrl: string = null;

    songListMap: Map<string, playlist_entry> = new Map<string, playlist_entry>();
    songList: playlist_entry[] = [];
    commercialList: playlist_entry[] = [];
    commercialStack: playlist_entry[] = [];
    commercialInterval: number = 1; //@TODO: Add this to the config
    commercialIntervalCounter: number = 0;

    songTempQueue: playlist_entry[] = [];

    lastPlaylistPageChecked: number = 0;
    curSong = 0;
    isPlaying = false;
    progSymbol = '⚪';
    loadingSymbol = '<a:loading:936525608404545566>';
    voiceConnection: VoiceConnection = null;
    //voiceChannelId: string;

    resource: AudioResource = null;
    currentSongDurationInSeconds = 0;
    playingEmbed: Discord.EmbedBuilder = null;
    progressMessage: Discord.Message = null;
    loopMode: boolean = false;
    lastSongPlayed: playlist_entry = null;

    textChannel: Discord.DMChannel = null;
    player = null;
    updatePlaybackTimeIsRunning: boolean = false;

    constructor(id: string) {
        this.id = id;

        //@TODO this should be loaded/saved in a configuration file
        this.playlistUrl = 'PLJdv7u2ne9iANURyGydzS2lEdNOXLkccA';
        this.commercialPlaylistUrl = 'PL1mb_nfn6SvLWa7UtuC-sRdb4ujThhqbX'

        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause,
            },
        });
        this.player.on(AudioPlayerStatus.Idle, () => {
            if (this.songList.length > 0) {
                this.play_next_song();
            }
        });

        this.update_playback_time();
    }

    next_song_index(): number {
        return (this.curSong + 1) % this.songList.length;
    }

    /**
     * @description increments the current song index and returns the next song
     * @returns the next song in the playlist
     */
    get_next_song(): playlist_entry {
        this.curSong = this.next_song_index();
        return this.songList[this.curSong];
    }

    is_time_for_commercial(): boolean {
        return this.commercialInterval > 0 && this.commercialIntervalCounter > this.commercialInterval;
    }

    get_next_commercial(): playlist_entry {
        if (this.commercialStack.length === 0) {
            this.commercialStack = [...this.commercialList];
            shuffle(this.commercialStack);
        }
        return this.commercialStack.pop();
    }

    play_next_song(): void {
        if (this.loopMode) {
            if (this.lastSongPlayed) {
                play_song(this, this.lastSongPlayed);
            } else {
                this.textChannel.send(`Something went wrong with loop mode`);
                play_song(this, this.get_next_song());
            }
            return;
        }

        if (this.songTempQueue.length > 0) {
            play_song(this, this.songTempQueue.shift());
        } else {

            //increment counter first to avoid doubling up commercials when
            //using a command that doesn't run through this path
            this.commercialIntervalCounter++;

            if (this.is_time_for_commercial()) {
                play_song(this, this.get_next_commercial());
                this.commercialIntervalCounter = 0;
            } else {
                play_song(this, this.get_next_song());
            }
        }
    }

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

const fetchUrlMaxAttempts = 3;
export async function play_song(guild: user_guild, song: playlist_entry) {
    if (!guild.voiceConnection) return;
    let stream = null;
    let attempts = 0;

    while (attempts < fetchUrlMaxAttempts) {
        try {
            stream = await playDl.stream(song.url);
            guild.resource = createAudioResource(stream.stream, { inputType: stream.type });
            guild.player.play(guild.resource);
            guild.voiceConnection.subscribe(guild.player);
            break;
        } catch (e) {
            attempts++;
            await delay(1000);
            console.log(`Retrying url... ${attempts}`);
            if (attempts == fetchUrlMaxAttempts) {
                console.log(`Error: ${e}`);
            }
        }
    }

    if (attempts == fetchUrlMaxAttempts) {
        guild.textChannel.send(`Error fetching url: ${song.url}`);
        play_song(guild, guild.get_next_song());
        return;
    }

    guild.lastSongPlayed = song;
    display_player(guild, song);
    guild.currentSongDurationInSeconds = song.durationInSec;
}

export async function display_player(guild: user_guild, song: playlist_entry) {
    guild.playingEmbed = new Discord.EmbedBuilder().setTitle(`▶️ ${song.title}`).setURL(`${song.url})`);
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
