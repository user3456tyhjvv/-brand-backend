require('dotenv').config({ debug: true });

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const paypal = require('@paypal/checkout-server-sdk'); // Add PayPal SDK
const app = express();


app.use(express.json());
const allowedOrigins = [
  'https://brandifyblog.web.app',
  'https://brand-backend-y2fk.onrender.com',
  'http://localhost:3000' // for development
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // This is important for cookies/sessions
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));
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
  try {
    // Verify credentials exist
    const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
    const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
    
    if (!consumerKey || !consumerSecret) {
      throw new Error('PesaPal credentials not configured');
    }

    // Generate OAuth parameters
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Create parameter string
    const params = new URLSearchParams();
    params.append('oauth_consumer_key', consumerKey);
    params.append('oauth_nonce', nonce);
    params.append('oauth_signature_method', 'HMAC-SHA1');
    params.append('oauth_timestamp', timestamp.toString());
    params.append('oauth_version', '1.0');
    
    // Create base string
    const baseString = `POST&${encodeURIComponent(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`)}&${encodeURIComponent(params.toString())}`;
    
    // Create signing key
    const signingKey = `${encodeURIComponent(consumerSecret)}&`;
    
    // Generate signature
    const signature = crypto
      .createHmac('sha1', signingKey)
      .update(baseString)
      .digest('base64');

    // Construct authorization header
    return `OAuth oauth_consumer_key="${consumerKey}", oauth_nonce="${nonce}", oauth_signature="${encodeURIComponent(signature)}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${timestamp}", oauth_version="1.0"`;
  } catch (error) {
    console.error('Error generating PesaPal auth header:', error);
    throw error;
  }
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
    console.log('Received request to create PesaPal order:', req.body);
    
    const { amount, currency, planId, planName, customerEmail, customerName } = req.body;
    
    // Validate required fields
    if (!amount || !currency || !customerEmail) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['amount', 'currency', 'customerEmail']
      });
    }

    // Generate unique order ID
    const orderId = `BRANDIFY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    console.log('Attempting to authenticate with PesaPal...');
    
    // Get auth token with enhanced error handling
    const authHeader = getPesaPalAuthHeader();
    console.log('Generated auth header:', authHeader);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const authResponse = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    console.log('Auth response status:', authResponse.status);
    
    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('Full auth error response:', errorText);
      throw new Error(`PesaPal auth failed: ${authResponse.status} - ${errorText}`);
    }
    
    const authData = await authResponse.json();
    console.log('Auth response data:', authData);
    
    if (!authData.token) {
      console.error('Invalid auth response:', authData);
      throw new Error('PesaPal did not return an access token');
    }
    
    const accessToken = authData.token;
    console.log('Successfully obtained PesaPal access token');
    
    const orderData = {
      id: orderId,
      currency,
      amount,
      description: `${planName || 'Plan'} Subscription`,
      callback_url: process.env.PESAPAL_CALLBACK_URL || "https://brandifyblog.web.app/pesapal-callback",
      notification_id: process.env.PESAPAL_IPN_URL || "https://brand-backend-y2fk.onrender.com/api/pesapal-ipn",
      billing_address: {
        email_address: customerEmail,
        phone_number: "",
        country_code: "",
        first_name: customerName?.split(' ')[0] || "Customer",
        middle_name: "",
        last_name: customerName?.split(' ')[1] || "",
        line_1: "",
        line_2: "",
        city: "",
        state: "",
        postal_code: "",
        zip_code: ""
      }
    };
    
    console.log('Submitting order to PesaPal:', orderData);
    
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
    
    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      console.error('PesaPal order submission failed:', orderResponse.status, errorText);
      throw new Error(`PesaPal order submission failed: ${orderResponse.status} - ${errorText}`);
    }
    
    const orderResult = await orderResponse.json();
    console.log('PesaPal order created successfully:', orderResult);
    
    // Validate the response contains redirect_url
    if (!orderResult.redirect_url) {
      throw new Error('PesaPal did not return a redirect URL');
    }
    
    // Save order to Firestore
    const orderRef = db.collection('pesapalOrders').doc(orderId);
    await orderRef.set({
      orderId,
      amount,
      currency,
      planId: planId || null,
      planName: planName || null,
      customerEmail,
      customerName: customerName || null,
      status: 'PENDING',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      redirectUrl: orderResult.redirect_url
    }, { merge: true, ignoreUndefinedProperties: true });
    
    res.json({
      iframeUrl: orderResult.redirect_url,
      orderId,
      message: 'PesaPal order created successfully'
    });
    console.timeEnd('PesaPalOrderCreation');
  } catch (error) {
    console.error('PesaPal order creation error:', error);
    res.status(500).json({ 
      message: 'Failed to create PesaPal order',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/pesapal-payment-status', async (req, res) => {
  try {
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' });
    }

    console.log('Attempting to authenticate with PesaPal for status check...');
    
    // Get auth token
    const authHeader = getPesaPalAuthHeader();
    const authResponse = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Cache-Control': 'no-cache'
      }
    });

    if (!authResponse.ok) {
      const errorData = await authResponse.json();
      console.error('PesaPal auth error details:', errorData);
      throw new Error(`PesaPal auth failed: ${authResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const authData = await authResponse.json();

    if (!authData.token) {
      console.error('PesaPal auth response:', authData);
      throw new Error('PesaPal did not return an access token');
    }

    const accessToken = authData.token;
    console.log('Successfully obtained access token for status check');
    
    // Get transaction status
    const statusResponse = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderId}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('Status check failed:', statusResponse.status, errorText);
      throw new Error(`Status check failed: ${statusResponse.status} - ${errorText}`);
    }
    
    const statusData = await statusResponse.json();
    console.log('Payment status:', statusData);
    
    // Update Firestore with new status
    if (statusData.payment_status) {
      const orderRef = db.collection('pesapalOrders').doc(orderId);
      await orderRef.update({
        status: statusData.payment_status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    res.json({ 
      status: statusData.payment_status,
      details: statusData
    });
    
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
// Add this to your backend
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.path}`);
  const start = Date.now();
  res.on('finish', () => {
    console.log(`Request completed in ${Date.now() - start}ms`);
  });
  next();
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
PORT=3001
// Start Server
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
