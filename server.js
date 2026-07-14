const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// === MIDDLEWARES ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", credentials: true }));

// === MONGODB SCHEMAS (डेटाबेस के नियम) ===

// 1. यूज़र का स्कीमा
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, default: "" },
    balance: { type: Number, default: 70 }, // नए यूज़र को मिलने वाला डिफ़ॉल्ट बैलेंस
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// 2. हर राउंड (लॉटरी रिज़ल्ट) का स्कीमा
const periodSchema = new mongoose.Schema({
    gameMode: String,     // '30s', '1m', '3m', '5m'
    periodId: String,     // अनोखा राउंड नंबर
    resultNumber: Number, // 0-9
    resultColor: String,  // Red/Green/Violet
    resultSize: String,   // Big/Small
    createdAt: { type: Date, default: Date.now }
});
const Period = mongoose.model('Period', periodSchema);

// 3. यूज़र के लगाए सट्टे (Bet) का स्कीमा
const betSchema = new mongoose.Schema({
    phone: String,
    gameMode: String,
    periodId: String,
    selectValue: String, // जो यूज़र ने चुना (Red, Green, 0, 1, Big आदि)
    betAmount: Number,
    winAmount: { type: Number, default: 0 },
    status: { type: String, default: "Pending" }, // Pending, Win, Loss
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);


// === LIVE GAMES TIMER ENGINE (असली गेम इंजन लॉजिक) ===

const liveGames = {
    "30s": { duration: 30, timeLeft: 30, currentPeriod: "" },
    "1m": { duration: 60, timeLeft: 60, currentPeriod: "" },
    "3m": { duration: 180, timeLeft: 180, currentPeriod: "" },
    "5m": { duration: 300, timeLeft: 300, currentPeriod: "" }
};

// === नया सीरियल पीरियड आईडी बनाने का सही फंक्शन ===
async function generateNewPeriodId(mode) {
    const now = new Date();
    const dateStr = now.getFullYear() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0');

    try {
        // डेटाबेस से आज का सबसे आख़िरी पीरियड रिकॉर्ड ढूँढें
        const lastRecord = await Period.findOne({ 
            gameMode: mode, 
            periodId: { $regex: '^' + dateStr } 
        }).sort({ createdAt: -1 });

        let nextCount = 1;
        if (lastRecord) {
            // अगर पुराना रिकॉर्ड है, तो आख़िरी के 3 डिजिट निकालकर उसमें 1 जोड़ें
            const lastCountStr = lastRecord.periodId.slice(-3);
            nextCount = parseInt(lastCountStr) + 1;
        }

        // काउंटर को 3 डिजिट का बनाएं (जैसे: 001, 002, 003)
        const countStr = String(nextCount).padStart(3, '0');
        liveGames[mode].currentPeriod = dateStr + countStr;

    } catch (err) {
        console.error("Period ID error:", err);
        // बैकअप के लिए अगर कोई दिक्कत आए तो 3 डिजिट रैंडम
        const randomSec = Math.floor(100 + Math.random() * 900);
        liveGames[mode].currentPeriod = dateStr + randomSec;
    }
}

async function calculateGameResult(mode) {
  const game = liveGames[mode];
  const activePeriod = game.currentPeriod;

  // 1. Generate Authentic Random Number (0 to 9)
  const finalNumber = Math.floor(Math.random() * 10);
  const num = Number(finalNumber);

  // 2. Strict Size Logic
  const finalSize = num >= 5 ? "Big" : "Small";

  // 3. Strict Color Logic
  let finalColor = "Red";
  if (num === 0 || num === 5) {
    finalColor = "Violet";
  } else if ([1, 3, 7, 9].includes(num)) {
    finalColor = "Green";
  } else {
    finalColor = "Red";
  }

  // 4. Save Final Round Result to Database
  const newPeriod = new Period({
    gameMode: mode,
    periodId: activePeriod,
    resultNumber: num,
    resultColor: finalColor,
    resultSize: finalSize
  });
  await newPeriod.save();

  // 5. Fetch All Pending Bets for This Period
  const pendingBets = await Bet.find({ gameMode: mode, periodId: activePeriod, status: "Pending" });

  // 6. 2% Commission & Strict Winning Calculation Engine
  for (let bet of pendingBets) {
    let isWin = false;
    let multiplier = 0;
    
    const commissionRate = 0.02; // 2% Trade Fee Cut
    const tradeAmount = bet.betAmount * (1 - commissionRate);

    // Category 1: Exact Number Selection Check (9x)
    if (bet.selectValue === String(num)) {
      isWin = true;
      multiplier = 9;
    }
    // Category 2: Exact Size Selection Check (2x)
    else if ((bet.selectValue === "Big" || bet.selectValue === "Small") && bet.selectValue === finalSize) {
      isWin = true;
      multiplier = 2;
    }
    // Category 3: Exact Color Selection Check (Red/Green - 2x)
    else if ((bet.selectValue === "Green" || bet.selectValue === "Red") && bet.selectValue === finalColor) {
      isWin = true;
      multiplier = 2;
    }
    // Category 4: Half Win Logic (User selected Red/Green but Violet mix 0 or 5 appeared - 1.5x)
    else if ((bet.selectValue === "Green" && num === 5) || (bet.selectValue === "Red" && num === 0)) {
      isWin = true;
      multiplier = 1.5;
    }
    // Category 5: Pure Violet Selection Check (4.5x)
    else if (bet.selectValue === "Violet" && (num === 0 || num === 5)) {
      isWin = true;
      multiplier = 4.5;
    }

    // Process Wallet Updates Based on Result
    if (isWin) {
      const winAmt = tradeAmount * multiplier;
      bet.winAmount = Number(winAmt.toFixed(2));
      bet.status = 'Win';

      // Update User Balance Immediately
      await User.findOneAndUpdate(
        { phone: bet.phone },
        { $inc: { balance: bet.winAmount } }
      );
    } else {
      bet.winAmount = 0;
      bet.status = 'Loss';
    }

    await bet.save(); // Save Individual Bet Status
  }
}

// === बैकएंड का टाइमर चालू करने का सही इंजन ===
function startServerTimerEngine() {
    Object.keys(liveGames).forEach(async (mode) => {
        await generateNewPeriodId(mode);
    });

    setInterval(() => {
        Object.keys(liveGames).forEach(async (mode) => {
            const game = liveGames[mode];
            if (game.timeLeft <= 0) {
                await calculateGameResult(mode);
                await generateNewPeriodId(mode); // नए राउंड के लिए नंबर-वाइज़ आईडी बनाएं
                game.timeLeft = game.duration;
            } else {
                game.timeLeft--;
            }
        });
    }, 1000);
}


// === ROUTES / APIS (फ्रंटएंड के लिए रास्ते) ===

// 1. डेटाबेस कनेक्शन स्टेटस चेक करने के लिए
app.get('/api/db-status', (req, res) => {
    res.json({ success: mongoose.connection.readyState === 1 });
});

// 2. नया रजिस्ट्रेशन (Register API)
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, inviteCode } = req.body;
        const exists = await User.findOne({ phone: phone.trim() });
        if (exists) {
            return res.json({ success: false, message: "Already registered!" });
        }
        const newUser = new User({ 
            phone: phone.trim(), 
            password: password.trim(), 
            inviteCode: inviteCode || "" 
        });
        await newUser.save();
        res.json({ success: true, message: "Registered successfully!" });
    } catch (err) { 
        res.status(500).json({ success: false, message: "Registration failed! Server error." }); 
    }
});

