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

app.use(express.json());
app.use(cors());

// लोकल फोन प्रिव्यूअर ऐप और डार्क मोड एनवायरनमेंट से डेटा लोड करने के लिए कस्टमाइज्ड हेडर्स
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
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

// यूजर का लाइव बैलेंस खींचने का रूट जो home.html पर काम आएगा
app.get('/api/balance/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) return res.json({ success: false, message: "User not found!" });
        res.json({ success: true, balance: user.balance, requiredWager: user.requiredWager || 0 });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error fetching balance!" });
    }
});
app.post('/api/deposit/submit', async (req, res) => {
    try {
        const { phone, amount, utrNumber } = req.body;

        if (!utrNumber || utrNumber.trim().length !== 12) {
            return res.json({ success: false, message: "Invalid UTR! Must be exactly 12 digits." });
        }

        const utrExists = await Deposit.findOne({ utrNumber: utrNumber.trim() });
        if (utrExists) {
            return res.json({ success: false, message: "This UTR Number has already been submitted!" });
        }

        const newDeposit = new Deposit({
            phone: phone,
            amount: Number(amount),
            utrNumber: utrNumber.trim(),
            status: 'PENDING'
        });

        await newDeposit.save();
        res.json({ success: true, message: "Deposit request filed successfully! Waiting for admin approval." });

    } catch (err) {
        console.error("Deposit submission error:", err);
        res.status(500).json({ success: false, message: "Server error during deposit submission!" });
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
