// =================================================================
// 1. आवश्यक लाइब्रेरी और सर्वर सेटअप
// =================================================================
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

// मिडिलवेयर सेटअप
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '')));

// =================================================================
// 2. MONGODB डेटाबेस स्कीमा और मॉडल्स (Schemas & Models)
// =================================================================

// ए. यूजर स्कीमा (User Profiles)
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// बी. बेटिंग स्कीमा (User Bets History)
const betSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    period: { type: String, required: true },
    mode: { type: String, required: true }, // '30s', '1m', '3m', '5m'
    selectValue: { type: String, required: true }, // 'Red', 'Green', 'Big', '5' आदि
    amount: { type: Number, required: true },
    winAmount: { type: Number, default: 0 },
    status: { type: String, default: 'PENDING' }, // PENDING, WIN, LOSS
    socketId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

// सी. गेम पीरियड हिस्ट्री स्कीमा (Main Game History)
const gameHistorySchema = new mongoose.Schema({
    mode: { type: String, required: true },
    period: { type: String, required: true },
    number: { type: Number, required: true },
    bigSmall: { type: String, required: true },
    color: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const GameHistory = mongoose.model('GameHistory', gameHistorySchema);

// डी. डिपॉजिट स्कीमा (User Deposits)
const depositSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    utrNumber: { type: String, required: true, unique: true },
    status: { type: String, default: 'PENDING' }, // PENDING, SUCCESS, REJECTED
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// ई. विड्रॉल स्कीमा (User Withdrawals)
const withdrawSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true }, // 'upi' या 'bank'
    details: { type: String, required: true }, // पूरा बैंक विवरण या यूपीआई आईडी
    status: { type: String, default: 'PENDING' }, // PENDING, SUCCESS, REJECTED
    createdAt: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);
// =================================================================
// 3. यूजर ऑथेंटिकेशन और वॉलेट कोर APIs
// =================================================================

// यूजर रजिस्ट्रेशन API
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const exists = await User.findOne({ phone });
        if (exists) return res.json({ success: false, message: "यह मोबाइल नंबर पहले से रजिस्टर्ड है!" });
        const newUser = new User({ phone, password, balance: 100 }); // ₹100 वेलकम बोनस
        await newUser.save();
        res.json({ success: true, message: "रजिस्ट्रेशन सफल रहा!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "सर्वर त्रुटि!" });
    }
});

// यूजर लॉगिन API
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.json({ success: false, message: "गलत मोबाइल नंबर या पासवर्ड!" });
        res.json({ success: true, phone: user.phone, message: "लगातार लॉगिन सफल!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "सर्वर त्रुटि!" });
    }
});

// लाइव बैलेंस चेक API
app.get('/api/balance/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) return res.json({ success: false, message: "यूजर नहीं मिला" });
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: "त्रुटि" });
    }
});

