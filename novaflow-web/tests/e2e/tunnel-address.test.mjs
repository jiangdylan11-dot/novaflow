import assert from 'node:assert/strict';
import { tunnelAddress } from '../../worker/src/tunnel.mjs';
assert.equal(tunnelAddress('Post "https://api.trycloudflare.com/tunnel": network timeout'), '');
assert.equal(tunnelAddress('| https://rooms-editing-incurred-bikes.trycloudflare.com |'), 'https://rooms-editing-incurred-bikes.trycloudflare.com');
assert.equal(tunnelAddress('https://api.trycloudflare.com/tunnel\nhttps://real-test-host.trycloudflare.com'), 'https://real-test-host.trycloudflare.com');
console.log('3 passed, 0 failed: tunnel address rejects API error URLs');