// 3. लॉगिन (Login API)
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone: phone.trim() });
        if (!user || user.password !== password.trim()) {
            return res.json({ success: false, message: "Invalid credentials!" });
        }
        res.json({ 
            success: true, 
            phone: user.phone, 
            balance: user.balance, 
            message: "Login success!" 
        });
    } catch (err) { 
        res.status(500).json({ success: false, message: "Login failed! Server error." }); 
    }
});
// === १. गेम मोड के अनुसार पिछला इतिहास भेजने की अपडेटेड एपीआई (Pagination के साथ) ===
app.get('/api/game-history/:mode', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; // यदि पेज न दिया हो, तो पहला पेज
    const limit = 10; // एक बार में १० रिकॉर्ड
    const skip = (page - 1) * limit;

    const list = await Period.find({ gameMode: req.params.mode })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // कुल रिकॉर्ड की संख्या ताकि फ्रंटएंड को पता चले कि आगे और डेटा है या नहीं
    const totalRecords = await Period.countDocuments({ gameMode: req.params.mode });
    const hasMore = skip + list.length < totalRecords;

    res.json({ success: true, list, hasMore });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// === २. यूजर द्वारा विशिष्ट गेम मोड में लगाई गई बेट्स फ़िल्टर करने की अपडेटेड एपीआई ===
app.get('/api/user-bets/:phone/:mode', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const list = await Bet.find({ phone: req.params.phone.trim(), gameMode: req.params.mode })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalRecords = await Bet.countDocuments({ phone: req.params.phone.trim(), gameMode: req.params.mode });
    const hasMore = skip + list.length < totalRecords;

    res.json({ success: true, list, hasMore });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});


