const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

function loadSource(source) {
  const filename = path.join(process.cwd(), source);
  const result = esbuild.buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

// Business rules live in the FastAPI backend (backend/tests). These cover the UI-side preview helpers only.
const { validInstituteSlot, formatInstituteSlot, addMonthsClamped } = loadSource('src/lib/schedule.ts');

test('course time slots respect 8 AM to 9 PM and allow variable duration', () => {
  assert.equal(validInstituteSlot('08:00', '09:00'), true);
  assert.equal(validInstituteSlot('19:30', '21:00'), true);
  assert.equal(validInstituteSlot('07:59', '09:00'), false);
  assert.equal(validInstituteSlot('20:00', '21:01'), false);
  assert.equal(validInstituteSlot('10:00', '10:00'), false);
  assert.equal(formatInstituteSlot('08:00', '09:30'), '8:00 AM – 9:30 AM');
  assert.equal(addMonthsClamped(new Date(2026, 0, 31), 1).getDate(), 28);
});

// 19 Nov: bills and receipts open the chat for the registered number the same way the fee reminder does.
const { waLink, waNumber } = loadSource('src/lib/whatsapp.ts');

test('WhatsApp numbers follow the fee-reminder rules and open the exact chat', () => {
  assert.deepEqual(waNumber('98765 43210'), { local: '9876543210', problem: null });
  assert.deepEqual(waNumber('+91 98765 43210'), { local: '9876543210', problem: null });
  assert.deepEqual(waNumber('09876543210'), { local: '9876543210', problem: null });
  assert.equal(waNumber('').problem, 'missing');
  assert.equal(waNumber(null).problem, 'missing');
  assert.equal(waNumber('12345').problem, 'invalid');
  assert.equal(waNumber('5876543210').problem, 'invalid');
  assert.equal(waLink('9876543210', 'Bill SB-1'), 'https://wa.me/919876543210?text=Bill%20SB-1');
});
