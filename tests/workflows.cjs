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
