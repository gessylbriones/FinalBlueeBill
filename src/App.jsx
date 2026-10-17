import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text as NativeText,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import logo from './assets/bluebill-logo.png';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';



const roles = { ADMIN: 'admin', USER: 'user' };
const waterRatePerCubicMeter = 30;

async function loadBillsForUser(firebaseUser, isAdmin) {
  const billsCollection = collection(db, 'bills');
  const billsQuery = isAdmin
    ? billsCollection
    : query(billsCollection, where('email', '==', firebaseUser.email));
  const snapshot = await getAdminCollection('bills', billsQuery);
  return snapshot.docs.map((billDocument) => billDocument.data());
}

async function loadCustomerAuthorization(email) {
  const customerQuery = query(collection(db, 'customers'), where('email', '==', email.toLowerCase()));
  const snapshot = await getAdminCollection('customers', customerQuery);
  return snapshot.docs[0]?.data() || null;
}

function firestoreAccessError(resourceName, error) {
  if (error.code === 'permission-denied' || error.code === 'firestore/permission-denied') {
    return new Error(`Firestore denied access to ${resourceName}. Confirm the current firestore.rules are published to the Firebase project configured for this app.`);
  }
  return error;
}

async function getAdminCollection(collectionName, collectionQuery) {
  try {
    return await getDocs(collectionQuery);
  } catch (error) {
    const resourceName = `the "${collectionName}" collection query`;
    const accessError = firestoreAccessError(resourceName, error);
    if (accessError !== error && (collectionName === 'users' || collectionName === 'bills')) {
      throw new Error(`${accessError.message} For admin access, users/{auth-uid} must have the exact role value "admin".`);
    }
    throw accessError;
  }
}

async function loadAdminData() {
  const [customersSnapshot, usersSnapshot, billsSnapshot] = await Promise.all([
    getAdminCollection('customers', collection(db, 'customers')),
    getAdminCollection('users', collection(db, 'users')),
    getAdminCollection('bills', collection(db, 'bills'))
  ]);
  return {
    customerUsers: customersSnapshot.docs.map((customerDocument) => customerDocument.data()),
    registeredUsers: usersSnapshot.docs
      .map((userDocument) => userDocument.data())
      .filter((profile) => profile.role === roles.USER),
    bills: billsSnapshot.docs.map((billDocument) => billDocument.data())
  };
}

function mergeBillRecords(currentRecords, savedBills) {
  return savedBills.reduce((records, bill) => {
    const existingIndex = records.findIndex((item) => item.id === bill.id);
    return existingIndex >= 0
      ? records.map((item, index) => index === existingIndex ? bill : item)
      : [...records, bill];
  }, currentRecords);
}

function getCustomerAuthErrorMessage(error, action) {
  switch (error.code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a while and try again.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 8 characters.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled in Firebase Authentication.';
    case 'auth/network-request-failed':
      return 'Could not connect to Firebase. Check your internet connection and try again.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firebase denied access. Check that Firestore is enabled and the published security rules match firestore.rules.';
    default:
      return error.message || `Unable to ${action}.`;
  }
}


const toledoBarangays = [
  'Awihao', 'Bagakay', 'Bato', 'Biga', 'Bulongan', 'Bunga', 'Cabitoonan', 'Calongcalong', 'Cambang-ug',
  'Canlumampao', 'Cantabaco', 'Capitan Claudio', 'Carmen', 'Daanglungsod', 'Don Andres Soriano (Lutopan)',
  'Dumlog', 'Gen. Climaco', 'Ibo', 'Ilihan', 'Juan Climaco Sr.', 'Landahan', 'Loay', 'Luray II',
  'Matab-ang', 'Media Once', 'Pangamihan', 'Poblacion', 'Poog', 'Putingbato', 'Sagay', 'Sam-ang',
  'Sangi', 'Mainggit', 'Subayon', 'Talavera', 'Tubod', 'Tungkay'
];

