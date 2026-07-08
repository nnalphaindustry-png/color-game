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
app.use(express.static(path.join(__dirname, '')));

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
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
        const { phone, password } = req.body;
        const exists = await User.findOne({ phone });
        if (exists) return res.json({ success: false, message: "This mobile number is already registered!" });
        const newUser = new User({ phone, password, balance: 70 });
        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error!" });
    }
});

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
    '30s': { countdown: 30, period: "2026070710001", history: [] },
    '1m': { countdown: 60, period: "2026070730001", history: [] },
    '3m': { countdown: 180, period: "2026070750001", history: [] },
    '5m': { countdown: 300, period: "2026070770001", history: [] }
};

let manualControls = { '30s': null, '1m': null, '3m': null, '5m': null };
let adminUpiConfig = "";
let adminBankConfig = "";
let processingLocks = { '30s': false, '1m': false, '3m': false, '5m': false };

async function initializeGameHistory() {
    for (let mode of Object.keys(gameStates)) {
        const records = await GameHistory.find({ mode }).sort({ createdAt: -1 }).limit(20);
        gameStates[mode].history = records.map(r => ({
            period: r.period, number: r.number, bigSmall: r.bigSmall, color: r.color
        }));
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
        message: "गेम खेलने के लिए कृपया पहली बार कम से कम ₹100 का रिचार्ज (Deposit) करें!" 
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
            await User.updateOne({ phone: dep.phone }, { $inc: { balance: dep.amount } });
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
