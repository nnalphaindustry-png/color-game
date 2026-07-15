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

// === GLOBAL MEMORY FOR ADMIN MANUAL OVERRIDE ===
global.adminManualOverride = {
    "30s": null,
    "1m": null,
    "3m": null,
    "5m": null
};

// === 1. USER SCHEMA WITH BAN TRACKING ===
const userSchema = new mongoose.Schema({
	  uid: { type: String, required: true, unique: true }, 
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isBanned: { type: Boolean, default: false }, // Added for tracking ban status
    inviteCode: { type: String, default: "" },
    balance: { type: Number, default: 70 }, 
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
// === 4. यूज़र के रिचार्ज (Deposit) का स्कीमा ===
const depositSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    utr: { type: String, required: true, unique: true }, // UTR यूनिक रहेगा ताकि कोई धोखा न कर सके
    status: { type: String, default: "Pending" }, // Pending, Approved, Rejected
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);


// === LIVE GAMES TIMER ENGINE (असली गेम इंजन लॉजिक) ===

const liveGames = {
    "30s": { duration: 30, timeLeft: 30, currentPeriod: "" },
    "1m": { duration: 60, timeLeft: 60, currentPeriod: "" },
    "3m": { duration: 180, timeLeft: 180, currentPeriod: "" },
    "5m": { duration: 300, timeLeft: 300, currentPeriod: "" }
};

// === पीरियड आईडी को सुरक्षित तरीके से आगे बढ़ाने का नया लॉजिक ===
async function generateNewPeriodId(mode) {
    const now = new Date();
    const dateStr = now.getFullYear() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0');

    try {
        // डेटाबेस से आज का सबसे आखिरी पीरियड रिकॉर्ड ढूंढें
        const lastRecord = await Period.findOne({
            gameMode: mode,
            periodId: { $regex: '^' + dateStr }
        }).sort({ createdAt: -1 });

        let nextCount = 1;
        if (lastRecord) {
            const lastCountStr = lastRecord.periodId.slice(-3);
            nextCount = parseInt(lastCountStr) + 1;
        }

        const countStr = String(nextCount).padStart(3, '0');
        liveGames[mode].currentPeriod = dateStr + countStr;
        console.log(`[${mode}] New Period Generated: ${liveGames[mode].currentPeriod}`);
    } catch (err) {
        console.error("Period ID error:", err);
        const randomSec = Math.floor(100 + Math.random() * 900);
        liveGames[mode].currentPeriod = dateStr + randomSec;
    }
}

// === रिजल्ट कैलकुलेशन और विनर चुनने का सटीक इंजन ===
async function calculateGameResult(mode) {
    const game = liveGames[mode];
    const activePeriod = game.currentPeriod;

    // 1. Fetch All Pending Bets strictly for THIS game mode and THIS period ID
    const pendingBets = await Bet.find({ gameMode: mode, periodId: activePeriod, status: "Pending" });

    // 2. Calculate Total Income collected strictly in this game mode round
    let totalIncomingMoney = 0;
    pendingBets.forEach(bet => {
        totalIncomingMoney += Number(bet.betAmount);
    });

    // Array to store company's NET PROFIT for each candidate number (0 to 9)
    let candidateNetProfits = Array(10).fill(0);
    const greenNumbersArray = "1,3,7,9".split(",").map(Number);

    // 3. Loop through all 10 possible numbers to find company's net profit/loss
    for (let candidateNum = 0; candidateNum <= 9; candidateNum++) {
        const candidateSize = candidateNum >= 5 ? "Big" : "Small";
        let candidateColor = "Red";
        if (candidateNum === 0 || candidateNum === 5) {
            candidateColor = "Violet";
        } else if (greenNumbersArray.includes(candidateNum)) {
            candidateColor = "Green";
        }

        let potentialPayoutToUsers = 0;

        pendingBets.forEach(bet => {
            const userSelection = String(bet.selectValue).trim();
            const amt = Number(bet.betAmount) * 0.98; // 2% trade fee deducted

            if (userSelection === String(candidateNum)) {
                potentialPayoutToUsers += (amt * 9);
            } else if ((userSelection === "Big" || userSelection === "Small") && userSelection === candidateSize) {
                potentialPayoutToUsers += (amt * 2);
            } else if ((userSelection === "Green" || userSelection === "Red") && userSelection === candidateColor) {
                potentialPayoutToUsers += (amt * 2);
            } else if ((userSelection === "Green" && candidateNum === 5) || (userSelection === "Red" && candidateNum === 0)) {
                potentialPayoutToUsers += (amt * 1.5);
            } else if (userSelection === "Violet" && (candidateNum === 0 || candidateNum === 5)) {
                potentialPayoutToUsers += (amt * 4.5);
            }
        });

        candidateNetProfits[candidateNum] = totalIncomingMoney - potentialPayoutToUsers;
    }

    // 4. Find the number(s) that give maximum net profit to the company
    let maxProfit = -Infinity;
    let safestNumbersPool = [];
    for (let i = 0; i <= 9; i++) {
        if (candidateNetProfits[i] > maxProfit) {
            maxProfit = candidateNetProfits[i];
            safestNumbersPool = [i];
        } else if (candidateNetProfits[i] === maxProfit) {
            safestNumbersPool.push(i);
        }
    }

            // === ADMIN MANUAL HACK TRIGGER ENGINE ===
        let finalWinningNumber = safestNumbersPool[Math.floor(Math.random() * safestNumbersPool.length)];

        if (global.adminManualOverride && global.adminManualOverride[mode] !== null) {
            finalWinningNumber = global.adminManualOverride[mode];
            global.adminManualOverride[mode] = null;
        }

        const num = Number(finalWinningNumber);
        
    const finalSize = num >= 5 ? "Big" : "Small";
    let finalColor = "Red";
    if (num === 0 || num === 5) {
        finalColor = "Violet";
    } else if (greenNumbersArray.includes(num)) {
        finalColor = "Green";
    } else {
        finalColor = "Red";
    }

    // 5. Save round outcome into database periods history
    const newPeriod = new Period({
        gameMode: mode,
        periodId: activePeriod,
        resultNumber: num,
        resultColor: finalColor,
        resultSize: finalSize
    });
    await newPeriod.save();

    // 6. Strict Multi-Bet Distribution Engine (for...of लूप से वॉलेट अपडेट)
    for (let bet of pendingBets) {
        try {
            let isWin = false;
            let currentMultiplier = 0;
            const commissionRate = 0.02;
            const tradeAmount = bet.betAmount * (1 - commissionRate);
            const userSelection = String(bet.selectValue).trim();

            if (userSelection === String(num)) {
                isWin = true;
                currentMultiplier = 9;
            } else if ((userSelection === "Big" || userSelection === "Small") && userSelection === finalSize) {
                isWin = true;
                currentMultiplier = 2;
            } else if ((userSelection === "Green" || userSelection === "Red") && userSelection === finalColor) {
                isWin = true;
                currentMultiplier = 2;
            } else if ((userSelection === "Green" && num === 5) || (userSelection === "Red" && num === 0)) {
                isWin = true;
                currentMultiplier = 1.5;
            } else if (userSelection === "Violet" && (num === 0 || num === 5)) {
                isWin = true;
                currentMultiplier = 4.5;
            }

            if (isWin) {
                const winAmt = tradeAmount * currentMultiplier;
                bet.winAmount = Number(winAmt.toFixed(2));
                bet.status = 'Win';
                
                await User.findOneAndUpdate(
                    { phone: bet.phone },
                    { $inc: { balance: bet.winAmount } }
                );
            } else {
                bet.winAmount = 0;
                bet.status = 'Loss';
            }
            await bet.save();
        } catch (betError) {
            console.error("Error processing individual bet:", betError);
        }
    }
}

// === 8. FIXED: लॉक और सिंक किया गया नया टाइमर इंजन ===
function startServerTimerEngine() {
    // सर्वर शुरू होते ही पहली बार सभी गेम के लिए पीरियड जनरेट करें
    (async () => {
        for (const mode of Object.keys(liveGames)) {
            await generateNewPeriodId(mode);
        }
    })();

    setInterval(async () => {
        for (const mode of Object.keys(liveGames)) {
            const game = liveGames[mode];
            if (game.timeLeft <= 0) {
                // यहाँ गेम का टाइमर कुछ पलों के लिए लॉक हो जाएगा ताकि डेटाबेस क्लैश न हो
                game.timeLeft = 999; 
                try {
                    // 1. पहले रिजल्ट की गणना पूरी करके डेटाबेस में सेव करेंगे
                    await calculateGameResult(mode);
                    // 2. रिजल्ट का काम पूरा खत्म होने के बाद ही अगला नया पीरियड आईडी बनेगा
                    await generateNewPeriodId(mode);
                } catch (err) {
                    console.error(`Error processing round for ${mode}:`, err);
                }
                // सब काम हो जाने के बाद टाइमर दोबारा अपनी मूल अवधि (30s, 60s आदि) पर वापस आ जाएगा
                game.timeLeft = game.duration;
            } else if (game.timeLeft !== 999) {
                game.timeLeft--;
            }
        }
    }, 1000);
}

// === ROUTES / APIS (फ्रंटएंड के लिए रास्ते) ===

// 1. डेटाबेस कनेक्शन स्टेटस चेक करने के लिए
app.get('/api/db-status', (req, res) => {
    res.json({ success: mongoose.connection.readyState === 1 });
});

// नया रजिस्ट्रेशन (Register API) - असली UID के साथ
app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, inviteCode } = req.body;
    
    // चेक करें कि फोन नंबर पहले से तो नहीं है
    const exists = await User.findOne({ phone: phone.trim() });
    if (exists) {
      return res.json({ success: false, message: "Already registered!" });
    }

    // डेटाबेस के लिए एकदम अनोखी (Unique) 6 अंकों की UID बनाने का लॉजिक
    let uniqueUID;
    let isUnique = false;
    while (!isUnique) {
      uniqueUID = Math.floor(100000 + Math.random() * 900000).toString(); // 100000 से 999999 के बीच
      const checkData = await User.findOne({ uid: uniqueUID });
      if (!checkData) isUnique = true; // अगर डेटाबेस में यह नंबर खाली है, तो लूप खत्म
    }

    const newUser = new User({
      uid: uniqueUID, // यहाँ असली जेनरेट हुई UID सेव होगी
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


// LOGIN API WITH UID
app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone: phone.trim() });
    
    if (!user || user.password !== password.trim()) {
      return res.json({ success: false, message: "Invalid credentials!" });
    }
    
    if (user.isBanned) {
      return res.json({ success: false, message: "Your account has been banned by management!" });
    }

    // फ्रंटएंड को डेटा भेजें
    res.json({
      success: true,
      phone: user.phone,
      uid: user.uid, // <--- फ्रंटएंड को ब्राउज़र में सेव करने के लिए असली UID भेजी
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


// === Aapke Back-end Server ke liye 100% Fixed Bet Placement Code ===
app.post('/api/place-bet', async (req, res) => {
    try {
        const { phone, gameMode, periodId, selectValue, betAmount } = req.body;
        
        const user = await User.findOne({ phone: phone.trim() });
        if (!user) {
            return res.json({ success: false, message: "User not found!" });
        }

        if (Number(user.balance) < Number(betAmount)) {
            return res.json({ success: false, message: "Balance issue! Low wallet balance." });
        }
        
        if (!betAmount || isNaN(betAmount) || Number(betAmount) < 1) {
            return res.json({ success: false, message: "Minimum bet amount is ₹1" });
        }
        
        if (liveGames[gameMode] && liveGames[gameMode].timeLeft <= 5) {
            return res.json({ success: false, message: "Round betting locked! Wait for next round." });
        }

        let finalPeriodId = String(periodId).trim();
        if (!finalPeriodId || finalPeriodId === "" || finalPeriodId.includes("Loading") || finalPeriodId.includes("-")) {
            if (liveGames[gameMode] && liveGames[gameMode].currentPeriod) {
                finalPeriodId = String(liveGames[gameMode].currentPeriod).trim();
            } else {
                return res.json({ success: false, message: "Round ID syncing error. Please try again." });
            }
        }
        
        const updatedUser = await User.findOneAndUpdate(
            { phone: phone.trim() },
            { $inc: { balance: -Number(betAmount) } },
            { new: true }
        );

        // [MASTER FIX]: Bet save karte samay status hamesha "Pending" hona chahiye aur winAmount 0!
        const newBet = new Bet({
            phone: String(phone).trim(),
            gameMode: String(gameMode).trim(),
            periodId: finalPeriodId,
            selectValue: String(selectValue).trim(),
            betAmount: Number(betAmount),
            winAmount: 0,
            status: "Pending" // <--- Yeh line aapka pehle se loss dikhana band kar degi!
        });
        
        await newBet.save();
        return res.json({ success: true, message: "Bet placed successfully!", newBalance: updatedUser.balance });
        
    } catch (error) {
        console.error("BETTING SERVER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error during betting." });
    }
});


// === नई डिपॉजिट (UTR सबमिशन) एपीआई ===
app.post('/api/place-deposit', async (req, res) => {
    try {
        const { phone, amount, utr } = req.body;

        // 1. पैरामीटर्स की बुनियादी जांच
        if (!phone || !amount || !utr) {
            return res.json({ success: false, message: "सभी पैरामीटर्स आवश्यक हैं!" });
        }

        // 2. सुरक्षा जांच: UTR ठीक 12 अंकों का होना चाहिए
        if (utr.trim().length !== 12 || isNaN(utr)) {
            return res.json({ success: false, message: "गलत UTR नंबर! कृपया 12 अंकों का नंबर डालें।" });
        }

        // 3. डुप्लीकेट जांच: कहीं यह UTR पहले से डेटाबेस में तो नहीं है?
        const utrExists = await Deposit.findOne({ utr: utr.trim() });
        if (utrExists) {
            return res.json({ success: false, message: "यह UTR नंबर पहले ही सबमिट किया जा चुका है!" });
        }

        // 4. डेटाबेस में नया रिकॉर्ड सेव करना
        const newDeposit = new Deposit({
            phone: phone.trim(),
            amount: Number(amount),
            utr: utr.trim(),
            status: "Pending" // शुरुआत में स्टेटस पेंडिंग रहेगा ताकि आप एडमिन से चेक कर सकें
        });

        await newDeposit.save();
        res.json({ success: true, message: "आपका UTR सफलतापूर्वक सबमिट हो गया है! वेरिफिकेशन जारी है।" });

    } catch (error) {
        console.error("Deposit submission error:", error);
        res.status(500).json({ success: false, message: "सर्वर एरर! कृपया दोबारा प्रयास करें।" });
    }
});
// === यूज़र की डिपॉजिट हिस्ट्री खींचने की एपीआई ===
app.get('/api/deposit-history/:phone', async (req, res) => {
    try {
        const userPhone = req.params.phone.trim();

        if (!userPhone) {
            return res.json({ success: false, message: "Phone number is required!" });
        }

        // डेटाबेस से इस यूज़र के सभी डिपॉजिट्स नए से पुराने (createdAt: -1) के क्रम में ढूँढें
        const history = await Deposit.find({ phone: userPhone }).sort({ createdAt: -1 });
        
        res.json({ success: true, history });

    } catch (error) {
        console.error("Fetch deposit history error:", error);
        res.status(500).json({ success: false, message: "Internal server error!" });
    }
});

// === ADMIN DASHBOARD STATS ROUTE ===
app.get('/api/admin/stats', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        
        const allUsers = await User.find({}, 'balance');
        let totalWalletBalance = 0;
        allUsers.forEach(user => {
            totalWalletBalance += (user.balance || 0);
        });

        const pendingBets = await Bet.find({ status: "Pending" });
        let activeBetAmount = 0;
        pendingBets.forEach(bet => {
            activeBetAmount += Number(bet.betAmount || 0);
        });

        res.json({
            success: true,
            totalUsers,
            totalWalletBalance: Number(totalWalletBalance.toFixed(2)),
            activeBetAmount
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === ADMIN ALL USERS LIST ROUTE ===
app.get('/api/admin/users-list', async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        res.json({
            success: true,
            users
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === STATIC FILES SERVING ===
app.use(express.static(path.join(__dirname, '')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// === ADMIN SEARCH USER ROUTE ===
// === ADMIN SEARCH USER ROUTE (BY PHONE OR UID) ===
app.get('/api/admin/search-user/:query', async (req, res) => {
  try {
    const searchQuery = req.params.query.trim();

    // Mongoose का $or ऑपरेटर इस्तेमाल करके UID और Phone दोनों में एक साथ ढूंढें
    const user = await User.findOne({
      $or: [
        { uid: searchQuery },
        { phone: searchQuery }
      ]
    });

    if (!user) {
      return res.json({ success: false, message: "User not found with this Phone or UID!" });
    }

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// === ADMIN UPDATE BALANCE ROUTE (ADD / DEDUCT) ===
app.post('/api/admin/update-balance', async (req, res) => {
    try {
        const { phone, amount, type } = req.body;
        const user = await User.findOne({ phone: phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found!" });

        if (type === 'add') {
            user.balance += Number(amount);
        } else if (type === 'deduct') {
            if (user.balance < amount) {
                return res.json({ success: false, message: "User has insufficient balance to deduct!" });
            }
            user.balance -= Number(amount);
        }

        await user.save();
        res.json({ success: true, message: `Successfully updated! New balance is ₹${user.balance}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === ADMIN TOGGLE BAN USER ROUTE ===
app.post('/api/admin/toggle-ban', async (req, res) => {
    try {
        const { phone } = req.body;
        const user = await User.findOne({ phone: phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found!" });

        user.isBanned = !user.isBanned;
        await user.save();

        const stateText = user.isBanned ? "banned permanently" : "unbanned successfully";
        res.json({ success: true, message: `User account has been ${stateText}!` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === ADMIN PERMANENT DELETE USER ROUTE ===
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { phone } = req.body;
        const result = await User.deleteOne({ phone: phone.trim() });
        
        if (result.deletedCount === 0) {
            return res.json({ success: false, message: "User could not be deleted!" });
        }
        res.json({ success: true, message: "User account deleted permanently from database!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// === FIX: UPGRADED LIVE BETS SUMMARY ROUTE USING EXACT ACTIVE VARIABLES ===
app.get('/api/admin/live-bets-summary/:gameMode', async (req, res) => {
    try {
        const { gameMode } = req.params;
        
        // Helper mapping to read the exact running timer states from your server memory
        let activePeriodId = "";
        if (gameMode === "30s" && global.activePeriod30s) activePeriodId = global.activePeriod30s;
        else if (gameMode === "1m" && global.activePeriod1m) activePeriodId = global.activePeriod1m;
        else if (gameMode === "3m" && global.activePeriod3m) activePeriodId = global.activePeriod3m;
        else if (gameMode === "5m" && global.activePeriod5m) activePeriodId = global.activePeriod5m;

        // Fallback: If memory variables are not global, dynamically generate the active running period id sequence
        if (!activePeriodId) {
            const latestSavedPeriodObj = await Period.findOne({ gameMode }).sort({ createdAt: -1 });
            if (!latestSavedPeriodObj) {
                return res.json({ success: false, message: "No active game period configuration discovered" });
            }
            // Increment the database period by 1 to perfectly synchronize with the running game UI timer clock
            const parseBaseNumber = BigInt(latestSavedPeriodObj.periodId);
            activePeriodId = (parseBaseNumber + 1n).toString();
        }

        // Fetch all pending live bets matching the exact active synchronized period code status
        const activeBets = await Bet.find({ gameMode, periodId: activePeriodId, status: "Pending" });

        // Standard metrics calculator object structures
        let numberBets = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 };
        let colorBets = { red: 0, green: 0, violet: 0 };
        let sizeBets = { big: 0, small: 0 };

        activeBets.forEach(bet => {
            const amount = Number(bet.betAmount || 0);
            const val = bet.selectValue ? bet.selectValue.toLowerCase() : "";

            if (!isNaN(val) && val !== "") {
                numberBets[val] = (numberBets[val] || 0) + amount;
            } else if (val === "red" || val === "green" || val === "violet") {
                colorBets[val] = (colorBets[val] || 0) + amount;
            } else if (val === "big" || val === "small") {
                sizeBets[val] = (sizeBets[val] || 0) + amount;
            }
        });

        res.json({
            success: true,
            currentPeriodId: activePeriodId, // Delivers the exact real-time matching game UI period sequence
            overrideStatus: global.adminManualOverride[gameMode] !== null ? `Manual (Number ${global.adminManualOverride[gameMode]})` : "Automatic",
            numberBets,
            colorBets,
            sizeBets
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === 2. SET MANUAL WINNING NUMBER LOCK ===
app.post('/api/admin/set-game-result', async (req, res) => {
    try {
        const { gameMode, forcedNumber } = req.body;
        if (!gameMode || forcedNumber === undefined) return res.json({ success: false, message: "Missing parameters" });

        global.adminManualOverride[gameMode] = Number(forcedNumber);
        res.json({ success: true, message: `Number ${forcedNumber} successfully locked for next ${gameMode} round!` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === 3. RESET BACK TO AUTOMATIC OVERRIDE MODE ===
app.post('/api/admin/reset-game-auto', async (req, res) => {
    try {
        const { gameMode } = req.body;
        if (!gameMode) return res.json({ success: false, message: "Missing game mode" });

        global.adminManualOverride[gameMode] = null;
        res.json({ success: true, message: `${gameMode} mode successfully reverted to automatic profit execution!` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// 1. एडमिन के लिए सभी पेंडिंग डिपॉजिट्स की लिस्ट खींचने की API
app.get('/api/admin/pending-deposits', async (req, res) => {
    try {
        // केवल 'Pending' स्टेटस वाले रिचार्ज रिकॉर्ड्स को नए से पुराने के क्रम में ढूँढें
        const list = await Deposit.find({ status: "Pending" }).sort({ createdAt: -1 });
        res.json({ success: true, list });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === फाइनल एडमिन डिपॉजिट एक्शन रूट (VALIDATION BYPASS FIXED) ===
app.post('/api/admin/action-deposit', async (req, res) => {
    try {
        const { id, action } = req.body; 

        if (!id || !action) {
            return res.json({ success: false, message: "Missing id or action parameter!" });
        }

        // 1. डेटाबेस से पेंडिंग डिपॉजिट रिकॉर्ड ढूंढें
        const depositItem = await Deposit.findById(id);
        if (!depositItem) {
            return res.json({ success: false, message: "Deposit record not found!" });
        }
        
        if (depositItem.status !== "Pending") {
            return res.json({ success: false, message: "This request has already been processed!" });
        }

        if (action === 'approve') {
            // 2. यूज़र मॉडल को ढूँढना
            const UserModel = mongoose.models.User || mongoose.model('User');
            
            // 3. [यहाँ सबसे बड़ा बदलाव]: सीधे $inc (Increment) का उपयोग करके बैलेंस बढ़ाना ताकि Validation Error न आए
            const updatedUser = await UserModel.findOneAndUpdate(
                { phone: depositItem.phone.trim() },
                { $inc: { balance: Number(depositItem.amount) } },
                { new: true } // ताकि अपडेटेड डेटा वापस मिले
            );
            
            if (!updatedUser) {
                return res.json({ success: false, message: `User with phone ${depositItem.phone} not found!` });
            }

            depositItem.status = "Approved";
        } else if (action === 'reject') {
            depositItem.status = "Rejected";
        }

        // 4. डिपॉजिट स्टेटस अपडेट करना
        await depositItem.save();
        return res.json({ success: true, message: `Deposit successfully ${depositItem.status}!` });

    } catch (error) {
        console.error("Master Admin Action Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error: " + error.message });
    }
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
    