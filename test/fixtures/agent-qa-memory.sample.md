## Login page
<!-- type: route | id: ROUTE-TEST-LOGIN-001 -->

- **URL**: `/login`
- **Purpose**: authenticate users before accessing dashboard

---

## Dashboard page
<!-- type: route | id: ROUTE-TEST-DASHBOARD-001 -->

- **URL**: `/dashboard`
- **Purpose**: landing page after successful login

---

## Login form locators
<!-- type: semantic_locator | id: LOC-TEST-LOGIN-001 -->

- Email field: `#email`
- Password field: `#password`
- Submit button: text "Entrar"

---

## Login happy path
<!-- type: flow | id: FLOW-TEST-LOGIN-001 -->

1. Open `/login`
2. Fill email and password
3. Submit form
4. Expect dashboard route

---

## Invalid section without metadata

This section should be skipped by the chunker.