// 4. यूज़र का लाइव बैलेंस चेक करने के लिए
app.get('/api/balance/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        res.json({ success: !!user, balance: user ? user.balance : 0 });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

// अपडेटेड एपीआई जो टाइमर के साथ-साथ आख़िरी जीता हुआ नंबर और रंग भी फ्रंटएंड को देगी
app.get('/api/game-sync', async (req, res) => {
    try {
        const syncData = {};
        for (let mode of Object.keys(liveGames)) {
            // डेटाबेस से इस गेम मोड का सबसे लेटेस्ट ख़त्म हुआ राउंड ढूंढें
            const lastPeriodRecord = await Period.findOne({ gameMode: mode }).sort({ createdAt: -1 });
            
            syncData[mode] = { 
                timeLeft: liveGames[mode].timeLeft, 
                currentPeriod: liveGames[mode].currentPeriod,
                lastResult: lastPeriodRecord ? {
                    number: lastPeriodRecord.resultNumber,
                    color: lastPeriodRecord.resultColor
                } : null
            };
        }
        res.json({ success: true, data: syncData });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});


// 6. असली सट्टा (Bet) लगाने की एपीआई
app.post('/api/place-bet', async (req, res) => {
    try {
        const { phone, gameMode, periodId, selectValue, betAmount } = req.body;
        
        const user = await User.findOne({ phone: phone.trim() });
        if (!user || user.balance < betAmount) {
            return res.json({ success: false, message: "Balance issue! Low wallet balance." });
        }
    // === FIX: MINIMUM BET LIMIT CHECK ===
    if (!betAmount || isNaN(betAmount) || Number(betAmount) < 1) {
      return res.json({ success: false, message: "Minimum bet amount is ₹1" });
    }
    
        // आखिरी 5 सेकंड में सट्टा ब्लॉक करें
        if (liveGames[gameMode] && liveGames[gameMode].timeLeft <= 5) {
            return res.json({ success: false, message: "Round betting locked! Wait for next round." });
        }

        // यूज़र के वॉलेट से पैसे काटें
        user.balance -= Number(betAmount);
        await user.save();

        // सट्टा डेटाबेस में रिकॉर्ड करें
        const newBet = new Bet({ 
            phone: phone.trim(), 
            gameMode, 
            periodId, 
            selectValue, 
            betAmount: Number(betAmount) 
        });
        await newBet.save();

        res.json({ success: true, message: "Bet placed successfully!", newBalance: user.balance });
    } catch (error) { 
        res.status(500).json({ success: false, message: "Server error during betting." }); 
    }
});

// === STATIC FILES SERVING ===
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === SERVER START & DATABASE CONNECTION ===
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected Successfully!");
        startServerTimerEngine(); // डेटाबेस कनेक्ट होते ही टाइमर चालू हो जाएगा
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error("Database connection error:", err);
    });
    