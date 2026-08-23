import assert from"node:assert/strict";
import test from"node:test";
import{listBloggers,shouldContinueBloggerPagination,type Runner}from"../../lib/workers/get-notes-cli";

function blogger(id:number){return{follow_id:id,account_name:`博主 ${id}`,platform:"douyin"};}

test("blogger pagination continues when total exceeds accumulated rows even if has_more is false",async()=>{const calls:number[]=[];const run:Runner=async(args)=>{const page=Number(args.at(-1));calls.push(page);return page===1?{data:{bloggers:Array.from({length:20},(_,index)=>blogger(index+1)),has_more:false,total:28}}:{data:{bloggers:Array.from({length:8},(_,index)=>blogger(index+21)),has_more:false,total:28}};};const result=await listBloggers("kb",run);assert.equal(result.length,28);assert.deepEqual(calls,[1,2]);});

test("blogger pagination stops when reported total is satisfied",async()=>{let calls=0;const run:Runner=async()=>{calls+=1;return{data:{bloggers:[blogger(1),blogger(2)],has_more:false,total:2}};};assert.equal((await listBloggers("kb",run)).length,2);assert.equal(calls,1);});

test("blogger pagination stops safely on an empty or duplicate page",async()=>{const emptyCalls:number[]=[];const emptyRun:Runner=async(args)=>{const page=Number(args.at(-1));emptyCalls.push(page);return page===1?{data:{bloggers:[blogger(1)],has_more:false,total:3}}:{data:{bloggers:[],has_more:false,total:3}};};assert.equal((await listBloggers("kb",emptyRun)).length,1);assert.deepEqual(emptyCalls,[1,2]);const duplicateCalls:number[]=[];const duplicateRun:Runner=async(args)=>{const page=Number(args.at(-1));duplicateCalls.push(page);return{data:{bloggers:[blogger(1)],has_more:page===1,total:2}};};assert.equal((await listBloggers("kb",duplicateRun)).length,1);assert.deepEqual(duplicateCalls,[1,2]);});

test("pagination decision accepts either a trustworthy has_more flag or an unfinished total",()=>{assert.equal(shouldContinueBloggerPagination({hasMore:true,total:null,accumulated:20,newItems:20}),true);assert.equal(shouldContinueBloggerPagination({hasMore:false,total:28,accumulated:20,newItems:20}),true);assert.equal(shouldContinueBloggerPagination({hasMore:false,total:20,accumulated:20,newItems:20}),false);assert.equal(shouldContinueBloggerPagination({hasMore:true,total:28,accumulated:20,newItems:0}),false);});
