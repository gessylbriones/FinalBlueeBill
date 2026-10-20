# BlueBill App

A React Native app that runs on web with Expo. Firebase Authentication handles
sign-in and password resets; Firestore stores account profiles and bills.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. In Firebase Console, enable **Authentication → Sign-in method →
   Email/Password**, create a Firestore database, and publish the rules from
   `firestore.rules` in the Firestore **Rules** tab.
3. Start the app:
   ```bash
   npm run web
   ```
4. Open the Expo web URL shown in the terminal (usually
   `http://localhost:8081`).

No separate API server or `.env` file is required.

## Deploy to Vercel

Import the GitHub repository into Vercel with the project root as the Root
Directory. Use the **Other** framework preset so Vercel serves the static Expo
web export rather than treating the source as a Node.js application. The
project is configured to build with `npm run build` and publish from `dist`.
If overriding these settings in Vercel, use `npm run build` for the Build
Command and `dist` for the Output Directory.

## Customer accounts and bills

Admins handle customer authorization and consumption billing as separate
actions:

1. Use **Add user** to confirm the customer's name and email. BlueBill creates
   a customer number (for example, `TCWD-CU-1001`) and stores the authorized
   customer record. Share that number with the customer. No consumption bill is
   created by this action.
2. Customers register with their name, email, and password only. After
   email/password sign-in, BlueBill automatically matches the email to the
   admin-authorized customer record. The customer number appears on their
   dashboard; they do not enter it during registration or sign-in.
3. Use **Log bill** to select an authorized customer. Set an initial meter
   reading, then record later readings as they are received. BlueBill shows
   live usage as the current reading minus the last billed reading and
   calculates the pending amount at the configured per-m³ rate. Press **Log
   bill** to finalize the usage in a bill receipt. The customer's next usage
   cycle starts from that meter reading.

Customers can read only bills linked to their signed-in email. They can access
their customer dashboard after an admin has authorized their email, even if no
consumption bills have been issued yet.

Customers can review pending bills and their paid/overdue bill history. BlueBill
does not process online payments. An administrator can record an offline
payment in the admin **History** screen to move a bill to **Paid**; an unpaid
bill past its due date is shown as **Overdue**. Customers cannot delete bills
from their history. They can download a PDF receipt for each pending, overdue,
or paid bill. Each receipt includes a QR code with the bill number, status,
amount, usage, and customer number.

The **Monthly usage** navigation page shows live usage for the customer's
current billing cycle. It updates from Firestore as admins record meter
readings and resets to zero when a bill is logged. Customers see their own
usage and estimated amount; administrators see all authorized customers'
current usage. Existing bills and customer records without meter readings do
not provide a starting baseline; the admin must set a starting reading before
usage can accrue.
On the **Log bill** screen, admins can edit the last billed reading and current
reading independently; readings are not restricted to increase from their
previously saved values.

Admins and customers can update their own name and city/district from the
Profile page. Customer location changes are saved to both the account profile
and its authorized customer record, so admins see the latest location in the
dashboard and **Log bill** customer list. Users cannot change their own role.

The customer Home page displays the customer-service contact number
09655375630 and directs customers to visit the office for further bill concerns.

## Admin access

For the first administrator, create an Email/Password account in Firebase
Authentication, create its matching `users/{uid}` document in Firestore with
`role: "admin"`, and use the same credentials on the Admin sign-in screen. Only
a trusted project administrator should bootstrap this first role.

After an administrator is active, they can open **Add New Admin** from the
admin dashboard to manage administrator access for all registered accounts.
They can promote a customer to `admin` or remove administrator access to return
that account to the `user` role. The `bluebillproject@gmail.com` Blue Bill Admin
account is protected and cannot be demoted by another administrator. Admins
cannot remove their own access from this screen; a different administrator can
demote them. Role changes are enforced by Firestore rules, and account owners
must sign in again to use their new role. Customers cannot assign themselves
administrator access.

## Firestore data

- `users/{uid}` — account profile and role.
- `customers/{customerNumber}` — admin-confirmed customer email, name, and
  customer number, plus admin-maintained meter readings and current billing
  cycle baseline.
- `bills/{billId}` — consumption bill. Admins can
  read and write bills; customers can read only bills matching their email.

Publish `firestore.rules` in the Firebase Console after deploying the app.
Those rules allow admins to promote registered users or return other admins
to the customer role, protect the `bluebillproject@gmail.com` admin from
demotion, prevent customers from granting themselves the admin role, and
prevent customers from reading another customer's bills.
Existing Supabase bills are not migrated automatically; import them into the
Firestore `bills` collection if needed.
