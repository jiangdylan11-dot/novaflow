const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('novaflow-web/renderer/assets/index-BbIa-2NM.js', 'utf8');
const start = source.indexOf('Jn=(e,t,n)=>');
const end = source.indexOf(',Yn=()=>', start);
const render = source.slice(start + 3, end);

test('save owns progress even when an asynchronous preview render updates', () => {
  let closed = 0;
  let created = 0;
  const context = {
    document: {
      body: { getAttribute: () => '1' },
      createElement: () => { created++; throw new Error('unexpected preview dialog'); }
    },
    Yn: () => { closed++; }
  };
  vm.runInNewContext(`(${render})(1, 73, 'preview')`, context);
  assert.equal(closed, 1);
  assert.equal(created, 0);
});
