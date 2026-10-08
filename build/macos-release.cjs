// The ordinary package.json build stays unsigned for the cross-platform CI matrix.
const { build } = require('../package.json');

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    hardenedRuntime: true,
    notarize: true,
  },
};
