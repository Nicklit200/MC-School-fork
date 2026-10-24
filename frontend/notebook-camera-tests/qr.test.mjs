import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {qrMatrix} from '../public/notebook-camera/qr.mjs';

// Expected complete symbols were generated with the independent Project Nayuki
// encoder (byte mode, ECC L, fixed mask 0). This checks placement, version bits,
// byte counts, block interleaving and error correction, not only output size.
const {fixtures}=JSON.parse(readFileSync(new URL('./qr-reference-fixtures.json',import.meta.url),'utf8'));
for(const fixture of fixtures)test('QR matches independent encoder: '+fixture.name,()=>{
 const matrix=qrMatrix(fixture.payload);
 assert.equal(new TextEncoder().encode(fixture.payload).length,fixture.bytes);
 assert.equal(matrix.length,fixture.version*4+17);
 const hash=createHash('sha256').update(matrix.map(row=>row.map(Number).join('')).join('\n')).digest('hex');
 assert.equal(hash,fixture.sha256);
});
test('oversize QR fails clearly instead of silently dropping the pairing secret',()=>{
 assert.throws(()=>qrMatrix('x'.repeat(322)),/слишком длинный/);
 assert.throws(()=>qrMatrix('я'.repeat(161)),/слишком длинный/);
});
