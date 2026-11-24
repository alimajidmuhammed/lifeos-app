# LifeOS Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every document lives under `/users/{userId}/...`. A user may only access paths where `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Server-Only Entitlements**: `/users/{userId}/entitlements/{entitlementId}` is strictly read-only for the authenticated owner (`allow create, update, delete: if false;`).
3. **Immutable Identity & Audit Fields**: `uid` must equal `request.auth.uid` on create and remain immutable on update. `createdAt` must equal `request.time` on create and remain immutable on update. `updatedAt` must equal `request.time` on every write.
4. **Monotonic Daily AI Quota**: `/users/{userId}/aiUsage/{dayKey}` forbids deletes, requires `dayKey` matching `^\d{4}-\d{2}-\d{2}$`, initializes `requestCount == 1` on create, and only permits `requestCount == existing().requestCount + 1` on update.
5. **No Shadow Fields or Oversized Strings**: Every `create` checks `keys().hasAll(...) && keys().hasOnly(...)`. Every `update` validates `isValid[Entity](incoming())` AND `incoming().diff(existing()).affectedKeys().hasOnly([...])`. Every string has an explicit `.size()` upper bound.
6. **Path Variable Hardening**: Single-document operations validate `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars).

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Cross-Tenant Read**: User B attempts `get(/users/userA)` -> DENIED.
2. **Cross-Tenant List**: User B attempts `list(/users/userA/debts)` -> DENIED.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` writes `/users/{uid}` -> DENIED.
4. **Entitlement Escalation**: User A writes `{ plan: "pro", aiDailyQuota: 9999 }` to `/users/userA/entitlements/current` -> DENIED.
5. **Quota Reset / Delete**: User A deletes `/users/userA/aiUsage/2026-11-23` or updates `requestCount` from `10` to `0` -> DENIED.
6. **Shadow Field Injection**: User A updates `/users/userA` with extra field `isAdmin: true` -> DENIED.
7. **UID Spoofing**: User A creates `/users/userA/debts/d1` with `uid: "userB"` -> DENIED.
8. **Timestamp Forgery**: User A creates `/users/userA` with client-backdated `createdAt` instead of `request.time` -> DENIED.
9. **Immutable Field Tampering**: User A updates `/users/userA` modifying `createdAt` -> DENIED.
10. **ID Poisoning**: User A writes `/users/userA/notes/../../evil` or 300-character ID -> DENIED.
11. **Value Poisoning (Oversized String)**: User A writes a 500-character `displayName` (`maxLength: 100`) -> DENIED.
12. **Negative Financial Minor Unit**: User A creates `/users/userA/debts/d2` with `principalMinor: -500` -> DENIED.