// पेज राउट्स डिफाइन करना
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));
app.get('/deposit', (req, res) => res.sendFile(path.join(__dirname, 'deposit.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname, 'withdraw.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// =================================================================
// 4. डिपॉजिट और विड्रॉल यूज़र-साइड सबमिशन APIs
// =================================================================
app.post('/api/user/submit-deposit', async (req, res) => {
    try {
        const { phone, amount, utr } = req.body;
        if (!utr || utr.length !== 12 || isNaN(utr)) {
            return res.json({ success: false, message: "त्रुटि: कृपया सही 12-अंकों का UTR नंबर डालें!" });
        }
        const existingTx = await Deposit.findOne({ utrNumber: utr });
        if (existingTx) return res.json({ success: false, message: "यह UTR नंबर पहले ही इस्तेमाल किया जा चुका है!" });
        
        const newDeposit = new Deposit({ phone, amount: parseInt(amount), utrNumber: utr, status: 'PENDING' });
        await newDeposit.save();
        res.json({ success: true, message: "रिक्वेस्ट सबमिट हो गई है!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "डिपॉजिट सर्वर त्रुटि!" });
    }
});

app.post('/api/user/submit-withdraw', async (req, res) => {
    try {
        const { phone, amount, method, details } = req.body;
        const withdrawAmount = parseInt(amount);
        if (isNaN(withdrawAmount) || withdrawAmount < 100) return res.json({ success: false, message: "न्यूनतम निकासी सीमा ₹100 है!" });
        
        const user = await User.findOne({ phone });
        if (!user || user.balance < withdrawAmount) return res.json({ success: false, message: "आपके पास पर्याप्त वॉलेट बैलेंस नहीं है!" });
        
        user.balance -= withdrawAmount;
        await user.save();
        
        const newWithdraw = new Withdraw({ phone, amount: withdrawAmount, method, details, status: 'PENDING' });
        await newWithdraw.save();
        res.json({ success: true, message: "विड्रॉल रिक्वेस्ट सफलतापूर्वक सबमिट हो गई है!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "विड्रॉल सर्वर त्रुटि!" });
    }
});

// =================================================================
// 5. कलर प्रेडिक्शन गेम स्टेट और टाइमर मैनेजमेंट (RNG & Core Engine)
// =================================================================
let gameStates = {
    '30s': { countdown: 30, period: "2026070710001", history: [] },
    '1m': { countdown: 60, period: "2026070730001", history: [] },
    '3m': { countdown: 180, period: "2026070750001", history: [] },
    '5m': { countdown: 300, period: "2026070770001", history: [] }
};

async function initializeGameHistory() {
    for (let mode of Object.keys(gameStates)) {
        const records = await GameHistory.find({ mode }).sort({ createdAt: -1 }).limit(20);
        gameStates[mode].history = records.map(r => ({
            period: r.period, number: r.number, bigSmall: r.bigSmall, color: r.color
        }));
    }
}

let processingLocks = { '30s': false, '1m': false, '3m': false, '5m': false };

async function generateMultiGameResult(mode) {
    if (processingLocks[mode]) return;
    processingLocks[mode] = true;
    try {
        const game = gameStates[mode];
                // 🔥 यहाँ सुधार किया: एडमिन के द्वारा चुने गए नंबर को गेम में इंजेक्ट करने का फिक्स
        let forcedNum = manualControls[mode];
        const winningNumber = (forcedNum !== null && forcedNum !== undefined) ? forcedNum : Math.floor(Math.random() * 10);
        manualControls[mode] = null; // विनर घोषित होने के बाद एडमिन के नंबर को वापस रिसेट करें
        
        const winningBigSmall = winningNumber >= 5 ? 'Big' : 'Small';
        
        let winningColor = 'Red';
        if ([1, 3, 7, 9].includes(winningNumber)) winningColor = 'Green';
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
// =================================================================
// 6. मास्टर क्लॉक / टाइमर लूप (Master Clock Ticker)
// =================================================================
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

// =================================================================
// 7. सॉकेट कनेक्शन और लाइव बेटिंग रिसीवर
// =================================================================
io.on('connection', (socket) => {
    
    // जब कोई नया यूजर पेज ओपन करे, उसे तुरंत सारा करंट डेटा (All Modes Sync) भेजें
    socket.emit('all_modes_state', gameStates);

    // यूजर द्वारा बेट लगाने का लाइव हैंडलर
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
            user.balance -= betAmount;
            await user.save();
            
            const currentPeriod = gameStates[mode].period;
            const newBet = new Bet({
                phone,
                period: currentPeriod,
                mode,
                selectValue,
                amount: betAmount,
                socketId: socket.id
            });
            await newBet.save();
            
            socket.emit('bet_response', { success: true, message: "Bet placed successfully!", newBalance: user.balance });
        } catch (err) {
            socket.emit('bet_response', { success: false, message: "सर्वर एरर!" });
        }
    });

    // 🆕 सुधार: पर्सनल माई हिस्ट्री का सॉकेट हैंडलर (जो पहले गायब था)
    socket.on('get_my_history', async (data) => {
        try {
            const { phone, mode } = data;
            // डेटाबेस से उस यूजर की सिर्फ इस मोड की रीसेंट 20 बेट्स निकालें
            const myBets = await Bet.find({ phone, mode }).sort({ createdAt: -1 }).limit(20);
            
            socket.emit('my_history_data', { success: true, bets: myBets });
        } catch (err) {
            socket.emit('my_history_data', { success: false, bets: [] });
        }
    });

    socket.on('disconnect', () => {});
});
// =================================================================
// 👑 MASTER PANEL BACKEND ENGINE APIs - PART 1
// =================================================================

// 1. डैशबोर्ड का पूरा लाइव डेटा, कुल स्टैट्स और रजिस्टर्ड यूज़र लिस्ट लोड करना
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
            success: true,
            totalUsers,
            totalDeposits,
            totalWithdraws,
            activeBetsCount,
            users,
            pendingDeposits,
            pendingWithdraws
        });
    } catch (err) {
        res.json({ success: false });
    }
});

// 2. मोबाइल नंबर सर्च, वॉलेट बैलेंस क्रेडिट/डेबिट और अकाउंट बैन/अनबैन कंट्रोल API
app.post('/api/admin/user-control', async (req, res) => {
    try {
        const { action, phone, amount } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.json({ success: false, message: "User profile not found in database!" });

        // सस्पेंड स्कीमा चेकर सपोर्ट
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

// 3. गेम मैनुअल कंट्रोल पॉलिसी सेटिंग API (Choose Winner Override)
let manualControls = { '30s': null, '1m': null, '3m': null, '5m': null };
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
// =================================================================
// 👑 MASTER PANEL BACKEND ENGINE APIs - PART 2
// =================================================================

// 4. यूज़र डिपॉजिट यूटीआर रिक्वेस्ट को अप्रूव (SUCCESS) या रिजेक्ट करना
app.post('/api/admin/deposit-action', async (req, res) => {
    try {
        const { requestId, action } = req.body;
        const dep = await Deposit.findById(requestId);
        if (!dep || dep.status !== 'PENDING') return res.json({ success: false, message: "Request already processed!" });

        if (action === "Success") {
            dep.status = 'SUCCESS';
            await dep.save();
            
            // यूजर के वॉलेट में पैसा प्लस करना
            await User.updateOne({ phone: dep.phone }, { $inc: { balance: dep.amount } });
            
            // लाइव सॉकेट सिग्नल भेजना ताकि यूजर को इन-गेम तुरंत अलर्ट दिख जाए
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

// 5. यूज़र विड्रॉल रिक्वेस्ट को अप्रूव या रिजेक्ट (Refund) करना
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
            
            // रिजेक्ट होने पर यूजर का काटा गया पैसा वापस उसके वॉलेट में रिफंड जोड़ें
            await User.updateOne({ phone: wit.phone }, { $inc: { balance: wit.amount } });
            res.json({ success: true, message: "Withdrawal rejected and amount fully refunded to user balance!" });
        }
    } catch (err) {
        res.json({ success: false, message: "Server error during withdrawal processing!" });
    }
});

// 6. मास्टर गेटवे यूपीआई आईडी और बैंक क्रेडेंशियल अपडेट करना
app.post('/api/admin/update-gateway', (req, res) => {
    try {
        const { upiId, bankDetails } = req.body;
        if(upiId) adminUpiConfig = upiId;
        if(bankDetails && bankDetails[0]) { 
            adminBankConfig = bankDetails[0]; 
        }
        res.json({ success: true, message: "System payment gateway configuration updated successfully!" });
    } catch (err) {
        res.json({ success: false, message: "Failed to update configuration!" });
    }
});

// =================================================================
// 8. डेटाबेस कनेक्शन और सर्वर स्टार्ट इंजन
// =================================================================
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
