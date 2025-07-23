const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());



admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});


const db = admin.firestore();

app.use(cors({
  origin: "https://brandifyblog.web.app", 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// === EXISTING ROUTE: /index (Developer registration + custom token) ===
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

// === ✅ NEW ROUTE: /getCustomToken (Reusable endpoint for known UID) ===
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

// === ERROR HANDLING ===
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// === 404 HANDLING ===
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// === START SERVER ===
app.listen(3001, () => console.log("🚀 API running on http://localhost:3001"));
