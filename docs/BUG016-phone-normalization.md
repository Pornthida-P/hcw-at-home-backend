# BUG016: Phone Number Normalization Issue

## Problem Description

Thai phone numbers in local format (`0812345678` or `081-234-5678`) were being normalized incorrectly, resulting in "phone not authorized platform" errors.

## Root Cause

The `cleanPhoneNumberForTwilio` function in `api/utils/helpers.js` was simply removing non-digit characters (except +) and prepending a `+` if missing. This caused Thai local numbers starting with `0` to be converted to invalid international numbers:

- `0812345678` → `+0812345678` ❌ (Invalid - no country starts with +0)
- `081-234-5678` → `+0812345678` ❌ (Same issue)

The correct Thai international format requires:
- Removing the leading `0`
- Adding country code `+66`
- Result: `0812345678` → `+66812345678` ✓

## Impact

When the phone number was normalized incorrectly:
1. The SMS helper would attempt to match it against provider prefixes
2. No provider would match `+08...` numbers
3. The system would reject the number as "not authorized platform"

## Solution

Updated `cleanPhoneNumberForTwilio` to:
1. Check if number starts with `+` → return as-is (already international)
2. Check if number starts with `0` → replace with `+{countryCode}` (local to international)
3. Otherwise → prepend `+` (ambiguous case, might already have country code)

Configuration via environment variable:
```bash
DEFAULT_PHONE_COUNTRY_CODE=66  # For Thailand
```

## Fixed Code

```javascript
function cleanPhoneNumberForTwilio(number) {
  let cleaned = number.replace(/[^+\d]/g, '');
  
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  const defaultCountryCode = process.env.DEFAULT_PHONE_COUNTRY_CODE || '66';
  
  if (cleaned.startsWith('0') && defaultCountryCode) {
    cleaned = `+${defaultCountryCode}${cleaned.substring(1)}`;
  } else if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }

  return cleaned;
}
```

## Test Cases

| Input          | Output         | Status |
|----------------|----------------|--------|
| 0812345678     | +66812345678   | ✓      |
| 081-234-5678   | +66812345678   | ✓      |
| +66812345678   | +66812345678   | ✓      |
| +1234567890    | +1234567890    | ✓      |

## SMS Provider Prefix Matching

After normalization, the phone number is checked against SMS provider prefixes. For Thai numbers:

- Provider prefix might be: `+66`, `+668`, etc.
- Normalized `+66812345678` will now match correctly
- Numbers without valid provider prefix still rejected (by design for security)

## Configuration Requirements

Set in `.env` or environment:
```bash
DEFAULT_PHONE_COUNTRY_CODE=66  # Thailand
```

For other countries, adjust accordingly:
- USA: `1`
- UK: `44`
- France: `33`
- etc.

## Testing

Run the test file to verify normalization:
```bash
node test/phone-normalization.test.js
```

## Related Files

- `api/utils/helpers.js` - Fixed normalization function
- `api/helpers/sms.js` - SMS sending with provider matching
- `api/controllers/PublicInviteController.js` - Prefix status checking
- `test/phone-normalization.test.js` - Verification tests
