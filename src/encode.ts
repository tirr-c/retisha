import * as childProcess from 'child_process';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('No source specified');
    process.exit(1);
}

const source = args[0];

const handle = childProcess.spawn(
    '/usr/bin/ffmpeg',
    [
        '-i', source,
        '-vn',
        '-af', 'loudnorm',
        '-c:a', 'libopus',
        '-b:a', '96k',
        '-f', 'webm',
        '-',
    ],
    {
        stdio: ['inherit', 'inherit', 'inherit'],
    },
);

handle.on('exit', code => {
    if (code == null) {
        process.exit(1);
        return;
    }
    process.exit(code);
});
