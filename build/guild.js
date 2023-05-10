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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.guilds = exports.display_player = exports.play_song = exports.user_guild = void 0;
const voice_1 = require("@discordjs/voice");
const _1 = require(".");
const Discord = __importStar(require("discord.js"));
const play_dl_1 = __importDefault(require("play-dl"));
class user_guild {
    id;
    playlistUrl = null;
    lastPlaylistPageChecked = 0;
    songListMap = new Map();
    songList = [];
    songTempQueue = [];
    curSong = 0;
    isPlaying = false;
    progSymbol = '⚪';
    loadingSymbol = '<a:loading:936525608404545566>';
    voiceConnection = null;
    resource = null;
    currentSongDurationInSeconds = 0;
    playingEmbed = null;
    progressMessage = null;
    loopMode = false;
    lastSongPlayed = null;
    textChannel = null;
    player = null;
    constructor(id) {
        this.id = id;
        this.playlistUrl = 'PLJdv7u2ne9iANURyGydzS2lEdNOXLkccA';
        this.player = (0, voice_1.createAudioPlayer)({
            behaviors: {
                noSubscriber: voice_1.NoSubscriberBehavior.Pause,
            },
        });
        this.player.on(voice_1.AudioPlayerStatus.Idle, () => {
            if (this.songList.length > 0) {
                if (this.loopMode) {
                    if (this.lastSongPlayed) {
                        play_song(this, this.lastSongPlayed);
                    }
                    else {
                        this.textChannel.send(`Something went wrong with loop mode`);
                        play_song(this, this.get_next_song());
                    }
                }
                else {
                    if (this.songTempQueue.length > 0) {
                        play_song(this, this.songTempQueue.shift());
                    }
                    else {
                        play_song(this, this.get_next_song());
                    }
                }
            }
        });
        this.update_playback_time();
    }
    next_song_index() {
        return (this.curSong + 1) % this.songList.length;
    }
    get_next_song() {
        this.curSong = this.next_song_index();
        return this.songList[this.curSong];
    }
    updatePlaybackTimeIsRunning = false;
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
const fetchUrlMaxAttempts = 10;
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
exports.play_song = play_song;
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
exports.display_player = display_player;
exports.guilds = [];
for (let i = 0; i < exports.guilds.length; ++i) {
    const g = exports.guilds[i];
}
