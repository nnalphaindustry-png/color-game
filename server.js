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
// This open headers override configuration will allow your local phone file to load data
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(express.static(path.join(__dirname, '')));

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  
  //   33  43    
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
app.post('/api/register', async (req, res) => {
  try {
    // फ्रंटएंड से 'ref' (इनवाइट करने वाले का मोबाइल नंबर) भी स्वीकार करेंगे
    const { phone, password, ref } = req.body; 
    const exists = await User.findOne({ phone });
    if (exists) return res.json({ success: false, message: "This mobile number is already registered!" });
    
    // चेक करें कि इनवाइट करने वाला वाकई हमारे डेटाबेस में है या नहीं
    let referrer = null;
    if (ref && ref.trim() !== "" && ref !== "null" && ref !== "undefined") {
      const checkReferrer = await User.findOne({ phone: ref });
      if (checkReferrer) {
        referrer = ref;
      }
    }

    const newUser = new User({ 
      phone, 
      password, 
      balance: 70, // आपका डिफ़ॉल्ट साइन-अप बोनस
      referredBy: referrer 
    });
    await newUser.save();
    res.json({ success: true, message: "Registration successful!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error!" });
  }
});
// 📢 नोटिफिकेशन और अलर्ट के लिए नया डेटाबेस स्कीमा
const NoticeSchema = new mongoose.Schema({
    message: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String,
        default: null // भविष्य में इमेज लिंक डालने के लिए
    },
    createdAt: {
        type: Date,
        default: Date.now // सर्वर अपने आप लाइव टाइम नोट करेगा
    }
});

// मॉडल को एक्सपोर्ट करना
const Notice = mongoose.model('Notice', NoticeSchema);
// 🎧 Customer Helpdesk Ticket Database Schema
const ComplaintSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true // Store chosen category like Deposit, Withdrawal etc.
    },
    message: {
        type: String,
        required: true
    },
    status: {
        type: String,
        default: "Pending" // Pending, Resolved, or Rejected
    },
    createdAt: {
        type: Date,
        default: Date.now // Server will record exact live time automatically
    }
});

// Exporting the Complaint Model
const Complaint = mongoose.model('Complaint', ComplaintSchema);


app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.json({ success: false, message: "Invalid mobile number or password!" });
        res.json({ success: true, phone: user.phone, message: "Login successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error!" });
    }
});

app.get('/api/balance/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) return res.json({ success: false, message: "User not found!" });
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error!" });
    }
});
// 📑 API to fetch Deposit History for a specific user
app.get('/api/deposit-history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    // डेटाबेस से यूज़र के सभी डिपॉजिट्स निकालकर लेटेस्ट वाले पहले दिखाएगा
    const history = await Deposit.find({ phone }).sort({ createdAt: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error fetching history!" });
  }
});
// 📑 API to fetch Withdraw History for a specific user
app.get('/api/withdraw-history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    // डेटाबेस से यूज़र के सभी विड्रॉल रिकॉर्ड निकालकर लेटेस्ट वाले पहले दिखाएगा
    // ध्यान रखें: आपके मॉडल का नाम 'Withdraw' या जो भी हो, उसके अनुसार चेक करें
    const history = await Withdraw.find({ phone }).sort({ createdAt: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error fetching withdraw history!" });
  }
});
// 📊 API to fetch Game History (Bets) for a specific user
app.get('/api/game-history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    
    // डेटाबेस से यूज़र के सभी बेट्स (bets) निकालकर लेटेस्ट वाले पहले दिखाएगा
    // ध्यान रखें: आपके डेटाबेस मॉडल का नाम 'Bet' होना चाहिए जो हमने पहले place_bet में देखा था
    const history = await Bet.find({ phone }).sort({ createdAt: -1 }).limit(50); 
    
    res.json({ success: true, history });
  } catch (err) {
    console.error("Game history error:", err);
    res.status(500).json({ success: false, message: "Server error fetching game history!" });
  }
});
// 📝 API to fetch Wallet Transactions for a specific user
app.get('/api/transaction-history/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    
    // हम डेटाबेस से डिपॉजिट और विड्रॉल दोनों निकाल रहे हैं ताकि पासबुक बन सके
    const deposits = await Deposit.find({ phone, status: 'SUCCESS' }).lean();
    const withdraws = await Withdraw.find({ phone }).lean();
    const bets = await Bet.find({ phone }).lean();

    // सभी रिकॉर्ड्स को एक लिस्ट में मिलाकर 'Transaction' फॉर्मेट देना
    let txList = [];

    deposits.forEach(d => txList.push({ type: 'Deposit Info', amount: d.amount, isPlus: true, createdAt: d.createdAt }));
    withdraws.forEach(w => txList.push({ type: `Withdrawal (${w.status})`, amount: w.amount, isPlus: false, createdAt: w.createdAt }));
    bets.forEach(b => {
      txList.push({ type: 'Game Bet Placed', amount: b.amount, isPlus: false, createdAt: b.createdAt });
      if(b.status === 'WIN') {
        txList.push({ type: 'Game Winning Bonus', amount: b.winAmount, isPlus: true, createdAt: b.createdAt });
      }
    });

    // तारीख के हिसाब से लेटेस्ट ट्रांजैक्शन सबसे ऊपर सेट करना
    txList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, history: txList.slice(0, 50) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error fetching transactions!" });
  }
});

