// Run by `npm version <version>` once package.json has the new version: manifest.json and versions.json follow it.
import { readFileSync, writeFileSync } from 'node:fs';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const write = (f, data) => writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
const version = read('package.json').version;
const manifest = read('manifest.json');
manifest.version = version;
write('manifest.json', manifest);
const versions = read('versions.json');
versions[version] = manifest.minAppVersion;
write('versions.json', versions);
console.log(`version ${version}`);
