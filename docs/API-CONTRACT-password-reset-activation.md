# API Contract: Password Reset and Account Activation

This document specifies the API contract for password reset, account activation, and related authentication flows.

## Password Reset Flow (Self-Service)

### 1. Request Password Reset

**Endpoint:** `POST /api/v1/forgot-password`

**Authentication:** None (public endpoint)

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:** Always returns success to prevent user enumeration
```json
{
  "success": true
}
```

**Status Codes:**
- `200 OK` - Always, regardless of whether email exists
- `401 Unauthorized` - Invalid email format

**Behavior:**
- Validates email format
- If user exists with role `admin`, `doctor`, or `nurse`:
  - Generates secure random token (32 bytes hex)
  - Hashes token with bcrypt (10 rounds) and stores in `User.resetPasswordToken`
  - Creates JWT with embedded plain token, expires in 5 minutes (configurable)
  - Sends email to user with reset link: `/reset-password?token=<JWT>`
- If user doesn't exist: No action (prevents enumeration)
- Always returns success response

**Security:**
- Token hashed at rest (bcrypt)
- JWT expiry enforces time limit (5 minutes default)
- No indication whether email exists
- Previous reset tokens invalidated when new one issued

### 2. Reset Password

**Endpoint:** `POST /api/v1/reset-password`

**Authentication:** None (uses token)

**Request:**
```json
{
  "token": "<JWT token from email>",
  "password": "NewSecurePassword123"
}
```

**Response:**
```json
{
  "success": true
}
```

**Status Codes:**
- `200 OK` - Password reset successful
- `400 Bad Request` - Token invalid, expired, or password too weak
  - `{ "message": "token-missing" }`
  - `{ "message": "token-expired" }`
  - `{ "message": "invalid-token" }`
  - `{ "message": "password-too-weak" }`
- `500 Internal Server Error` - Server error

**Password Requirements:**
- Minimum 6 characters
- Must contain at least 2 of: lowercase, uppercase, digit
- Regex: `^(((?=.*[a-z])(?=.*[A-Z]))|((?=.*[a-z])(?=.*[0-9]))|((?=.*[A-Z])(?=.*[0-9])))(?=.{6,})`

**Behavior:**
- Verifies JWT signature and expiry
- Checks token type is `password-reset`
- Finds user by email from JWT
- Verifies plain token against hashed token in database using bcrypt
- Updates password (hashed with bcrypt)
- Clears `resetPasswordToken` (single-use)
- Token becomes invalid after successful use

**Security:**
- Single-use tokens (cleared after redemption)
- JWT expiry enforced (5 minutes)
- Token compared with bcrypt (hashed at rest)
- Password validated before acceptance

---

## Account Activation Flow

### 1. User Creation (Admin)

**Endpoint:** `POST /api/v1/user` (or blueprint route)

**Authentication:** Admin only

**Request:**
```json
{
  "email": "newuser@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "doctor"
  // Note: password omitted triggers activation flow
}
```

**Response:**
```json
{
  // User object
  "id": "507f1f77bcf86cd799439011",
  "email": "newuser@example.com",
  "isActivated": false,
  ...
}
```

**Behavior:**
- Admin creates user without password
- System automatically:
  - Generates activation token (secure random 32 bytes)
  - Hashes and stores in `User.activationToken`
  - Sets `User.isActivated = false`
  - Sends activation email with JWT link
- Email contains link: `/reset-password?token=<JWT>` (same UI, different backend)

**Note:** The activation link uses the same frontend reset-password page. The backend differentiates by JWT token type.

### 2. Activate Account

**Endpoint:** `POST /api/v1/activate-account`

**Authentication:** None (uses token)

**Request:**
```json
{
  "token": "<JWT token from email>",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "success": true
}
```

**Status Codes:**
- `200 OK` - Account activated successfully
- `400 Bad Request` - Token invalid, expired, or password too weak
  - `{ "message": "token-missing" }`
  - `{ "message": "token-expired" }`
  - `{ "message": "invalid-token" }`
  - `{ "message": "password-too-weak" }`
- `500 Internal Server Error` - Server error

**Behavior:**
- Verifies JWT signature and expiry (24 hours default)
- Checks token type is `account-activation`
- Finds user by email from JWT
- Verifies plain token against hashed token using bcrypt
- Sets user password (hashed)
- Sets `isActivated = true`
- Clears `activationToken` (single-use)

**Token Expiry:**
- Default: 24 hours (configurable via `ACTIVATION_TOKEN_EXPIRY`)
- Can be set to longer period for account activation vs password reset

---

## Admin Password Reset

### Send Password Reset to User

**Endpoint:** `POST /api/v1/admin/send-password-reset/:userId`

**Authentication:** Admin only (requires `isLoggedIn` + `isAdmin` policies)

