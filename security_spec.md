# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Strict Ownership**: Every document in `/users/{userId}`, `/users/{userId}/private/{docId}`, `/workflows/{workflowId}`, `/executions/{executionId}`, `/mediaQueue/{itemId}`, `/researchReports/{reportId}`, `/memories/{memoryId}`, and `/plugins/{pluginId}` belongs exclusively to a single authenticated, email-verified user (`request.auth.uid`). No cross-user reads or writes are permitted.
2. **PII & Biometric Isolation**: User email addresses (`/users/{userId}/private/info`) and compact normalized facial descriptor vectors (`/users/{userId}/private/faceAuth`) are isolated under `/users/{userId}/private/` and never stored on top-level `/users/{userId}` or shared collections. Raw camera frames/images are never stored in Firestore.
3. **Immutable Ownership & Timestamps**: `ownerId` / `uid` and `createdAt` are immutable once created (`plugins` also lock `slug`, `toolName`, and `kind` on update). `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. **Terminal State Locking**: Once an execution record in `/executions/{executionId}` reaches a terminal status (`completed` or `failed`), it cannot be mutated again.
5. **Bounded Arrays & Strings**: Every string field enforces strict `.size()` bounds and ID/videoId/slug/toolName fields match strict regex patterns. Workflow `steps` are bounded to `1..15` items; `researchReports` arrays are strictly bounded (`<= 12`); `faceAuth.descriptor` is strictly `16..128` numeric values; `memories.content` is bounded to `1..600` chars; `plugins.parameters` and `plugins.headers` are strictly bounded (`<= 8`) with map schema checks on the initial element.
6. **Master Gate on Subcollections**: `/users/{userId}/private/{docId}` (`info` and `faceAuth`) verifies parent `/users/{userId}` ownership and existence via `exists()` / `get()` on updates and reads.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Workflow Create**: Creating `/workflows/wf1` with `ownerId: "victim_uid"` while authenticated as `"attacker_uid"` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Creating `/users/attacker_uid` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on Create**: Creating `/workflows/wf1` with an extra `"isAdmin": true` ghost field -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
4. **Cross-User PII Read**: Reading `/users/victim_uid/private/info` as `"attacker_uid"` -> `PERMISSION_DENIED`.
5. **Client Timestamp Forgery**: Creating `/executions/ex1` with a client-supplied past timestamp instead of `serverTimestamp()` (`request.time`) -> `PERMISSION_DENIED`.
6. **ID Poisoning**: Creating `/workflows/<2000-char-invalid-id!@#>` -> `PERMISSION_DENIED` (blocked by `isValidId()`).
7. **Terminal Execution Tampering**: Updating `/executions/ex1` when `existing().status == "completed"` back to `"running"` -> `PERMISSION_DENIED`.
8. **Owner Reassignment Update**: Updating `/workflows/wf1` to change `ownerId` to `"other_uid"` -> `PERMISSION_DENIED`.
9. **Unbounded Array / Payload Exhaustion**: Creating `/workflows/wf1` with `steps` having 50 items or `name` > 120 chars -> `PERMISSION_DENIED`.
10. **YouTube Video ID Injection**: Creating `/mediaQueue/mq1` with `videoId: "../../evil?js"` -> `PERMISSION_DENIED` (blocked by regex `^[a-zA-Z0-9_\-]+$`).
11. **Unscoped List Query**: Calling `getDocs(collection(db, "executions"))` without `.where("ownerId", "==", uid)` -> `PERMISSION_DENIED` (enforced by `allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid`).
12. **Role/Shadow Update on User Profile**: Updating `/users/uid1` with an unauthorized key `role: "admin"` -> `PERMISSION_DENIED` (blocked by `affectedKeys().hasOnly(...)` and `isValidUserProfile()`).
