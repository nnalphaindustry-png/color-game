const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const corsOptions = {
    origin: "*", // सभी डोमेन और लोकल स्टोरेज को अनुमति दें
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],
    credentials: true
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(path.join(__dirname, '')));

// पुराना डेटा उठाने के लिए बिल्कुल सटीक User Schema
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    requiredWager: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    isFirstDepositDone: { type: Boolean, default: false },
    referredBy: { type: String, default: null },
    promoBalance: { type: Number, default: 0 },
    totalCommissionEarned: { type: Number, default: 0 },
    claimedMissions: { type: [Number], default: [] },
    selfSpinCount: { type: Number, default: 0 },
    referralSpinCount: { type: Number, default: 0 },
    lastDepositAmount: { type: Number, default: 0 },
    lastRefDepositAmount: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const betSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    period: { type: String, required: true },
    mode: { type: String, required: true },
    selectValue: { type: String, required: true },
    amount: { type: Number, required: true },
    winAmount: { type: Number, default: 0 },
    status: { type: String, default: 'PENDING' },
    socketId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

const gameHistorySchema = new mongoose.Schema({
    mode: { type: String, required: true },
    period: { type: String, required: true },
    number: { type: Number, required: true },
    bigSmall: { type: String, required: true },
    color: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const GameHistory = mongoose.model('GameHistory', gameHistorySchema);

const depositSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    utrNumber: { type: String, required: true, unique: true },
    status: { type: String, default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const withdrawSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    details: { type: String, required: true },
    status: { type: String, default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);
// नए गेम का 100% वर्किंग रजिस्ट्रेशन रूट जो इनवाइट कोड भी चेक करेगा
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, ref } = req.body;
        const exists = await User.findOne({ phone });
        if (exists) return res.json({ success: false, message: "This mobile number is already registered!" });

        let referrer = null;
        if (ref && ref.trim() !== "" && ref !== "null" && ref !== "undefined") {
            const checkReferrer = await User.findOne({ phone: ref });
            if (checkReferrer) { referrer = ref; }
        }

        const newUser = new User({
            phone,
            password,
            balance: 70, // नए मेंबर्स के लिए ₹70 का वेलकम बोनस
            referredBy: referrer
        });
        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during registration!" });
    }
});

// पुराना डेटा उठाने और मैच करने वाला पक्का लॉगिन रूट
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.json({ success: false, message: "Invalid mobile number or password!" });
        
        // लॉगिन सफल होने पर पुराना बैलेंस और नंबर दोनों वापस भेजेगा
        res.json({ success: true, phone: user.phone, balance: user.balance, message: "Login successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during login!" });
    }
});

// === अपनी server.js के लाइन 138 से 154 वाले हिस्से को इससे बदल दो ===
app.get('/api/balance/:phone', async (req, res) => {
    // हर रिक्वेस्ट को पास करने के लिए रिस्पॉन्स हेडर्स को यहीं लॉक कर देते हैं
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) {
            return res.json({ success: false, message: "User not found!" });
        }
        
        // सीधे बिना किसी तामझाम के डेटा वापस भेजना
        return res.json({
            success: true,
            balance: Number(user.balance || 0),
            requiredWager: Number(user.requiredWager || 0)
        });
    } catch (err) {
        console.error("Balance fetching server error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post('/api/deposit/submit', async (req, res) => {
    try {
        // फ्रंटएंड से utrNumber या utrnumber दोनों में से जो भी आए, उसे उठा लो
        const { phone, amount, utrNumber, utrnumber } = req.body;
        const finalUTR = (utrNumber || utrnumber || "").toString().trim();

        if (!finalUTR || finalUTR.length !== 12) {
            return res.status(400).json({ success: false, message: "Invalid UTR! Must be exactly 12 digits." });
        }

        const utrExists = await Deposit.findOne({ utrNumber: finalUTR });
        if (utrExists) {
            return res.json({ success: false, message: "This UTR Number has already been submitted!" });
        }

        // इसे बदलें (Corrected Code)
const newDeposit = new Deposit({
    phone: phone,
    amount: Number(amount),
    utrNumber: finalUTR, // <--- utrNumber.trim() की जगह finalUTR लिखें
    status: 'PENDING'
});

        await newDeposit.save();
        res.json({ success: true, message: "Deposit request filed successfully! Waiting for admin approval." });

    } catch (err) {
        console.error("Deposit submission error:", err);
        res.status(500).json({ success: false, message: "Server error during deposit submission!" });
    }
});
// === टेस्टिंग के लिए: यह रूट डेटाबेस का सारा डेटा खींचकर दिखाएगा ===
app.get('/api/admin/deposits/pending', async (req, res) => {
    try {
        // यहाँ से { status: 'PENDING' } हटा दिया है ताकि सारा पुराना डेटा भी दिखे
        const pendingRequests = await Deposit.find({}).sort({ createdAt: -1 });
        res.json({ success: true, data: pendingRequests });
    } catch (err) {
        console.error("Pending list fetch error:", err);
        res.status(500).json({ success: false, message: "Server error fetching list" });
    }
});

