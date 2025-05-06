"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.guilds = exports.user_guild = void 0;
exports.play_song = play_song;
exports.display_player = display_player;
const voice_1 = require("@discordjs/voice");
const _1 = require(".");
const Discord = __importStar(require("discord.js"));
const play_dl_1 = __importDefault(require("play-dl"));
class user_guild {
    id;
    playlistUrl = null;
    commercialPlaylistUrl = null;
    songListMap = new Map();
    songList = [];
    commercialList = [];
    commercialStack = [];
    commercialInterval = 1; //@TODO: Add this to the config
    commercialIntervalCounter = 0;
    songTempQueue = [];
    lastPlaylistPageChecked = 0;
    curSong = 0;
    isPlaying = false;
    progSymbol = '⚪';
    loadingSymbol = '<a:loading:936525608404545566>';
    voiceConnection = null;
    //voiceChannelId: string;
    resource = null;
    currentSongDurationInSeconds = 0;
    playingEmbed = null;
    progressMessage = null;
    loopMode = false;
    lastSongPlayed = null;
    textChannel = null;
    player = null;
    updatePlaybackTimeIsRunning = false;
    constructor(id) {
        this.id = id;
        //@TODO this should be loaded/saved in a configuration file
        this.playlistUrl = 'PLJdv7u2ne9iANURyGydzS2lEdNOXLkccA';
        this.commercialPlaylistUrl = 'PLJdv7u2ne9iCQelfTeK7JJjJCWPZemONa';
        this.player = (0, voice_1.createAudioPlayer)({
            behaviors: {
                noSubscriber: voice_1.NoSubscriberBehavior.Play,
            },
        });
        this.player.on(voice_1.AudioPlayerStatus.Idle, () => {
            if (this.songList.length > 0) {
                this.play_next_song();
            }
        });
        this.update_playback_time();
    }
    next_song_index() {
        return (this.curSong + 1) % this.songList.length;
    }
    /**
     * @description increments the current song index and returns the next song
     * @returns the next song in the playlist
     */
    get_next_song() {
        this.curSong = this.next_song_index();
        return this.songList[this.curSong];
    }
    is_time_for_commercial() {
        return this.commercialInterval > 0 && this.commercialIntervalCounter > this.commercialInterval;
    }
    get_next_commercial() {
        if (this.commercialStack.length === 0) {
            this.commercialStack = [...this.commercialList];
            (0, _1.shuffle)(this.commercialStack);
        }
        return this.commercialStack.pop();
    }
    play_next_song() {
        if (this.loopMode) {
            if (this.lastSongPlayed) {
                play_song(this, this.lastSongPlayed);
            }
            else {
                this.textChannel.send(`Something went wrong with loop mode`);
                play_song(this, this.get_next_song());
            }
            return;
        }
        if (this.songTempQueue.length > 0) {
            play_song(this, this.songTempQueue.shift());
        }
        else {
            //increment counter first to avoid doubling up commercials when
            //using a command that doesn't run through this path
            this.commercialIntervalCounter++;
            if (this.is_time_for_commercial()) {
                play_song(this, this.get_next_commercial());
                this.commercialIntervalCounter = 0;
            }
            else {
                play_song(this, this.get_next_song());
            }
        }
    }
    async update_playback_time() {
        if (this.updatePlaybackTimeIsRunning)
            return;
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
                        }
                        else {
                            str += '-';
                        }
                    }
                    str += `| ${(0, _1.make_duration_str)(this.resource.playbackDuration)}/${(0, _1.make_duration_str)(this.currentSongDurationInSeconds * 1000)}`;
                    await this.progressMessage.edit(str);
                }
                catch (e) {
                    //TODO: don't just throw the error away
                    console.log(e.trace);
                }
            }
            else {
                if (!this.resource) {
                    //console.log('resource is null');
                }
                if (!this.progressMessage) {
                    //console.log('prog message is null');
                }
            }
            await (0, _1.delay)(2000);
        }
    }
}
exports.user_guild = user_guild;
const fetchUrlMaxAttempts = 3;
async function play_song(guild, song) {
    if (!guild.voiceConnection)
        return;
    let stream = null;
    let attempts = 0;
    while (attempts < fetchUrlMaxAttempts) {
        try {
            stream = await play_dl_1.default.stream(song.url);
            guild.resource = (0, voice_1.createAudioResource)(stream.stream, { inputType: stream.type });
            guild.player.play(guild.resource);
            guild.voiceConnection.subscribe(guild.player);
            break;
        }
        catch (e) {
            attempts++;
            await (0, _1.delay)(1000);
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
async function display_player(guild, song) {
    guild.playingEmbed = new Discord.EmbedBuilder().setTitle(`▶️ ${song.title}`).setURL(`${song.url})`);
    guild.playingEmbed.setImage(`${song.thumbUrl}`);
    if (guild.songTempQueue.length > 0 || guild.songList.length > 1) {
        const nextSong = guild.songTempQueue.length > 0 ? guild.songTempQueue[0] : guild.songList[guild.next_song_index()];
        guild.playingEmbed.setFooter({ text: `Up next: ${nextSong.title}`, iconURL: `${nextSong.thumbUrl}` });
    }
    await guild.textChannel.send({ embeds: [guild.playingEmbed] });
    guild.progressMessage = await guild.textChannel.send(`${guild.loadingSymbol}`);
}
exports.guilds = [];
for (let i = 0; i < exports.guilds.length; ++i) {
    const g = exports.guilds[i];
}
