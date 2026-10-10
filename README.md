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
Directory. The project is configured to build with `npm run build` and publish
the Expo web export from `dist`. If overriding these settings in Vercel, use
`npm run build` for the Build Command and `dist` for the Output Directory.

## Customer accounts

Use **Customer → Create customer account** to register. New accounts receive a
`users/{uid}` profile with the `user` role. A customer can read bills only when
the bill's `email` matches their signed-in Firebase email.

When logging a bill, enter the customer's account email so the bill is linked
to the right account.

## Admin account

Register the account through the app first. In Firebase Console, find its UID
under **Authentication → Users**, then edit the matching `users/{uid}` document
in Firestore. Set `role` to `admin`. The app uses the authenticated Firebase
UID to locate that profile, so no separate admin ID field is needed. Sign in
from the **Admin** tab using the same Firebase email and password. Only a
trusted project administrator should grant this role.

## Firestore data

- `users/{uid}` — account profile and role.
- `bills/{billId}` — bill record. Admins can read and write bills; customers
  can read only their own bills.

The Firestore rules prevent users from granting themselves the admin role.
Existing Supabase bills are not migrated automatically; import them into the
Firestore `bills` collection if you need to retain them.
