import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {cpuSnapshot, cpuPercent, gpuRows} = require('../../worker/src/resource-telemetry.cjs');

test('CPU usage is the total non-idle share between two system samples', () => {
  const sample = (user, idle) => [{times:{user,nice:0,sys:0,idle,irq:0}}];
  assert.equal(cpuPercent(null, cpuSnapshot(sample(100, 100))), null);
  assert.equal(cpuPercent(cpuSnapshot(sample(100, 100)), cpuSnapshot(sample(130, 170))), 30);
  assert.equal(cpuPercent(cpuSnapshot(sample(100, 100)), cpuSnapshot(sample(100, 100))), null);
  assert.equal(cpuPercent(cpuSnapshot(sample(100, 100)), cpuSnapshot(sample(90, 90))), null);
  assert.equal(cpuSnapshot([{times:{idle: 1}}]), null);
  assert.equal(cpuPercent(cpuSnapshot(sample(100, 100)), cpuSnapshot([...sample(130, 170), ...sample(1, 1)])), null);
});

test('NVIDIA usage and temperature handle unavailable values and multiple devices', () => {
  const rows = gpuRows('GPU A, 100, 1000, 43, 25\nGPU B, 200, 2000, N/A, N/A');
  assert.deepEqual(rows.map(({name,percent,temperature}) => ({name,percent,temperature})), [
    {name:'GPU A',percent:25,temperature:43}, {name:'GPU B',percent:null,temperature:null}
  ]);
  assert.equal(rows[0].used,100 * 1048576);
  assert.equal(gpuRows('broken\nGPU, 900, 100, 45, 2').length,0);
  assert.equal(gpuRows('GPU, 1, 100, 999, 101')[0].temperature,null);
  assert.equal(gpuRows('GPU, 1, 100, 999, 101')[0].percent,null);
});
