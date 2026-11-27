// Strict quick reviewer smoke; historical scenario/options remain unchanged.
import { options as historicalOptions } from './scenario.js';
export { setup, readLeaderboard, reportPair } from './scenario.js';

export const options = {
  ...historicalOptions,
  thresholds: {
    ...historicalOptions.thresholds,
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    dropped_iterations: ['count==0'],
  },
};