**Request:**
- No body
- URL parameter: `userId` (user's MongoDB ObjectId or Sails ID)

**Response:**
```json
{
  "success": true
}
```

**Status Codes:**
- `200 OK` - Reset email sent
- `400 Bad Request` - Invalid userId or user role
  - `{ "message": "userId-required" }`
  - `{ "message": "invalid-role" }` (user is not staff)
- `403 Forbidden` - Not admin
  - `{ "message": "forbidden" }`
- `404 Not Found` - User not found
  - `{ "message": "user-not-found" }`
- `500 Internal Server Error` - Server error

**Behavior:**
- Validates requesting user is admin
- Finds target user by ID
- Validates target user has staff role (`admin`, `doctor`, `nurse`, `scheduler`)
- Generates new reset token (invalidates any previous)
- Sends password reset email to user
- Admin NEVER sees the password or token

**Security:**
- Admin cannot see or set user passwords
- Admin only triggers email to user
- User must complete reset themselves
- Audit logged: admin ID + target user ID

---

## Token Security Summary

### Token Types

1. **Password Reset Token**
   - Expiry: 5 minutes (configurable via `PASSWORD_RESET_TOKEN_EXPIRY`)
   - Format: Secure random 32 bytes → hashed with bcrypt
   - Embedded in JWT with type `password-reset`

2. **Activation Token**
   - Expiry: 24 hours (configurable via `ACTIVATION_TOKEN_EXPIRY`)
   - Format: Secure random 32 bytes → hashed with bcrypt
   - Embedded in JWT with type `account-activation`

### JWT Structure

```json
{
  "email": "user@example.com",
  "token": "<plain-token>",
  "type": "password-reset|account-activation",
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Signed with:** `APP_SECRET` environment variable

### Security Properties

- ✅ Tokens hashed at rest (bcrypt, 10 rounds)
- ✅ Single-use (cleared after redemption)
- ✅ Time-limited (JWT expiry enforced)
- ✅ Type-checked (prevents token type confusion)
- ✅ Superseding (new token invalidates old)
- ✅ No enumeration (consistent responses)
- ✅ Audit logged (all operations)

---

## Frontend Integration

### Reset Password Page

**Route:** `/reset-password`

**Query Parameter:** `token` (JWT)

**UI Flow:**
1. Extract token from URL query parameter
2. Present password form (password + confirm password)
3. Validate password meets requirements
4. POST to appropriate endpoint based on token type (backend handles this)
5. Show success/error message

**Error Messages to Handle:**
- `token-missing` - "Reset link is invalid"
- `token-expired` - "Reset link has expired. Please request a new one."
- `invalid-token` - "Reset link is invalid or has already been used"
- `password-too-weak` - "Password does not meet requirements"
- `server-error` - "An error occurred. Please try again."

### Admin User Management

**Create User Form:**
- Email (required)
- First Name, Last Name (required)
- Role (required)
- Password (optional)
  - If provided: user can log in immediately
  - If omitted: user receives activation email

**Admin Actions:**
- "Send Password Reset" button on user detail page
- Calls: `POST /api/v1/admin/send-password-reset/:userId`
- Shows confirmation: "Password reset email sent to user@example.com"

---

## Environment Configuration

```bash
# Required
APP_SECRET=<secret-key-for-jwt>
DOCTOR_URL=https://doctor.example.com

# Optional - Token Expiry
PASSWORD_RESET_TOKEN_EXPIRY=5m        # Default: 5 minutes
ACTIVATION_TOKEN_EXPIRY=24h           # Default: 24 hours

# Optional - Email Configuration
DEFAULT_DOCTOR_LOCALE=en

# For phone normalization (BUG016 fix)
DEFAULT_PHONE_COUNTRY_CODE=66         # Thailand
```

---

## Rate Limiting Recommendations

To prevent abuse, implement rate limiting:

- **forgot-password:** 3 requests per email per hour
- **reset-password:** 5 attempts per token (before expiry)
- **activate-account:** 5 attempts per token (before expiry)

*Note: Rate limiting not implemented in this version but strongly recommended for production.*

---

## Localization Keys

Add these keys to locale files (`config/locales/*.json`):

```json
{
  "forgot password email subject": "Reset your password",
  "forgot password email": "Click this link to reset your password: {{url}}",
  "account activation email subject": "Activate your account",
  "account activation email": "Click this link to activate your account and set your password: {{url}}"
}
```

---

## Testing

### Manual Testing (Development)

1. Set `NODE_ENV=development` to use mock email helper (logs instead of sending)
2. Check logs for email content and tokens
3. Extract JWT token from logs
4. Test password reset/activation flows

### Automated Testing

See `test/` directory for unit tests covering:
- Token generation and hashing
- JWT creation and verification
- Password validation
- Single-use enforcement
- Expiry enforcement

---

## Migration Notes

### Existing Users

- Existing users: `isActivated` defaults to `true` (compatible)
- No migration needed for password reset (replaces existing logic)

### Existing Tokens

- Old unhashed `resetPasswordToken` values will not validate
- Users with pending reset must request new token after deployment
- This is acceptable as tokens expire quickly (5 minutes)

---

## Security Audit Checklist

- ✅ Tokens hashed at rest
- ✅ Single-use enforcement
- ✅ Time-limited expiry
- ✅ No user enumeration
- ✅ No secrets in logs
- ✅ Admin authorization checked
- ✅ Password strength validated
- ✅ Token type validation
- ✅ JWT signature verification
- ⚠️ Rate limiting (recommended, not implemented)
- ⚠️ CAPTCHA (recommended for production)

---

## Related Documentation

- [BUG016: Phone Normalization](./BUG016-phone-normalization.md)
- [User Model Schema](../api/models/User.js)
- [Auth Controller](../api/controllers/AuthController.js)
