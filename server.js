const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", credentials: true }));


// === USER SCHEMA ===
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, default: "" },
    balance: { type: Number, default: 70 }, 
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);
const periodSchema = new mongoose.Schema({ gameMode: String, periodId: String, resultNumber: Number, resultColor: String, resultSize: String, createdAt: { type: Date, default: Date.now } });
const Period = mongoose.model('Period', periodSchema);
const betSchema = new mongoose.Schema({ phone: String, gameMode: String, periodId: String, selectValue: String, betAmount: Number, winAmount: { type: Number, default: 0 }, status: { type: String, default: "Pending" }, createdAt: { type: Date, default: Date.now } });
const Bet = mongoose.model('Bet', betSchema);

// === LIVE DATABASE STATUS ROUTE ===
// इसे ब्राउज़र में खोलकर आप चेक कर सकते हैं कि डेटाबेस कनेक्टेड है या नहीं
app.get('/api/db-status', (req, res) => {
    const states = ["Disconnected", "Connected", "Connecting", "Disconnecting"];
    const statusNum = mongoose.connection.readyState; // मोंगोडीबी की स्थिति जांचें
    
    if (statusNum === 1) {
        return res.json({ success: true, status: states[statusNum], message: "Database is fully connected!" });
    } else {
        return res.json({ success: false, status: states[statusNum], message: "Database is NOT connected!" });
    }
});

// === REGISTER ROUTE ===
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, confirmPassword, inviteCode } = req.body;
        if (!phone || !password || !confirmPassword) {
            return res.json({ success: false, message: "Required fields are missing!" });
        }
        if (password !== confirmPassword) {
            return res.json({ success: false, message: "Passwords do not match!" });
        }
        const exists = await User.findOne({ phone: phone.trim() });
        if (exists) {
            return res.json({ success: false, message: "This phone number is already registered!" });
        }
        const newUser = new User({
            phone: phone.trim(),
            password: password.trim(),
            inviteCode: inviteCode ? inviteCode.trim() : ""
        });
        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during registration!" });
    }
});

// === UPDATED LOGIN ROUTE WITH USER CHECK ===
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.json({ success: false, message: "Please fill all fields!" });
        }

        const cleanPhone = phone.trim();

        // 1. पहले चेक करें कि इस नंबर से कोई अकाउंट बना भी है या नहीं
        const userExists = await User.findOne({ phone: cleanPhone });
        
        if (!userExists) {
            // अगर डेटाबेस में नंबर नहीं मिला, तो यह विशिष्ट मैसेज भेजें
            return res.json({ 
                success: false, 
                message: "No account found with this number. Please register first!" 
            });
        }

        // 2. अगर अकाउंट है, तो पासवर्ड मैच करके देखें
        if (userExists.password !== password.trim()) {
            return res.json({ 
                success: false, 
                message: "Invalid password! Please try again." 
            });
        }
        
        // 3. सब कुछ सही होने पर लॉगिन सफल करें
        res.json({ 
            success: true, 
            phone: userExists.phone, 
            balance: userExists.balance, 
            message: "Login successful!" 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during login!" });
    }
});
// === NEW SECURE CONNECTION FOR PROFILE BALANCE ===
app.get('/api/balance/:phone', async (req, res) => {
    try {
        const cleanPhone = req.params.phone.trim();
        // नए डेटाबेस (goa_club_db) में यूज़र को खोजना
        const user = await User.findOne({ phone: cleanPhone });
        
        if (!user) {
            return res.json({ success: false, message: "User not found in new database!" });
        }
        
        // सीधे नए डेटाबेस का रियल बैलेंस फ्रंटएंड को भेजना
        res.json({
            success: true,
            balance: Number(user.balance || 0)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error fetching balance!" });
    }
});


// === MOVE THIS TO THE BOTTOM OF SERVER.JS ===
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ... आपका पुराना कोड ...

// === यूज़र का सट्टा (Bet) सबमिट करने का रूट ===
app.post('/api/place-bet', async (req, res) => {
    try {
        const { phone, gameMode, periodId, selectValue, betAmount } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ success: false, message: "यूज़र नहीं मिला!" });
        if (user.balance < betAmount) return res.status(400).json({ success: false, message: "अपर्याप्त बैलेंस!" });
        
        user.balance -= betAmount;
        await user.save();
        
        const newBet = new Bet({ phone, gameMode, periodId, selectValue, betAmount, status: "Pending" });
        await newBet.save();
        
        res.json({ success: true, message: "दांव सफलतापूर्वक लग गया!", newBalance: user.balance });
    } catch (error) {
        res.status(500).json({ success: false, message: "सर्ver एरर!" });
    }
});