app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));
app.get('/deposit', (req, res) => res.sendFile(path.join(__dirname, 'deposit.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname, 'withdraw.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/user/submit-deposit', async (req, res) => {
    try {
        const { phone, amount, utr } = req.body;
        if (!utr || utr.length !== 12 || isNaN(utr)) {
            return res.json({ success: false, message: "Error: Please enter a valid 12-digit UTR number!" });
        }
        const existingTx = await Deposit.findOne({ utrNumber: utr });
        if (existingTx) return res.json({ success: false, message: "This UTR number has already been used!" });
        const newDeposit = new Deposit({ phone, amount: parseInt(amount), utrNumber: utr, status: 'PENDING' });
        await newDeposit.save();
        res.json({ success: true, message: "Deposit request submitted successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Deposit server error!" });
    }
});

app.post('/api/user/submit-withdraw', async (req, res) => {
    try {
        const { phone, amount, method, details } = req.body;
        const withdrawAmount = parseInt(amount);
        if (isNaN(withdrawAmount) || withdrawAmount < 100) return res.json({ success: false, message: "Minimum withdrawal limit is 100!" });
        const user = await User.findOne({ phone });
        if (!user || user.balance < withdrawAmount) return res.json({ success: false, message: "Insufficient wallet balance!" });
        
        user.balance -= withdrawAmount;
        await user.save();
        const newWithdraw = new Withdraw({ phone, amount: withdrawAmount, method, details, status: 'PENDING' });
        await newWithdraw.save();
        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Withdrawal server error!" });
    }
});
let gameStates = {
    '30s': { countdown: 30, period: "100001", history: [] },
    '1m': { countdown: 60, period: "300001", history: [] },
    '3m': { countdown: 180, period: "500001", history: [] },
    '5m': { countdown: 300, period: "700001", history: [] }
};

let manualControls = { '30s': null, '1m': null, '3m': null, '5m': null };
let adminUpiConfig = "";
let adminBankConfig = "";
let processingLocks = { '30s': false, '1m': false, '3m': false, '5m': false };

async function initializeGameHistory() {
    for (let mode of Object.keys(gameStates)) {
        // 1.       20   
        const records = await GameHistory.find({ mode }).sort({ createdAt: -1 }).limit(20);
        gameStates[mode].history = records.map(r => ({
            period: r.period, number: r.number, bigSmall: r.bigSmall, color: r.color
        }));

        // 2.    ,          
        const lastRecord = await GameHistory.findOne({ mode }).sort({ period: -1 });

        if (lastRecord && lastRecord.period) {
            //     (   ),     +1 
            gameStates[mode].period = String(Number(lastRecord.period) + 1);
        } else {
            //     ,   1    
            console.log(`[Game Init] No previous records for ${mode}. Using default.`);
        }
    }
}


async function generateMultiGameResult(mode) {
    if (processingLocks[mode]) return;
    processingLocks[mode] = true;
    try {
        const game = gameStates[mode];
        let forcedNum = manualControls[mode];
        let winningNumber;

        if (forcedNum !== null && forcedNum !== undefined) {
            winningNumber = forcedNum;
        } else {
            const currentFinishedPeriod = game.period;
            const activeBets = await Bet.find({ period: currentFinishedPeriod, mode, status: 'PENDING' });

            if (activeBets.length === 0) {
                winningNumber = Math.floor(Math.random() * 10);
            } else {
                let numberInvestments = Array(10).fill(0);
                
                activeBets.forEach(bet => {
                    let amt = bet.amount;
                    let val = bet.selectValue;

                    if (!isNaN(val)) {
                        numberInvestments[parseInt(val)] += (amt * 9);
                    } else if (val === 'Big') {
                        for(let i=5; i<=9; i++) numberInvestments[i] += (amt * 2);
                    } else if (val === 'Small') {
                        for(let i=0; i<=4; i++) numberInvestments[i] += (amt * 2);
                    } else if (val === 'Green') {
                        [1, 3, 7, 9].forEach(n => numberInvestments[n] += (amt * 2));
                        numberInvestments[5] += (amt * 1.5);
                    } else if (val === 'Red') {
                        [2, 4, 6, 8].forEach(n => numberInvestments[n] += (amt * 2));
                        numberInvestments[0] += (amt * 1.5);
                    } else if (val === 'Violet') {
                        [0, 5].forEach(n => numberInvestments[n] += (amt * 4.5));
                    }
                });

                let minPayout = numberInvestments[0];
                winningNumber = 0;
                for (let i = 1; i < 10; i++) {
                    if (numberInvestments[i] < minPayout) {
                        minPayout = numberInvestments[i];
                        winningNumber = i;
                    }
                }
            }
        }

        manualControls[mode] = null;
        const winningBigSmall = winningNumber >= 5 ? 'Big' : 'Small';
        
        let winningColor = 'Red';
        let greenNums = [1, 3, 7, 9, 5];
        if (greenNums.includes(winningNumber)) winningColor = 'Green';
        if (winningNumber === 5) winningColor = 'Green-Violet';
        if (winningNumber === 0) winningColor = 'Red-Violet';
        
        const currentFinishedPeriod = game.period;
        await processUserBetsOutcome(mode, currentFinishedPeriod, winningNumber, winningColor, winningBigSmall);
        
        const resultEntry = { period: currentFinishedPeriod, number: winningNumber, bigSmall: winningBigSmall, color: winningColor };
        game.history.unshift(resultEntry);
        if (game.history.length > 30) game.history.pop();
        
        const savedHistory = new GameHistory({ mode, period: currentFinishedPeriod, number: winningNumber, bigSmall: winningBigSmall, color: winningColor });
        await savedHistory.save();
        
        game.period = String(Number(game.period) + 1);
        io.emit('game_result', { mode: mode, newResult: resultEntry, nextPeriod: game.period, history: game.history });
    } catch (error) {
        console.error(`[Engine Error] Mode ${mode}:`, error);
    } finally {
        processingLocks[mode] = false;
    }
}

// ==========================================
// 1. एजेंट का VIP टियर और कमीशन प्रतिशत (%) तय करने का नियम
// ==========================================
function getAgentCommissionRate(inviteCount) {
  if (inviteCount >= 500) return 0.012; // Diamond Agent: 1.2% कमीशन
  if (inviteCount >= 100) return 0.010; // Gold Agent: 1.0% कमीशन
  if (inviteCount >= 50)  return 0.008; // Silver Agent: 0.8% कमीशन
  return 0.006;                         // Bronze Agent: 0.6% कमीशन (शुरुआती स्तर)
}

// ==========================================
// 2. पूरा अपग्रेड किया हुआ बेट आउटकम फंक्शन (कमीशन के साथ)
// ==========================================
async function processUserBetsOutcome(mode, period, winNum, winColor, winBigSmall) {
  const activeBets = await Bet.find({ period, mode, status: 'PENDING' });
  for (let bet of activeBets) {
    let isWin = false;
    let multiplier = 2;
    if (!isNaN(bet.selectValue)) {
      if (parseInt(bet.selectValue) === winNum) { isWin = true; multiplier = 9; }
    } else if (bet.selectValue === winBigSmall) {
      isWin = true; multiplier = 2;
    } else if (winColor.includes(bet.selectValue)) {
      isWin = true; multiplier = winColor.includes('-Violet') ? 1.5 : 2;
    }
    
    if (isWin) {
      bet.status = 'WIN';
      bet.winAmount = bet.amount * multiplier;
      await User.updateOne({ phone: bet.phone }, { $inc: { balance: bet.winAmount } });
    } else {
      bet.status = 'LOSS';
      bet.winAmount = 0;
    }
    await bet.save();

    // 💸 लाइव बेटिंग प्रतिशत कमीशन लॉजिक 💸
    try {
      const currentUser = await User.findOne({ phone: bet.phone });
      // अगर इस यूजर को किसी ने इनवाइट किया है, तो ही कमीशन प्रोसेस होगा
      if (currentUser && currentUser.referredBy) {
        const parentAgent = await User.findOne({ phone: currentUser.referredBy });
        if (parentAgent) {
          // चेक करें कि एजेंट ने टोटल कितने ऐसे लोगों को जोड़ा है जिन्होंने ₹300+ का सफल डिपॉजिट किया है
          const validInvitesCount = await User.countDocuments({ 
            referredBy: parentAgent.phone,
            phone: { $in: await Deposit.distinct("phone", { status: 'SUCCESS', amount: { $gte: 300 } }) }
          });
          
          // एजेंट के टियर के हिसाब से कमीशन की दर निकालें
          const rate = getAgentCommissionRate(validInvitesCount);
          const commissionAmount = bet.amount * rate;
          
          // एजेंट के प्रमोशन वॉलेट में कमीशन प्लस करें
          parentAgent.promoBalance += commissionAmount;
          parentAgent.totalCommissionEarned += commissionAmount;
          await parentAgent.save();
        }
      }
    } catch (commissionError) {
      console.error("Error processing agent commission:", commissionError);
    }

    if (bet.socketId) {
      io.to(bet.socketId).emit('bet_outcome', { status: bet.status, winAmount: bet.winAmount, period: period });
    }
  }
}


setInterval(() => {
    for (let mode of Object.keys(gameStates)) {
        const game = gameStates[mode];
        game.countdown--;
        io.emit('time_update', { mode: mode, countdown: game.countdown, period: game.period });
        if (game.countdown <= 0) {
            if (mode === '30s') game.countdown = 30;
            if (mode === '1m') game.countdown = 60;
            if (mode === '3m') game.countdown = 180;
            if (mode === '5m') game.countdown = 300;
            generateMultiGameResult(mode);
        }
    }
}, 1000);
io.on('connection', (socket) => {
    socket.emit('all_modes_state', gameStates);
    
    socket.on('place_bet', async (data) => {
  try {
    const { phone, mode, selectValue, amount } = data;
    const betAmount = parseInt(amount);

    if (gameStates[mode].countdown <= 5) {
      return socket.emit('bet_response', { success: false, message: "Betting closed! Time is over for this round." });
    }

    const user = await User.findOne({ phone });
    if (!user || user.balance < betAmount) {
      return socket.emit('bet_response', { success: false, message: "Insufficient wallet balance to place this bet!" });
    }

    // 🔒 नया नियम: चेक करें कि यूज़र ने कभी डिपॉजिट किया है या नहीं
    const hasDeposited = await Deposit.findOne({ phone: phone, status: 'SUCCESS' });
    
    // अगर यूज़र के पास सिर्फ बोनस का ₹70 है और उसने कभी रिचार्ज नहीं किया है, तो उसे रोकें
    if (!hasDeposited && user.balance <= 70) {
      return socket.emit('bet_response', { 
        success: false, 
        message: "First-time deposit is required to unlock your bonus and start playing! Please recharge now!" 
      });
    }

    // अगर सब सही है तो बैलेंस काटें और गेम लगाने दें
    user.balance -= betAmount;
    await user.save();

    const currentPeriod = gameStates[mode].period;
    const newBet = new Bet({
      phone, period: currentPeriod, mode, selectValue, amount: betAmount, socketId: socket.id
    });
    await newBet.save();

    socket.emit('bet_response', { success: true, message: "Bet placed successfully!", newBalance: user.balance });
  } catch (err) {
    socket.emit('bet_response', { success: false, message: "Server error!" });
  }
});
// 🎧 यूज़र की पर्सनल बेट हिस्ट्री (My History) भेजने के लिए बैकएंड कोड
socket.on('get_my_history', async (data) => {
  try {
    const { phone, mode } = data;
    
    if (!phone || !mode) {
      return socket.emit('my_history_data', { success: false, bets: [], message: "Missing data!" });
    }

    // 🔍 डेटाबेस के 'Bet' टेबल से इस यूज़र के सिर्फ इस गेम मोड के लेटेस्ट 30 रिकॉर्ड्स निकालना
    const userBets = await Bet.find({ phone: phone, mode: mode })
                              .sort({ createdAt: -1 })
                              .limit(30);
    
    // 🚀 वापस फ़्रंटएंड (game.html) को डेटा भेजना
    socket.emit('my_history_data', { success: true, bets: userBets });
    
  } catch (err) {
    console.error("Error in get_my_history socket:", err);
    socket.emit('my_history_data', { success: false, bets: [] });
  }
});


    socket.on('disconnect', () => {});
});

app.get('/api/admin/dashboard-data', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const users = await User.find().sort({ createdAt: -1 });
        const successDeps = await Deposit.find({ status: 'SUCCESS' });
        const totalDeposits = successDeps.reduce((sum, item) => sum + item.amount, 0);
        const successWits = await Withdraw.find({ status: 'SUCCESS' });
        const totalWithdraws = successWits.reduce((sum, item) => sum + item.amount, 0);
        const activeBetsCount = await Bet.countDocuments({ status: 'PENDING' });
        const pendingDeposits = await Deposit.find({ status: 'PENDING' });
        const pendingWithdraws = await Withdraw.find({ status: 'PENDING' });
        res.json({
            success: true, totalUsers, totalDeposits, totalWithdraws, activeBetsCount, users, pendingDeposits, pendingWithdraws
        });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post('/api/admin/user-control', async (req, res) => {
    try {
        const { action, phone, amount } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.json({ success: false, message: "User profile not found in database!" });
        if (user.isBanned === undefined) { user.isBanned = false; }
        
        if (action === "search") {
            return res.json({ success: true, phone: user.phone, balance: user.balance, isBanned: user.isBanned });
        } else if (action === "add_balance") {
            user.balance += amount;
            await user.save();
            return res.json({ success: true, message: "Successfully credited funds to user wallet." });
        } else if (action === "deduct_balance") {
            if(user.balance < amount) return res.json({ success: false, message: "User has insufficient balance to deduct!" });
            user.balance -= amount;
            await user.save();
            return res.json({ success: true, message: "Successfully debited funds from user wallet." });
        } else if (action === "ban") {
            user.isBanned = !user.isBanned;
            await user.save();
            return res.json({ success: true, message: user.isBanned ? "User account suspended successfully!" : "User account activated successfully!" });
        }
    } catch (err) {
        res.json({ success: false, message: "Server API control error!" });
    }
});

app.post('/api/admin/control-game', (req, res) => {
    const { mode, controlMode, adminResult } = req.body;
    if (controlMode === "manual") {
        manualControls[mode] = adminResult;
        res.json({ success: true, message: "Directives set: Forced winning number applied for next round." });
    } else {
        manualControls[mode] = null;
        res.json({ success: true, message: "Directives set: Auto-Profit mode activated successfully." });
    }
});

app.post('/api/admin/deposit-action', async (req, res) => {
try {
    const { requestId, action } = req.body;
    const dep = await Deposit.findById(requestId);
    if (!dep || dep.status !== 'PENDING') return res.json({ success: false, message: "Request already processed!" });

    if (action === "Success") {
        dep.status = 'SUCCESS';
        await dep.save();
        
        //    
        await User.updateOne({ phone: dep.phone }, { $inc: { balance: dep.amount } });

        // === [     ] ===
        const allowedAmounts = [300, 500, 1000, 5000, 10000];
        if (allowedAmounts.includes(dep.amount)) {
            //      
            await User.updateOne(
                { phone: dep.phone },
                { $inc: { selfSpinCount: 1 }, $set: { lastDepositAmount: dep.amount } }
            );
        }

        //     (       )
        const userDetails = await User.findOne({ phone: dep.phone });
        if (userDetails && userDetails.referredBy) {
            const allDeps = await Deposit.countDocuments({ phone: dep.phone, status: 'SUCCESS' });
            //         ,       
            if (allDeps === 1) {
                await User.updateOne(
                    { phone: userDetails.referredBy },
                    { $inc: { referralSpinCount: 1 }, $set: { lastRefDepositAmount: dep.amount } }
                );
            }
        }
        // === [   ] ===

        io.emit('deposit_credited', { phone: dep.phone, amount: dep.amount });
        res.json({ success: true, message: "Deposit request approved successfully!" });
    } else {
        dep.status = 'REJECTED';
        await dep.save();
        res.json({ success: true, message: "Deposit request rejected cleanly!" });
    }
} catch (err) {
    res.json({ success: false, message: "Server error during deposit processing!" });
}
});


app.post('/api/admin/withdraw-action', async (req, res) => {
    try {
        const { requestId, action } = req.body;
        const wit = await Withdraw.findById(requestId);
        if (!wit || wit.status !== 'PENDING') return res.json({ success: false, message: "Request already processed!" });
        if (action === "Success") {
            wit.status = 'SUCCESS';
            await wit.save();
            res.json({ success: true, message: "Withdrawal marked as successful and dispatched!" });
        } else {
            wit.status = 'REJECTED';
            await wit.save();
            await User.updateOne({ phone: wit.phone }, { $inc: { balance: wit.amount } });
            res.json({ success: true, message: "Withdrawal rejected and amount fully refunded to user balance!" });
        }
    } catch (err) {
        res.json({ success: false, message: "Server error during withdrawal processing!" });
    }
});

app.post('/api/admin/update-gateway', (req, res) => {
    try {
        const { upiId, bankDetails } = req.body;
        if(upiId) adminUpiConfig = upiId;
        if(bankDetails) adminBankConfig = bankDetails;
        res.json({ success: true, message: "System payment gateway configuration updated successfully!" });
    } catch (err) {
        res.json({ success: false, message: "Failed to update configuration!" });
    }
});
// 📊 1. एजेंसी सेंटर का पूरा डेटा और इनवाइटेड यूज़र्स की लिस्ट लोड करने की API
app.get('/api/agency/dashboard/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const agent = await User.findOne({ phone });
    if (!agent) return res.json({ success: false, message: "Agent profile not found" });

    // इस एजेंट द्वारा रेफ़र किए गए सभी यूज़र्स निकालें
    const invitedUsers = await User.find({ referredBy: phone }).select('phone createdAt').sort({ createdAt: -1 }).lean();
    
    // हमारे डेटाबेस से सफल डिपॉजिटर्स की लिस्ट (₹300 या उससे ज़्यादा वाले)
    const successDepositors = await Deposit.distinct("phone", { status: 'SUCCESS', amount: { $gte: 300 } });

    // सभी यूज़र्स के नंबर को छिपाकर और उनका स्टेटस (Valid/Pending) सेट करके लिस्ट तैयार करें
    const usersListWithStatus = invitedUsers.map(u => {
      // नंबर को बीच से मास्क करें (जैसे 9876***123) सुरक्षा के लिए
      const maskedPhone = u.phone.length >= 10 
        ? u.phone.substring(0, 4) + "****" + u.phone.substring(u.phone.length - 3)
        : u.phone;

      return {
        phone: maskedPhone,
        date: new Date(u.createdAt).toLocaleDateString(),
        status: successDepositors.includes(u.phone) ? 'Valid (Deposited ₹300+)' : 'Pending (No Recharge)'
      };
    });

    // कुल वैलिड यूज़र्स की संख्या गिनें
    const validCount = usersListWithStatus.filter(u => u.status.startsWith('Valid')).length;

    res.json({
      success: true,
      promoBalance: agent.promoBalance,
      totalEarned: agent.totalCommissionEarned,
      totalInvites: invitedUsers.length,
      validInvitesCount: validCount,
      claimedMissions: agent.claimedMissions,
      invitedUsers: usersListWithStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Agency dashboard server error" });
  }
});

// 🏆 2. इनवाइट मिशन बोनस (50, 150, 250...) क्लेम करने की API
const milestones = [
  { id: 1, count: 1, reward: 50 },
  { id: 2, count: 3, reward: 150 },
  { id: 3, count: 5, reward: 250 },
  { id: 4, count: 10, reward: 500 },
  { id: 5, count: 50, reward: 3000 },
  { id: 6, count: 100, reward: 7000 },
  { id: 7, count: 200, reward: 16000 },
  { id: 8, count: 500, reward: 45000 },
  { id: 9, count: 1000, reward: 100000 }
];

app.post('/api/agency/claim-mission', async (req, res) => {
  try {
    const { phone, missionId } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: "User profile not found" });

    // सुरक्षा जाँच: क्या यह मिशन पहले ही क्लेम हो चुका है?
    if (user.claimedMissions.includes(missionId)) {
      return res.json({ success: false, message: "This mission reward has already been claimed!" });
    }

    const mission = milestones.find(m => m.id === missionId);
    if (!mission) return res.json({ success: false, message: "Invalid Mission Selection" });

    // डेटाबेस में लाइव चेक करें कि एजेंट के कितने वैलिड यूज़र्स हैं
    const validCount = await User.countDocuments({
      referredBy: phone,
      phone: { $in: await Deposit.distinct("phone", { status: 'SUCCESS', amount: { $gte: 300 } }) }
    });

    if (validCount < mission.count) {
      return res.json({ success: false, message: `Requirement not met! You need ${mission.count} valid users. Current: ${validCount}` });
    }

    // मिशन रिवॉर्ड क्लेम करके प्रमोशन बैलेंस में जोड़ें
    user.claimedMissions.push(missionId);
    user.promoBalance += mission.reward;
    user.totalCommissionEarned += mission.reward;
    await user.save();

    res.json({ success: true, message: `Success! ₹${mission.reward} added to your Promo Wallet!` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Mission claim server error" });
  }
});

// 💰 3. कमीशन वॉलेट से मुख्य बैलेंस में पैसे ट्रांसफर करने की API
app.post('/api/agency/transfer-to-main', async (req, res) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.json({ success: false, message: "User not found" });

    const transferAmount = user.promoBalance;
    if (transferAmount <= 0) {
      return res.json({ success: false, message: "Your Promotion Balance is ₹0.00. Nothing to transfer!" });
    }

    // प्रमोशन बैलेंस को 0 करें और मुख्य बैलेंस में जोड़ें
    user.promoBalance = 0;
    user.balance += transferAmount;
    await user.save();

    res.json({ 
      success: true, 
      message: `Successfully transferred ₹${transferAmount.toFixed(2)} to your main gaming wallet!`,
      newMainBalance: user.balance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Wallet transfer server error" });
  }
});

// 📝 1. एडमिन पैनल से नया मैसेज भेजने का रास्ता (POST API)
app.post('/api/admin/add-notice', async (req, res) => {
    try {
        const { message, imageUrl } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: "मैसेज लिखना जरूरी है!" });
        }

        // नया नोटिस डेटाबेस में सुरक्षित करना
        const newNotice = new Notice({
            message,
            imageUrl: imageUrl || null
        });

        await newNotice.save();
        res.json({ success: true, message: "नया अलर्ट गेम में लाइव हो गया है!" });

    } catch (error) {
        console.error("Notice Error:", error);
        res.status(500).json({ success: false, message: "सर्वर एरर आ गया!" });
    }
});
// 🔔 2. यूज़र्स के लिए सभी नोटिफिकेशन्स खींचने का रास्ता (GET API)
app.get('/api/user/get-notices', async (req, res) => {
    try {
        // डेटाबेस से सारे मैसेज निकालना (नया मैसेज सबसे ऊपर रहेगा)
        const notices = await Notice.find().sort({ createdAt: -1 });

        if (notices.length === 0) {
            return res.json({ success: true, latest: null, history: [] });
        }

        // सबसे नया मैसेज पॉपअप के लिए और बाकी इतिहास के लिए भेजना
        res.json({
            success: true,
            latest: notices[0], // यह होमपेज पर ऑटोमैटिक पॉपअप खुलेगा
            history: notices     // यह घंटी दबाने पर पूरी लिस्ट दिखाएगा
        });

    } catch (error) {
        console.error("Fetch Notice Error:", error);
        res.status(500).json({ success: false, message: "डेटा लोड नहीं हो पाया!" });
    }
});

