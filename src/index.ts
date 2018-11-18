import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

import { Client, Message, TextChannel } from 'eris';

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

async function main() {
    const youtubeDlVersion = await getYoutubeDlVersion();
    console.log(`youtube-dl ${youtubeDlVersion}`);

    const bot = new Client(token!, {});

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
        }

        // URL tests
        const url = new URL(splitContent[1]);
        let id = undefined;
        if (url.host === 'youtu.be') {
            id = url.pathname.substr(1);
        } else if (/^(:?www\.|music\.)?youtube.com$/.test(url.host) && url.pathname === '/watch') {
            id = url.searchParams.get('v');
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

        const { stdout: audioUrlRaw } = await util.promisify(childProcess.exec)(`youtube-dl -xg '${url.toString()}'`);
        const audioUrlList = audioUrlRaw.split('\n').filter(x => x !== '');
        if (audioUrlList.length === 0) {
            await bot.createMessage(
                msg.channel.id,
                ':x: 재생할 수 있는 음악이 없어요.',
            );
            return;
        }
        const audioUrl = audioUrlList[0];

        let connection;
        try {
            connection = await bot.joinVoiceChannel(voiceChannelId);
        } catch (err) {
            await bot.createMessage(
                msg.channel.id,
                ':x: 음성 채널에 들어갈 수 없어요.',
            );
            return;
        }

        if (connection.playing) {
            connection.removeAllListeners('end');
            connection.stopPlaying();
        }

        await bot.createMessage(
            msg.channel.id,
            ':notes: 리퀘스트, 접수했어요!',
        );
        connection.play(audioUrl);
        connection.once('end', () => {
            bot.leaveVoiceChannel(voiceChannelId);
        });
    });

    bot.connect();

    process.on('SIGINT', () => handleTermination(bot));
    process.on('SIGTERM', () => handleTermination(bot));
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
