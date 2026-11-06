# BUG016: Phone Number Rejection - Investigation INCOMPLETE

## Reported Issue

**Observed Behavior:** UI already displayed `+66812345678` then received "phone not authorized platform" error.

## Initial Hypothesis (INCORRECT)

I initially hypothesized the issue was in `cleanPhoneNumberForTwilio` converting `0812345678` to `+0812345678`.

**Status:** This hypothesis does NOT explain the observed behavior where the UI already showed the correct format `+66812345678`.

## Actual System Flow

### 1. Phone Number Validation Path

```
User Input → Frontend Normalization? → Backend checkPrefix API → determineStatus() → Provider Prefix Matching
```

**Endpoint:** `GET /api/v1/check-prefix?phoneNumber=+66812345678&type=patient&language=en`

**Code Path:**
1. `PublicInviteController.checkPrefix()` receives phone number (line 546-562)
2. Calls `determineStatus(phoneNumber, providers, config)`
3. Iterates through `SmsProvider` records from database
4. Checks `phoneNumber.startsWith(prefix)` for each enabled provider
5. Returns code 0 if no provider matches

### 2. Provider Prefix Configuration

Providers configured in `config/bootstrap.js` (lines 64-108):

- **TWILIO**: Prefix from `SMS_TWILLO_WL_PREFIX` env var (default: `*`)
- **OVH**: Prefix from `SMS_OVH_WL_PREFIX` (default: `*`)
- **SWISSCOM**: Prefix from `SMS_SWISSCOM_WL_PREFIX` (default: `*`)
- **CLICKATEL**: Prefix from `SMS_CLICKATEL_WL_PREFIX` (default: `*`)
- **CLICKATEL_API**: Prefix from `SMS_CLICKATEL_API_WL_PREFIX` (default: `*`)
- **ODOO_SMS**: Prefix from `SMS_ODOO_WL_PREFIX` (default: `*`)
- **TWILIO_WHATSAPP**: Prefix from `TWILIO_WHATSAPP_WL_PREFIX` (NO default - could be empty!)

### 3. Prefix Matching Logic

From `PublicInviteController.js:23`:
```javascript
const prefixMatches = prefixList.includes('*') || 
                      prefixList.some(prefix => prefix && phoneNumber.startsWith(prefix));
```

**Key Points:**
- `*` wildcard matches everything
- Empty/null prefix values are falsy and won't match
- Exclusion prefixes (starting with `!`) skip providers

### 4. Possible Root Causes

#### A. All Providers Disabled
If all SMS providers have missing required env vars, they're all marked `isDisabled: true` and won't be checked.

**Check:** Query `SmsProvider` table: `SELECT * FROM sms_providers WHERE isDisabled = false`

#### B. Prefix Configuration Mismatch
If env vars set prefixes that don't match Thai numbers:
- `SMS_TWILLO_WL_PREFIX=+1` (US only)
- `SMS_TWILLO_WL_PREFIX=+668` (only +668, not +6681/+6682)
- `SMS_TWILLO_WL_PREFIX=!+66` (excluded!)

**Check:** Environment variables in production

#### C. Empty Prefix with No Default
For TWILIO_WHATSAPP specifically, if `TWILIO_WHATSAPP_WL_PREFIX` is not set, it could be `undefined` or empty string, which won't match.

**Check:** `process.env.TWILIO_WHATSAPP_WL_PREFIX` value

#### D. Frontend Pre-Normalization
The UI might be normalizing `0812345678` → `+66812345678` on the frontend, then sending to backend which rejects it due to provider config.

**Check:** Frontend code that calls `/api/v1/check-prefix`

## What My Fix Actually Did

I modified `cleanPhoneNumberForTwilio` to convert `0812345678` → `+66812345678`.

**Impact:**
- ✅ Helps if phone number arrives at backend as `0812345678`
- ❌ Does NOT help if phone number already arrives as `+66812345678`
- ❌ Does NOT affect provider prefix matching
- ❌ Does NOT fix provider configuration issues

## Evidence Needed to Confirm Root Cause

### Test Case 1: Provider Configuration
```sql
-- On production database
SELECT provider, prefix, isWhatsapp, isDisabled FROM sms_providers;
```

Expected for Thai numbers to work:
- At least one provider with `isDisabled = false`
- AND that provider's prefix matches `+66` (e.g., `*`, `+66`, `+668`, etc.)
- AND that prefix does NOT have exclusion `!+66`

### Test Case 2: Environment Variables
```bash
# On production server
echo $SMS_TWILLO_WL_PREFIX
echo $SMS_OVH_WL_PREFIX
# etc. for all providers
```

### Test Case 3: API Reproduction
```bash
curl -X GET "https://api.example.com/api/v1/check-prefix?phoneNumber=%2B66812345678&type=patient&language=en" \
  -H "Authorization: Bearer <token>"
```

Expected response for working config:
```json
{
  "phoneNumber": "+66812345678",
  "status": 3,
  "message": "Invite will be send by SMS."
}
```

Actual observed response:
```json
{
  "phoneNumber": "+66812345678",
  "status": 0,
  "message": "This phone number is not permitted to be used on this platform."
}
```

### Test Case 4: Call Path Tracing
Add debug logging to `determineStatus()`:
```javascript
for (const provider of smsProviders) {
  sails.config.customLogger.log('debug', `Provider: ${provider.provider}, prefix: ${provider.prefix}, disabled: ${provider.isDisabled}`);
  // ... rest of logic
}
```

## Recommendations

### Immediate Actions
1. **Query production database** for SmsProvider configuration
2. **Check production environment variables** for prefix settings
3. **Reproduce the exact error** with the exact phone number
4. **Enable debug logging** for determineStatus function
5. **Verify ALL providers aren't disabled** due to missing credentials

### Configuration Fix (If Needed)
If the issue is prefix configuration, update environment variables:
```bash
# For Thailand - match all Thai numbers
SMS_TWILLO_WL_PREFIX=+66
# OR use wildcard
SMS_TWILLO_WL_PREFIX=*
```

### Code Fix (If Needed)
If TWILIO_WHATSAPP needs a default:
```javascript
// In bootstrap.js line 103
prefix: process.env[provider.prefix] || '*',  // Add default for TWILIO_WHATSAPP too
```

## Status: UNRESOLVED

**Conclusion:** The observed BUG016 case where UI shows `+66812345678` and backend rejects it is **NOT EXPLAINED** by my normalization fix. The actual cause requires:
1. Production database inspection
2. Production environment variable inspection  
3. Reproduction with exact observed inputs
4. Debug logging of provider matching

**My Fix Status:**
- ✅ Improves normalization for local Thai numbers (`0812345678` → `+66812345678`)
- ❌ Does NOT prove it fixes the observed rejection case
- ⚠️ May be orthogonal to the actual issue

**Next Steps:**
- Deploy to test environment with controlled SmsProvider configuration
- Test with various provider prefix combinations
- Reproduce exact error before claiming fix