// 📥 1. API Route for Users to Submit a New Complaint Ticket (POST API)
app.post('/api/user/submit-complaint', async (req, res) => {
    try {
        const { phone, category, message } = req.body;
        
        if (!phone || !category || !message) {
            return res.status(400).json({ success: false, message: "All fields are required!" });
        }

        // Saving new complaint details to database
        const newComplaint = new Complaint({
            phone,
            category,
            message
        });

        await newComplaint.save();
        res.json({ success: true, message: "Your support request has been recorded successfully!" });

    } catch (error) {
        console.error("Complaint Submit Error:", error);
        res.status(500).json({ success: false, message: "Server connection failed!" });
    }
});
// 👑 2. API Route for Admin Panel to Fetch All User Complaints (GET API)
app.get('/api/admin/get-complaints', async (req, res) => {
    try {
        // Fetching all tickets from database (Latest complaints will appear on top)
        const complaints = await Complaint.find().sort({ createdAt: -1 });

        res.json({
            success: true,
            complaintsList: complaints
        });

    } catch (error) {
        console.error("Fetch Complaints Error:", error);
        res.status(500).json({ success: false, message: "Failed to load complaints data!" });
    }
});
// ===       ( server.js     ) ===

app.get('/api/user/spin-status/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const user = await mongoose.model('User').findOne({ phone: phone });
        if (!user) {
            return res.json({ success: true, selfSpins: 0, refSpins: 0 });
        }
        res.json({ 
            success: true, 
            selfSpins: user.selfSpinCount || 0, 
            refSpins: user.referralSpinCount || 0 
        });
    } catch (err) {
        console.error("Spin status error:", err);
        res.json({ success: false, selfSpins: 0, refSpins: 0, error: err.message });
    }
});