// === अपनी server.js में पुराने approve रूट को इस कोड से बदलें ===
app.post('/api/admin/deposit/approve', async (req, res) => {
    try {
        const { utrNumber } = req.body;

        // 1. पहले वो डिपॉजिट रिक्वेस्ट ढूंढो जो पेंडिंग हो
        const depositOrder = await Deposit.findOne({ utrNumber: utrNumber });
        if (!depositOrder) {
            return res.json({ success: false, message: "Deposit request order not found!" });
        }

        if (depositOrder.status === 'SUCCESS') {
            return res.json({ success: false, message: "This order is already approved!" });
        }

        // 2. यूजर के वॉलेट में पैसे बढ़ाओ ($inc का इस्तेमाल करके)
        const playerPhone = depositOrder.phone;
        const depositAmount = Number(depositOrder.amount);

        const userUpdate = await User.findOneAndUpdate(
            { phone: playerPhone },
            { $inc: { balance: depositAmount } }, // यह सीधे पुराने बैलेंस में अमाउंट प्लस कर देगा
            { new: true } // अपडेटेड डेटा रिटर्न करेगा
        );

        if (!userUpdate) {
            return res.json({ success: false, message: "User account not found to credit balance!" });
        }

        // 3. डिपॉजिट का स्टेटस SUCCESS करो
        depositOrder.status = 'SUCCESS';
        await depositOrder.save();

        console.log(`✅ Success! credited ₹${depositAmount} to ${playerPhone}`);
        res.json({ success: true, message: `Successfully approved & credited ₹${depositAmount}!` });

    } catch (err) {
        console.error("Approval critical error:", err);
        res.status(500).json({ success: false, message: "Internal server error during approval" });
    }
});


// फाइलों के डायरेक्ट राउट्स
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
// यह गेम स्टेट्स का डेटा है जो गेम चलाने में काम आता है
let gameStates = {
    '30s': { countdown: 30, period: "2026071210001", history: [] },
    '1m': { countdown: 60, period: "2026071230001", history: [] },
    '3m': { countdown: 180, period: "2026071250001", history: [] },
    '5m': { countdown: 300, period: "2026071270001", history: [] }
};

// सॉकेट कनेक्शन हैंडलर (भविष्य में लाइव बेटिंग के लिए)
io.on('connection', (socket) => {
    socket.emit('all_modes_state', gameStates);
    socket.on('disconnect', () => {});
});

// अब यहाँ कोई असली पासवर्ड या लिंक नहीं है! यह सीधे तुम्हारी .env फाइल से वैल्यू उठाएगा
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("गड़बड़ है भाई! तुम्हारी .env फाइल में MONGO_URI नहीं मिल रहा है।");
    process.exit(1);
}

// मोंगोडीबी लाइव कनेक्शन ब्लॉक
mongoose.connect(MONGO_URI)
.then(() => {
    console.log("91 GOA CLUB Engine: MongoDB Atlas Connected Securely via .env!");
    server.listen(PORT, () => {
        console.log(`Server engine running tightly on port ${PORT}`);
    });
})
.catch(err => console.error("Database connection failure:", err));
