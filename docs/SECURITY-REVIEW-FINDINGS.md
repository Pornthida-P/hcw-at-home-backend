# Security & Completeness Review - Findings and Fixes

## Review Date
November 6, 2026

## Issues Found and Fixed

### 1. BUG016: Investigation Incomplete ❌ → ⚠️ UNRESOLVED
**Finding:** Original claim that phone normalization fix solved BUG016 was INCORRECT.

**User Report:** UI already displayed `+66812345678`, then backend rejected with "phone not authorized platform".

**Analysis:**
- If UI showed correct format, the issue is NOT in `cleanPhoneNumberForTwilio`
- Actual cause likely: SMS provider prefix configuration in database
- Possible causes:
  - All providers disabled (missing credentials)
  - Provider prefix doesn't match `+66` (e.g., set to `+1` for US only)
  - Exclusion prefix `!+66`
  - Empty prefix with no wildcard default

**Status:** `cleanPhoneNumberForTwilio` improvement may help OTHER cases, but doesn't prove it fixes observed BUG016.

**Action Required:**
1. Query production `sms_providers` table
2. Check production environment variables (`SMS_*_WL_PREFIX`)
3. Reproduce exact error with exact phone number
4. Add debug logging to `determineStatus()`

**Documentation:** See `docs/BUG016-investigation-incomplete.md`

### 2. Activation Email Not Auto-Sent ❌ → ✅ FIXED
**Finding:** Created `send-activation-email.js` helper but never wired it to user creation.

**Fix:** Added `afterCreate` hook in `User.js` model:
```javascript
async afterCreate(user, proceed) {
  if (!user.password && user.email && ['admin', 'doctor', 'nurse', 'scheduler'].includes(user.role)) {
    await sails.helpers.sendActivationEmail.with({ user });
  }
}
```

**When Triggered:**
- User created via blueprint `POST /api/v1/user` without password
- User has email
- User role is staff (admin, doctor, nurse, scheduler)

**Status:** ✅ Fixed

### 3. No Authentication Block for Unactivated Accounts ❌ → ✅ FIXED
**Finding:** `isActivated: false` users could still authenticate.

**Fix:** Added check in LocalStrategy (`config/passport.js` line 326):
```javascript
if (user && user.hasOwnProperty('isActivated') && user.isActivated === false) {
  return cb(null, false, {
    message: sails._t(locale, 'account not activated'),
  });
}
```

**Status:** ✅ Fixed

### 4. Non-Atomic Single-Use Tokens ❌ → ✅ FIXED
**Finding:** Original implementation:
1. Read user from DB
2. Check if token matches
3. Update user to clear token

**Race Condition:** Two parallel requests could both pass step 2 before either reaches step 3.

**Fix:** Atomic compare-and-update with MongoDB:
```javascript
const updateResult = await userCollection.updateOne(
  { 
    _id: user._id,
    resetPasswordToken: user.resetPasswordToken  // ← Atomic guard
  },
  { $set: { password: hashedPassword, resetPasswordToken: '' } }
);

if (updateResult.matchedCount === 0) {
  return res.status(400).json({ message: 'token-expired' });
}
```

**Applied To:**
- `resetPassword()` - line 308-319
- `activateAccount()` - line 1046-1057

**Status:** ✅ Fixed with DB-level atomic updates

### 5. Rate Limits Not Implemented ❌ → ✅ FIXED
**Finding:** Documentation only, no actual rate limiting.

**Fix:** Created `api/utils/rate-limiter.js` with in-memory sliding window rate limiter.

**Configuration:**
```bash
FORGOT_PASSWORD_RATE_LIMIT=3         # per hour
RESET_PASSWORD_RATE_LIMIT=5          # per hour
ACTIVATE_ACCOUNT_RATE_LIMIT=5        # per hour
ADMIN_SEND_RESET_RATE_LIMIT=10       # per hour
```

**Applied To:**
- `forgotPassword` - 3 requests per email per hour
- `resetPassword` - 5 attempts per token per hour
- `activateAccount` - 5 attempts per token per hour  
- `sendPasswordReset` - 10 per admin per target user per hour

