#!/usr/bin/env bash
# Regression set for the auto skeleton: the four synthetic animals (bone list + mechanism
# check), the three artist-rigged characters (compare), the montage and the contract test.
#   bash run-all.sh
cd "$(dirname "$0")"
for a in quadruped-parts quadruped bird fish; do
  echo "== $a"
  node auto-bones.cjs --ps out/animals/$a/flat.json --img out/animals/$a/images --rig none --out animals/$a --scale 0.8 2>&1 | grep -E "auto skeleton|Error|    at "
  node -e "const b=JSON.parse(require('fs').readFileSync('out/animals/$a/bones.json','utf8')); const p=JSON.parse(require('fs').readFileSync('out/animals/$a/plan.json','utf8')); console.log('hips', JSON.stringify(p.hips)); console.log(b.bones.filter(x=>x.kind==='bone').map(x=>x.name+'('+x.len.toFixed(0)+')').join(' '));"
  node mech-check.cjs --tag animals/$a --rig none 2>&1 | sed -n 3,9p | grep -v "^wrote"
done
node montage-animals.cjs | tail -1
echo "== jiaye"; node auto-bones.cjs 2>&1 | grep -E "auto skeleton"; node bones-compare.cjs 2>&1 | grep -E "^ALL|hierarchy agreement"
echo "== jinse"; node auto-bones.cjs --ps "D:/foyo_new/立绘/锦瑟/PSD.json" --img "D:/foyo_new/立绘/锦瑟/images" --rig "D:/foyo_new/立绘/锦瑟/NovaFlow/立绘.json" --out jinse 2>&1 | grep -E "auto skeleton"; node bones-compare.cjs --tag jinse --rig "D:/foyo_new/立绘/锦瑟/NovaFlow/立绘.json" 2>&1 | grep -E "^ALL|hierarchy agreement"
echo "== anan"; node auto-bones.cjs --ps out/anan/flat/flat.json --img out/anan/flat/images --rig "D:/AI_APP/spine查看/test/spine_lihui_anan_5.json" --out anan --scale 1 2>&1 | grep -E "auto skeleton"; node bones-compare.cjs --tag anan --rig "D:/AI_APP/spine查看/test/spine_lihui_anan_5.json" 2>&1 | grep -E "^ALL|hierarchy agreement"
echo "== tests"; (cd ../../particle-editor-desktop && node --test tests/spine-auto-bones-contract.test.js 2>&1 | grep -E "fail [0-9]|pass [0-9]")
