# Test Suite

This directory contains regression tests for the HCW@Home backend.

## Structure

- `integration/` - Integration tests for API endpoints and business logic
  - `consultation-close.test.js` - Tests for consultation close consistency (R-01)

## Running Tests

The test suite uses Mocha, Chai, and Sinon. Dependencies are already installed.

### Run all tests:
```bash
npx mocha test/**/*.test.js
```

### Run only consultation close tests:
```bash
npx mocha test/integration/consultation-close.test.js
```

### Run with npm script:
```bash
npm run test:integration
```

To add this to package.json scripts:
```json
"scripts": {
  "test:integration": "mocha test/integration/*.test.js"
}
```

## Manual Testing

For immediate verification without a test framework:

### R-01: Consultation Close Consistency

1. Start the application with a test database
2. Create and accept a test consultation via the UI or API
3. Close the consultation: `POST /consultation/:id/close`
4. Immediately verify the response contains:
   - `closedBy`: should be the user ID who closed it
   - `closedAt`: should be a recent timestamp
   - `status`: should be `'closed'`
5. Immediately fetch the consultation: `GET /consultation/:id`
6. Verify all fields match the close response
7. Check the History view in the UI - should show:
   - Correct duration (closedAt - acceptedAt)
   - Correct "Closed by" with doctor's name
8. Generate PDF export - should show correct duration and closer
9. Reload the page and verify data hasn't changed

**Expected**: No discrepancy between immediate and settled states

**Before fix**: First History render showed wrong duration (e.g., 53s vs 7s) and missing/wrong closedBy field

## Test Coverage Goals

- [ ] Immediate consistency after close
- [ ] Settled behavior after reload
- [ ] Edge cases (null userId, already closed, etc.)
- [ ] Socket broadcast contains correct data
- [ ] API response contains all updated fields
- [ ] Duration calculation accuracy
- [ ] closedBy field population

## Related Issues

- [Issue #5](https://github.com/Pornthida-P/hcw-at-home-backend/issues/5) - R-01: Consultation close stale data
