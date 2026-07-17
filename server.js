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
// === VIP लेवल 1 से 10 की शर्तें और इनाम (₹2 बेट = 1 EXP के अनुसार) ===
const VIP_CONFIG = {
    1: { requiredEXP: 3000, reward: 30 },        // यूजर को लगेगा ₹3000 की बेट, पर असल में ₹6000 की बेट पर होगा
    2: { requiredEXP: 10000, reward: 100 },      // असल में ₹20,000 की बेट
    3: { requiredEXP: 50000, reward: 500 },      // असल में ₹1,00,000 की बेट
    4: { requiredEXP: 200000, reward: 2000 },    // असल में ₹4,00,000 की बेट
    5: { requiredEXP: 500000, reward: 5000 },    // असल में ₹10,00,000 की बेट
    6: { requiredEXP: 1000000, reward: 10000 },  // असल में ₹20,00,000 की बेट
    7: { requiredEXP: 3000000, reward: 30000 },  // असल में ₹60,00,000 की बेट
    8: { requiredEXP: 7000000, reward: 70000 },  // असल में ₹1,40,00,000 की बेट
    9: { requiredEXP: 15000000, reward: 150000 },// असल में ₹3,00,00,000 की बेट
    10: { requiredEXP: 30000000, reward: 300000 }// असल में ₹6,00,00,000 की बेट
};

// === MONGODB SCHEMAS (डेटाबेस के नियम) ===

// === GLOBAL MEMORY FOR ADMIN MANUAL OVERRIDE ===
global.adminManualOverride = {
    "30s": null,
    "1m": null,
    "3m": null,
    "5m": null
};

// === 1. USER SCHEMA WITH BAN TRACKING (UPDATED FOR AGENTS) ===
const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isBanned: { type: Boolean, default: false },
    balance: { type: Number, default: 70 },
    createdAt: { type: Date, default: Date.now },

    // --- ऑटोमैटिक इनवाइट और एजेंट ट्रैकिंग के नए फील्ड्स ---
    inviteCode: { type: String, default: "" },          // यूजर का अपना यूनिक इनवाइट कोड
    referredBy: { type: String, default: "" },          // इसे इनवाइट करने वाले (Parent) का फोन नंबर
    yesterdayCommission: { type: Number, default: 0 },  // रात 12 बजे ट्रांसफर होने वाला कल का कमीशन
    totalCommission: { type: Number, default: 0 },      // अब तक की कुल कुल कमाई
        arWallet: { type: Number, default: 0 },
            inviteSpinsAvailable: { type: Number, default: 0 }, // इनवाइट पर मिले स्पिन्स
    depositSpinsAvailable: { type: Number, default: 0 }, // खुद रिचार्ज करने पर मिले स्पिन्स
    todaySpinWallet: { type: Number, default: 0 }, // 🌟 नया फील्ड: बिना कैश आउट वाला आज का स्पिन रिवॉर्ड
    lifetimeSpinTotal: { type: Number, default: 0 },
    // userSchema के अंदर ये नए फ़ील्ड्स जोड़ें:
lifetimeEXP: { type: Number, default: 0 },    // यूजर के कुल असली EXP (बेट राशि / 2)
vipLevel: { type: Number, default: 0 },       // मौजूदा VIP लेवल (0 से 10)
claimedVipLevels: { type: [Number], default: [] }, // क्लेम किए जा चुके इनामों की लिस्ट
lastVipUpgradeDate: { type: Date, default: Date.now }, // लेवल मेंटेनेंस की तारीख चेक करने के लिए

    // --- लाइव रिचार्ज और बेट टर्नओवर ट्रैकिंग ---
    todayBetPlay: { type: Number, default: 0 },         // आज दिनभर में खेली गई कुल बेट
    todayDeposit: { type: Number, default: 0 },         // आज दिनभर में किया गया कुल रिचार्ज
    totalDeposit: { type: Number, default: 0 },         // लाइफटाइम कुल रिचार्ज (Valid User चेक करने के लिए)
    isActiveUser: { type: Boolean, default: false },     // यूजर ऑन/ऑफ स्टेटस ट्रैक करने के लिए
    
    claimedMilestoneIds: { type: [String], default: [] }, // डिपाजिट बोनस के जो टास्क क्लेम हो चुके हैं (उदा: ["task_1"])
    // === AGENT WORK TRACKING SYSTEM FIELDS ===
agentWorkStatus: { type: String, enum: ['None', 'Pending', 'Approved', 'Rejected'], default: 'None' }, 
agentGmail: { type: String, default: "" },
agentAltPhone: { type: String, default: "" },
agentWorkAppliedAt: { type: Date },

});

