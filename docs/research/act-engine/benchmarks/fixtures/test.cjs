const {test}=require('node:test');const assert=require('node:assert/strict');const {sum}=require('./dist/src');test('sum',()=>assert.equal(sum(2,3),5));
