#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const bundlePath = path.join(repoRoot, 'particle-editor', 'assets', 'index-BbIa-2NM.js')
let source = fs.readFileSync(bundlePath, 'utf8')

function replaceOnce(before, after, label, alreadyApplied) {
  if (alreadyApplied && source.includes(alreadyApplied)) return
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} anchor must exist exactly once`)
  }
  source = source.slice(0, first) + after + source.slice(first + before.length)
}

const resolverAnchor = '})))},resolveVideoResource:async e=>{'
const publishMethod = '})))},publishVideoResource:async(e,t={})=>{let n=String(e?.filePath||e?.path||``).trim();if(!n)throw Error(`video resource path is required`);let r=window.electronAPI?.videoResourceMediaRegister;if(typeof r!=`function`)throw Error(`video resource media bridge unavailable`);let i=await r({filePath:n}),a=String(i?.url||``).trim(),o=String(i?.token||``).trim();if(!i?.ok||!a||!o)throw Error(String(i?.error||`video resource media registration failed`));let p=Date.now(),m={id:`local-${p}-video-merge-${Math.random().toString(16).slice(2)}`,createdAt:p,promptId:``,filename:String(i?.fileName||e?.fileName||n.split(/[\\\\/]/).pop()||`video.mp4`),subfolder:``,type:`local`,objectUrl:a,sourceKind:String(t?.sourceKind||`video_merge_output`).trim()||`video_merge_output`,localPath:n,videoMergeCachedPath:n,mediaToken:o,mimeType:String(i?.mimeType||e?.mimeType||(/\\.webm$/i.test(n)?`video/webm`:`video/mp4`))};for(let e of(Array.isArray(et.current)?et.current.slice(29):[])){let t=String(e?.mediaToken||``).trim();t&&window.electronAPI?.videoResourceMediaRelease?.({token:t})}$e(e=>[m,...e].slice(0,30));return Object.freeze({resourceId:String(m.id),fileName:String(m.filename),mimeType:String(m.mimeType),localPath:n,objectUrl:a,mediaToken:o})},resolveVideoResource:async e=>{'
replaceOnce(resolverAnchor, publishMethod, 'shared asset publish bridge', 'publishVideoResource:async')

const cleanupAnchor = '(0,_.useEffect)(()=>()=>{for(let e of Array.from(kt.current))try{URL.revokeObjectURL(e)}catch{}kt.current.clear()},[]);'
const cleanupReplacement = '(0,_.useEffect)(()=>()=>{for(let e of Array.from(kt.current))try{URL.revokeObjectURL(e)}catch{}kt.current.clear();try{for(let e of Array.isArray(et.current)?et.current:[]){let t=String(e?.mediaToken||``).trim();t&&window.electronAPI?.videoResourceMediaRelease?.({token:t})}}catch{}},[]);'
replaceOnce(cleanupAnchor, cleanupReplacement, 'shared asset media cleanup', 'kt.current.clear();try{for(let e of Array.isArray(et.current)')

const deleteAnchor = 'v(t=>{let n=t.find(t=>t.id===e.id),r=String(n?.tmpDir||``);if(r&&window?.electronAPI?.exportCleanupDir)try{window.electronAPI.exportCleanupDir({dir:r})}catch{}return t.filter(t=>t.id!==e.id)})'
const deleteReplacement = 'v(t=>{let n=t.find(t=>t.id===e.id),r=String(n?.tmpDir||``),i=String(n?.mediaToken||``).trim();if(r&&window?.electronAPI?.exportCleanupDir)try{window.electronAPI.exportCleanupDir({dir:r})}catch{}i&&window.electronAPI?.videoResourceMediaRelease?.({token:i});return t.filter(t=>t.id!==e.id)})'
replaceOnce(deleteAnchor, deleteReplacement, 'shared asset delete cleanup', 'i=String(n?.mediaToken||``).trim();if(r&&window?.electronAPI?.exportCleanupDir)')

fs.writeFileSync(bundlePath, source, 'utf8')
console.log('patched video merge save-and-close resource publishing')
