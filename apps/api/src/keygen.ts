import { writeFileSync } from 'node:fs';

import { generateKeypair, publicKeyEntry, signingKeyRecord } from '@debrief/chain';

const outFile = process.argv[2] ?? 'debrief.signing-key.json';
const keypair = generateKeypair();
writeFileSync(outFile, `${JSON.stringify(signingKeyRecord(keypair), null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify(publicKeyEntry(keypair.publicKey))}\n`);