// === रजिस्ट्रेशन से पहले अपने आप यूनिक इनवाइट कोड जनरेट करने का लॉजिक ===
userSchema.pre('save', async function (next) {
    // अगर यूजर के पास पहले से कोड है (यानी अपडेट हो रहा है), तो दोबारा नहीं बनाएंगे
    if (!this.isNew || this.inviteCode) return next();
    
    let uniqueCode = "";
    let isCodeUnique = false;
    const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

    // लूप तब तक चलेगा जब तक एकदम अनोखा कोड न मिल जाए
    while (!isCodeUnique) {
        // 6 अक्षरों का रैंडम कोड बनाना (जैसे: GOA74X)
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        uniqueCode = "GOA"; // कोड की शुरुआत हमेशा GOA से होगी
        for (let i = 0; i < 5; i++) {
            uniqueCode += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        // डेटाबेस में चेक करना कि यह कोड पहले से किसी के पास तो नहीं है
        const checkExistingCode = await UserModel.findOne({ inviteCode: uniqueCode });
        if (!checkExistingCode) {
            isCodeUnique = true; // अगर खाली है, तो लूप खत्म
        }
    }

    this.inviteCode = uniqueCode; // यूजर को यह कोड अलॉट कर दिया
    next();
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
// === 5. यूज़र के विथड्रॉल (Withdrawal) का स्कीमा ===
const withdrawalSchema = new mongoose.Schema({
    uid: { type: String, required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    accountValue: { type: String, required: true },
    status: { type: String, default: "Pending" }, // Pending, Approved, Rejected
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// === GIFT CODE SCHEMA CLEAN CODE ===
const giftCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    maxUses: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    usersRedeemed: [{ type: String }]
});
const GiftCode = mongoose.model('GiftCode', giftCodeSchema);

// === LIVE GAMES TIMER ENGINE (असली गेम इंजन लॉजिक) ===
// === LUCKY WHEEL HISTORY SCHEMA ===
const wheelHistorySchema = new mongoose.Schema({
    phone: { type: String, required: true },
    spinType: { type: String, enum: ['invite', 'deposit'] },
    amountWon: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});
const WheelHistory = mongoose.model('WheelHistory', wheelHistorySchema);

const NotificationSchema = new mongoose.Schema({
  type: { type: String, enum: ['ALL', 'SINGLE'], required: true }, // ALL  SINGLE
  targetUsers: [{ type: String }], //  Single        ID  
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
module.exports = Notification;

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

// // नया रजिस्ट्रेशन (Register API) - असली UID और एजेंट ट्रैकिंग के साथ
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

        // रेफरल कोड का पता लगाना (यह चेक करना कि यह कोड किस एजेंट का है)
        let parentPhone = "";
        if (inviteCode && inviteCode.trim() !== "") {
            const parentUser = await User.findOne({ inviteCode: inviteCode.trim() });
            if (parentUser) {
                parentPhone = parentUser.phone; // एजेंट का फोन नंबर निकाल लिया
            }
        }

        const newUser = new User({
            uid: uniqueUID, // यहाँ असली जेनरेट हुई UID सेव होगी
            phone: phone.trim(),
            password: password.trim(),
            referredBy: parentPhone // यहाँ सेट हो गया कि इस यूजर को किसने इनवाइट किया है
        });

        await newUser.save();
        res.json({ success: true, message: "Registered successfully!" });
    } catch (err) {
        console.error("Registration failed:", err);
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


// === १. गेम मोड के अनुसार पिछला इतिहास भेजने की एपीआई (UPDATED WITH TOTAL PAGES) ===
app.get('/api/game-history/:mode', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; 
        const limit = 10; // एक बार में १० रिकॉर्ड
        const skip = (page - 1) * limit;
        
        const list = await Period.find({ gameMode: req.params.mode })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalRecords = await Period.countDocuments({ gameMode: req.params.mode });
        // कुल कितने पेजेस बन रहे हैं उसकी गणना
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        const hasMore = skip + list.length < totalRecords;

        res.json({ success: true, list, hasMore, totalPages });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// === २. यूजर द्वारा विशिष्ट गेम मोड में लगाई गई बेट्स फ़िल्टर करने की एपीआई (UPDATED WITH TOTAL PAGES) ===
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
        // कुल कितने पेजेस बन रहे हैं उसकी गणना
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        const hasMore = skip + list.length < totalRecords;

        res.json({ success: true, list, hasMore, totalPages });
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
    // Master Deposit Security Check
    if (!user.totalDeposit || Number(user.totalDeposit) <= 0) {
      return res.json({ 
        success: false, 
        message: "To play games or use your signup bonus, you must complete your first deposit/recharge first!" 
      });
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
        
        // 1. यूजर की बेट का आधा हिस्सा EXP के रूप में निकालें
const earnedEXP = Number(betAmount) / 2;

// 2. डेटाबेस में यूजर का बैलेंस काटें और EXP जोड़ें
const updatedUser = await User.findOneAndUpdate(
  { phone: phone.trim() },
  {
    $inc: {
      balance: -Number(betAmount),       
      todayBetPlay: Number(betAmount),   
      lifetimeEXP: earnedEXP             
    },
    $set: { isActiveUser: true }
  },
  { new: true } 
);

// 3. ऑटोमैटिक VIP लेवल अपग्रेड इंजन (0 से 10 स्तर तक)
let currentLevel = updatedUser.vipLevel || 0;
let nextLevel = currentLevel + 1;

while (nextLevel <= 10 && updatedUser.lifetimeEXP >= VIP_CONFIG[nextLevel].requiredEXP) {
    currentLevel = nextLevel;
    nextLevel++;
}

if (currentLevel !== updatedUser.vipLevel) {
    await User.updateOne(
        { phone: phone.trim() },
        { $set: { vipLevel: currentLevel, lastVipUpgradeDate: new Date() } }
    );
    console.log(`[VIP LEVEL UP]: User ${phone} upgraded to VIP ${currentLevel}`);
}

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

// === ४. फ्रंटएंड VIP पेज पर डेटा भेजने की एपीआई ===
app.get('/api/vip-status/:phone', async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.params.phone.trim() });
    if (!user) return res.json({ success: false, message: "User not found!" });

    const currentLevel = user.vipLevel || 0;
    const nextLevel = currentLevel < 10 ? currentLevel + 1 : 10;
    
    res.json({
      success: true,
      vipLevel: currentLevel,
      currentEXP: user.lifetimeEXP || 0,
      nextLevelRequiredEXP: VIP_CONFIG[nextLevel].requiredEXP, 
      claimedVipLevels: user.claimedVipLevels || [] 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ========================================================
//  AGENT WORK SYSTEM - PHASE 1 APIs
// ========================================================

//  API 1:       UID/Phone    
app.get('/api/agent-work/status/:phone', async (req, res) => {
    try {
        const userPhone = req.params.phone.trim();
        const user = await User.findOne({ phone: userPhone });
        
        if (!user) {
            return res.json({ success: false, message: "User not found!" });
        }

        //     UID, Phone    
        res.json({
            success: true,
            uid: user.uid,
            phone: user.phone,
            status: user.agentWorkStatus || 'None',
            agentGmail: user.agentGmail || "",
            agentAltPhone: user.agentAltPhone || ""
        });
    } catch (error) {
        console.error("Error fetching agent work status:", error);
        res.status(500).json({ success: false, message: "Server error while fetching status." });
    }
});

//  API 2:       (Apply)   
app.post('/api/agent-work/apply', async (req, res) => {
    try {
        const { phone, agentGmail, agentAltPhone } = req.body;

        if (!phone || !agentGmail || !agentAltPhone) {
            return res.json({ success: false, message: "    !" });
        }

        const user = await User.findOne({ phone: phone.trim() });
        if (!user) {
            return res.json({ success: false, message: "User not found!" });
        }

        //  :             
        if (user.agentWorkStatus === 'Pending') {
            return res.json({ success: false, message: "       !" });
        }
        if (user.agentWorkStatus === 'Approved') {
            return res.json({ success: false, message: "      !" });
        }

        //   
        user.agentWorkStatus = 'Pending';
        user.agentGmail = agentGmail.trim();
        user.agentAltPhone = agentAltPhone.trim();
        user.agentWorkAppliedAt = new Date();

        await user.save();

        res.json({ success: true, message: "    !      " });
    } catch (error) {
        console.error("Error applying for agent work:", error);
        res.status(500).json({ success: false, message: " !    " });
    }
});

//  API 3:     -       
app.get('/api/admin/agent-work/requests', async (req, res) => {
    try {
        //  'Pending'      
        const pendingAgents = await User.find({ agentWorkStatus: 'Pending' }).sort({ agentWorkAppliedAt: -1 });
        res.json({ success: true, list: pendingAgents });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

//  API 4:     - APPROVE  REJECT   
app.post('/api/admin/agent-work/action', async (req, res) => {
    try {
        const { id, action } = req.body; // id =   MongoDB _id, action = 'approve'  'reject'

        if (!id || !action) {
            return res.json({ success: false, message: "Missing required parameters!" });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.json({ success: false, message: "User record not found!" });
        }

        if (action === 'approve') {
            user.agentWorkStatus = 'Approved';
        } else if (action === 'reject') {
            user.agentWorkStatus = 'Rejected';
        } else {
            return res.json({ success: false, message: "Invalid action type!" });
        }

        await user.save();
        res.json({ success: true, message: `    ${user.agentWorkStatus}    !` });
    } catch (error) {
        console.error("Admin agent action error:", error);
        res.status(500).json({ success: false, message: "Internal server error: " + error.message });
    }
});

// === VIP    AR WALLET     API ===
app.post('/api/claim-vip-reward', async (req, res) => {
  try {
    const { phone, levelToClaim } = req.body;
    const targetLevel = Number(levelToClaim);

      if (targetLevel < 1 || targetLevel > 10) {
    return res.json({ success: false, message: "Invalid VIP level requested!" });
  }
  

    const user = await User.findOne({ phone: phone.trim() });
    if (!user) return res.json({ success: false, message: "User not found!" });

      if (user.vipLevel < targetLevel) {
    return res.json({ success: false, message: `You have not reached VIP Level ${targetLevel} yet!` });
  }
  
      if (user.claimedVipLevels && user.claimedVipLevels.includes(targetLevel)) {
    return res.json({ success: false, message: `You have already claimed the rewards for VIP Level ${targetLevel}!` });
  }
  
    const rewardAmount = VIP_CONFIG[targetLevel].reward;

    // ===  : balance   arWallet  totalCommission   ===
    await User.findOneAndUpdate(
      { phone: phone.trim() },
      {
        $inc: { 
          arWallet: rewardAmount,             //    AR Wallet  
          totalCommission: rewardAmount       //      
        },
        $push: { claimedVipLevels: targetLevel }
      }
    );

      return res.json({
    success: true,
    message: `Congratulations! Your VIP Level ${targetLevel} reward of ${rewardAmount} has been credited to your AR Wallet.`
  });
  
  } catch (err) {
      res.status(500).json({ success: false, message: "Server error! Please try again later." });
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
// ==========================================
// === LIVE ACTIVITY AREA NEW ENGINES ===
// ==========================================

// अपनी server.js फ़ाइल में /api/redeem-gift वाले हिस्से को इस कोड से बदलें:
app.post('/api/redeem-gift', async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code || phone === "undefined" || code === "") {
      return res.status(400).json({ success: false, message: "कृपया एक वैध गिफ्ट कोड डालें।" });
    }

    // FIX: मोंगूज़ मॉडल को डेटाबेस कनेक्शन से सीधे सुरक्षित रूप से उठाना
    const GiftCodeModel = mongoose.models.GiftCode || mongoose.model('GiftCode');
    const gift = await GiftCodeModel.findOne({ code: String(code).trim().toUpperCase() });
    
    if (!gift) {
      return res.status(404).json({ success: false, message: "यह गिफ्ट कोड मौजूद नहीं है या एक्सपायर हो गया है!" });
    }

    if (gift.usersRedeemed && gift.usersRedeemed.includes(String(phone).trim())) {
      return res.status(400).json({ success: false, message: "आप इस कोड को पहले ही रिडीम कर चुके हैं!" });
    }

    if (Number(gift.usedCount) >= Number(gift.maxUses)) {
      return res.status(400).json({ success: false, message: "इस गिफ्ट कोड की सीमा समाप्त हो चुकी है!" });
    }

    const UserModel = mongoose.models.User || mongoose.model('User');
    const user = await UserModel.findOne({ phone: String(phone).trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: "यूजर अकाउंट नहीं मिला!" });
    }
    // Master Deposit Security Check
    if (!user.totalDeposit || Number(user.totalDeposit) <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: "To redeem gift codes, you must complete your first deposit/recharge first!" 
      });
    }
    
    // यूजर के वॉलेट को अपडेट करना
    user.arWallet = (Number(user.arWallet) || 0) + Number(gift.amount);
    user.totalCommission = (Number(user.totalCommission) || 0) + Number(gift.amount);
    await user.save();

    // गिफ्ट कोड के यूसेज को अपडेट करना
    if (!gift.usersRedeemed) gift.usersRedeemed = [];
    gift.usersRedeemed.push(String(phone).trim());
    gift.usedCount = Number(gift.usedCount) + 1;
    await gift.save();

    // अब सर्वर शुद्ध JSON डेटा ही वापस भेजेगा, HTML पेज नहीं!
    return res.status(200).json({
      success: true,
      message: `सफलता! ₹${gift.amount} आपके AR Wallet में जोड़ दिए गए हैं।`
    });

  } catch (error) {
    console.error("GIFT REDEEM CRITICAL ERROR:", error);
    // अगर कोई और दिक्कत भी आई, तो भी यह HTML नहीं बल्कि शुद्ध JSON एरर ही भेजेगा
    return res.status(500).json({ success: false, message: "सर्वर डेटाबेस क्रैश एरर! कृपया कोड फिर से चेक करें।" });
  }
});



// 2. एडमिन के लिए नया गिफ्ट कोड जनरेट करने की API (इसे आप पोस्टमैन या एडमिन से चला सकते हैं)
app.post('/api/admin/create-gift-code', async (req, res) => {
    try {
        const { code, amount, maxUses } = req.body;
        if (!code || !amount) return res.json({ success: false, message: "Code and Amount required!" });

        const newGift = new GiftCode({
            code: String(code).trim().toUpperCase(),
            amount: Number(amount),
            maxUses: Number(maxUses || 100)
        });

        await newGift.save();
        res.json({ success: true, message: `Gift Code ${code} created successfully for ₹${amount}!` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to create code: " + error.message });
    }
});

// 3. अटेंडेंस (हाजिरी बोनस) के लिए यूजर की आज की बेटिंग चेक करने की API
app.get('/api/attendance-status/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found" });

        // हाजिरी क्लेम करने के लिए कंडीशन: आज कम से कम ₹500 की बेट खेली होनी चाहिए
        // आपके सर्वर का 'todayBetPlay' वेरिएबल इसे लाइव ट्रैक करता है
        const isConditionMet = (user.todayBetPlay || 0) >= 500;

        res.json({
            success: true,
            todayBetPlay: user.todayBetPlay || 0,
            isConditionMet: isConditionMet,
            consecutiveDays: 0, // इसे बाद में क्रॉन जॉब से सिंक करेंगे, अभी डिफ़ॉल्ट 0
            accumulated: "0.00"
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// एडमिन पैनल के लिए सभी बने हुए गिफ्ट कोड्स की लिस्ट भेजने की API
app.get('/api/admin/live-gift-codes', async (req, res) => {
    try {
        const list = await GiftCode.find({}).sort({ _id: -1 }); // नए कोड सबसे ऊपर
        res.json({ success: true, list });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === नई विथड्रॉल सबमिशन एपीआई (User End) ===
app.post('/api/place-withdrawal', async (req, res) => {
    try {
        const { uid, phone, amount, method, accountValue } = req.body;

        if (!phone || !amount || !method || !accountValue) {
            return res.json({ success: false, message: "All fields are required!" });
        }

        const user = await User.findOne({ phone: phone.trim() });
        if (!user) {
            return res.json({ success: false, message: "User account not found!" });
        }

        if (Number(user.balance) < Number(amount)) {
            return res.json({ success: false, message: "Insufficient wallet balance!" });
        }

        if (Number(amount) < 100 || Number(amount) > 50000) {
            return res.json({ success: false, message: "Amount must be between ₹100 and ₹50,000!" });
        }

        // 1. यूज़र के वॉलेट से बैलेंस तुरंत माइनस करना
        user.balance -= Number(amount);
        await user.save();

        // 2. डेटाबेस में विथड्रॉल रिकॉर्ड पेंडिंग स्टेटस के साथ सेव करना
        const newWithdrawal = new Withdrawal({
            uid: uid || "N/A",
            phone: phone.trim(),
            amount: Number(amount),
            method: method,
            accountValue: accountValue,
            status: "Pending"
        });
        await newWithdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted successfully! Verifying...", newBalance: user.balance });
    } catch (error) {
        console.error("User withdrawal error:", error);
        res.status(500).json({ success: false, message: "Server error! Please try again." });
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
// === [MASTER FIX]: यूजर विथड्रॉल हिस्ट्री लाइव डेटाबेस एपीआई ===
app.get('/api/withdrawal-history/:phone', async (req, res) => {
    try {
        const userPhone = req.params.phone;

        if (!userPhone || userPhone.trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "मोबाइल नंबर प्रदान करना अनिवार्य है!" 
            });
        }

        // विथड्रॉल कलेक्शन में यूजर के फोन नंबर से रिकॉर्ड खोजना 
        // .sort({ createdAt: -1 }) से नया विथड्रॉल हमेशा सबसे ऊपर दिखेगा
        const historyRecords = await Withdrawal.find({ phone: userPhone.trim() })
                                               .sort({ createdAt: -1 });

        console.log(`[HISTORY FETCH SUCCESS]: User ${userPhone} requested history. Found ${historyRecords.length} records.`);

        res.json({
            success: true,
            history: historyRecords
        });

    } catch (error) {
        console.error("CRITICAL HISTORY FETCH ERROR:", error);
        res.status(500).json({ 
            success: false, 
            message: "सर्वर डेटाबेस से इतिहास खींचने में असमर्थ रहा।" 
        });
    }
});
// === USER APP: GET LIVE NOTIFICATIONS ===
app.get('/api/user/notifications/:phone', async (req, res) => {
  try {
    const userPhone = String(req.params.phone).trim();

    //       'ALL' ( )        ('SINGLE') 
    const messages = await Notification.find({
      $or: [
        { type: 'ALL' },
        { type: 'SINGLE', targetUsers: userPhone }
      ]
    }).sort({ createdAt: -1 }); //    

    return res.json({ success: true, notifications: messages });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error fetching notifications." });
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

    // [MASTER FIX]: स्वीकृत विथड्रॉल राशि की गणना करना
    const approvedWithdrawals = await Withdrawal.find({ status: "Approved" });
    let totalWithdrawalBalance = 0;
    approvedWithdrawals.forEach(w => {
        totalWithdrawalBalance += Number(w.amount || 0);
    });

    res.json({
        success: true,
        totalUsers,
        totalWalletBalance: Number(totalWalletBalance.toFixed(2)),
        totalWithdrawalBalance: Number(totalWithdrawalBalance.toFixed(2)), // फ्रंटएंड के लिए आवश्यक लाइन
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
// === 1. यूजर का व्हील स्टेटस (Today Win और Lifetime Total) भेजने की API ===
app.get('/api/wheel-status/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found" });
        
        const history = await WheelHistory.find({ phone: req.params.phone.trim() }).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            todayUncachedSpinEarned: user.todaySpinWallet || 0, // बॉक्स 1 के लिए डेटा
            lifetimeTotalSpinEarned: user.lifetimeSpinTotal || 0, // बॉक्स 2 के लिए डेटा
            inviteSpinsAvailable: user.inviteSpinsAvailable || 0,
            depositSpinsAvailable: user.depositSpinsAvailable || 0,
            history
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// === 2. व्हील स्पिन करने और 'Today Win' + 'Lifetime Total' दोनों में प्लस करने की API ===
app.post('/api/spin-wheel', async (req, res) => {
    try {
        const { phone, spinType } = req.body;
        const user = await User.findOne({ phone: phone.trim() });
        
        if (!user) return res.json({ success: false, message: "User not found!" });

        if (spinType === 'invite' && (user.inviteSpinsAvailable || 0) <= 0) {
            return res.json({ success: false, message: "No invite spins available!" });
        }
        if (spinType === 'deposit' && (user.depositSpinsAvailable || 0) <= 0) {
            return res.json({ success: false, message: "No deposit spins available!" });
        }

        let calculatedRewardAmt = 0;
        if (spinType === 'deposit') {
            const lastApprovedDeposit = await Deposit.findOne({ phone: user.phone, status: "Approved" }).sort({ createdAt: -1 });
            const baseAmountReference = lastApprovedDeposit ? lastApprovedDeposit.amount : 100;
            calculatedRewardAmt = baseAmountReference * (Math.random() * (0.06 - 0.02) + 0.02); // 2% से 6%
        } else {
            calculatedRewardAmt = 300 * (Math.random() * (0.06 - 0.02) + 0.02);
        }

        calculatedRewardAmt = Number(Number(calculatedRewardAmt).toFixed(2));
        if (calculatedRewardAmt < 2) calculatedRewardAmt = 2.50;

        const spinDecrementField = spinType === 'invite' ? { inviteSpinsAvailable: -1 } : { depositSpinsAvailable: -1 };
        
        // स्पिन होने पर पैसा सीधे 'todaySpinWallet' और 'lifetimeSpinTotal' में रिकॉर्ड होगा
        await User.findOneAndUpdate(
            { phone: user.phone },
            {
                $inc: {
                    todaySpinWallet: calculatedRewardAmt,
                    lifetimeSpinTotal: calculatedRewardAmt,
                    ...spinDecrementField
                }
            }
        );

        const newLog = new WheelHistory({ phone: user.phone, spinType, amountWon: calculatedRewardAmt });
        await newLog.save();

        res.json({ success: true, amountWon: calculatedRewardAmt, message: "Spin success!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server spin error." });
    }
});

// === 3. Cash Out API: 'Today Win' से पैसा काटकर सीधे 'arWallet' में भेजने का मास्टर लॉजिक ===
app.post('/api/wheel-cashout', async (req, res) => {
    try {
        const { phone } = req.body;
        const user = await User.findOne({ phone: phone.trim() });
        
        if (!user) return res.json({ success: false, message: "User not found!" });
            // Master Deposit Security Check
    if (!user.totalDeposit || Number(user.totalDeposit) <= 0) {
      return res.json({ 
        success: false, 
        message: "To transfer funds from AR Wallet to Main Wallet, you must complete your first deposit/recharge first!" 
      });
    }
        const transferAmount = user.todaySpinWallet || 0;
        if (transferAmount <= 0) {
            return res.json({ success: false, message: "Today's earning box is empty!" });
        }
        
        // 🌟 फाइनल एक्शन: आज की कमाई को 0 करो और सारा पैसा उठाकर सीधे arWallet में प्लस कर दो!
        await User.findOneAndUpdate(
            { phone: user.phone },
            {
                $set: { todaySpinWallet: 0 },
                $inc: { arWallet: transferAmount } // पैसा कन्फर्म सीधे आपके arWallet में चला गया
            }
        );
        
        res.json({ success: true, message: "Successfully transferred to arWallet!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Cashout operation failed." });
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

// === ADMIN PANEL: SEND & BROADCAST NOTIFICATION API ===
app.post('/api/admin/send-notification', async (req, res) => {
  try {
    const { type, targetUsers, message } = req.body;

    //   
    if (!type || !message) {
      return res.json({ success: false, message: "Missing required notification fields!" });
    }

    //        
    const newNotification = new Notification({
      type: type, // 'ALL'  'SINGLE'
      targetUsers: type === 'SINGLE' ? targetUsers : [], //  Single      
      message: message.trim(),
      createdAt: new Date()
    });

    await newNotification.save();

    return res.json({ 
      success: true, 
      message: "Notification broadcast parameters synced and stored successfully!" 
    });

  } catch (error) {
    console.error("NOTIFICATION SYSTEM CRITICAL ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server database failure." });
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
            // 2. यूज़र मॉडल को ढूँढना
            const UserModel = mongoose.models.User || mongoose.model('User');
            
            // नियम: अगर डिपॉजिट ₹100 या उससे अधिक है तो खुद का 1 स्पिन जोड़ें
            let selfSpinAdd = 0;
            if (Number(depositItem.amount) >= 100) {
                selfSpinAdd = 1;
            }

            // सीधे $inc का उपयोग करके बैलेंस, आज का डिपॉजिट, लाइफटाइम डिपॉजिट और स्पिन एक साथ बढ़ाना
            const updatedUser = await UserModel.findOneAndUpdate(
                { phone: depositItem.phone.trim() },
                {
                    $inc: {
                        balance: Number(depositItem.amount), // यूज़र का गेम बैलेंस बढ़ा
                        todayDeposit: Number(depositItem.amount), // आज के कुल रिचार्ज में जुड़ा
                        totalDeposit: Number(depositItem.amount), // लाइफटाइम कुल रिचार्ज में जुड़ा
                        depositSpinsAvailable: selfSpinAdd // यहाँ आपका 1 सेल्फ डिपॉजिट स्पिन क्रेडिट हुआ
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                return res.json({ success: false, message: `User with phone ${depositItem.phone} not found!` });
            }

            // --- इनवाइट दोस्त वाला नियम (अगर इस यूजर का कोई पैरेंट एजेंट है और रिचार्ज ≥ ₹300 है) ---
            if (updatedUser.referredBy && Number(depositItem.amount) >= 300) {
                await UserModel.findOneAndUpdate(
                    { phone: updatedUser.referredBy.trim() },
                    { $inc: { inviteSpinsAvailable: 1 } } // इनवाइट करने वाले एजेंट को 1 लकी स्पिन मिला
                );
                console.log(`[WHEEL SUCCESS]: Agent ${updatedUser.referredBy} awarded 1 Spin for inviting ${updatedUser.phone}`);
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
// === 1. एडमिन पैनल के लिए सभी पेंडिंग विथड्रॉल की लिस्ट भेजने की API ===
app.get('/api/admin/pending-withdrawals', async (req, res) => {
    try {
        const list = await Withdrawal.find({ status: "Pending" }).sort({ createdAt: -1 });
        res.json({ success: true, list });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// === 2. एडमिन पैनल द्वारा विथड्रॉल को APPROVE या REJECT करने की मुख्य API ===
app.post('/api/admin/action-withdrawal', async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !action) {
            return res.json({ success: false, message: "Missing id or action parameter!" });
        }

        const withdrawItem = await Withdrawal.findById(id);
        if (!withdrawItem) {
            return res.json({ success: false, message: "Withdrawal record not found!" });
        }

        if (withdrawItem.status !== "Pending") {
            return res.json({ success: false, message: "This request has already been processed!" });
        }

        if (action === 'approve') {
            // अप्रूव होने पर बैलेंस फ्रंटएंड से पहले ही कट चुका है, इसलिए सिर्फ स्टेटस अपडेट होगा
            withdrawItem.status = "Approved";
        } else if (action === 'reject') {
            // रिजेक्ट होने पर पैसे यूज़र के वॉलेट में वापस (Refund) क्रेडिट कर दिए जाएंगे
            const UserModel = mongoose.models.User || mongoose.model('User');
            await UserModel.findOneAndUpdate(
                { phone: withdrawItem.phone.trim() },
                { $inc: { balance: Number(withdrawItem.amount) } }
            );
            withdrawItem.status = "Rejected";
        }

        await withdrawItem.save();
        return res.json({ success: true, message: `Withdrawal request successfully ${withdrawItem.status}!` });
    } catch (error) {
        console.error("Admin Withdrawal Action Error:", error);
        return res.status(500).json({ success: false, message: "Server error: " + error.message });
    }
});
// =========================================================================
// === 5 NEW API ROUTES FOR AGENT COMMISSION SYSTEM & DASHBOARDS ===
// =========================================================================

// 1. मुख्य प्रमोशन पेज के लिए समरी डेटा रूट्स (/api/agent-summary/:phone)
app.get('/api/agent-summary/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found" });
        
        res.json({
            success: true,
            yesterdayCommission: user.yesterdayCommission || 0,
            totalCommission: user.totalCommission || 0,
            inviteCode: user.inviteCode || ""
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. कमीशन डिटेल्स पेज के लिए आज का कुल टीम टर्नओवर (/api/team-turnover-summary/:phone)
app.get('/api/team-turnover-summary/:phone', async (req, res) => {
    try {
        const agentPhone = req.params.phone.trim();
        
        // Level 1 ढूँढना
        const level1Users = await User.find({ referredBy: agentPhone });
        const l1Phones = level1Users.map(u => u.phone);
        
        // Level 2 ढूँढना
        const level2Users = await User.find({ referredBy: { $in: l1Phones } });
        const l2Phones = level2Users.map(u => u.phone);
        
        // Level 3 ढूँढना
        const level3Users = await User.find({ referredBy: { $in: l2Phones } });
        
        // तीनों लेवल्स का आज का कुल टर्नओवर जोड़ना
        let todayTotalTurnover = 0;
        level1Users.forEach(u => todayTotalTurnover += (u.todayBetPlay || 0));
        level2Users.forEach(u => todayTotalTurnover += (u.todayBetPlay || 0));
        level3Users.forEach(u => todayTotalTurnover += (u.todayBetPlay || 0));
        
        res.json({ success: true, todayTotalTurnover });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. कमीशन डिटेल्स पेज के लिए लेवल-वाइज टीम लिस्ट (/api/team-details/:phone/:levelNumber)
app.get('/api/team-details/:phone/:levelNumber', async (req, res) => {
    try {
        const agentPhone = req.params.phone.trim();
        const levelNum = parseInt(req.params.levelNumber);
        let targetUsers = [];
        
        // Level 1 यूज़र्स
        const level1Users = await User.find({ referredBy: agentPhone });
        
        if (levelNum === 1) {
            targetUsers = level1Users;
        } else {
            const l1Phones = level1Users.map(u => u.phone);
            const level2Users = await User.find({ referredBy: { $in: l1Phones } });
            
            if (levelNum === 2) {
                targetUsers = level2Users;
            } else if (levelNum === 3) {
                const l2Phones = level2Users.map(u => u.phone);
                targetUsers = await User.find({ referredBy: { $in: l2Phones } });
            }
        }
        
        // फ्रंटएंड बैनर के लिए साफ़-सुथरी लिस्ट तैयार करना
        const usersList = targetUsers.map(u => ({
            uid: u.uid,
            todayBetPlay: u.todayBetPlay || 0,
            isActiveUser: u.isActiveUser || false,
            createdAt: u.createdAt
        }));
        
        res.json({ success: true, usersList });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. डिपॉजिट बोनस पेज के लिए मुख्य डैशबोर्ड नंबर्स (/api/deposit-dashboard-summary/:phone)
app.get('/api/deposit-dashboard-summary/:phone', async (req, res) => {
    try {
        const agentPhone = req.params.phone.trim();
        
        // एजेंट ने जितने लोगों को सीधा इनवाइट किया है (Direct / Level 1)
        const directUsers = await User.find({ referredBy: agentPhone });
        
        // कम्प्लीट वे हैं जिनका कुल रिचार्ज ₹300 या उससे ज़्यादा है
        let completeUsersCount = 0;
        let incompleteUsersCount = 0;
        
        directUsers.forEach(u => {
            if ((u.totalDeposit || 0) >= 300) {
                completeUsersCount++;
            } else {
                incompleteUsersCount++;
            }
        });
        
        // टास्क क्लेम ट्रैकिंग के लिए क्लेम की हुई आईडी की लिस्ट
        const agentUserObj = await User.findOne({ phone: agentPhone });
        const claimedMilestoneIds = agentUserObj ? agentUserObj.claimedMilestoneIds : [];
        
        res.json({
            success: true,
            totalValidInvites: completeUsersCount, // 1, 3, 5 टास्क के प्रोग्रेस बार के लिए
            completeUsersCount,
            incompleteUsersCount,
            claimedMilestoneIds
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. डिपॉजिट बोनस पेज के लिए कम्प्लीट/इनकम्प्लीट यूज़र्स की लिस्ट (/api/deposit-users-list/:phone/:userTabType)
app.get('/api/deposit-users-list/:phone/:userTabType', async (req, res) => {
    try {
        const agentPhone = req.params.phone.trim();
        const tabType = req.params.userTabType.trim(); // 'complete' या 'incomplete'
        
        const directUsers = await User.find({ referredBy: agentPhone });
        let filteredUsers = [];
        
        directUsers.forEach(u => {
            const hasDeposited300 = (u.totalDeposit || 0) >= 300;
            if (tabType === 'complete' && hasDeposited300) {
                filteredUsers.push(u);
            } else if (tabType === 'incomplete' && !hasDeposited300) {
                filteredUsers.push(u);
            }
        });
        
        const usersList = filteredUsers.map(u => ({
            uid: u.uid,
            todayDeposit: u.todayDeposit || 0,
            totalDeposit: u.totalDeposit || 0,
            createdAt: u.createdAt
        }));
        
        res.json({ success: true, usersList });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. इनवाइटेड यूज़र्स (Direct Link List) पेज के लिए रूट्स (/api/direct-invited-details/:phone)
app.get('/api/direct-invited-details/:phone', async (req, res) => {
    try {
        const agentPhone = req.params.phone.trim();
        const directUsers = await User.find({ referredBy: agentPhone });
        
        const usersList = directUsers.map(u => ({
            uid: u.uid,
            todayDeposit: u.todayDeposit || 0,
            totalDeposit: u.totalDeposit || 0,
            isActiveUser: u.isActiveUser || false,
            createdAt: u.createdAt
        }));
        
        res.json({ success: true, usersList });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// =========================================================================
// === DAILY AUTOMATIC ENGINE (रोज़ रात ठीक 12:00 बजे चलने वाली स्क्रिप्ट) ===
// =========================================================================

// === [UPDATED: बोनस सीधे AR WALLET में तुरंत जमा होगा] ===
app.post('/api/claim-milestone-reward', async (req, res) => {
    try {
        const { phone, milestoneId, bonusAmount } = req.body;
        if (!phone || !milestoneId || !bonusAmount) {
            return res.json({ success: false, message: "Missing required parameters!" });
        }

        const user = await User.findOne({ phone: phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found!" });

        if (user.claimedMilestoneIds && user.claimedMilestoneIds.includes(milestoneId)) {
            return res.json({ success: false, message: "This milestone bonus has already been claimed!" });
        }

        // [बदलाव]: पैसा सीधे 'arWallet' में तुरंत प्लस होगा और 'totalCommission' रिकॉर्ड में दर्ज होगा
        await User.findOneAndUpdate(
            { phone: phone.trim() },
            { 
                $inc: { 
                    arWallet: Number(bonusAmount),         // तुरंत तिजोरी में जुड़ गया
                    totalCommission: Number(bonusAmount),   // लाइफटाइम रिकॉर्ड में जुड़ा
                    yesterdayCommission: Number(bonusAmount)
                },
                $push: { claimedMilestoneIds: milestoneId }
            }
        );

        res.json({ success: true, message: "Bonus transferred instantly to your AR Wallet!" });
    } catch (error) {
        console.error("Claim reward server error:", error);
        res.status(500).json({ success: false, message: "Server error during claiming." });
    }
});

// === 4. NEW API: AR WALLET से BALANCE (MAIN WALLET) में पैसा ट्रांसफर करना ===
app.post('/api/transfer-ar-to-main', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.json({ success: false, message: "User phone is required!" });

        // यूजर को डेटाबेस में ढूँढना
        const user = await User.findOne({ phone: phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found!" });

        const currentArBalance = Number(user.arWallet || 0);

        // चेक करना कि तिजोरी में पैसे हैं भी या नहीं
        if (currentArBalance <= 0) {
            return res.json({ success: false, message: "Your AR Wallet balance is 0. Nothing to transfer!" });
        }

        // [जादू लॉजिक]: arWallet को तुरंत 0 करना और गेम balance में सारा पैसा प्लस करना
        await User.findOneAndUpdate(
            { phone: phone.trim() },
            {
                $set: { arWallet: 0 },               // तिजोरी खाली (Zero) हो गई
                $inc: { balance: currentArBalance } // पूरा पैसा मेन वॉलेट गेमिंग बैलेंस में जुड़ गया
            }
        );

        res.json({ 
            success: true, 
            message: `Successfully transferred ₹${currentArBalance.toFixed(2)} to your Main Wallet!` 
        });

    } catch (err) {
        console.error("AR Wallet transfer API failed:", err);
        res.status(500).json({ success: false, message: "Server error during wallet transfer." });
    }
});

// === 5. मुख्य डैशबोर्ड पर arWallet बैलेंस भेजने के लिए पुरानी एपीआई में रिस्पॉन्स अपडेट करना ===
// (नोट: जो हमने /api/agent-summary/:phone बनाई थी, उसमें arWallet भी रिटर्न कर देंगे)
app.get('/api/agent-summary-updated/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found" });
        
        res.json({
            success: true,
            yesterdayCommission: user.yesterdayCommission || 0,
            totalCommission: user.totalCommission || 0,
            inviteCode: user.inviteCode || "" ,
            arWallet: user.arWallet || 0 // <--- यह नया डेटा फ्रंटएंड डैशबोर्ड के लिए जाएगा
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// === [UPDATED: रात 12 बजे का कमीशन अपने आप AR WALLET में ट्रांसफर होगा] ===
function startDailyNightCommissionCronJob() {
    console.log("[CRON JOB] Automatic 12:00 AM Commission Scheduler Active.");

    setInterval(async () => {
        const now = new Date();
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentSeconds = now.getSeconds();

        if (currentHours === 0 && currentMinutes === 0 && currentSeconds === 0) {
        	        // === [VIP MAINTENANCE ENGINE] ===
        try {
            const activeVipUsers = await User.find({ vipLevel: { $gt: 0 } });
            const thirtyDaysAgoDate = new Date();
            thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30); 

            for (let targetUser of activeVipUsers) {
                if (targetUser.lastVipUpgradeDate < thirtyDaysAgoDate) {
                    const currentLevel = targetUser.vipLevel;
                    const requiredExpAmount = VIP_CONFIG[currentLevel].requiredEXP;

                    if (targetUser.lifetimeEXP < requiredExpAmount) {
                        let loweredVipLevel = currentLevel - 1; 
                        let reducedEXP = VIP_CONFIG[loweredVipLevel] ? VIP_CONFIG[loweredVipLevel].requiredEXP : 0;

                        await User.findByIdAndUpdate(targetUser._id, {
                            $set: { 
                                vipLevel: loweredVipLevel,
                                lifetimeEXP: reducedEXP,
                                lastVipUpgradeDate: new Date() 
                            }
                        });
                        console.log(`[VIP DOWNGRADE SUCCESS]: User ${targetUser.phone} dropped to VIP ${loweredVipLevel}`);
                    }
                }
            }
        } catch (vipCronError) {
            console.error("VIP Downgrade Engine Execution Error:", vipCronError);
        }
        
            console.log("[CRON ENGINE] Midnight 12:00 AM discovered. Processing AR Wallet transfers...");

            try {
                const allUsersList = await User.find({});

                for (let agent of allUsersList) {
                    let calculatedBonusAmt = 0;

                    // Level 1 टर्नओवर (0.01%)
                    const level1Users = await User.find({ referredBy: agent.phone });
                    level1Users.forEach(u => calculatedBonusAmt += (u.todayBetPlay || 0) * 0.0001); 

                    // Level 2 टर्नओवर (0.001%)
                    const l1Phones = level1Users.map(u => u.phone);
                    const level2Users = await User.find({ referredBy: { $in: l1Phones } });
                    level2Users.forEach(u => calculatedBonusAmt += (u.todayBetPlay || 0) * 0.00001); 

                    // Level 3 टर्नओवर (0.001%)
                    const l2Phones = level2Users.map(u => u.phone);
                    const level3Users = await User.find({ referredBy: { $in: l2Phones } });
                    level3Users.forEach(u => calculatedBonusAmt += (u.todayBetPlay || 0) * 0.00001); 

                    if (calculatedBonusAmt > 0) {
                        // [बदलाव]: रोज़ रात 12 बजे का कमीशन सीधे 'arWallet' तिजोरी में जमा होगा
                        await User.findByIdAndUpdate(agent._id, {
                            $set: { yesterdayCommission: calculatedBonusAmt }, 
                            $inc: { 
                                arWallet: calculatedBonusAmt,      // तिजोरी में अपने आप चला गया
                                totalCommission: calculatedBonusAmt // रिकॉर्ड में प्लस हुआ
                            }
                        });
                    } else {
                        await User.findByIdAndUpdate(agent._id, {
                            $set: { yesterdayCommission: 0 }
                        });
                    }
                }

                // मास्टर रीसेट
                await User.updateMany({}, {
                    $set: { todayBetPlay: 0, todayDeposit: 0, isActiveUser: false }
                });

                console.log("[CRON ENGINE SUCCESS] Midnight commissions added to AR Wallet and day counters reset.");
            } catch (cronError) {
                console.error("[CRON CRITICAL ERROR] Midnight operations failed:", cronError);
            }
        }
    }, 1000); 
}
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
    startDailyNightCommissionCronJob(); // <--- रात 12 बजे वाला नया कमीशन इंजन यहाँ चालू कर दिया
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
    .catch(err => {
        console.error("Database connection error:", err);
    });
    