app.post('/api/user/spin-wheel', async (req, res) => {
    try {
        const { phone, type } = req.body;
        const UserMod = mongoose.model('User');
        const user = await UserMod.findOne({ phone: phone });
        if (!user) return res.json({ success: false, message: "User not found!" });

        let bonusAmount = 0;
        let percentage = 0;

        if (type === 'self') {
            if ((user.selfSpinCount || 0) <= 0) {
                return res.json({ success: false, message: "You don't have personal spins!" });
            }
            percentage = Math.random() * (12 - 3) + 3;
            bonusAmount = ((user.lastDepositAmount || 0) * percentage) / 100;
            user.selfSpinCount = (user.selfSpinCount || 1) - 1;
        } else if (type === 'referral') {
            if ((user.referralSpinCount || 0) <= 0) {
                return res.json({ success: false, message: "You don't have referral spins!" });
            }
            percentage = Math.random() * (5 - 3) + 3;
            bonusAmount = ((user.lastRefDepositAmount || 0) * percentage) / 100;
            user.referralSpinCount = (user.referralSpinCount || 1) - 1;
        } else {
            return res.json({ success: false, message: "Invalid spin type selection!" });
        }

        bonusAmount = parseFloat(bonusAmount.toFixed(2));
        user.promoBalance = (user.promoBalance || 0) + bonusAmount;
        user.totalCommissionEarned = (user.totalCommissionEarned || 0) + bonusAmount;
        
        await user.save();

        res.json({ 
            success: true, 
            message: `Success! You won ${bonusAmount}`, 
            bonus: bonusAmount,
            selfSpins: user.selfSpinCount,
            refSpins: user.referralSpinCount
        });
    } catch (err) {
        console.error("Spin wheel error:", err);
        res.status(500).json({ success: false, message: "Internal server error!" });
    }
});

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colorgame')
.then(async () => {
    console.log("MongoDB connected successfully RR");
    await initializeGameHistory();
    server.listen(PORT, () => {
        console.log(`Server engine running tightly on port ${PORT}`);
    });
})
.catch(err => console.error("Database connection failure:", err));