**Response Headers:**
- `X-RateLimit-Limit` - Max requests allowed
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Unix timestamp when limit resets
- `Retry-After` - Seconds until retry allowed

**Status Code:** `429 Too Many Requests`

**Status:** ✅ Fixed

**Note:** For production with multiple servers, replace with Redis-backed rate limiting.

### 6. Password Validation Not Verified ❌ → ✅ VERIFIED
**Checked:** Both `resetPassword` and `activateAccount` validate password:
```javascript
const passwordFormat = new RegExp('^(((?=.*[a-z])(?=.*[A-Z]))|((?=.*[a-z])(?=.*[0-9]))|((?=.*[A-Z])(?=.*[0-9])))(?=.{6,})');
if (!passwordFormat.test(req.body.password)) {
  return res.status(400).json({ message: 'password-too-weak' });
}
```

**Requirements:**
- Minimum 6 characters
- At least 2 of: lowercase, uppercase, digit

**Status:** ✅ Verified in both endpoints

### 7. Token Type Isolation ✅ VERIFIED
**Checked:** Both endpoints validate token type:
```javascript
if (decoded.type !== 'password-reset') { // or 'account-activation'
  return res.status(400).json({ message: 'invalid-token' });
}
```

**Prevents:** Using activation token for password reset or vice versa.

**Status:** ✅ Verified

### 8. Token Expiry ✅ VERIFIED
**Checked:** JWT expiry enforced via `jwt.verify()`:
```javascript
decoded = jwt.verify(jwtToken, appSecret); // throws TokenExpiredError if expired
```

**Expiry Times:**
- Password reset: 5 minutes (configurable)
- Account activation: 24 hours (configurable)

**Status:** ✅ Verified

### 9. Superseded Token Handling ✅ VERIFIED
**Mechanism:** New token overwrites old token in database:
```javascript
await db.collection("user").updateOne(
  { _id: user._id },
  { $set: { resetPasswordToken: hashedToken } } // ← Overwrites old token
);
```

**Effect:** Old token becomes invalid because hash won't match.

**Status:** ✅ Verified - new tokens automatically supersede old ones

### 10. Admin Authorization ✅ VERIFIED
**Endpoint:** `sendPasswordReset`

**Policy:** `["isLoggedIn", "isAdmin"]` in `config/policies.js`

**Code Check:**
```javascript
if (!req.user || req.user.role !== 'admin') {
  return res.status(403).json({ message: 'forbidden' });
}
```

**Status:** ✅ Double-checked (policy + inline)

### 11. Missing Translations ❌ → ✅ FIXED
**Added to `en.json` and `th.json`:**
- `account not activated` - User cannot log in before activation
- `account activation email subject` - Email subject line
- `account activation email` - Email body with activation link

**Also Updated:**
- `forgot password email subject` - Improved clarity
- `forgot password email` - Better formatting

**Status:** ✅ Fixed with Thai and English translations

## Frontend API Contract

### Activation URL Route
**Required Frontend Route:** `/reset-password`

**Query Parameter:** `token` (JWT)

**Usage:**
- SAME page for both password reset AND account activation
- Backend differentiates by JWT token type (`password-reset` vs `account-activation`)
- Frontend doesn't need to distinguish

**URL Format:**
```
https://doctor.example.com/reset-password?token=<JWT>
```

**Doctor App Status:**
- ✅ Route `/reset-password` exists
- ✅ Accepts `?token=<JWT>` query parameter
- ✅ Calls `POST /api/v1/reset-password` with token
- ⚠️ May need to also call `POST /api/v1/activate-account` based on error response
  - OR backend could handle both via same endpoint (not currently implemented)

**Recommendation:** Frontend should:
1. Try `POST /api/v1/reset-password` with token
2. If error `invalid-token` and haven't tried activation, try `POST /api/v1/activate-account`
3. OR backend adds unified endpoint `/api/v1/validate-token` that auto-detects type

**Current Status:** Backend provides TWO endpoints, frontend must call correct one.

## Untested Areas

