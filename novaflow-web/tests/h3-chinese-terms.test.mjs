import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreChineseTerms as r} from '../packages/shared/src/h3-chinese-terms.mjs';

test('the words the user wrote go back into the English text',()=>{
  assert.equal(r('Chinese wuxia style, Li Xiaoyao in a loose cyan robe stands.','国风武侠，身穿青衫的李逍遥第一帧就挥剑'),'国风 wuxia style, 李逍遥 in a loose 青衫 stands.');
  assert.equal(r('Zhang San waves in a qipao.','张三穿着旗袍挥手'),'张三 waves in a 旗袍.');
  assert.equal(r('Ouyang Feng turns.','欧阳锋转身'),'欧阳锋 turns.');
});
test('words the user did not write are left alone',()=>{
  assert.equal(r('A girl in a cyan robe.','一个穿蓝绿色长袍的女孩'),'A girl in a cyan robe.');
  assert.equal(r('Li Na smiles.','一个女孩微笑'),'Li Na smiles.');
  assert.equal(r('New York at night.','纽约的夜晚'),'New York at night.');
  assert.equal(r('Marco Polo walks.','马可波罗走路'),'Marco Polo walks.');
  assert.equal(r('A cat.','英文 only'),'A cat.');
  assert.equal(r('A cat.','cat'),'A cat.');
});
