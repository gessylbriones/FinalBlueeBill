import React, { useEffect, useState } from 'react';
import {
  Image,
  Linking,
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
import QRCode from 'react-native-qrcode-svg';
import logo from './assets/bluebill-logo.png';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';



const roles = { ADMIN: 'admin', USER: 'user' };
const waterRatePerCubicMeter = 30;

async function loadBillsForUser(firebaseUser, isAdmin) {
  const billsCollection = collection(db, 'bills');
  const billsQuery = isAdmin
    ? billsCollection
    : query(billsCollection, where('email', '==', firebaseUser.email));
  const snapshot = await getDocs(billsQuery);
  return snapshot.docs.map((billDocument) => billDocument.data());
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

const users = [
  { id: 'TCWD-TN-1001', name: 'Gessyl Mae Briones', email: 'sarah.johnson@gmail.com', phone: '+63 917 123 4567', city: 'Barangay Taboc, Toledo City', bill: 4230.00, status: 'Paid', meter: 'M-20481', previousReading: 125, currentReading: 266, dueDate: 'Oct 14, 2026', lastPayment: 'Mar 02, 2026', address: 'Blk 4 Lot 12, Taboc, Toledo City', barangay: 'Taboc', paymentMethod: 'GCash' },
  { id: 'TCWD-TN-1002', name: 'Kurt Elemeno', email: 'michael.chen@yahoo.com', phone: '+63 915 222 1988', city: 'Barangay Bato, Toledo City', bill: 3825.00, status: 'Pending', meter: 'M-18322', previousReading: 410, currentReading: 537, dueDate: 'Mar 20, 2026', lastPayment: 'Feb 12, 2026', address: 'Zone 2, Bato, Toledo City', barangay: 'Bato', paymentMethod: 'Maya' },
  { id: 'TCWD-TN-1003', name: 'John Lez Tayona', email: 'emily.rodriguez@gmail.com', phone: '+63 920 456 7781', city: 'Barangay Poblacion, Toledo City', bill: 3560.00, status: 'Overdue', meter: 'M-22197', previousReading: 88, currentReading: 207, dueDate: 'Mar 07, 2026', lastPayment: 'Jan 25, 2026', address: 'Poblacion Street, Toledo City', barangay: 'Poblacion', paymentMethod: 'GoTyme' },
  { id: 'TCWD-TN-1004', name: 'Earl Joseph Taran', email: 'james.wilson@hotmail.com', phone: '+63 905 771 3344', city: 'Barangay Magsaysay, Toledo City', bill: 4685.00, status: 'Paid', meter: 'M-26654', previousReading: 220, currentReading: 376, dueDate: 'Mar 18, 2026', lastPayment: 'Mar 06, 2026', address: 'Magsaysay Extension, Toledo City', barangay: 'Magsaysay', paymentMethod: 'GCash' },
  { id: 'TCWD-TN-1005', name: 'Johan Carl Demotor', email: 'lisa.anderson@bluebill.ph', phone: '+63 999 223 4455', city: 'Barangay Dumlog, Toledo City', bill: 3990.00, status: 'Pending', meter: 'M-31220', previousReading: 302, currentReading: 435, dueDate: 'Mar 25, 2026', lastPayment: 'Feb 26, 2026', address: 'Sitio San Jose, Dumlog, Toledo City', barangay: 'Dumlog', paymentMethod: 'Maya' }
];

function getNextTrackingNumber(records) {
  const highestNumber = records.reduce((highest, record) => {
    const match = /^TCWD-TN-(\d+)$/i.exec(record.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 1000);
  return `TCWD-TN-${highestNumber + 1}`;
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

const ewalletLinks = {
  GCash: { app: 'gcash://', web: 'https://www.gcash.com/' },
  Maya: { app: 'maya://', web: 'https://www.maya.ph/' },
  GoTyme: { app: 'gotyme://', web: 'https://www.gotyme.com.ph/' }
};

async function openEwalletPayment(method) {
  const target = ewalletLinks[method] || ewalletLinks.GCash;

  try {
    const canOpenApp = await Linking.canOpenURL(target.app);
    if (canOpenApp) {
      await Linking.openURL(target.app);
      return;
    }

    await Linking.openURL(target.web);
  } catch (error) {
    await Linking.openURL(target.web);
  }
}

function downloadReceiptFile(meterReading, customer) {
  if (typeof document === 'undefined') return;

  const receiptHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>BlueBill receipt</title>
<style>body{font-family:Arial,sans-serif;color:#111827;max-width:680px;margin:40px auto;padding:24px}h1{color:#3866ff}hr{border:0;border-top:1px solid #e5eaf3;margin:24px 0}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9}.total{font-size:28px;font-weight:700}</style>
</head><body><h1>BlueBill</h1><p>Water billing receipt</p><hr><div class="total">Amount due: ₱${meterReading.amount.toFixed(2)}</div><hr>
<div class="row"><span>Customer</span><strong>${customer.name}</strong></div>
<div class="row"><span>Service address</span><strong>${customer.address}</strong></div>
<div class="row"><span>Previous meter reading</span><strong>${customer.previousReading} m³</strong></div>
<div class="row"><span>Current meter reading</span><strong>${customer.currentReading} m³</strong></div>
<div class="row"><span>Water consumption</span><strong>${meterReading.consumption} m³</strong></div>
<div class="row"><span>Rate</span><strong>₱${waterRatePerCubicMeter}/m³</strong></div>
<div class="row"><span>Due date</span><strong>${customer.dueDate}</strong></div>
</body></html>`;
  const blob = new Blob([receiptHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bluebill-receipt-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const history = [
  { date: 'Feb 25, 2026', amount: 79.12, status: 'Paid' },
  { date: 'Dec 20, 2025', amount: 99.30, status: 'Paid' },
  { date: 'Oct 03, 2025', amount: 114.80, status: 'Paid' }
];

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
  const [accountRecords, setAccountRecords] = useState(users);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerAccount, setCustomerAccount] = useState(null);

  async function saveBillRecord(record) {
    const existingIndex = accountRecords.findIndex((item) => item.name.toLowerCase() === record.customer.toLowerCase());
    const existingRecord = existingIndex >= 0 ? accountRecords[existingIndex] : null;
    const nextRecord = {
      ...(existingRecord || {}),
      id: existingRecord?.id || getNextTrackingNumber(accountRecords),
      name: record.customer,
      email: record.email,
      phone: existingRecord?.phone || 'Not provided',
      city: record.location,
      bill: record.amount,
      status: 'Pending',
      meter: existingRecord?.meter || `M-${Date.now().toString().slice(-5)}`,
      previousReading: record.previousReading,
      currentReading: record.currentReading,
      dueDate: new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      lastPayment: existingRecord?.lastPayment || 'Not paid',
      address: record.location,
      barangay: record.location,
      paymentMethod: existingRecord?.paymentMethod || 'GCash'
    };
    try {
      await setDoc(doc(db, 'bills', nextRecord.id), nextRecord);
      setAccountRecords((currentRecords) => mergeBillRecords(currentRecords, [nextRecord]));
      setScreen('dashboard');
    } catch (error) {
      throw new Error(getCustomerAuthErrorMessage(error, 'save bill'));
    }
  }

  function signIn(nextRole, name, email, customerRecord, savedBills = []) {
    setAccountRecords((currentRecords) => mergeBillRecords(currentRecords, savedBills));
    const nextUser = nextRole === roles.ADMIN
      ? { name: name || 'Admin User', email: email || 'admin@bluebill.com', city: 'Toledo' }
      : { name: name || customerRecord?.name || 'Customer', email: email || customerRecord?.email || '', city: customerRecord?.city || '' };
    setRole(nextRole);
    setUser(nextUser);
    setCustomerAccount(customerRecord || null);
    setScreen('dashboard');
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setCustomerAccount(null);
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
          {screen === 'dashboard' && <Dashboard role={role} user={user} accountRecords={accountRecords} customerAccount={customerAccount} onNavigate={setScreen} selectedCustomer={selectedCustomer} setSelectedCustomer={setSelectedCustomer} />}
          {screen === 'history' && <History role={role} />}
          {screen === 'receipt' && <Receipt customer={customerAccount || accountRecords[0]} />}
          {screen === 'log-bill' && <LogBill onNavigate={setScreen} onSaveBill={saveBillRecord} />}
          {screen === 'profile' && <Profile user={user} onSave={setUser} onSignOut={signOut} />}
        </ScrollView>
        <Navigation role={role} screen={screen} onNavigate={setScreen} onSignOut={signOut} />
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
      const profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid));
      if (!profileSnapshot.exists()) {
        await firebaseSignOut(auth);
        setError('Your account profile is missing. Contact the system administrator.');
        return;
      }
      const profile = profileSnapshot.data();
      const profileRole = String(profile.role || '').trim().toLowerCase();

      if (role === roles.ADMIN) {
        if (profileRole !== roles.ADMIN) {
          await firebaseSignOut(auth);
          setError('This Firebase account profile does not have role "admin". Check users/{your-auth-uid} in Firestore.');
          return;
        }
        const savedBills = await loadBillsForUser(credential.user, true);
        setError('');
        onLogin(roles.ADMIN, profile.name || credential.user.displayName || credential.user.email, credential.user.email, null, savedBills);
        return;
      }

      if (profileRole !== roles.USER) {
        await firebaseSignOut(auth);
        setError('This account is not configured as a customer account.');
        return;
      }
      const savedBills = await loadBillsForUser(credential.user, false);
      const customerRecord = savedBills[0];
      if (!customerRecord) {
        await firebaseSignOut(auth);
        setError('Your account is signed in, but no bill is linked to this email yet. Contact the system administrator.');
        return;
      }
      setError('');
      onLogin(role, credential.user.displayName || credential.user.email, credential.user.email, customerRecord, savedBills);
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
          <Text style={styles.authHint}>Admin accounts are managed by the system administrator.</Text>
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

function Dashboard({ role, user, accountRecords, customerAccount, onNavigate, selectedCustomer, setSelectedCustomer }) {
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
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('GCash');
  const [showDemoPaymentQr, setShowDemoPaymentQr] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [adminSearch, setAdminSearch] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const filteredUsers = adminFilter === 'All'
    ? users
    : users.filter((item) => item.status === adminFilter);
  const paymentFilteredUsers = paymentFilter === 'All'
    ? filteredUsers
    : filteredUsers.filter((item) => item.paymentMethod === paymentFilter);
  const visibleUsers = adminSearch.trim()
    ? paymentFilteredUsers.filter((item) => `${item.id} ${item.name} ${item.email} ${item.barangay} ${item.city}`.toLowerCase().includes(adminSearch.trim().toLowerCase()))
    : paymentFilteredUsers;
  const customersByBarangay = Object.values(users.reduce((groups, item) => {
    if (!groups[item.barangay]) groups[item.barangay] = { name: item.barangay, customers: [] };
    groups[item.barangay].customers.push(item);
    return groups;
  }, {})).sort((a, b) => a.name.localeCompare(b.name));
  const barangayCustomers = selectedBarangay
    ? users.filter((item) => item.barangay === selectedBarangay)
    : [];

  function selectPaymentMethod(method) {
    setSelectedPaymentMethod(method);
    setShowDemoPaymentQr(true);
    setPaymentMessage('This QR will not make or confirm a payment.');
  }

  async function openSelectedWallet(method) {
    setPaymentMessage(`Opening ${method}...`);
    try {
      await openEwalletPayment(method);
      setPaymentMessage(`${method} opened. This does not process or confirm a payment.`);
    } catch {
      setPaymentMessage(`Unable to open ${method}. Please install the app or visit its website.`);
    }
  }

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
            <View style={styles.customerModalRow}><Text style={styles.customerModalLabel}>Payment method</Text><Text style={styles.customerModalValue}>{selectedCustomer.paymentMethod}</Text></View>
            <Pressable style={styles.payNowButton} onPress={() => openEwalletPayment(selectedCustomer.paymentMethod)}>
              <Text style={styles.payNowButtonText}>Pay with {selectedCustomer.paymentMethod}</Text>
            </Pressable>
            <Pressable style={styles.modalCloseButton} onPress={() => setSelectedCustomer(null)}>
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!isAdmin ? (
        <Card title="Payment method" subtitle="Choose a wallet to preview the payment QR">
          <View style={styles.paymentMethodRow}>
            {['GCash'].map((method) => (
              <Pressable key={method} style={[styles.paymentMethodChip, selectedPaymentMethod === method && styles.paymentMethodChipActive]} onPress={() => selectPaymentMethod(method)}>
                <Text style={[styles.paymentMethodChipText, selectedPaymentMethod === method && styles.paymentMethodChipTextActive]}>Pay With</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.billAmount}>Amount due: ₱{customerRecord.bill.toFixed(2)}</Text>
          {showDemoPaymentQr ? (
            <View style={styles.paymentQrPanel}>
              <Text style={styles.paymentQrTitle}>{selectedPaymentMethod} payment QR</Text>
              <View style={styles.paymentQrCode}>
                <QRCode
                  value={JSON.stringify({
                    type: 'BLUEBILL_DEMO_PAYMENT',
                    method: selectedPaymentMethod,
                    amount: customerRecord.bill.toFixed(2),
                    reference: customerRecord.id
                  })}
                  size={184}
                  color="#111827"
                  backgroundColor="#ffffff"
                />
              </View>
              <Text style={styles.paymentQrNotice}>This QR does not collect or verify payment.</Text>
              <Text style={styles.paymentWalletLabel}>Open an e-wallet</Text>
              <View style={styles.paymentWalletButtons}>
                {['GCash', 'Maya', 'GoTyme'].map((method) => (
                  <Pressable key={method} style={styles.paymentWalletButton} onPress={() => openSelectedWallet(method)}>
                    <Text style={styles.paymentWalletButtonText}>Open {method} app</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {paymentMessage ? <Text style={styles.paymentMessage}>{paymentMessage}</Text> : null}
        </Card>
      ) : null}
      <Card title={isAdmin ? 'Customer accounts' : 'Recent payments'} subtitle={isAdmin ? 'Accounts needing attention' : 'Your latest activity'}>
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
            <Text style={styles.filterGroupLabel}>Payment method</Text>
            <View style={styles.adminFilterRow}>
              {['All', 'GCash', 'Maya', 'GoTyme'].map((option) => (
                <Pressable key={option} style={[styles.filterChip, paymentFilter === option && styles.filterChipActive]} onPress={() => setPaymentFilter(option)}>
                  <Text style={[styles.filterChipText, paymentFilter === option && styles.filterChipTextActive]}>{option}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.adminTableWrap}>
              <View style={styles.adminTableHeader}>
                <Text style={styles.adminTableHeaderCell}>Tracking</Text>
                <Text style={styles.adminTableHeaderCell}>Name</Text>
                <Text style={styles.adminTableHeaderCell}>Barangay</Text>
                <Text style={styles.adminTableHeaderCell}>Status</Text>
                <Text style={styles.adminTableHeaderCell}>Method</Text>
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
                  <Text style={styles.adminTableCell}>{item.paymentMethod}</Text>
                  <Text style={styles.adminTableCell}>₱{item.bill.toFixed(2)}</Text>
                </Pressable>
              ))}
              {!visibleUsers.length ? <Text style={styles.emptyState}>No customer accounts match this search.</Text> : null}
            </View>
          </View>
        ) : (
          (history).map((item, index) => (
            <View style={styles.listRow} key={item.id || item.date}>
              <View style={styles.listIcon}><Text style={styles.listIconText}>₱</Text></View>
              <View style={styles.listMain}>
                <Text style={styles.listTitle}>{item.date}</Text>
                <Text style={styles.listSubtitle}>{item.status}</Text>
              </View>
              <Text style={styles.amount}>₱{item.amount.toFixed(2)}</Text>
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
      <Button label={isAdmin ? 'Log a new bill' : 'View receipt'} onPress={() => onNavigate(isAdmin ? 'log-bill' : 'receipt')} secondary />
    </View>
  );
}

function History({ role }) {
  const entries = role === roles.ADMIN ? users.map((item) => ({ date: item.name, amount: item.bill, status: item.status })) : history;
  return (
    <View>
      <Text style={styles.eyebrow}>ACTIVITY</Text>
      <Text style={styles.title}>Billing history</Text>
      <Text style={styles.muted}>A clear record of every account update.</Text>
      <Card>
        {entries.map((item, index) => (
          <View style={styles.historyRow} key={`${item.date}-${index}`}>
            <View><Text style={styles.listTitle}>{item.date}</Text><Text style={styles.listSubtitle}>{item.status}</Text></View>
            <Text style={styles.amount}>${item.amount.toFixed(2)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Receipt({ customer }) {
  const meterReading = calculateWaterBill(customer.previousReading, customer.currentReading);
  const [downloadMessage, setDownloadMessage] = useState('');

  function downloadReceipt() {
    downloadReceiptFile(meterReading, customer);
    setDownloadMessage('Receipt downloaded. You can print the HTML file or save it as PDF.');
  }

  return (
    <View>
      <Text style={styles.eyebrow}>CURRENT BILL</Text>
      <Text style={styles.title}>Your receipt</Text>
      <Card>
        <Text style={styles.receiptLabel}>Amount due</Text>
        <Text style={styles.receiptAmount}>₱{meterReading.amount.toFixed(2)}</Text>
        <View style={styles.divider} />
        <Detail label="Service period" value="Feb 01 - Feb 29, 2026" />
        <Detail label="Previous meter reading" value={`${customer.previousReading} m³`} />
        <Detail label="Current meter reading" value={`${customer.currentReading} m³`} />
        <Detail label="Water consumption" value={`${meterReading.consumption} m³`} />
        <Detail label="Rate" value={`₱${waterRatePerCubicMeter}/m³`} />
        <Detail label="Due date" value={customer.dueDate} />
        <Detail label="Service address" value={customer.address} />
        <StatusPill label="Pending" />
      </Card>
      <Button label="Download receipt" onPress={downloadReceipt} />
      {downloadMessage ? <Text style={styles.success}>{downloadMessage}</Text> : null}
    </View>
  );
}

function LogBill({ onNavigate, onSaveBill }) {
  const [customer, setCustomer] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [previousReading, setPreviousReading] = useState('');
  const [currentReading, setCurrentReading] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const meterReading = calculateWaterBill(previousReading, currentReading);

  async function saveBill() {
    if (saving) return;
    if (!customer.trim() || !email.trim() || !email.includes('@') || !location.trim() || !previousReading.trim() || !currentReading.trim()) {
      setMessage('Enter the customer name, valid account email, service location, and meter readings before saving.');
      return;
    }
    if (Number(currentReading) < Number(previousReading)) {
      setMessage('Current meter reading must be greater than the previous reading.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSaveBill({
        customer: customer.trim(),
        email: email.trim().toLowerCase(),
        location: location.trim(),
        previousReading: Number(previousReading),
        currentReading: Number(currentReading),
        amount: meterReading.amount
      });
    } catch (error) {
      setMessage(error.message || 'Unable to save bill permanently.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Text style={styles.eyebrow}>ADMIN TOOL</Text>
      <Text style={styles.title}>Log a bill</Text>
      <Text style={styles.muted}>Add a new charge to a Toledo City customer account.</Text>
      <Card>
        <Field label="Customer" value={customer} onChangeText={setCustomer} placeholder="Customer name" />
        <Field label="Customer account email" value={email} onChangeText={setEmail} placeholder="customer@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Location" value={location} onChangeText={setLocation} placeholder="Barangay, city, or service address" />
        <Field label="Previous meter reading (m³)" value={previousReading} onChangeText={setPreviousReading} placeholder="125" keyboardType="decimal-pad" />
        <Field label="Current meter reading (m³)" value={currentReading} onChangeText={setCurrentReading} placeholder="132" keyboardType="decimal-pad" />
        <View style={styles.calculationBox}>
          <Text style={styles.calculationTitle}>Bill calculation</Text>
          <Text style={styles.calculationText}>Consumption: {meterReading.consumption} m³</Text>
          <Text style={styles.calculationText}>Rate: ₱{waterRatePerCubicMeter}/m³</Text>
          <Text style={styles.calculationAmount}>Total: ₱{meterReading.amount.toFixed(2)}</Text>
        </View>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Button label={saving ? 'Saving...' : 'Save bill'} onPress={saveBill} />
      </Card>
      <Button label="Back to dashboard" onPress={() => onNavigate('dashboard')} secondary />
    </View>
  );
}

function Profile({ user, onSave, onSignOut }) {
  const [name, setName] = useState(user?.name || '');
  const [city, setCity] = useState(user?.city || '');
  const [message, setMessage] = useState('');
  return (
    <View>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.title}>Profile</Text>
      <Card>
        <Field label="Full name" value={name} onChangeText={setName} />
        <Field label="Email" value={user?.email || ''} editable={false} />
        <Field label="City or district" value={city} onChangeText={setCity} />
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <Button label="Save changes" onPress={() => { onSave({ ...user, name, city }); setMessage('Profile updated.'); }} />
      </Card>
      <Button label="Sign out" onPress={onSignOut} secondary />
    </View>
  );
}

function Navigation({ role, screen, onNavigate, onSignOut }) {
  const items = role === roles.ADMIN
    ? [['dashboard', 'Home'], ['log-bill', 'Log bill'], ['history', 'History'], ['profile', 'Profile']]
    : [['dashboard', 'Home'], ['receipt', 'Receipt'], ['history', 'History'], ['profile', 'Profile']];
  return (
    <View style={styles.navigation}>
      {items.map(([target, label]) => (
        <Pressable key={target} style={styles.navItem} onPress={() => onNavigate(target)}>
          <Text style={[styles.navLabel, screen === target && styles.navLabelActive]}>{label}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.navItem} onPress={onSignOut}><Text style={styles.navLabel}>Sign out</Text></Pressable>
    </View>
  );
}

function Card({ title, subtitle, children }) {
  return <View style={styles.card}>{title ? <Text style={styles.cardTitle}>{title}</Text> : null}{subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}{children}</View>;
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
  cardSubtitle: { color: colors.muted, fontSize: 14, marginTop: 4, marginBottom: 18 },
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
  payNowButton: { marginTop: 16, backgroundColor: '#10b981', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  payNowButtonText: { color: '#ffffff', fontWeight: '800' },
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
  paymentMethodRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  paymentMethodChip: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fafc', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  paymentMethodChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  paymentMethodChipText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  paymentMethodChipTextActive: { color: colors.primary },
  billAmount: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  paymentQrPanel: { alignItems: 'center', marginTop: 14, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: '#f8fafc' },
  paymentQrTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  paymentQrCode: { padding: 12, borderRadius: 8, backgroundColor: '#ffffff' },
  paymentQrNotice: { color: '#92400e', fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 12, textAlign: 'center' },
  paymentWalletLabel: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  paymentWalletButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  paymentWalletButton: { minWidth: 132, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, backgroundColor: '#ffffff', alignItems: 'center' },
  paymentWalletButtonText: { color: colors.primary, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  paymentMessage: { color: '#92400e', fontSize: 14, lineHeight: 20, marginTop: 10 },
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
  receiptLabel: { color: colors.muted, fontWeight: '700' },
  receiptAmount: { color: colors.text, fontSize: 42, fontWeight: '900', marginVertical: 8 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  detail: { paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailValue: { color: colors.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  status: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#fff7ed', marginTop: 12 },
  statusText: { color: '#c2410c', fontWeight: '800', fontSize: 12 },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 6 },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  navLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  navLabelActive: { color: colors.primary }
});