function getNextTrackingNumber(records) {
  const highestNumber = records.reduce((highest, record) => {
    const match = /^TCWD-TN-(\d+)$/i.exec(record.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 1000);
  return `TCWD-TN-${highestNumber + 1}`;
}

function getNextCustomerNumber(records) {
  const highestNumber = records.reduce((highest, record) => {
    const match = /^TCWD-CU-(\d+)$/i.exec(record.id || '');
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 1000);
  return `TCWD-CU-${highestNumber + 1}`;
}

function calculateWaterBill(previousReading, currentReading) {
  const consumption = Math.max(0, Number(currentReading) - Number(previousReading));
  return { consumption, amount: consumption * waterRatePerCubicMeter };
}

function getAdminSummary(accountRecords) {
  const collected = accountRecords
    .filter((item) => item.status === 'Paid')
    .reduce((total, item) => total + Number(item.bill), 0);
  const openBills = accountRecords.filter((item) => item.status !== 'Paid').length;
  const recordedConsumption = accountRecords.reduce(
    (total, item) => total + calculateWaterBill(item.previousReading, item.currentReading).consumption,
    0
  );
  const barangayTotals = accountRecords.reduce((totals, item) => {
    if (item.status !== 'Paid') totals[item.barangay] = (totals[item.barangay] || 0) + Number(item.bill);
    return totals;
  }, {});

  return {
    collected,
    openBills,
    recordedConsumption,
    barangayBalances: Object.entries(barangayTotals).map(([name, amount]) => ({ name, amount }))
  };
}

const customerChartBars = [42, 58, 46, 72, 66, 51, 60];
const adminChartBars = [72, 80, 68, 88, 94, 76, 83];

function useTextScale() {
  const { fontScale } = useWindowDimensions();
  return fontScale;
}

function Text({ style, ...props }) {
  const textScale = useTextScale();
  const flattenedStyle = StyleSheet.flatten(style) || {};
  const scaledStyle = flattenedStyle.fontSize
    ? { ...flattenedStyle, fontSize: Math.round(flattenedStyle.fontSize * textScale) }
    : [{ fontSize: 16 }, style];

  return <NativeText {...props} style={scaledStyle} />;
}

function buildUsageSummary(bars, scale = 1) {
  const weeklyTotal = bars.reduce((sum, value) => sum + value, 0);
  const dailyAverage = Math.round((weeklyTotal / bars.length) * scale);
  const monthlyTotal = Math.round(dailyAverage * 30);

  return {
    daily: `${dailyAverage.toLocaleString()} gal/day`,
    monthly: `${monthlyTotal.toLocaleString()} gal`
  };
}

function formatDueCountdown(dueDate, now) {
  const dueAt = new Date(dueDate);
  dueAt.setHours(23, 59, 59, 999);
  const difference = dueAt.getTime() - now.getTime();
  const totalSeconds = Math.floor(Math.abs(difference) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const countdown = `${days}d ${hours}h ${minutes}m ${String(seconds).padStart(2, '0')}s`;

  return difference >= 0 ? `Due in ${countdown}` : `Overdue by ${countdown}`;
}

export default function App() {
  const [screen, setScreen] = useState('splash');
  const [role, setRole] = useState(roles.ADMIN);
  const [user, setUser] = useState(null);
  const [accountRecords, setAccountRecords] = useState([]);
  const [customerUsers, setCustomerUsers] = useState([]);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [customerAccount, setCustomerAccount] = useState(null);
  const [selectedBillingCustomer, setSelectedBillingCustomer] = useState(null);

  async function saveCustomerRecord(record) {
    const existingCustomer = customerUsers.find((customer) => customer.email.toLowerCase() === record.email.toLowerCase());
    if (existingCustomer) {
      throw new Error(`This email is already authorized under customer number ${existingCustomer.customerNumber}.`);
    }
    const firstNumber = Number(getNextCustomerNumber(customerUsers).replace('TCWD-CU-', ''));
    try {
      const customer = await runTransaction(db, async (transaction) => {
        let sequence = firstNumber;
        let customerReference;
        let customerNumber;
        while (true) {
          customerNumber = `TCWD-CU-${sequence}`;
          customerReference = doc(db, 'customers', customerNumber);
          const existingCustomer = await transaction.get(customerReference);
          if (!existingCustomer.exists()) break;
          sequence += 1;
        }
        const newCustomer = {
          id: customerNumber,
          customerNumber,
          name: record.name,
          email: record.email,
          createdAt: new Date().toISOString()
        };
        transaction.set(customerReference, newCustomer);
        return newCustomer;
      });
      setCustomerUsers((currentCustomers) => [...currentCustomers, customer]);
      return customer;
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'add customer'));
    }
  }

  async function refreshRegisteredUsers() {
    try {
      const usersSnapshot = await getAdminCollection('users', collection(db, 'users'));
      setRegisteredUsers(usersSnapshot.docs
        .map((userDocument) => userDocument.data())
        .filter((profile) => profile.role === roles.USER));
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'refresh registered users'));
    }
  }

  async function saveBillRecord(record) {
    const existingRecord = customerUsers.find((item) => item.email === record.email);
    const firstNumber = Number(getNextTrackingNumber(accountRecords).replace('TCWD-TN-', ''));
    const billFields = {
      name: record.customer,
      email: record.email,
      uid: existingRecord?.uid || null,
      city: record.location,
      bill: record.amount,
      status: 'Pending',
      meter: `M-${Date.now().toString().slice(-5)}`,
      issuedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      lastPayment: 'Not paid',
      address: record.location,
      barangay: record.location
    };
    try {
      const nextRecord = await runTransaction(db, async (transaction) => {
        let sequence = firstNumber;
        let billReference;
        let billNumber;
        while (true) {
          billNumber = `TCWD-TN-${sequence}`;
          billReference = doc(db, 'bills', billNumber);
          const existingBill = await transaction.get(billReference);
          if (!existingBill.exists()) break;
          sequence += 1;
        }
        const bill = { id: billNumber, ...billFields };
        transaction.set(billReference, bill);
        return bill;
      });
      setAccountRecords((currentRecords) => mergeBillRecords(currentRecords, [nextRecord]));
      return nextRecord.id;
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'save bill'));
    }
  }

  async function promoteUserToAdmin(profile) {
    if (role !== roles.ADMIN || !auth.currentUser) {
      throw new Error('Only a signed-in administrator can promote a user.');
    }
    try {
      await updateDoc(doc(db, 'users', profile.uid), { role: roles.ADMIN });
      setRegisteredUsers((currentUsers) => currentUsers.filter((candidate) => candidate.uid !== profile.uid));
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'promote user to administrator'));
    }
  }

  async function markBillPaid(bill) {
    const paidBill = {
      ...bill,
      status: 'Paid',
      lastPayment: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    };
    try {
      await updateDoc(doc(db, 'bills', bill.id), {
        status: paidBill.status,
        lastPayment: paidBill.lastPayment
      });
      setAccountRecords((currentRecords) => mergeBillRecords(currentRecords, [paidBill]));
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'record offline payment'));
    }
  }

  async function deletePaidBill(bill) {
    if (role !== roles.USER || bill.status !== 'Paid') {
      throw new Error('Only bills recorded as paid can be deleted from customer history.');
    }
    try {
      await deleteDoc(doc(db, 'bills', bill.id));
      setAccountRecords((currentRecords) => currentRecords.filter((record) => record.id !== bill.id));
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'delete paid bill'));
    }
  }

  const refreshBills = useCallback(async () => {
    try {
      if (!auth.currentUser) throw new Error('Sign in to refresh bills.');
      const bills = await loadBillsForUser(auth.currentUser, role === roles.ADMIN);
      setAccountRecords(bills);
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'refresh bills'));
    }
  }, [role]);

  async function saveProfile(profileChanges) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Sign in to update your profile.');
    const updatedProfile = {
      ...user,
      name: profileChanges.name.trim(),
      city: profileChanges.city.trim()
    };
    if (!updatedProfile.name) throw new Error('Enter your full name.');
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        name: updatedProfile.name,
        city: updatedProfile.city
      });
      setUser(updatedProfile);
      if (role === roles.ADMIN) {
        setRegisteredUsers((currentUsers) => currentUsers.map((profile) =>
          profile.uid === firebaseUser.uid ? { ...profile, name: updatedProfile.name, city: updatedProfile.city } : profile
        ));
      }
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'save profile'));
    }
  }

  function signIn(nextRole, name, email, customerRecord, savedBills = [], adminData = null, profileData = null) {
    setAccountRecords(nextRole === roles.ADMIN ? [] : savedBills);
    if (adminData) {
      setCustomerUsers(adminData.customerUsers);
      setRegisteredUsers(adminData.registeredUsers);
      setAccountRecords(adminData.bills);
    }
    const nextUser = nextRole === roles.ADMIN
      ? { uid: auth.currentUser?.uid, name: name || 'Admin User', email: email || 'admin@bluebill.com', city: profileData?.city || 'Toledo' }
      : { uid: auth.currentUser?.uid, name: name || customerRecord?.name || 'Customer', email: email || customerRecord?.email || '', city: profileData?.city || customerRecord?.city || '', customerNumber: customerRecord?.customerNumber };
    setRole(nextRole);
    setUser(nextUser);
    setCustomerAccount(customerRecord || null);
    setScreen('dashboard');
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setCustomerAccount(null);
    setCustomerUsers([]);
    setRegisteredUsers([]);
    setAccountRecords([]);
    setSelectedBillingCustomer(null);
    setScreen('splash');
  }

  if (screen === 'splash') return <Splash onStart={() => setScreen('login')} />;
  if (screen === 'login') return <Login role={role} onRoleChange={setRole} onLogin={signIn} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <View style={styles.app}>
        <Header user={user} onProfile={() => setScreen('profile')} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {screen === 'dashboard' && <Dashboard role={role} user={user} accountRecords={accountRecords} customerUsers={customerUsers} registeredUsers={registeredUsers} onRefreshRegisteredUsers={refreshRegisteredUsers} onPromoteUser={promoteUserToAdmin} />}
          {screen === 'history' && <History accountRecords={accountRecords} role={role} onMarkBillPaid={markBillPaid} onDeletePaidBill={deletePaidBill} onRefreshBills={refreshBills} />}
          {screen === 'add-user' && <AddCustomer onSaveCustomer={saveCustomerRecord} />}
          {screen === 'issue-bill' && <LogBill customerUsers={customerUsers} selectedCustomer={selectedBillingCustomer} onSelectCustomer={setSelectedBillingCustomer} onSaveBill={saveBillRecord} />}
          {screen === 'profile' && <Profile user={user} onSave={saveProfile} onSignOut={signOut} />}
        </ScrollView>
        {role === roles.ADMIN && screen === 'history' ? (
          <Text style={styles.adminHistoryNote}>Note: This records an offline payment only. BlueBill does not process transactions.</Text>
        ) : null}
        <Navigation role={role} screen={screen} onNavigate={(nextScreen) => {
          if (nextScreen === 'issue-bill') setSelectedBillingCustomer(null);
          setScreen(nextScreen);
        }} />
      </View>
    </SafeAreaView>
  );
}

