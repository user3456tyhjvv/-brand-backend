// Fixed PesaPal backend code - Add this to your backend server.js

require('dotenv').config({ debug: true });

const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const paypal = require('@paypal/checkout-server-sdk');

const app = express();

// Basic middleware
app.use(express.json());

console.log("Loaded environment variables:", {
  FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  PAYPAL_CLIENT_ID: !!process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: !!process.env.PAYPAL_CLIENT_SECRET,
  PESAPAL_CONSUMER_KEY: !!process.env.PESAPAL_CONSUMER_KEY,
  PESAPAL_CONSUMER_SECRET: !!process.env.PESAPAL_CONSUMER_SECRET,
  PESAPAL_ENV: process.env.PESAPAL_ENV || 'sandbox'
});

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// CORS Configuration
const allowedOrigins = [
  'https://brandifyblog.web.app',
  'https://brand-backend-y2fk.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001'
];

const corsOptions = {
  origin: function (origin, callback) {
    console.log('Request origin:', origin);
    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      console.log('Origin allowed:', origin);
      callback(null, true);
    } else {
      console.log('Origin blocked:', origin);
      callback(null, true); // Allow all origins for debugging
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Additional CORS headers middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return res.sendStatus(200);
  }
  next();
});

// PayPal Configuration (unchanged)
function paypalEnvironment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  return process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment());

// PesaPal Configuration - FIXED
const PESAPAL_BASE_URL = process.env.PESAPAL_ENV === 'production' 
  ? 'https://pay.pesapal.com/v3' 
  : 'https://cybqa.pesapal.com/pesapalv3';

console.log('Using PesaPal environment:', process.env.PESAPAL_ENV || 'sandbox');
console.log('PesaPal Base URL:', PESAPAL_BASE_URL);

