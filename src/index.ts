import * as childProcess from 'child_process';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as path from 'path';
import { Readable } from 'stream';
import { URL } from 'url';
import * as util from 'util';

import { Client, Message, TextChannel, VoiceConnection } from 'eris';

import { musicPath } from './path';

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

function handleTermination(bot?: Client) {
    bot && bot.disconnect({ reconnect: false });
    process.exit(0);
}

async function getYoutubeDlVersion() {
    const { stdout } = await util.promisify(childProcess.exec)('youtube-dl --version');
    return stdout.trim();
}

async function initializeFileSystem() {
    await util.promisify(fs.mkdir)(musicPath, { recursive: true });
}

interface MusicInfo {
    textChannelId: string;
    voiceChannelId: string;
    type: string;
    musicId: string;
    title: string;
}

let enqueue: (list: MusicInfo[]) => void = () => {};
let cancelPlaying: (clearAll: boolean) => void = () => {};
async function runQueue(bot: Client) {
    let queue: MusicInfo[] = [];
    let stop = false;
    while (!stop) {
        const musicList = await new Promise<MusicInfo[]>(resolve => {
            enqueue = resolve;
        });
        enqueue = item => {
            queue.push(...item);
        };
        queue.push(...musicList);
        while (queue.length > 0) {
            let informationMessage;
            let message: string;
            const item = queue.shift()!;

            try {
                let connection: VoiceConnection;
                try {
                    connection = await bot.joinVoiceChannel(item.voiceChannelId, { opusOnly: true });
                } catch (err) {
                    await bot.createMessage(
                        item.textChannelId,
                        ':x: 음성 채널에 들어갈 수 없어요.',
                    );
                    return;
                }
                connection.on('error', console.error);

                const id = `${item.type}-${item.musicId}`;
                const music = path.join(musicPath, id + '.webm');
                try {
                    await util.promisify(fs.access)(music, fs.constants.R_OK);
                } catch (_) {
                    informationMessage = await bot.createMessage(
                        item.textChannelId,
                        `:hourglass: **${item.title}** 다운로드 중입니다...`,
                    );
                    if (item.type === 'youtube') {
                        const { stdout } =
                            await util.promisify(childProcess.exec)(`youtube-dl -xg https://youtu.be/${item.musicId}`);
                        let url = stdout.split('\n')[0].trim();
                        await util.promisify(childProcess.exec)(
                            `ffmpeg -i '${url}' -vn -c:a libopus -b:a 96k '${music}'`
                        );
                    } else {
                        throw new Error(`Unknown type ${item.type}`);
                    }
                }

                if (connection.playing) {
                    connection.removeAllListeners('end');
                    connection.stopPlaying();
                }

                message = `:notes: **${item.title}**`;
                if (informationMessage != null) {
                    await informationMessage.edit(message);
                } else {
                    informationMessage = await bot.createMessage(
                        item.textChannelId,
                        message,
                    );
                }

                connection.play(music, { format: 'webm' });
                const waitingCancelPromise = new Promise<boolean>(resolve => {
                    cancelPlaying = resolve;
                }).then(clearAll => {
                    connection.removeAllListeners('end');
                    connection.stopPlaying();
                    if (clearAll) {
                        queue = [];
                    }
                });
                const waitingEndPromise = new Promise((resolve, reject) => {
                    connection.once('end', () => {
                        // bot.leaveVoiceChannel(voiceChannelId);
                        resolve();
                    });
                });
                await Promise.race([waitingCancelPromise, waitingEndPromise]);
            } catch (err) {
                console.error(err);
                message = `:dizzy_face: ${item.title} 재생 실패...`;
                if (informationMessage != null) {
                    await informationMessage.edit(message);
                } else {
                    informationMessage = await bot.createMessage(
                        item.textChannelId,
                        message,
                    );
                }
            }
            cancelPlaying = () => {};
        }
    }
    enqueue = () => {};
    cancelPlaying = () => {};
}

async function main() {
    await initializeFileSystem();

    const youtubeDlVersion = await getYoutubeDlVersion();
    console.log(`youtube-dl ${youtubeDlVersion}`);

    const bot = new Client(token!, {});
    runQueue(bot);

    bot.on('messageCreate', async msg => {
        if (msg.member == null) {
            return;
        }

        const myId = bot.user.id;
        const mentions = [`<@${myId}>`, `<@!${myId}>`];
        const content = msg.content;
        const splitContent = content.split(' ').filter(x => x !== '');
        if (splitContent.length !== 2 || mentions.indexOf(splitContent[0]) === -1) {
            return;
        }

        if (splitContent[1] === '버전') {
            await bot.createMessage(
                msg.channel.id,
                '버전 `dev`\n\n' +
                `\`youtube-dl\` ${youtubeDlVersion}`
            );
            return;
        } else if (splitContent[1] === '다음') {
            cancelPlaying(false);
            return;
        } else if (splitContent[1] === '정지') {
            cancelPlaying(true);
            return;
        }

        // URL tests
        const url = new URL(splitContent[1]);
        let id = undefined;
        let isPlaylist = false;
        if (url.host === 'youtu.be') {
            id = url.pathname.substr(1);
        } else if (/^(:?www\.|m\.|music\.)?youtube.com$/.test(url.host)) {
            if (url.pathname === '/watch') {
                id = url.searchParams.get('v');
            } else if (url.pathname === '/playlist') {
                id = url.searchParams.get('list');
                isPlaylist = true;
            }
        }
        if (id == null) {
            return;
        }

        const voiceChannelId = msg.member.voiceState.channelID;
        if (voiceChannelId == null) {
            await bot.createMessage(
                msg.channel.id,
                ':x: 먼저 음성 채널에 접속해 주세요.',
            );
            return;
        }

        await msg.channel.sendTyping();

        const musicList = [];
        if (isPlaylist) {
            const { stdout } = await util.promisify(childProcess.exec)(
                `youtube-dl --playlist-random --flat-playlist -J 'https://youtube.com/playlist?list=${id}'`,
            );
            const playlistInfo = JSON.parse(stdout);
            for (const entry of playlistInfo.entries) {
                musicList.push({
                    textChannelId: msg.channel.id,
                    voiceChannelId,
                    type: 'youtube',
                    musicId: entry.id,
                    title: entry.title,
                });
            }
        } else {
            const { stdout } = await util.promisify(childProcess.exec)(
                `youtube-dl -e 'https://youtu.be/${id}'`,
            );
            const title = stdout.trim();
            if (title !== '') {
                musicList.push({
                    textChannelId: msg.channel.id,
                    voiceChannelId,
                    type: 'youtube',
                    musicId: id,
                    title,
                });
            }
        }

        if (musicList.length === 0) {
            await bot.createMessage(
                msg.channel.id,
                ':x: 재생할 수 있는 음악이 없어요.',
            );
            return;
        }

        await bot.createMessage(
            msg.channel.id,
            ':ok: 리퀘스트, 접수했어요!',
        );
        enqueue(musicList);
    });

    bot.connect();

    process.on('SIGINT', () => handleTermination(bot));
    process.on('SIGTERM', () => handleTermination(bot));
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
