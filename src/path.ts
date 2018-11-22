import * as path from 'path';

export const home = process.env['RETISHA_HOME'] || '/var/lib/retisha';
export const musicPath = path.join(home, 'music');
export const sshKeyPath = path.join(home, 'worker_key');
