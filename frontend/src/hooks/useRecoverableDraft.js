import { useCallback, useEffect, useRef, useState } from 'react';

// Each tab keeps drafts under the exact actor, facility and clinical record.
// No pending callback can flush a previous record's text under a new key.
const PREFIX='hms.draft.v2';
let storageGeneration=0;
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}};
const write=(key,value)=>{try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* In-memory text remains available if storage is full. */}};
export function clearAllDrafts(){
 storageGeneration++;
 try{const keys=[];for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);if(/^hms\.draft\.v[12]:/.test(k||''))keys.push(k);}keys.forEach(k=>sessionStorage.removeItem(k));}catch{/* Storage may be unavailable. */}
}
export default function useRecoverableDraft({userId,facilityId,scope,id,enabled=true}){
 const key=enabled&&userId&&facilityId&&id?`${PREFIX}:${userId}:${facilityId}:${scope}:${id}`:null;
 const entries=useRef(new Map()),timers=useRef(new Map()),active=useRef(key);active.current=key;
 const generation=useRef(storageGeneration);
 const [found,setFound]=useState({key:null,value:null});
 useEffect(()=>{
  if(!key){setFound({key:null,value:null});return;}
  const value=read(key);entries.current.set(key,value);setFound({key,value});
  const flush=()=>{clearTimeout(timers.current.get(key));if(generation.current===storageGeneration)write(key,entries.current.get(key));};
  window.addEventListener('pagehide',flush);
  return()=>{flush();window.removeEventListener('pagehide',flush);};
 },[key]);
 const keep=useCallback((value,revision)=>{
  if(!key||active.current!==key||generation.current!==storageGeneration)return;
  entries.current.set(key,{...(entries.current.get(key)||{}),value:copy(value),revision,savedAt:new Date().toISOString()});
  clearTimeout(timers.current.get(key));timers.current.set(key,setTimeout(()=>{if(generation.current===storageGeneration)write(key,entries.current.get(key));},400));
 },[key]);
 const setPending=useCallback(request=>{
  if(!key||active.current!==key||generation.current!==storageGeneration)return;
  entries.current.set(key,{...(entries.current.get(key)||{}),pending:request?copy(request):undefined});write(key,entries.current.get(key));
 },[key]);
 const clear=useCallback(()=>{
  if(!key||active.current!==key)return;clearTimeout(timers.current.get(key));entries.current.set(key,null);write(key,null);setFound({key,value:null});
 },[key]);
 const dismiss=useCallback(()=>setFound({key,value:null}),[key]);
 return {recovered:found.key===key?found.value:null,keep,setPending,clear,dismiss};
}
