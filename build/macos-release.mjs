// The ordinary package.json build stays unsigned for the cross-platform CI matrix.
import packageJson from '../package.json' with { type: 'json' };

const { build } = packageJson;
export default {
  ...build,
  mac: {
    ...build.mac,
    hardenedRuntime: true,
    notarize: true,
  },
};
