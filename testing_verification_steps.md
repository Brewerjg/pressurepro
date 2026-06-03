# Testing Steps for PressurePro Onboarding Bug Fix

## Pre-Fix Verification (Reproduce the Bug)

### Test Setup
1. Identify a PressurePro user account that exhibits the issue
2. Check their current profile status:
   ```sql
   SELECT id, user_id, onboarded_at, is_demo, email
   FROM profiles p
   LEFT JOIN auth.users u ON u.id = COALESCE(p.id, p.user_id)
   WHERE u.email = 'test@example.com';
   ```

### Bug Reproduction Steps
1. Sign in with PressurePro credentials
2. Observe that user is redirected to `/onboarding`
3. Go through onboarding wizard
4. Click "Skip" on the final step (Add Customer)
5. **BUG 1**: User should be redirected to home but is sent back to `/onboarding`
6. If they do reach home, **BUG 2**: Demo banner appears and shows hardcoded demo data

## Post-Fix Verification

### 1. Apply Code Fixes
- Deploy the updated `DemoBanner.tsx` with dual-column support
- Deploy the updated `Onboarding.tsx` with explicit `is_demo: false` setting

### 2. Apply Database Fix
```sql
-- Run the SQL script
\i /Users/jasongrammer/Desktop/turf/fix_pressurepro_users.sql
```

### 3. Verify Database Changes
```sql
-- Check that PressurePro users now have proper flags
SELECT
  p.id,
  p.user_id,
  u.email,
  p.onboarded_at IS NOT NULL as is_onboarded,
  p.is_demo,
  CASE
    WHEN p.id IS NOT NULL AND p.user_id IS NOT NULL THEN 'Dual Column'
    WHEN p.id IS NOT NULL THEN 'TurfPro Style'
    WHEN p.user_id IS NOT NULL THEN 'PressurePro Style'
    ELSE 'Invalid'
  END as profile_type
FROM profiles p
LEFT JOIN auth.users u ON u.id = COALESCE(p.id, p.user_id)
WHERE p.onboarded_at IS NOT NULL
ORDER BY p.created_at DESC;
```

### 4. Test Onboarding Completion
**Test Case 1: Skip Onboarding**
1. Create a fresh PressurePro-style user or reset an existing one:
   ```sql
   UPDATE profiles
   SET onboarded_at = NULL, is_demo = NULL
   WHERE user_id = 'test-user-id';
   ```
2. Sign in with that user
3. Go through onboarding wizard
4. Click "Skip" at any step
5. **Expected**: User is redirected to home dashboard
6. **Expected**: No demo banner appears
7. **Expected**: Dashboard shows real (empty) data, not hardcoded demo data

**Test Case 2: Complete Full Onboarding**
1. Reset another test user's onboarding status
2. Sign in and complete all onboarding steps
3. Add a customer in step 4
4. Click "Finish setup"
5. **Expected**: User is redirected to home dashboard
6. **Expected**: No demo banner appears
7. **Expected**: Customer appears in the system

### 5. Test Demo Banner Logic
**Test Case 3: Actual Demo User**
1. Create a user marked as demo:
   ```sql
   UPDATE profiles
   SET is_demo = true
   WHERE user_id = 'demo-user-id';
   ```
2. Sign in with that user
3. **Expected**: Demo banner appears on home page

**Test Case 4: PressurePro User**
1. Sign in with a PressurePro user (has `user_id` but not `id`)
2. **Expected**: No demo banner appears
3. **Expected**: Profile query finds the user via `user_id` column

**Test Case 5: TurfPro User**
1. Sign in with a TurfPro user (has `id` column)
2. **Expected**: No demo banner appears
3. **Expected**: Profile query finds the user via `id` column

### 6. Browser Console Verification
Monitor browser console logs while testing:
- Look for `Demo check for user: [email]` messages
- Verify the correct profile type is detected
- Ensure no errors in profile queries

### 7. Integration Test
**Full User Journey Test**
1. Use the specific grammer user mentioned in the problem
2. Sign in with their PressurePro credentials
3. Verify they land directly on home dashboard (no onboarding loop)
4. Verify no demo banner appears
5. Verify dashboard shows their real data, not demo data

## Expected Console Outputs

### Successful Fix
```
Demo check for user: test@example.com
Profile query result: { data: { is_demo: false }, error: null }
✅ User is NOT a demo user
```

### For Demo Users
```
Demo check for user: demo@example.com
Profile query result: { data: { is_demo: true }, error: null }
✅ User IS a demo user
```

## Rollback Plan (If Issues Found)

If any issues are discovered:

1. **Code Rollback**: Revert the changes to `DemoBanner.tsx` and `Onboarding.tsx`
2. **Database Rollback**:
   ```sql
   -- Only if needed - restore previous state
   UPDATE profiles
   SET onboarded_at = NULL
   WHERE user_id IS NOT NULL AND id IS NULL
   AND onboarded_at > '2026-06-02'; -- Today's date
   ```

## Success Criteria

✅ **Bug 1 Fixed**: PressurePro users complete onboarding successfully without loops
✅ **Bug 2 Fixed**: PressurePro users see their real dashboard, not demo content
✅ **No Regression**: TurfPro users continue to work normally
✅ **Demo Users**: Actual demo users still see demo banner correctly
✅ **Data Integrity**: All profile records have correct `onboarded_at` and `is_demo` values

## Monitoring

After deployment, monitor for:
- Decreased onboarding completion rates (indicating new issues)
- User complaints about demo banners appearing incorrectly
- Database query errors related to profile lookups
- Support tickets from PressurePro users about being stuck