// === लाइव टाइमर और पीरियड आईडी सिंक करने का रूट ===
app.get('/api/game-sync', (req, res) => {
    const syncData = {};
    Object.keys(liveGames).forEach(mode => {
        syncData[mode] = { timeLeft: liveGames[mode].timeLeft, currentPeriod: liveGames[mode].currentPeriod };
    });
    res.json({ success: true, data: syncData });
});
// === 1. हर राउंड ख़त्म होने पर यूज़र्स का पैसा सेटल करने का फ़ंक्शन ===
async function settleUserBets(mode, periodId, winNum, winColor, winSize) {
    try {
        const pendingBets = await Bet.find({ gameMode: mode, periodId: periodId, status: "Pending" });
        
        for (let bet of pendingBets) {
            let isWin = false; let multiplier = 2; // डिफ़ॉल्ट 2 गुना मुनाफा
            
            // जीतने की शर्तें चेक करें
            if (bet.selectValue === winColor || bet.selectValue === winSize || bet.selectValue === winNum.toString()) {
                isWin = true;
                if (!isNaN(bet.selectValue)) multiplier = 9; // नंबर सही होने पर 9 गुना पैसा
            } else if ((winColor === "Red-Violet" && (bet.selectValue === "Red" || bet.selectValue === "Violet")) ||
                       (winColor === "Green-Violet" && (bet.selectValue === "Green" || bet.selectValue === "Violet"))) {
                isWin = true; multiplier = 1.5; // हाफ कलर विन पर 1.5 गुना
            }

            if (isWin) {
                bet.winAmount = bet.betAmount * multiplier; bet.status = "Win";
                await User.findOneAndUpdate({ phone: bet.phone }, { $inc: { balance: bet.winAmount } });
            } else {
                bet.status = "Loss";
            }
            await bet.save();
        }
    } catch (err) { console.error("Settlement Error:", err); }
}

// === 2. असली गेम हिस्ट्री और माई हिस्ट्री भेजने का API रूट्स ===
app.get('/api/game-history/:mode', async (req, res) => {
    const list = await Period.find({ gameMode: req.params.mode }).sort({ createdAt: -1 }).limit(10);
    res.json({ success: true, data: list });
});

app.get('/api/my-history/:mode/:phone', async (req, res) => {
    const list = await Bet.find({ gameMode: req.params.mode, phone: req.params.phone }).sort({ createdAt: -1 }).limit(10);
    res.json({ success: true, data: list });
});

// === 1. चारों गेम्स की लाइव स्थिति और पूल को ट्रैक करने का ग्लोबल ऑब्जेक्ट ===
const liveGames = {
    "30s": { duration: 30, timeLeft: 30, currentPeriod: "", pools: {} },
    "1m":  { duration: 60, timeLeft: 60, currentPeriod: "", pools: {} },
    "3m":  { duration: 180, timeLeft: 180, currentPeriod: "", pools: {} },
    "5m":  { duration: 300, timeLeft: 300, currentPeriod: "", pools: {} }
};

// पूल डेटा को हर नया राउंड शुरू होने पर रीसेट करने का फ़ंक्शन
function resetPool(mode) {
    liveGames[mode].pools = {
        "0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0,
        "Red":0,"Green":0,"Violet":0,"Big":0,"Small":0
    };
    const now = new Date();
    const timestamp = now.getFullYear() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + "0005";
    const randomId = Math.floor(1000 + Math.random() * 9000);
    liveGames[mode].currentPeriod = timestamp + randomId;
}

async function calculateGameResult(mode) {
    const game = liveGames[mode]; const pool = game.pools;
    let minPayout = Infinity; let bestNumbers = [];
    
    for (let num = 0; num <= 9; num++) {
        let currentPayout = pool[num.toString()] || 0;
        if (num === 0 || num === 5) currentPayout += (pool["Violet"] || 0);
        if ([1,3,7,9].includes(num)) currentPayout += (pool["Green"] || 0);
        if ([2,4,6,8].includes(num)) currentPayout += (pool["Red"] || 0);
        if (num >= 5) currentPayout += (pool["Big"] || 0); else currentPayout += (pool["Small"] || 0);
        if (currentPayout < minPayout) { minPayout = currentPayout; bestNumbers = [num]; }
        else if (currentPayout === minPayout) { bestNumbers.push(num); }
    }
    const finalNumber = bestNumbers[Math.floor(Math.random() * bestNumbers.length)];
    const finalColor = finalNumber === 0 ? "Red-Violet" : (finalNumber === 5 ? "Green-Violet" : ([1,3,7,9].includes(finalNumber) ? "Green" : "Red"));
    const finalSize = finalNumber >= 5 ? "Big" : "Small";

    // असली परिणाम को डेटाबेस में सेव करना
    const newPeriod = new Period({ gameMode: mode, periodId: game.currentPeriod, resultNumber: finalNumber, resultColor: finalColor, resultSize: finalSize });
    await newPeriod.save();

    // यूज़र्स के दांव का निपटारा (Settle) करना
    if (typeof settleUserBets === 'function') {
        await settleUserBets(mode, game.currentPeriod, finalNumber, finalColor, finalSize);
    }

    resetPool(mode); // अगला राउंड शुरू करने के लिए पूल खाली और नया पीरियड आईडी सेट करें
}


// === 3. बैकग्राउंड setInterval टाइमर इंजन ===
function startServerTimerEngine() {
    Object.keys(liveGames).forEach(mode => resetPool(mode));
    
    setInterval(() => {
        Object.keys(liveGames).forEach(async (mode) => {
            const game = liveGames[mode];
            if (game.timeLeft <= 0) {
                await calculateGameResult(mode);
                game.timeLeft = game.duration;
            } else {
                game.timeLeft--;
            }
        });
    }, 1000);
}

// सर्वर चलते ही टाइमर इंजन अपने आप चालू हो जाये
startServerTimerEngine();

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Database Connected Successfully!");
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => console.error("Database Connection Error:", err));
    