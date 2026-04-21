const { explain, parse, stringify } = require('./version');

// those notation are borrowed from semver
module.exports = {
  major,
  minor,
  patch,
  inc,
};

function major(input) {
  const version = explain(input);
  if (!version) {
    throw new TypeError('Invalid Version: ' + input);
  }
  return version.release[0];
}

function minor(input) {
  const version = explain(input);
  if (!version) {
    throw new TypeError('Invalid Version: ' + input);
  }
  if (version.release.length < 2) {
    return 0;
  }
  return version.release[1];
}

function patch(input) {
  const version = explain(input);
  if (!version) {
    throw new TypeError('Invalid Version: ' + input);
  }
  if (version.release.length < 3) {
    return 0;
  }
  return version.release[2];
}

function inc(input, release, preReleaseIdentifier) {
  let identifier = preReleaseIdentifier || `a`;
  const version = parse(input);

  if (!version) {
    return null;
  }

  if (
    !['a', 'b', 'c', 'rc', 'alpha', 'beta', 'pre', 'preview'].includes(
      identifier,
    )
  ) {
    return null;
  }

  switch (release) {
    case 'premajor':
      {
        const [majorVersion] = version.release;
        version.release.fill(0);
        version.release[0] = majorVersion + 1;
      }
      version.pre = [identifier, 0];
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'preminor':
      {
        const [majorVersion, minorVersion = 0] = version.release;
        version.release.fill(0);
        version.release[0] = majorVersion;
        version.release[1] = minorVersion + 1;
      }
      version.pre = [identifier, 0];
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'prepatch':
      {
        const [majorVersion, minorVersion = 0, patchVersion = 0] =
          version.release;
        version.release.fill(0);
        version.release[0] = majorVersion;
        version.release[1] = minorVersion;
        version.release[2] = patchVersion + 1;
      }
      version.pre = [identifier, 0];
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'prerelease':
      if (version.pre === null) {
        const [majorVersion, minorVersion = 0, patchVersion = 0] =
          version.release;
        version.release.fill(0);
        version.release[0] = majorVersion;
        version.release[1] = minorVersion;
        version.release[2] = patchVersion + 1;
        version.pre = [identifier, 0];
      } else {
        if (preReleaseIdentifier === undefined && version.pre !== null) {
          [identifier] = version.pre;
        }

        const [letter, number] = version.pre;
        if (letter === identifier) {
          version.pre = [letter, number + 1];
        } else {
          version.pre = [identifier, 0];
        }
      }

      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'major':
      if (
        version.release.slice(1).some((value) => value !== 0) ||
        version.pre === null
      ) {
        const [majorVersion] = version.release;
        version.release.fill(0);
        version.release[0] = majorVersion + 1;
      }
      delete version.pre;
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'minor':
      if (
        version.release.slice(2).some((value) => value !== 0) ||
        version.pre === null
      ) {
        const [majorVersion, minorVersion = 0] = version.release;
        version.release.fill(0);
        version.release[0] = majorVersion;
        version.release[1] = minorVersion + 1;
      }
      delete version.pre;
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    case 'patch':
      if (
        version.release.slice(3).some((value) => value !== 0) ||
        version.pre === null
      ) {
        const [majorVersion, minorVersion = 0, patchVersion = 0] =
          version.release;
        version.release.fill(0);
        version.release[0] = majorVersion;
        version.release[1] = minorVersion;
        version.release[2] = patchVersion + 1;
      }
      delete version.pre;
      delete version.post;
      delete version.dev;
      delete version.local;
      break;
    default:
      return null;
  }

  return stringify(version);
}
