// Run by `npm version <version>` once package.json has the new version: the manifests and versions.json follow it.
// A stable version (1.2.3) goes into manifest.json and manifest-beta.json (so testers on BRAT get it too) and into
// versions.json; a pre-release (1.2.3-beta.1) only into manifest-beta.json, which BRAT reads.
import { readFileSync, writeFileSync } from 'node:fs';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const write = (f, data) => writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
const version = read('package.json').version;
const manifest = read('manifest.json');
if (version.includes('-')) {
  write('manifest-beta.json', { ...manifest, version });
} else {
  manifest.version = version;
  write('manifest.json', manifest);
  write('manifest-beta.json', manifest);
  const versions = read('versions.json');
  versions[version] = manifest.minAppVersion;
  write('versions.json', versions);
}
console.log(`version ${version}`);
