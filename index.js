require('dotenv').config({ debug: true });

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const paypal = require('@paypal/checkout-server-sdk'); // Add PayPal SDK
const app = express();

app.use(cors());
app.use(express.json());

console.log("Loaded environment variables:", {
  FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  PAYPAL_CLIENT_ID: !!process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: !!process.env.PAYPAL_CLIENT_SECRET,
  PESAPAL_CONSUMER_KEY: !!process.env.PESAPAL_CONSUMER_KEY,
  PESAPAL_CONSUMER_SECRET: !!process.env.PESAPAL_CONSUMER_SECRET,
});

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();
const allowedOrigins = [
  "https://brandifyblog.web.app",
   "https://brand-backend-y2fk.onrender.com"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// ===========================
// PayPal Configuration
// ===========================
function paypalEnvironment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  return process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment());

// ===========================
// PesaPal Helper Functions
// ===========================
function getPesaPalAuthHeader() {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const data = Buffer.from(
    `pesapal_request_data&oauth_consumer_key=${process.env.PESAPAL_CONSUMER_KEY}&oauth_nonce=${nonce}&oauth_signature_method=HMAC-SHA1&oauth_timestamp=${timestamp}&oauth_version=1.0`,
    'utf-8'
  );
  
  const key = `${process.env.PESAPAL_CONSUMER_SECRET}&`;
  const signature = crypto.createHmac('sha1', key).update(data).digest('base64');
  
  return `OAuth oauth_consumer_key="${process.env.PESAPAL_CONSUMER_KEY}", oauth_nonce="${nonce}", oauth_signature="${encodeURIComponent(signature)}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${timestamp}", oauth_version="1.0"`;
}

// ===========================
// Payment Routes
// ===========================

// ---------------------------
// PesaPal Routes
// ---------------------------
const PESAPAL_BASE_URL = process.env.PESAPAL_ENV === 'production' 
  ? 'https://pay.pesapal.com/v3' 
  : 'https://cybqa.pesapal.com/pesapalv3';