function Splash({ onStart }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <View style={styles.splash}>
        <View style={styles.splashPanel}>
          <Image source={logo} style={styles.heroLogo} resizeMode="contain" />
          <Text style={styles.splashTitle}>Water billing, made clear.</Text>
          <Text style={styles.mutedCenter}>Streamlined billing for customers and teams.</Text>
          <Button label="Start now" onPress={onStart} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Login({ role, onRoleChange, onLogin }) {
  const textScale = useTextScale();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetComplete, setResetComplete] = useState(false);
  const [registrationMode, setRegistrationMode] = useState(false);

  async function submit() {
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      let profileSnapshot;
      try {
        profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid));
      } catch (error) {
        throw firestoreAccessError(`your users/${credential.user.uid} profile document`, error);
      }
      if (!profileSnapshot.exists()) {
        await firebaseSignOut(auth);
        setError('Your account profile is missing. Contact the system administrator.');
        return;
      }
      const profile = profileSnapshot.data();
      const profileRole = profile.role;

      if (role === roles.ADMIN) {
        if (profileRole !== roles.ADMIN) {
          await firebaseSignOut(auth);
          setError('This Firebase account profile does not have role "admin". Check users/{your-auth-uid} in Firestore.');
          return;
        }
        const adminData = await loadAdminData();
        setError('');
        onLogin(roles.ADMIN, profile.name || credential.user.displayName || credential.user.email, credential.user.email, null, [], adminData, profile);
        return;
      }

      if (profileRole !== roles.USER) {
        await firebaseSignOut(auth);
        setError(profileRole === roles.ADMIN
          ? 'This account is now an administrator. Select Admin sign-in to continue.'
          : 'This account is not configured as a customer account.');
        return;
      }
      const customerRecord = await loadCustomerAuthorization(credential.user.email);
      if (!customerRecord) {
        await firebaseSignOut(auth);
        setError('This email is not registered as an authorized customer yet. Contact an administrator to add your customer account.');
        return;
      }
      const savedBills = await loadBillsForUser(credential.user, false);
      setError('');
      onLogin(role, profile.name || customerRecord.name || credential.user.displayName || credential.user.email, credential.user.email, customerRecord, savedBills, null, profile);
    } catch (loginError) {
      if (auth.currentUser) await firebaseSignOut(auth);
      setError(getCustomerAuthErrorMessage(loginError, 'sign in'));
    }
  }

  async function registerCustomer() {
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('Enter your name, a valid email, and a password with at least 8 characters.');
      return;
    }
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid,
        name: name.trim(),
        email: credential.user.email,
        role: roles.USER,
        createdAt: serverTimestamp()
      });
      await firebaseSignOut(auth);
      setRegistrationMode(false);
      setError('Account created. Sign in with your new password.');
      setPassword('');
    } catch (registrationError) {
      if (auth.currentUser) await firebaseSignOut(auth);
      setError(registrationError.code === 'permission-denied'
        ? 'Your account was created, but its profile could not be saved. Check the Firestore security rules and contact the system administrator.'
        : getCustomerAuthErrorMessage(registrationError, 'create account'));
    }
  }

  function openPasswordReset() {
    setResetError('');
    setResetComplete(false);
    setResetMode(true);
  }

  async function sendResetCode() {
    if (!email.trim() || !email.includes('@')) {
      setResetError('Enter a valid email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setResetError('');
      setResetComplete(true);
    } catch (error) {
      setResetError(getCustomerAuthErrorMessage(error, 'send password reset email'));
    }
  }

  if (resetMode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
          <Image source={logo} style={styles.authLogo} resizeMode="contain" />
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.muted}>Firebase will email you a secure password reset link.</Text>
          {resetComplete ? (
            <View>
              <Text style={styles.resetSuccess}>Password reset email sent. Follow its link to choose a new password.</Text>
              <Button label="Return to sign in" onPress={() => { setResetMode(false); setResetComplete(false); }} />
            </View>
          ) : (
            <View>
              <Field label="Account email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
              {resetError ? <Text style={styles.error}>{resetError}</Text> : null}
              <Button label="Send password reset email" onPress={sendResetCode} />
              <Pressable style={styles.forgotPasswordButton} onPress={() => setResetMode(false)}>
                <Text style={styles.forgotPasswordText}>Back to sign in</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (registrationMode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
          <Image source={logo} style={styles.authLogo} resizeMode="contain" />
          <Text style={styles.title}>Create customer account</Text>
          <Text style={styles.muted}>Register to securely access your BlueBill billing information.</Text>
          <Field label="Full name" value={name} onChangeText={setName} placeholder="Your full name" />
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="off" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoComplete="off" />
          <Text style={styles.customerLookupHelp}>After registration, an administrator must issue a bill to your email before you can access your bill dashboard.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Create account" onPress={registerCustomer} />
          <Pressable style={styles.forgotPasswordButton} onPress={() => { setRegistrationMode(false); setError(''); }}>
            <Text style={styles.forgotPasswordText}>Back to sign in</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
        <Image source={logo} style={styles.authLogo} resizeMode="contain" />
        <Text style={styles.title}>{role === roles.ADMIN ? 'Welcome back' : 'Customer sign in'}</Text>
        <Text style={styles.muted}>{role === roles.ADMIN ? 'Sign in to manage your BlueBill account.' : 'Sign in to access bills linked to your account.'}</Text>
        <View style={styles.roleSwitch}>
          <Pressable style={[styles.roleOption, role === roles.ADMIN && styles.roleActive]} onPress={() => { onRoleChange(roles.ADMIN); setError(''); }}>
            <Text style={[styles.roleText, role === roles.ADMIN && styles.roleTextActive]}>Admin</Text>
          </Pressable>
          <Pressable style={[styles.roleOption, role === roles.USER && styles.roleActive]} onPress={() => { onRoleChange(roles.USER); setError(''); }}>
            <Text style={[styles.roleText, role === roles.USER && styles.roleTextActive]}>Customer</Text>
          </Pressable>
        </View>
        {role === roles.ADMIN ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="off" />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.passwordInputWrap}>
                <TextInput value={password} onChangeText={setPassword} placeholder="Enter password" secureTextEntry={!showPassword} autoComplete="off" style={[styles.passwordInput, { fontSize: Math.round(16 * textScale) }]} placeholderTextColor={colors.muted} />
                <Pressable accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} accessibilityRole="button" style={styles.visibilityButton} onPress={() => setShowPassword((visible) => !visible)}>
                  <Text style={styles.visibilityIcon}>{showPassword ? '🙈' : '👁'}</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {role === roles.ADMIN ? (
          <>
            <Button label="Sign in" onPress={submit} />
          <Text style={styles.authHint}>Admin access is granted by an existing administrator.</Text>
            <Pressable style={styles.forgotPasswordButton} onPress={openPasswordReset}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Field label="Account email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoComplete="password" />
            <Button label="Sign in to account" onPress={submit} />
            <Pressable style={styles.forgotPasswordButton} onPress={openPasswordReset}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>
            <Pressable style={styles.forgotPasswordButton} onPress={() => { setRegistrationMode(true); setError(''); }}>
              <Text style={styles.forgotPasswordText}>Create customer account</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ user, onProfile }) {
  const initials = user?.name?.split(' ').map((part) => part[0]).join('').slice(0, 2) || 'BB';
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>BlueBill</Text>
        <Text style={styles.headerHint}>Water billing tracker</Text>
      </View>
      <Pressable style={styles.avatarButton} onPress={onProfile}>
        <Text style={styles.avatar}>{initials}</Text>
      </Pressable>
    </View>
  );
}

function LegacyDashboard({ role, user, accountRecords, customerAccount, onNavigate, selectedCustomer, setSelectedCustomer }) {
  const textScale = useTextScale();
  const isAdmin = role === roles.ADMIN;
  const users = accountRecords;
  const customerRecord = customerAccount || users[0];
  const chartBars = isAdmin ? adminChartBars : customerChartBars;
  const usageScale = isAdmin ? 64 : 1;
  const adminSummary = getAdminSummary(users);
  const totalBilled = users.reduce((total, item) => total + Number(item.bill), 0);
  const overdueAmount = users.filter((item) => item.status === 'Overdue').reduce((total, item) => total + Number(item.bill), 0);
  const pendingAmount = users.filter((item) => item.status === 'Pending').reduce((total, item) => total + Number(item.bill), 0);
  const collectionRate = totalBilled ? Math.round((adminSummary.collected / totalBilled) * 100) : 0;
  const usageSummary = isAdmin
    ? { daily: `${Math.round((adminSummary.recordedConsumption * usageScale) / 30).toLocaleString()} gal/day`, monthly: `${(adminSummary.recordedConsumption * usageScale).toLocaleString()} gal` }
    : buildUsageSummary(chartBars, usageScale);
  const usageDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
  const [selectedUsageDay, setSelectedUsageDay] = useState(() => (new Date().getDay() + 6) % 7);
  useEffect(() => {
    const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const usageDates = usageDays.map((_, index) => {
    const date = new Date(currentDateTime);
    const currentDay = (currentDateTime.getDay() + 6) % 7;
    date.setDate(currentDateTime.getDate() + index - currentDay);
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  });
  const selectedUsage = Math.round(chartBars[selectedUsageDay] * usageScale);
  const [adminFilter, setAdminFilter] = useState('All');
  const [adminSearch, setAdminSearch] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const filteredUsers = adminFilter === 'All'
    ? users
    : users.filter((item) => item.status === adminFilter);
  const visibleUsers = adminSearch.trim()
    ? filteredUsers.filter((item) => `${item.id} ${item.name} ${item.email} ${item.barangay} ${item.city}`.toLowerCase().includes(adminSearch.trim().toLowerCase()))
    : filteredUsers;
  const customersByBarangay = Object.values(users.reduce((groups, item) => {
    if (!groups[item.barangay]) groups[item.barangay] = { name: item.barangay, customers: [] };
    groups[item.barangay].customers.push(item);
    return groups;
  }, {})).sort((a, b) => a.name.localeCompare(b.name));
  const barangayCustomers = selectedBarangay
    ? users.filter((item) => item.barangay === selectedBarangay)
    : [];

  return (
    <View>
      <Text style={styles.eyebrow}>{isAdmin ? 'ADMIN OVERVIEW' : 'CUSTOMER OVERVIEW'}</Text>
      <Text style={styles.title}>{isAdmin ? 'Good morning.' : `Hello, ${user?.name?.split(' ')[0] || 'there'}.`}</Text>
      <Text style={styles.muted}>{isAdmin ? 'Keep Toledo City billing moving across local barangays.' : 'Here is your latest billing activity.'}</Text>
      {!isAdmin ? (
        <View style={styles.trackingNumberRow}>
          <Text style={styles.trackingNumberLabel}>Tracking number</Text>
          <Text style={styles.trackingNumberValue}>{customerRecord.id}</Text>
        </View>
      ) : null}
      <Text style={styles.liveDateTime}>{currentDateTime.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {currentDateTime.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</Text>
      <View style={styles.metricsRow}>
        <Metric label={isAdmin ? 'Collected' : 'Current bill'} value={isAdmin ? `₱${adminSummary.collected.toLocaleString()}` : `₱${customerRecord.bill.toLocaleString()}`} />
        <Metric label={isAdmin ? 'Open bills' : 'Due date'} value={isAdmin ? adminSummary.openBills.toLocaleString() : new Date(customerRecord.dueDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} note={!isAdmin ? formatDueCountdown(customerRecord.dueDate, currentDateTime) : undefined} />
      </View>
      {isAdmin ? (
        <Card title="Billing health" subtitle="A quick view of collection performance and risk">
          <View style={styles.adminHealthGrid}>
            <View style={styles.adminHealthStat}>
              <Text style={styles.adminHealthLabel}>Collection rate</Text>
              <Text style={styles.adminHealthValue}>{collectionRate}%</Text>
              <Text style={styles.adminHealthHint}>of total billed</Text>
            </View>
            <View style={styles.adminHealthStat}>
              <Text style={styles.adminHealthLabel}>Overdue balance</Text>
              <Text style={styles.adminHealthValue}>₱{overdueAmount.toLocaleString()}</Text>
              <Text style={styles.adminHealthHint}>needs attention</Text>
            </View>
            <View style={styles.adminHealthStat}>
              <Text style={styles.adminHealthLabel}>Pending balance</Text>
              <Text style={styles.adminHealthValue}>₱{pendingAmount.toLocaleString()}</Text>
              <Text style={styles.adminHealthHint}>awaiting payment</Text>
            </View>
          </View>
          <Pressable style={styles.healthAction} onPress={() => setAdminFilter('Overdue')}>
            <Text style={styles.healthActionText}>Review overdue accounts</Text>
            <Text style={styles.healthActionArrow}>→</Text>
          </Pressable>
        </Card>
      ) : null}
      <Card title="Weekly usage" subtitle={`Consumption overview · ${usageDates[0]} - ${usageDates[6]}`}>
        <View style={styles.chart}>
          {chartBars.map((height, index) => (
            <View key={index} style={styles.barColumn}>
              <Pressable
                accessibilityLabel={`${usageDays[index]} usage: ${Math.round(height * usageScale)} gallons`}
                accessibilityRole="button"
                onPress={() => setSelectedUsageDay(index)}
                style={({ pressed }) => [styles.barTrack, selectedUsageDay === index && styles.selectedBarTrack, pressed && styles.pressedBarTrack]}
              >
                <View style={[styles.bar, { height: `${height}%` }]} />
              </Pressable>
              <Text style={styles.chartLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
            </View>
          ))}
        </View>
        <View style={styles.usageSummaryRow}>
          <View style={styles.usageSummaryItem}>
            <Text style={styles.usageSummaryLabel}>{usageDays[selectedUsageDay]} · {usageDates[selectedUsageDay]}</Text>
            <Text style={styles.usageSummaryValue}>{selectedUsage.toLocaleString()} gal</Text>
          </View>
          <View style={styles.usageSummaryItem}>
            <Text style={styles.usageSummaryLabel}>Total month usage</Text>
            <Text style={styles.usageSummaryValue}>{usageSummary.monthly}</Text>
          </View>
        </View>
      </Card>
      {selectedCustomer ? (
        <View style={styles.customerModalBackdrop}>
          <View style={styles.customerModalCard}>
            <Text style={styles.customerModalTitle}>{selectedCustomer.name}</Text>
            <Text style={styles.customerModalSubtitle}>{selectedCustomer.city}</Text>
            <Text style={styles.meterFormula}>Water consumption = current reading - previous reading</Text>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Tracking</Text><Text style={styles.customerModalValue}>{selectedCustomer.id}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Barangay</Text><Text style={styles.customerModalValue}>{selectedCustomer.barangay}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Address</Text><Text style={styles.customerModalValue}>{selectedCustomer.address}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Meter No.</Text><Text style={styles.customerModalValue}>{selectedCustomer.meter}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Previous reading</Text><Text style={styles.customerModalValue}>{selectedCustomer.previousReading} m³</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Current reading</Text><Text style={styles.customerModalValue}>{selectedCustomer.currentReading} m³</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Water consumption</Text><Text style={styles.customerModalValue}>{calculateWaterBill(selectedCustomer.previousReading, selectedCustomer.currentReading).consumption} m³</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Rate</Text><Text style={styles.customerModalValue}>₱{waterRatePerCubicMeter}/m³</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Phone</Text><Text style={styles.customerModalValue}>{selectedCustomer.phone}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Email</Text><Text style={styles.customerModalValue}>{selectedCustomer.email}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Amount due</Text><Text style={styles.customerModalValue}>₱{selectedCustomer.bill.toFixed(2)}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Due date</Text><Text style={styles.customerModalValue}>{selectedCustomer.dueDate}</Text></View>
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Last payment</Text><Text style={styles.customerModalValue}>{selectedCustomer.lastPayment}</Text></View>
            <Pressable style={styles.modalCloseButton} onPress={() => setSelectedCustomer(null)}>
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <Card title={isAdmin ? 'Customer accounts' : 'Issued bills'} subtitle={isAdmin ? 'Accounts needing attention' : 'Your latest bills'}>
        {isAdmin ? (
          <View>
            <View style={styles.adminSearchBox}>
              <TextInput value={adminSearch} onChangeText={setAdminSearch} style={[styles.adminSearchInput, { fontSize: Math.round(16 * textScale) }]} placeholder="Search name, email, tracking, or barangay" placeholderTextColor={colors.muted} />
            </View>
            <Text style={styles.filterGroupLabel}>Billing status</Text>
            <View style={styles.adminFilterRow}>
              {['All', 'Paid', 'Pending', 'Overdue'].map((option) => (
                <Pressable key={option} style={[styles.filterChip, adminFilter === option && styles.filterChipActive]} onPress={() => setAdminFilter(option)}>
                  <Text style={[styles.filterChipText, adminFilter === option && styles.filterChipTextActive]}>{option}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.adminTableWrap}>
              <View style={styles.adminTableHeader}>
                <Text style={styles.adminTableHeaderCell}>Tracking</Text>
                <Text style={styles.adminTableHeaderCell}>Name</Text>
                <Text style={styles.adminTableHeaderCell}>Barangay</Text>
                <Text style={styles.adminTableHeaderCell}>Status</Text>
                <Text style={styles.adminTableHeaderCell}>Due</Text>
              </View>
              {visibleUsers.map((item) => (
                <Pressable key={item.id} style={styles.adminTableRow} onPress={() => setSelectedCustomer(item)}>
                  <Text style={styles.adminTableCell}>{item.id}</Text>
                  <View style={styles.adminNameCell}>
                    <Text style={styles.adminTableCell}>{item.name}</Text>
                    <Text style={styles.adminContactCell}>{item.phone}</Text>
                    <Text style={styles.adminContactCell}>{item.email}</Text>
                  </View>
                  <Text style={styles.adminTableCell}>{item.city.split(',')[0]}</Text>
                  <Text style={[styles.adminStatusCell, item.status === 'Paid' ? styles.adminStatusPaid : item.status === 'Pending' ? styles.adminStatusPending : styles.adminStatusOverdue]}>{item.status}</Text>
                  <Text style={styles.adminTableCell}>₱{item.bill.toFixed(2)}</Text>
                </Pressable>
              ))}
              {!visibleUsers.length ? <Text style={styles.emptyState}>No customer accounts match this search.</Text> : null}
            </View>
          </View>
        ) : (
          accountRecords.map((item) => (
            <View style={styles.listRow} key={item.id}>
              <View style={styles.listIcon}><Text style={styles.listIconText}>₱</Text></View>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{item.id}</Text>
                <Text style={styles.listSubtitle}>{item.status}</Text>
              </View>
              <Text style={styles.amount}>₱{Number(item.bill).toFixed(2)}</Text>
            </View>
          ))
        )}
        {isAdmin ? (
          <View>
            <View style={styles.adminCustomerTotalRow}>
              <Text style={styles.adminCustomerTotalLabel}>Active customers</Text>
              <Text style={styles.adminCustomerTotalValue}>{users.length.toLocaleString()}</Text>
            </View>
            <View style={styles.adminCustomerTotalRow}>
              <Text style={styles.adminCustomerTotalLabel}>Total unpaid</Text>
              <Text style={styles.adminCustomerTotalValue}>₱{adminSummary.barangayBalances.reduce((total, item) => total + item.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
            </View>
            <View style={styles.barangayListBox}>
              <Text style={styles.barangayListTitle}>Customers by barangay</Text>
              {customersByBarangay.map((barangay) => (
                <Pressable key={barangay.name} style={[styles.barangayBalanceRow, selectedBarangay === barangay.name && styles.barangayBalanceRowActive]} onPress={() => setSelectedBarangay(barangay.name)}>
                  <Text style={styles.barangayBalanceName}>{barangay.name}</Text>
                  <View style={styles.barangayBalanceRight}><Text style={styles.barangayBalanceValue}>{barangay.customers.length} {barangay.customers.length === 1 ? 'customer' : 'customers'}</Text><Text style={styles.barangayViewHint}>View customers</Text></View>
                </Pressable>
              ))}
              {selectedBarangay ? (
                <View style={styles.unpaidCustomerList}>
                  <View style={styles.unpaidCustomerHeader}>
                    <Text style={styles.barangayListTitle}>Customers in {selectedBarangay}</Text>
                    <Pressable onPress={() => setSelectedBarangay(null)}><Text style={styles.clearSelection}>Clear</Text></Pressable>
                  </View>
                  {barangayCustomers.map((item) => (
                    <Pressable key={item.id} style={styles.unpaidCustomerRow} onPress={() => setSelectedCustomer(item)}>
                      <View style={styles.unpaidCustomerMain}>
                        <Text style={styles.listTitle}>{item.name}</Text>
                        <Text style={styles.listSubtitle}>{item.id} · {item.phone}</Text>
                        <Text style={styles.unpaidCustomerContact}>{item.email} · Meter {item.meter}</Text>
                      </View>
                      <View style={styles.unpaidCustomerAmount}><Text style={styles.amount}>₱{item.bill.toFixed(2)}</Text><Text style={styles.adminStatusCell}>{item.status}</Text></View>
                    </Pressable>
                  ))}
                  {!barangayCustomers.length ? <Text style={styles.emptyState}>No customers in this barangay.</Text> : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </Card>
      <Button label={isAdmin ? 'Issue a bill' : 'View bill history'} onPress={() => onNavigate(isAdmin ? 'issue-bill' : 'history')} secondary />
    </View>
  );
}

function billStatus(bill) {
  if (bill.status === 'Paid') return 'Paid';
  const dueDate = new Date(bill.dueDate);
  if (Number.isNaN(dueDate.getTime())) return bill.status || 'Pending';
  dueDate.setHours(23, 59, 59, 999);
  return bill.status !== 'Overdue' && dueDate < new Date() ? 'Overdue' : (bill.status || 'Pending');
}

function Dashboard({ role, user, accountRecords, customerUsers, registeredUsers, onRefreshRegisteredUsers, onPromoteUser }) {
  const isAdmin = role === roles.ADMIN;
  const [message, setMessage] = useState('');
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const [registeredUserSearch, setRegisteredUserSearch] = useState('');
  const [adminCandidateSearch, setAdminCandidateSearch] = useState('');
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [promotingUserId, setPromotingUserId] = useState(null);
  const filteredRegisteredUsers = registeredUsers.filter((registeredUser) =>
    (registeredUser.name || 'Customer').toLowerCase().includes(registeredUserSearch.trim().toLowerCase())
  );
  const filteredAdminCandidates = registeredUsers.filter((candidate) =>
    `${candidate.name || ''} ${candidate.email || ''}`.toLowerCase().includes(adminCandidateSearch.trim().toLowerCase())
  );
  const pendingCount = accountRecords.filter((bill) => billStatus(bill) === 'Pending').length;
  const overdueCount = accountRecords.filter((bill) => billStatus(bill) === 'Overdue').length;
  const paidCount = accountRecords.filter((bill) => billStatus(bill) === 'Paid').length;

  async function promoteUser(candidate) {
    setPromotingUserId(candidate.uid);
    setMessage('');
    try {
      await onPromoteUser(candidate);
      setMessage(`${candidate.name || candidate.email || 'Selected user'} is now an administrator and can no longer sign in as a customer.`);
    } catch (error) {
      setMessage(error.message || 'Unable to promote this user.');
    } finally {
      setPromotingUserId(null);
    }
  }

  async function refreshUsers() {
    setRefreshingUsers(true);
    setMessage('');
    try {
      await onRefreshRegisteredUsers();
    } catch (error) {
      setMessage(error.message || 'Unable to refresh registered users.');
    } finally {
      setRefreshingUsers(false);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>{isAdmin ? 'ADMIN OVERVIEW' : 'CUSTOMER OVERVIEW'}</Text>
      {isAdmin ? (
        <View style={styles.dashboardTitleRow}>
          <Text style={[styles.title, styles.dashboardTitle]}>Billing dashboard</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addAdminOpen ? 'Close Add New Admin menu' : 'Open Add New Admin menu'}
            style={styles.addAdminToggle}
            onPress={() => { setAddAdminOpen((open) => !open); setMessage(''); }}
          >
            <Text style={styles.addAdminToggleText}>Add New Admin</Text>
            <Text style={styles.addAdminArrow}>{addAdminOpen ? '▴' : '▾'}</Text>
          </Pressable>
        </View>
      ) : <Text style={styles.title}>{`Hello, ${user?.name?.split(' ')[0] || 'there'}.`}</Text>}
      {isAdmin && addAdminOpen ? (
        <Card title="Add New Admin" subtitle="Promoted users will only be able to sign in to the admin side.">
          <Field
            label="Search registered users"
            value={adminCandidateSearch}
            onChangeText={setAdminCandidateSearch}
            placeholder="Search by name or email"
          />
          <ScrollView style={styles.adminCandidatesList} nestedScrollEnabled showsVerticalScrollIndicator>
            {filteredAdminCandidates.map((candidate) => (
              <View style={styles.adminCandidateRow} key={candidate.uid}>
                <View style={styles.listMain}>
                  <Text style={styles.listTitle}>{candidate.name || 'Customer'}</Text>
                  <Text style={styles.listSubtitle}>{candidate.email}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.requestAction, promotingUserId === candidate.uid && styles.disabledAction]}
                  onPress={() => promoteUser(candidate)}
                  disabled={promotingUserId !== null}
                >
                  <Text style={styles.requestActionText}>{promotingUserId === candidate.uid ? 'Adding...' : 'Make admin'}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          {!registeredUsers.length ? <Text style={styles.emptyState}>There are no registered customer accounts to promote.</Text> : null}
          {registeredUsers.length > 0 && !filteredAdminCandidates.length ? <Text style={styles.emptyState}>No registered users match that search.</Text> : null}
          {message ? <Text style={message.includes('now an administrator') ? styles.success : styles.error}>{message}</Text> : null}
        </Card>
      ) : null}
      <Text style={styles.muted}>{isAdmin ? 'Manage customer authorization separately from issuing consumption bills.' : 'Bills issued to your account appear here.'}</Text>
      {!isAdmin && user?.customerNumber ? (
        <View style={styles.trackingNumberRow}>
          <Text style={styles.trackingNumberLabel}>Customer number</Text>
          <Text style={styles.trackingNumberValue}>{user.customerNumber}</Text>
        </View>
      ) : null}
      <View style={styles.metricsRow}>
        <Metric label={isAdmin ? 'Registered users' : 'Pending bills'} value={isAdmin ? registeredUsers.length.toLocaleString() : pendingCount.toLocaleString()} />
        <Metric label={isAdmin ? 'Authorized customers' : 'Paid / overdue'} value={isAdmin ? customerUsers.length.toLocaleString() : `${paidCount} / ${overdueCount}`} />
      </View>
      {isAdmin ? (
        <>
          <Card title="Registered customers / users" subtitle="Customer accounts created with email and password" centerTitle>
            <View style={styles.registeredUsersActions}>
              <Text style={styles.listSubtitle}>{registeredUsers.length} registered {registeredUsers.length === 1 ? 'user' : 'users'}</Text>
              <Pressable style={styles.requestAction} onPress={refreshUsers} disabled={refreshingUsers}>
                <Text style={styles.requestActionText}>{refreshingUsers ? 'Refreshing...' : 'Refresh list'}</Text>
              </Pressable>
            </View>
            <Field label="Search users by name" value={registeredUserSearch} onChangeText={setRegisteredUserSearch} placeholder="Type a customer name" />
            <ScrollView
              style={styles.registeredUsersList}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {filteredRegisteredUsers.map((registeredUser) => {
                const authorizedCustomer = customerUsers.find((customer) => customer.email.toLowerCase() === registeredUser.email.toLowerCase());
                return (
                  <View style={styles.historyRow} key={registeredUser.uid}>
                    <View style={styles.listMain}>
                      <Text style={styles.listTitle}>{registeredUser.name || 'Customer'}</Text>
                      <Text style={styles.listSubtitle}>{registeredUser.email}</Text>
                      <Text style={styles.customerLookupHelp}>
                        {authorizedCustomer
                          ? `Customer number: ${authorizedCustomer.customerNumber}`
                          : 'Not yet authorized by an admin'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            {!registeredUsers.length ? <Text style={styles.emptyState}>No customer accounts have registered yet.</Text> : null}
            {registeredUsers.length > 0 && !filteredRegisteredUsers.length ? <Text style={styles.emptyState}>No users match that name.</Text> : null}
          </Card>
        </>
      ) : (
        <>
          <Card title="Pending bills" subtitle="Payment is handled outside BlueBill; status is maintained by administrators">
            {accountRecords.filter((bill) => billStatus(bill) === 'Pending' || billStatus(bill) === 'Overdue').map((bill) => (
              <View style={styles.historyRow} key={bill.id}>
                <View style={styles.listMain}>
                  <Text style={styles.listTitle}>{bill.id}</Text>
                  <Text style={styles.listSubtitle}>Due {bill.dueDate} · {billStatus(bill)}</Text>
                </View>
                <Text style={styles.amount}>₱{Number(bill.bill).toFixed(2)}</Text>
              </View>
            ))}
            {!accountRecords.some((bill) => billStatus(bill) === 'Pending' || billStatus(bill) === 'Overdue') ? <Text style={styles.emptyState}>You have no pending bills.</Text> : null}
          </Card>
        </>
      )}
      {message && isAdmin && !addAdminOpen ? <Text style={styles.error}>{message}</Text> : null}
    </View>
  );
}

function History({ accountRecords, role, onMarkBillPaid, onDeletePaidBill, onRefreshBills }) {
  const isAdmin = role === roles.ADMIN;
  const [message, setMessage] = useState('');
  const [deleteConfirmationId, setDeleteConfirmationId] = useState(null);
  const [deletingBillId, setDeletingBillId] = useState(null);

  useEffect(() => {
    let isActive = true;
    onRefreshBills().catch((error) => {
      if (isActive) setMessage(error.message || 'Unable to refresh bills.');
    });
    return () => {
      isActive = false;
    };
  }, [onRefreshBills]);

  async function markBillPaid(bill) {
    setMessage('');
    try {
      await onMarkBillPaid(bill);
    } catch (error) {
      setMessage(error.message || 'Unable to record the offline payment.');
    }
  }

  async function deletePaidBill(bill) {
    if (deletingBillId) return;
    setDeletingBillId(bill.id);
    setMessage('');
    try {
      await onDeletePaidBill(bill);
      setDeleteConfirmationId(null);
    } catch (error) {
      setMessage(error.message || 'Unable to delete this paid bill.');
    } finally {
      setDeletingBillId(null);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>ACTIVITY</Text>
      <Text style={styles.title}>Bill history</Text>
      <Text style={styles.muted}>{isAdmin ? 'All bills issued to customers. Record payments made outside BlueBill.' : 'Paid and overdue bills issued to your account.'}</Text>
      <Card>
        {accountRecords
          .filter((bill) => isAdmin || billStatus(bill) === 'Paid' || billStatus(bill) === 'Overdue')
          .map((bill) => (
            <View style={styles.historyRow} key={bill.id}>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{isAdmin ? `${bill.id} · ${bill.name}` : bill.id}</Text>
                <Text style={styles.listSubtitle}>{billStatus(bill)} · Due {bill.dueDate}</Text>
              </View>
              <Text style={styles.amount}>₱{Number(bill.bill).toFixed(2)}</Text>
              {isAdmin && billStatus(bill) !== 'Paid' ? (
                <Pressable style={styles.requestAction} onPress={() => markBillPaid(bill)}>
                  <Text style={styles.requestActionText}>Record paid</Text>
                </Pressable>
              ) : null}
              {!isAdmin && billStatus(bill) === 'Paid' ? (
                deleteConfirmationId === bill.id ? (
                  <View style={styles.requestActions}>
                    <Pressable
                      style={styles.requestRejectAction}
                      onPress={() => deletePaidBill(bill)}
                      disabled={deletingBillId === bill.id}
                    >
                      <Text style={styles.requestRejectText}>{deletingBillId === bill.id ? 'Deleting...' : 'Confirm delete'}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.requestAction}
                      onPress={() => setDeleteConfirmationId(null)}
                      disabled={deletingBillId === bill.id}
                    >
                      <Text style={styles.requestActionText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.requestRejectAction}
                    onPress={() => setDeleteConfirmationId(bill.id)}
                  >
                    <Text style={styles.requestRejectText}>Delete</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          ))}
        {!accountRecords.some((bill) => isAdmin || billStatus(bill) === 'Paid' || billStatus(bill) === 'Overdue') ? <Text style={styles.emptyState}>No bill history yet.</Text> : null}
      </Card>
      {message ? <Text style={styles.error}>{message}</Text> : null}
    </View>
  );
}

function AddCustomer({ onSaveCustomer }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [saving, setSaving] = useState(false);

  async function addCustomer() {
    if (saving) return;
    if (!name.trim() || !email.trim() || !email.includes('@')) {
      setMessage('Enter the confirmed customer name and a valid email address.');
      return;
    }
    setSaving(true);
    setMessage('');
    setCustomerNumber('');
    try {
      const customer = await onSaveCustomer({ name: name.trim(), email: email.trim().toLowerCase() });
      setCustomerNumber(customer.customerNumber);
      setMessage('Customer added. Share the customer number with them. Issue water bills separately from the Issue bill screen.');
      setName('');
      setEmail('');
    } catch (error) {
      setMessage(error.message || 'Unable to add customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>ADMIN TOOL</Text>
      <Text style={styles.title}>Add user</Text>
      <Text style={styles.muted}>Confirm the customer's email and create their customer account number. This does not issue a water-consumption bill.</Text>
      <Card title="Customer authorization" subtitle="The customer signs in with the same email and their own password. Their authorized account is matched automatically." centerTitle centerSubtitle>
        <Field label="Confirmed customer name" value={name} onChangeText={setName} placeholder="Customer name" />
        <Field label="Confirmed customer email" value={email} onChangeText={setEmail} placeholder="customer@example.com" keyboardType="email-address" autoCapitalize="none" />
        {customerNumber ? <Text style={styles.success}>Customer number: {customerNumber}</Text> : null}
        {message ? <Text style={customerNumber ? styles.success : styles.error}>{message}</Text> : null}
        <Button label={saving ? 'Adding customer...' : 'Add customer'} onPress={addCustomer} />
      </Card>
    </View>
  );
}

function LogBill({ customerUsers, selectedCustomer, onSelectCustomer, onSaveBill }) {
  const [location, setLocation] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [message, setMessage] = useState('');
  const [issuedBillNumber, setIssuedBillNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const filteredCustomers = customerUsers.filter((customer) =>
    (customer.name || 'Customer').toLowerCase().includes(customerSearch.trim().toLowerCase())
  );

  async function saveBill() {
    if (saving) return;
    const amount = Number(billAmount);
    if (!selectedCustomer || !location.trim() || !billAmount.trim()) {
      setMessage('Select an authorized customer, enter the service location, and enter the bill amount.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a bill amount greater than ₱0.00.');
      return;
    }
    setSaving(true);
    setMessage('');
    setIssuedBillNumber('');
    try {
      const billNumber = await onSaveBill({
        customer: selectedCustomer.name,
        email: selectedCustomer.email,
        location: location.trim(),
        amount
      });
      setIssuedBillNumber(billNumber);
      setMessage('Bill issued and available in the customer dashboard.');
    } catch (error) {
      setMessage(error.message || 'Unable to save bill permanently.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>ADMIN TOOL</Text>
      <Text style={styles.title}>Issue bill</Text>
      <Text style={styles.muted}>Create a pending water-consumption bill for an authorized customer. Customer authorization is managed separately in Add user.</Text>
      <Card>
        {customerUsers.length ? (
          <View>
            <Text style={styles.customerPickerTitle}>Select a customer</Text>
            <Field label="Search customers by name" value={customerSearch} onChangeText={setCustomerSearch} placeholder="Type a customer name" />
            <ScrollView
              style={styles.issueCustomerList}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {filteredCustomers.map((account) => (
                <Pressable key={account.id} style={[styles.customerOption, selectedCustomer?.id === account.id && styles.customerOptionActive]} onPress={() => { onSelectCustomer(account); setMessage(''); }}>
                  <Text style={styles.listTitle}>{account.name || 'Customer'} · {account.customerNumber}</Text>
                  <Text style={styles.listSubtitle}>{account.email}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {!filteredCustomers.length ? <Text style={styles.emptyState}>No authorized customers match that name.</Text> : null}
          </View>
        ) : null}
        {!customerUsers.length ? <Text style={styles.emptyState}>Add an authorized customer before issuing a bill.</Text> : null}
        {selectedCustomer ? <Text style={styles.customerLookupDetails}>Billing {selectedCustomer.name} ({selectedCustomer.email}) · {selectedCustomer.customerNumber}</Text> : null}
        <Field label="Location" value={location} onChangeText={setLocation} placeholder="Barangay, city, or service address" />
        <Field label="Bill amount (₱)" value={billAmount} onChangeText={setBillAmount} placeholder="0.00" keyboardType="decimal-pad" />
        {issuedBillNumber ? <Text style={styles.success}>Issued bill number: {issuedBillNumber}</Text> : null}
        {message ? <Text style={issuedBillNumber ? styles.success : styles.error}>{message}</Text> : null}
        <Button label={saving ? 'Saving...' : 'Issue pending bill'} onPress={saveBill} />
      </Card>
    </View>
  );
}

function Profile({ user, onSave, onSignOut }) {
  const [name, setName] = useState(user?.name || '');
  const [city, setCity] = useState(user?.city || '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveChanges() {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave({ name, city });
      setMessage('Profile updated.');
    } catch (error) {
      setMessage(error.message || 'Unable to save profile changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.title}>Profile</Text>
      <Card>
        <Field label="Full name" value={name} onChangeText={setName} />
        <Field label="Email" value={user?.email || ''} editable={false} />
        <Field label="City or district" value={city} onChangeText={setCity} />
        {message ? <Text style={message === 'Profile updated.' ? styles.success : styles.error}>{message}</Text> : null}
        <Button label={saving ? 'Saving...' : 'Save changes'} onPress={saveChanges} />
      </Card>
      <Button label="Sign out" onPress={onSignOut} secondary />
    </View>
  );
}

function Navigation({ role, screen, onNavigate }) {
  const items = role === roles.ADMIN
    ? [['dashboard', 'Home'], ['add-user', 'Add user'], ['issue-bill', 'Issue bill'], ['history', 'History']]
    : [['dashboard', 'Home'], ['history', 'Bill history']];
  return (
    <View style={styles.navigation}>
      {items.map(([target, label]) => (
        <Pressable key={target} style={styles.navItem} onPress={() => onNavigate(target)}>
          <Text style={[styles.navLabel, screen === target && styles.navLabelActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Card({ title, subtitle, children, centerTitle = false, centerSubtitle = false }) {
  return <View style={styles.card}>{title ? <Text style={[styles.cardTitle, centerTitle && styles.cardTitleCentered]}>{title}</Text> : null}{subtitle ? <Text style={[styles.cardSubtitle, centerSubtitle && styles.cardSubtitleCentered]}>{subtitle}</Text> : null}{children}</View>;
}

function Metric({ label, value, note }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text>{note ? <Text style={styles.metricNote}>{note}</Text> : null}</View>; }
function Detail({ label, value }) { return <View style={styles.detail}><Text style={styles.listSubtitle}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function StatusPill({ label }) { return <View style={styles.status}><Text style={styles.statusText}>{label}</Text></View>; }
function Field({ label, ...props }) { const textScale = useTextScale(); return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={[styles.input, { fontSize: Math.round(16 * textScale) }]} placeholderTextColor={colors.muted} /></View>; }
function Button({ label, onPress, secondary = false }) { return <Pressable style={[styles.button, secondary && styles.buttonSecondary]} onPress={onPress}><Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text></Pressable>; }

const colors = { background: '#f4f6fb', surface: '#ffffff', border: '#e5eaf3', text: '#111827', muted: '#64748b', primary: '#3866ff', primarySoft: '#ebf1ff', success: '#15803d' };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  app: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#eef4ff' },
  splashPanel: { width: '100%', maxWidth: 480, padding: 28, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  heroLogo: { width: 220, height: 100, marginBottom: 22 },
  authWrap: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  authLogo: { width: 180, height: 72, alignSelf: 'center', marginBottom: 24 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginBottom: 8 },
  dashboardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  dashboardTitle: { flexShrink: 1 },
  addAdminToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 8, marginTop: 1 },
  addAdminToggleText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  addAdminArrow: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  adminCandidatesList: { maxHeight: 280 },
  adminCandidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f6', paddingVertical: 10 },
  disabledAction: { opacity: 0.55 },
  splashTitle: { color: colors.text, fontSize: 40, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: 20 },
  liveDateTime: { color: colors.primary, fontSize: 14, fontWeight: '700', marginTop: -10, marginBottom: 14 },
  trackingNumberRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: -12, marginBottom: 14 },
  trackingNumberLabel: { color: colors.muted, fontSize: 14 },
  trackingNumberValue: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  mutedCenter: { color: colors.muted, fontSize: 16, textAlign: 'center', marginBottom: 24 },
  roleSwitch: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: '#edf1f7', marginVertical: 20 },
  roleOption: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10 },
  roleActive: { backgroundColor: colors.surface },
  roleText: { color: colors.muted, fontWeight: '700' },
  roleTextActive: { color: colors.primary },
  field: { marginBottom: 16 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, fontSize: 16 },
  passwordInputWrap: { position: 'relative' },
  passwordInput: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, paddingLeft: 14, paddingRight: 52, paddingVertical: 13, color: colors.text, fontSize: 16 },
  visibilityButton: { position: 'absolute', right: 8, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' },
  visibilityIcon: { fontSize: 18 },
  error: { color: '#dc2626', marginBottom: 14 },
  customerLookupHelp: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 14 },
  customerPickerTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  issueCustomerList: { maxHeight: 270 },
  customerLookupResult: { padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, backgroundColor: colors.primarySoft },
  customerLookupName: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  customerLookupDetails: { color: colors.muted, fontSize: 14, marginBottom: 10 },
  customerLookupAction: { color: colors.primary, fontWeight: '800' },
  success: { color: colors.success, marginBottom: 14 },
  calculationBox: { backgroundColor: '#f7fafe', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  calculationTitle: { color: colors.text, fontWeight: '800', marginBottom: 8 },
  calculationText: { color: colors.muted, fontSize: 14, marginBottom: 4 },
  calculationAmount: { color: colors.text, fontWeight: '900', fontSize: 18, marginTop: 6 },
  forgotPasswordButton: { alignItems: 'center', paddingVertical: 10 },
  forgotPasswordText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  authHint: { color: colors.muted, textAlign: 'center', fontSize: 14, marginVertical: 10 },
  resetMessage: { color: colors.success, textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 4 },
  resetSuccess: { color: colors.success, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 12, padding: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  verificationNotice: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  demoCode: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 10, padding: 12, textAlign: 'center', fontWeight: '800', marginBottom: 8 },
  button: { backgroundColor: colors.primary, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 13, alignItems: 'center', marginTop: 8, marginBottom: 12 },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  buttonTextSecondary: { color: colors.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  brand: { color: colors.primary, fontWeight: '900', fontSize: 21 },
  headerHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  avatarButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatar: { color: colors.primary, fontWeight: '800' },
  content: { padding: 22, paddingBottom: 28 },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  metricsRow: { flexDirection: 'row', gap: 12, marginVertical: 10 },
  metric: { flex: 1, padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricLabel: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  metricNote: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18, marginVertical: 8 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  cardTitleCentered: { textAlign: 'center' },
  cardSubtitle: { color: colors.muted, fontSize: 14, marginTop: 4, marginBottom: 18 },
  cardSubtitleCentered: { textAlign: 'center' },
  adminHealthGrid: { flexDirection: 'row', gap: 12 },
  adminHealthStat: { flex: 1, paddingRight: 10, borderRightWidth: 1, borderRightColor: colors.border },
  adminHealthLabel: { color: colors.muted, fontSize: 14, fontWeight: '700', marginBottom: 7 },
  adminHealthValue: { color: colors.text, fontSize: 19, fontWeight: '900' },
  adminHealthHint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  healthAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  healthActionText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  healthActionArrow: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  chart: { height: 150, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 12 },
  barColumn: { alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: 16, height: 110, borderRadius: 8, backgroundColor: colors.primarySoft, justifyContent: 'flex-end', overflow: 'hidden' },
  selectedBarTrack: { backgroundColor: '#d7e2ff', transform: [{ scale: 1.08 }] },
  pressedBarTrack: { opacity: 0.72 },
  bar: { width: '100%', borderRadius: 8, backgroundColor: colors.primary },
  chartLabel: { color: colors.muted, fontSize: 12, marginTop: 8 },
  usageSummaryRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  usageSummaryItem: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f7fafe', borderWidth: 1, borderColor: colors.border },
  usageSummaryLabel: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  usageSummaryValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#eef1f6' },
  listIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  listIconText: { color: colors.primary, fontWeight: '800' },
  listMain: { flex: 1 },
  listTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  listSubtitle: { color: colors.muted, fontSize: 14, marginTop: 3 },
  amount: { color: colors.text, fontWeight: '800' },
  adminCustomerTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eef1f6' },
  adminCustomerTotalLabel: { color: colors.muted, fontWeight: '700' },
  adminCustomerTotalValue: { color: colors.text, fontWeight: '900', fontSize: 18 },
  barangayListBox: { marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fbff' },
  barangayListTitle: { color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 8 },
  barangayListText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  barangayBalanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  barangayBalanceRowActive: { backgroundColor: colors.primarySoft, borderRadius: 8, paddingHorizontal: 8 },
  barangayBalanceName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  barangayBalanceValue: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  barangayBalanceRight: { alignItems: 'flex-end' },
  barangayViewHint: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  unpaidCustomerList: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 },
  unpaidCustomerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  clearSelection: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  unpaidCustomerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eef1f6', paddingVertical: 10 },
  unpaidCustomerMain: { flex: 1, paddingRight: 8 },
  unpaidCustomerContact: { color: colors.muted, fontSize: 12, marginTop: 3 },
  unpaidCustomerAmount: { alignItems: 'flex-end' },
  contactInfo: { marginTop: 6 },
  contactText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  customerModalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  customerModalCard: { width: '88%', backgroundColor: '#ffffff', borderRadius: 18, padding: 20, borderWidth: 1, borderColor: colors.border },
  customerModalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginBottom: 4 },
  customerModalSubtitle: { color: colors.muted, fontSize: 14, marginBottom: 16 },
  meterFormula: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 10, padding: 10, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  customerModalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  customerModalLabel: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  customerModalValue: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right', maxWidth: '60%' },
  modalCloseButton: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalCloseButtonText: { color: '#ffffff', fontWeight: '800' },
  adminTableWrap: { marginTop: 6 },
  adminSearchBox: { marginBottom: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: '#f8fafc' },
  adminSearchInput: { paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 16 },
  filterGroupLabel: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 7 },
  adminFilterRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#f3f6fb', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  filterChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  filterChipText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  filterChipTextActive: { color: colors.primary },
  adminTableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8, marginBottom: 8 },
  adminTableHeaderCell: { flex: 1, color: colors.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  adminTableRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  adminTableCell: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '700' },
  emptyState: { color: colors.muted, fontSize: 14, paddingVertical: 14, textAlign: 'center' },
  adminNameCell: { flex: 1 },
  adminContactCell: { color: colors.muted, fontSize: 12, marginTop: 2 },
  adminStatusCell: { flex: 1, fontSize: 12, fontWeight: '800', textAlign: 'center', paddingVertical: 4, borderRadius: 999 },
  adminStatusPaid: { backgroundColor: '#dcfce7', color: '#166534' },
  adminStatusPending: { backgroundColor: '#fef3c7', color: '#92400e' },
  adminStatusOverdue: { backgroundColor: '#fee2e2', color: '#991b1b' },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  registeredUsersActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  registeredUsersList: { maxHeight: 270 },
  customerOption: { paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fafc' },
  customerOptionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.primarySoft },
  requestActionText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  requestRejectAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#fee2e2' },
  requestRejectText: { color: '#991b1b', fontWeight: '800', fontSize: 13 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  detail: { paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailValue: { color: colors.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  status: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#fff7ed', marginTop: 12 },
  statusText: { color: '#c2410c', fontWeight: '800', fontSize: 12 },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 6 },
  adminHistoryNote: { color: colors.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 8, backgroundColor: colors.background },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  navLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  navLabelActive: { color: colors.primary }
});