### Not Tested (Require Full Environment)
1. ❌ **Email Sending** - Mock helper not exercised
2. ❌ **Activation Email Trigger** - afterCreate hook not executed  
3. ❌ **Rate Limiter Cleanup** - Background cleanup interval not run
4. ❌ **Parallel Token Redemption** - Atomic guard not stress-tested
5. ❌ **LocalStrategy Block** - isActivated check not integration-tested
6. ❌ **Provider Prefix Matching** - BUG016 root cause not reproduced
7. ❌ **Phone Normalization** - cleanPhoneNumberForTwilio integration not tested
8. ❌ **Password Strength Validation** - Edge cases not tested
9. ❌ **JWT Expiry** - Time-based expiry not integration-tested
10. ❌ **Admin Policy Enforcement** - isAdmin policy not exercised

### Test Commands Needed

**Email Mock Test:**
```bash
# Set NODE_ENV=development
# Create user without password
# Check logs for activation email content
curl -X POST http://localhost:1337/api/v1/user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"email":"test@example.com","firstName":"Test","lastName":"User","role":"doctor"}'
```

**Rate Limit Test:**
```bash
# Hit endpoint 4 times rapidly
for i in {1..4}; do
  curl -X POST http://localhost:1337/api/v1/forgot-password \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com"}'
done
# 4th request should return 429
```

**Atomic Token Test:**
```bash
# Requires parallel execution
# Use `parallel` or `xargs` to send 5 simultaneous requests with same token
# Only ONE should succeed, others should get token-expired
```

**Activation Block Test:**
```bash
# Create unactivated user (isActivated: false)
# Attempt login
# Should receive "account not activated" error
```

## Environment Variable Requirements

### New Required
```bash
# Rate Limiting (optional, has defaults)
FORGOT_PASSWORD_RATE_LIMIT=3
RESET_PASSWORD_RATE_LIMIT=5
ACTIVATE_ACCOUNT_RATE_LIMIT=5
ADMIN_SEND_RESET_RATE_LIMIT=10

# Token Expiry (optional, has defaults)
PASSWORD_RESET_TOKEN_EXPIRY=5m
ACTIVATION_TOKEN_EXPIRY=24h

# Phone Normalization (optional, defaults to Thailand)
DEFAULT_PHONE_COUNTRY_CODE=66
```

### Existing Required
```bash
APP_SECRET=<secret-key-for-jwt>
DOCTOR_URL=https://doctor.example.com
DEFAULT_DOCTOR_LOCALE=en
```

## Files Modified

### Core Security Files
- `api/controllers/AuthController.js` - Rate limiting, atomic updates
- `config/passport.js` - isActivated check
- `api/models/User.js` - afterCreate hook
- `api/utils/rate-limiter.js` - NEW rate limiting utility

### Translations
- `config/locales/en.json` - Added 3 keys
- `config/locales/th.json` - Added 3 keys

### Documentation
- `docs/BUG016-investigation-incomplete.md` - NEW analysis
- `docs/SECURITY-REVIEW-FINDINGS.md` - THIS FILE

## Summary

### Fixed Issues: 9/11
✅ Activation email auto-send
✅ Authentication block for unactivated accounts
✅ Atomic single-use tokens  
✅ Rate limiting implemented
✅ Password validation verified
✅ Token type isolation verified
✅ Token expiry verified
✅ Superseded token handling verified
✅ Admin authorization verified
✅ Translations added

### Unresolved: 2/11
⚠️ BUG016 root cause NOT confirmed (requires production investigation)
⚠️ Frontend activation flow needs clarification (same endpoint or separate?)

### Testing Status
❌ No integration tests run (requires full environment)
❌ Security properties not stress-tested
❌ Email sending not exercised
❌ Parallel redemption not tested

## Recommendations

### Immediate
1. Deploy to test environment with controlled SMS provider config
2. Reproduce BUG016 with actual production phone number
3. Run integration tests with mock email/SMS
4. Stress-test atomic token redemption

### Production
1. Replace in-memory rate limiter with Redis
2. Add CAPTCHA to public endpoints
3. Monitor rate limit violations
4. Set up alerting for failed auth attempts
5. Regular security audits of token patterns

### Frontend
1. Clarify activation flow (unified or separate endpoints)
2. Add better error handling for activation vs reset
3. Display appropriate messages for unactivated accounts
4. Test complete activation flow end-to-end