// Create PesaPal Order
app.post('/api/create-pesapal-order', async (req, res) => {
  try {
    const { amount, currency, planId, planName, customerEmail, customerName } = req.body;
    
    // Generate unique order ID
    const orderId = `BRANDIFY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const orderData = {
      id: orderId,
      currency,
      amount,
      description: `${planName} Plan Subscription`,
      callback_url: "https://brandifyblog.web.app/pesapal-callback", 
      notification_id: "https://brandifyblog.web.app/api/pesapal-ipn", 
      billing_address: {
        email_address: customerEmail,
        phone_number: "",
        country_code: "",
        first_name: customerName.split(' ')[0] || "Customer",
        middle_name: "",
        last_name: customerName.split(' ')[1] || "",
        line_1: "",
        line_2: "",
        city: "",
        state: "",
        postal_code: "",
        zip_code: ""
      }
    };
    
    // Get auth token
    const authResponse = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': getPesaPalAuthHeader()
      }
    });
    
    const authData = await authResponse.json();
    const accessToken = authData.token;
    
    // Submit order
    const orderResponse = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(orderData)
    });
    
    const orderResult = await orderResponse.json();
    
    // Save order to Firestore
    const orderRef = db.collection('pesapalOrders').doc(orderId);
    await orderRef.set({
      orderId,
      amount,
      currency,
      planId,
      planName,
      customerEmail,
      customerName,
      status: 'PENDING',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      redirectUrl: orderResult.redirect_url
    });
    
    res.json({
      iframeUrl: orderResult.redirect_url,
      orderId
    });
    
  } catch (error) {
    console.error('PesaPal order creation error:', error);
    res.status(500).json({ 
      message: 'Failed to create PesaPal order', 
      error: error.message 
    });
  }
});

// Check PesaPal Payment Status
app.get('/api/pesapal-payment-status', async (req, res) => {
  try {
    const { orderId } = req.query;
    
    // Get auth token
    const authResponse = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': getPesaPalAuthHeader()
      }
    });
    
    const authData = await authResponse.json();
    const accessToken = authData.token;
    
    // Get transaction status
    const statusResponse = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderId}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const statusData = await statusResponse.json();
    
    // Update Firestore with new status
    if (statusData.payment_status) {
      const orderRef = db.collection('pesapalOrders').doc(orderId);
      await orderRef.update({
        status: statusData.payment_status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.json({ status: statusData.payment_status });
    
  } catch (error) {
    console.error('PesaPal status check error:', error);
    res.status(500).json({ 
      message: 'Failed to check payment status', 
      error: error.message 
    });
  }
});

// PesaPal IPN Handler
app.post('/api/pesapal-ipn', async (req, res) => {
  const { order_tracking_id, payment_status } = req.body;
  console.log(`PesaPal IPN: Order ${order_tracking_id} status: ${payment_status}`);
  
  try {
    const orderRef = db.collection('pesapalOrders').doc(order_tracking_id);
    await orderRef.update({
      status: payment_status,
      ipnReceivedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Additional business logic for completed payments
    if (payment_status === 'COMPLETED') {
      const orderDoc = await orderRef.get();
      const orderData = orderDoc.data();
      
      // Save payment record to main payments collection
      await db.collection('payments').add({
        userId: '', // Add user ID if available
        email: orderData.customerEmail,
        planId: orderData.planId,
        planName: orderData.planName,
        amount: orderData.amount,
        currency: orderData.currency,
        paymentMethod: 'pesapal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        orderId: order_tracking_id
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling PesaPal IPN:', error);
    res.status(500).send('Error processing IPN');
  }
});

// ---------------------------
// PayPal Routes
// ---------------------------

// Create PayPal Order
app.post('/api/create-paypal-order', async (req, res) => {
  try {
    const { amount, currency, planId, planName } = req.body;
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString()
        },
        description: `${planName} Plan Subscription`,
        custom_id: planId
      }],
      application_context: {
        brand_name: 'Brandify',
        user_action: 'PAY_NOW',
        return_url: 'https://brandifyblog.web.app/paypal-success', 
        cancel_url: 'https://brandifyblog.web.app/paypal-cancel'  
      }
    });

    const order = await paypalClient.execute(request);
    
    // Save order to Firestore
    const orderRef = db.collection('paypalOrders').doc(order.result.id);
    await orderRef.set({
      orderId: order.result.id,
      amount,
      currency,
      planId,
      planName,
      status: 'CREATED',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paypalData: order.result
    });

    res.json({ orderID: order.result.id });
  } catch (err) {
    console.error('PayPal order creation error:', err);
    res.status(500).json({ 
      message: 'Failed to create PayPal order', 
      error: err.message 
    });
  }
});

// Capture PayPal Order
app.post('/api/capture-paypal-order', async (req, res) => {
  try {
    const { orderID } = req.body;
    
    // Capture the payment
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    const capture = await paypalClient.execute(request);
    
    // Get order data from Firestore
    const orderRef = db.collection('paypalOrders').doc(orderID);
    const orderDoc = await orderRef.get();
    const orderData = orderDoc.data();
    
    // Update order status
    await orderRef.update({
      status: 'COMPLETED',
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      captureData: capture.result
    });
    
    // Save payment to main payments collection
    const paymentData = {
      userId: '', // Add user ID if available
      email: capture.result.payer.email_address,
      planId: orderData.planId,
      planName: orderData.planName,
      amount: orderData.amount,
      currency: orderData.currency,
      paymentMethod: 'paypal',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed',
      orderId: orderID,
      transactionId: capture.result.purchase_units[0].payments.captures[0].id
    };
    
    await db.collection('payments').add(paymentData);
    
    res.json({ success: true, paymentData });
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ 
      message: 'Failed to capture PayPal payment', 
      error: err.message 
    });
  }
});

// ===========================
// Existing Routes
// ===========================

// Developer registration + custom token
app.post("/index", async (req, res) => {
  const { tag, managerEmail } = req.body;

  if (!tag) {
    return res.status(400).json({ error: "Missing tag parameter" });
  }

  const uid = `dev-${Date.now()}`;

  try {
    await admin.auth().createUser({ uid });
    const customToken = await admin.auth().createCustomToken(uid);

    const tagDoc = {
      tag,
      assignedTo: uid,
      createdBy: managerEmail || "system@admin",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
      customToken,
    };

    const userDoc = {
      name: "Developer",
      tag,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isManager: false,
    };

    const batch = db.batch();
    const tagRef = db.collection("developerTags").doc(tag);
    const userRef = db.collection("users").doc(uid);

    batch.set(tagRef, tagDoc);
    batch.set(userRef, userDoc);
    await batch.commit();

    return res.json({ success: true, uid, tag, customToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// Reusable endpoint for known UID
app.post("/getCustomToken", async (req, res) => {
  const { uid } = req.body;

  if (!uid) {
    return res.status(400).json({ error: "UID required" });
  }

  try {
    const customToken = await admin.auth().createCustomToken(uid);
    return res.json({ token: customToken });
  } catch (error) {
    console.error("❌ Token generation failed:", error.message);
    return res.status(500).json({ error: "Failed to generate custom token" });
  }
});

// ===========================
// Error Handling
// ===========================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
