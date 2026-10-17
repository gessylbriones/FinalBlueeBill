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
3. Use **Issue bill** to select an authorized customer and issue a separate
   consumption bill (for example, `TCWD-TN-1001`). This appears as a pending
   bill in that customer's account.

Customers can read only bills linked to their signed-in email. They can access
their customer dashboard after an admin has authorized their email, even if no
consumption bills have been issued yet.

Customers can review pending bills and their paid/overdue bill history. BlueBill
does not process online payments. An administrator can record an offline
payment in the admin **History** screen to move a bill to **Paid**; an unpaid
bill past its due date is shown as **Overdue**. Customers can delete a bill
from their history only after an administrator has recorded it as **Paid**.
Firestore rules enforce that only the signed-in customer who owns a paid bill
can delete it.

Admins and customers can update their own name and city/district from the
Profile page. These changes are saved to the account's `users/{uid}` profile;
users cannot change their own role.

## Admin access

For the first administrator, create an Email/Password account in Firebase
Authentication, create its matching `users/{uid}` document in Firestore with
`role: "admin"`, and use the same credentials on the Admin sign-in screen. Only
a trusted project administrator should bootstrap this first role.

After an administrator is active, they can open **Add New Admin** from the
admin dashboard, search registered customer accounts, and promote a selected
user. Promotion changes that account's Firestore role to `admin`; the account
must then use Admin sign-in and can no longer enter the customer side.
Customers cannot assign themselves this role.

## Firestore data

- `users/{uid}` — account profile and role.
- `customers/{customerNumber}` — admin-confirmed customer email, name, and
  customer number.
- `bills/{billId}` — consumption bill. Admins can
  read and write bills; customers can read only bills matching their email.

Publish `firestore.rules` in the Firebase Console after deploying the app.
Those rules allow admins to promote registered users, prevent customers from
granting themselves the admin role, and prevent customers from reading another
customer's bills.
Existing Supabase bills are not migrated automatically; import them into the
Firestore `bills` collection if needed.
