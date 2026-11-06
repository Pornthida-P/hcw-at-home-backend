const { cleanPhoneNumberForTwilio } = require('../api/utils/helpers');

console.log('=== Phone Normalization Tests ===\n');

const testCases = [
  { input: '0812345678', expected: '+66812345678', description: 'Thai local format without country code' },
  { input: '081-234-5678', expected: '+66812345678', description: 'Thai local format with dashes' },
  { input: '+66812345678', expected: '+66812345678', description: 'Thai international format' },
  { input: '66812345678', expected: '+6666812345678', description: 'Thai international without plus (ambiguous)' },
  { input: '+1234567890', expected: '+1234567890', description: 'International with plus' },
];

console.log('Testing cleanPhoneNumberForTwilio:\n');
testCases.forEach(test => {
  const result = cleanPhoneNumberForTwilio(test.input);
  const passed = result === test.expected ? '✓' : '✗';
  console.log(`${passed} Input: "${test.input}"`);
  console.log(`  Expected: ${test.expected}`);
  console.log(`  Got:      ${result}`);
  console.log(`  Desc:     ${test.description}\n`);
});

console.log('\n=== Analysis ===');
console.log('Issue: cleanPhoneNumberForTwilio does NOT handle country code conversion.');
console.log('Thai local numbers (starting with 0) are normalized to +0... which is invalid.');
console.log('They should be converted from 0XXXXXXXXX to +66XXXXXXXXX (remove 0, add +66).\n');

console.log('For BUG016:');
console.log('- 0812345678 becomes +0812345678 (WRONG - should be +66812345678)');
console.log('- 081-234-5678 becomes +0812345678 (WRONG - should be +66812345678)');
console.log('- These invalid numbers then fail SMS provider prefix checks.');