// FIXED: PesaPal uses different auth method
async function getPesaPalToken() {
  try {
    const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
    const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
    
    if (!consumerKey || !consumerSecret) {
      throw new Error('PesaPal credentials not configured');
    }

    console.log('Getting PesaPal token...');
    
    const response = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        consumer_key: consumerKey,
        consumer_secret: consumerSecret
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('PesaPal auth response:', errorText);
      throw new Error(`PesaPal auth failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('PesaPal auth response:', data);
    
    if (!data.token) {
      throw new Error('PesaPal did not return a token');
    }

    return data.token;
  } catch (error) {
    console.error('Error getting PesaPal token:', error);
    throw error;
  }
}

// Enhanced logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// Basic routes
app.get('/', (req, res) => {
  res.json({ message: 'Brandify Backend API', status: 'running', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/cors-test', (req, res) => {
  res.json({ 
    message: 'CORS is working!', 
    origin: req.headers.origin,
    timestamp: new Date().toISOString() 
  });
});

// FIXED: PesaPal order creation
app.post('/api/create-pesapal-order', async (req, res) => {
  try {
    console.log('Creating PesaPal order:', req.body);
    console.log('Request headers:', req.headers);
    
    const { amount, currency, planId, planName, customerEmail, customerName } = req.body;
    
    if (!amount || !currency || !customerEmail) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['amount', 'currency', 'customerEmail']
      });
    }

    const orderId = `BRANDIFY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Get access token
    const accessToken = await getPesaPalToken();
    console.log('Got access token:', accessToken.substring(0, 20) + '...');
    
    // Register IPN URL if needed
    try {
      const ipnResponse = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/RegisterIPN`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          url: process.env.PESAPAL_IPN_URL,
          ipn_notification_type: "GET"
        })
      });
      
      if (ipnResponse.ok) {
        const ipnData = await ipnResponse.json();
        console.log('IPN registered:', ipnData);
      }
    } catch (ipnError) {
      console.warn('IPN registration failed (non-critical):', ipnError.message);
    }
    
    // Create the order
    const orderData = {
      id: orderId,
      currency,
      amount: parseFloat(amount),
      description: `${planName || 'Plan'} Subscription`,
      callback_url: process.env.PESAPAL_CALLBACK_URL || "https://brandifyblog.web.app/pesapal-callback",
      notification_id: process.env.PESAPAL_NOTIFICATION_ID || "",
      billing_address: {
        email_address: customerEmail,
        phone_number: "",
        country_code: "KE",
        first_name: customerName?.split(' ')[0] || "Customer",
        middle_name: "",
        last_name: customerName?.split(' ').slice(1).join(' ') || "",
        line_1: "",
        line_2: "",
        city: "",
        state: "",
        postal_code: "",
        zip_code: ""
      }
    };
    
    console.log('Submitting order to PesaPal:', orderData);
    
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
      console.error('PesaPal order submission failed:', errorText);
      throw new Error(`PesaPal order submission failed: ${orderResponse.status} - ${errorText}`);
    }
    
    const orderResult = await orderResponse.json();
    console.log('PesaPal order result:', orderResult);
    
    if (!orderResult.redirect_url) {
      throw new Error('PesaPal did not return a redirect URL');
    }
    
    // Save order to Firestore
    const orderRef = db.collection('pesapalOrders').doc(orderId);
    await orderRef.set({
      orderId,
      amount: parseFloat(amount),
      currency,
      planId: planId || null,
      planName: planName || null,
      customerEmail,
      customerName: customerName || null,
      status: 'PENDING',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      redirectUrl: orderResult.redirect_url,
      pesapalOrderId: orderResult.order_tracking_id
    });
    
    res.json({
      iframeUrl: orderResult.redirect_url,
      orderId,
      pesapalOrderId: orderResult.order_tracking_id,
      message: 'PesaPal order created successfully'
    });
  } catch (error) {
    console.error('PesaPal order creation error:', error);
    res.status(500).json({ 
      message: 'Failed to create PesaPal order',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// FIXED: PesaPal payment status check
app.get('/api/pesapal-payment-status', async (req, res) => {
  try {
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({ message: 'orderId is required' });
    }

    console.log('Checking payment status for order:', orderId);

    // Get the order from Firestore to get the PesaPal order ID
    const orderDoc = await db.collection('pesapalOrders').doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const orderData = orderDoc.data();
    const pesapalOrderId = orderData.pesapalOrderId || orderId;

    const accessToken = await getPesaPalToken();
    
    const statusResponse = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${pesapalOrderId}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error('Status check failed:', errorText);
      throw new Error(`Status check failed: ${statusResponse.status} - ${errorText}`);
    }
    
    const statusData = await statusResponse.json();
    console.log('Payment status:', statusData);
    
    // Update order status in Firestore
    if (statusData.payment_status) {
      await db.collection('pesapalOrders').doc(orderId).update({
        status: statusData.payment_status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusDetails: statusData
      });
    }
    
    res.json({ 
      status: statusData.payment_status || 'PENDING',
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

// PesaPal IPN handler
app.post('/api/pesapal-ipn', async (req, res) => {
  const { order_tracking_id, payment_status } = req.body;
  console.log(`PesaPal IPN: Order ${order_tracking_id} status: ${payment_status}`);
  
  try {
    // Find the order by PesaPal order ID
    const ordersSnapshot = await db.collection('pesapalOrders')
      .where('pesapalOrderId', '==', order_tracking_id)
      .get();
    
    if (ordersSnapshot.empty) {
      console.error('Order not found for PesaPal ID:', order_tracking_id);
      return res.status(404).send('Order not found');
    }

    const orderDoc = ordersSnapshot.docs[0];
    const orderData = orderDoc.data();
    
    await orderDoc.ref.update({
      status: payment_status,
      ipnReceivedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // If payment is completed, create payment record
    if (payment_status === 'COMPLETED') {
      await db.collection('payments').add({
        userId: '',
        email: orderData.customerEmail,
        planId: orderData.planId,
        planName: orderData.planName,
        amount: orderData.amount,
        currency: orderData.currency,
        paymentMethod: 'pesapal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'completed',
        orderId: orderDoc.id,
        pesapalOrderId: order_tracking_id
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling PesaPal IPN:', error);
    res.status(500).send('Error processing IPN');
  }
});

// GET endpoint for PesaPal IPN (some configurations use GET)
app.get('/api/pesapal-ipn', async (req, res) => {
  const { OrderTrackingId, OrderNotificationType } = req.query;
  console.log(`PesaPal IPN (GET): Order ${OrderTrackingId} type: ${OrderNotificationType}`);
  
  try {
    if (OrderTrackingId) {
      // Check the payment status
      const accessToken = await getPesaPalToken();
      
      const statusResponse = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        
        // Find and update the order
        const ordersSnapshot = await db.collection('pesapalOrders')
          .where('pesapalOrderId', '==', OrderTrackingId)
          .get();
        
        if (!ordersSnapshot.empty) {
          const orderDoc = ordersSnapshot.docs[0];
          await orderDoc.ref.update({
            status: statusData.payment_status,
            ipnReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
            statusDetails: statusData
          });
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling PesaPal IPN (GET):', error);
    res.status(500).send('Error processing IPN');
  }
});

// PayPal Routes (unchanged)
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

app.post('/api/capture-paypal-order', async (req, res) => {
  try {
    const { orderID } = req.body;
    
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    const capture = await paypalClient.execute(request);
    
    const orderRef = db.collection('paypalOrders').doc(orderID);
    const orderDoc = await orderRef.get();
    const orderData = orderDoc.data();
    
    await orderRef.update({
      status: 'COMPLETED',
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      captureData: capture.result
    });
    
    const paymentData = {
      userId: '',
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

// Developer registration routes (unchanged)
app.post('/index', async (req, res) => {
  try {
    const { tag, managerEmail } = req.body;

    if (!tag) {
      return res.status(400).json({ error: "Missing tag parameter" });
    }

    const uid = `dev-${Date.now()}`;

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

app.post('/getCustomToken', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ error: "UID required" });
    }

    const customToken = await admin.auth().createCustomToken(uid);
    return res.json({ token: customToken });
  } catch (error) {
    console.error("Token generation failed:", error.message);
    return res.status(500).json({ error: "Failed to generate custom token" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  res.status(500).json({ error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Server successfully started on port ${PORT}`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log('✅ Enhanced CORS configuration applied');
  console.log('✅ Fixed PesaPal integration ready');
});