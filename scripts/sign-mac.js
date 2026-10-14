'use strict';

const { signAsync } = require('@electron/osx-sign');

// A valid bundle signature is needed on Apple Silicon even for an internal
// build. Ad-hoc signing is not a Developer ID certificate or notarization.
module.exports = options => signAsync(options.identity ? options : {
  ...options,
  identity: '-',
  identityValidation: false,
  gatekeeperAssess: false,
});
