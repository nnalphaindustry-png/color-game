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
// === 1. गेम के परिणाम का स्कीमा ===
const gameResultSchema = new mongoose.Schema({
    gameMode: { type: String, required: true }, // '30s', '1m', '3m', '5m'
    periodId: { type: String, required: true, unique: true },
    winningNumber: { type: Number, required: true },
    winningColor: { type: String, required: true }, // 'Red', 'Green', 'Violet', 'Red-Violet', 'Green-Violet'
    winningSize: { type: String, required: true }, // 'Big' या 'Small'
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

// === 2. यूजर की बेट (सट्टे) का स्कीما ===
const betSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    gameMode: { type: String, required: true },
    periodId: { type: String, required: true },
    betOn: { type: String, required: true }, // रंग (Red), नंबर (0-9), या आकार (Big/Small)
    amount: { type: Number, required: true },
    status: { type: String, default: "Pending" }, // Pending, Win, Loss
    winAmount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
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
// वैश्विक वेरिएबल (Global Variables) ताकि फ्रंटएंड लाइव टाइमर देख सके
let currentPeriod30s = "";
let timeRemaining30s = 30;

function start30sGameEngine() {
    // हर दिन और समय के आधार पर एक यूनीक पीरियड आईडी बनाना
    const generatePeriodId = () => {
        const now = new Date();
        const dateStr = now.getFullYear() + 
                        String(now.getMonth() + 1).padStart(2, '0') + 
                        String(now.getDate()).padStart(2, '0');
        // कुल सेकंड्स को 30 से भाग देकर चक्र का नंबर निकालना
        const totalHalfMinutes = Math.floor((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 30);
        return dateStr + String(totalHalfMinutes).padStart(4, '0');
    };

    currentPeriod30s = generatePeriodId();

    // हर 1 सेकंड में चलने वाली घड़ी
    setInterval(async () => {
        timeRemaining30s--;

        if (timeRemaining30s <= 0) {
            // === समय समाप्त! विजेता चुनने का वक्त (00 सेकंड) ===
            const finishedPeriod = currentPeriod30s;
            
            // 1. नए चक्र की तुरंत शुरुआत ताकि टाइमर न रुके
            timeRemaining30s = 30;
            currentPeriod30s = generatePeriodId();

            try {
                // 2. इस पीरियड की सभी बेट्स को डेटाबेस से निकालना
                const allBets = await Bet.find({ periodId: finishedPeriod, gameMode: '30s' });

                // 3. 0 से 9 तक के सभी नंबरों का शुरुआती हिसाब ₹0 रखना
                let numberAmounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

                // 4. यूजर्स की बेट के अनुसार हर नंबर पर लगा कुल पैसा जोड़ना
                allBets.forEach(bet => {
                    const target = bet.betOn;
                    // अगर सीधे नंबर पर बेट है
                    if (!isNaN(target)) {
                        numberAmounts[target] += bet.amount;
                    }
                    // अगर रंग पर बेट है, तो उस रंग में आने वाले सभी नंबरों पर पैसा जोड़ना
                    else if (target === 'Green') { [1, 3, 7, 9].forEach(n => numberAmounts[n] += bet.amount); }
                    else if (target === 'Red') { [2, 4, 6, 8].forEach(n => numberAmounts[n] += bet.amount); }
                    else if (target === 'Violet') { [0, 5].forEach(n => numberAmounts[n] += bet.amount); }
                    // अगर Big/Small पर बेट है
                    else if (target === 'Small') { [0, 1, 2, 3, 4].forEach(n => numberAmounts[n] += bet.amount); }
                    else if (target === 'Big') { [5, 6, 7, 8, 9].forEach(n => numberAmounts[n] += bet.amount); }
                });

                // 5. वह नंबर ढूँढना जिसपर सबसे कम पैसा लगा है (LOWEST AMOUNT SYSTEM)
                let winningNumber = 0;
                let minAmount = Infinity;

                for (let i = 0; i <= 9; i++) {
                    if (numberAmounts[i] < minAmount) {
                        minAmount = numberAmounts[i];
                        winningNumber = i;
                    }
                }

                // 6. जीतने वाले नंबर के आधार पर उसका सही रंग और आकार तय करना
                let winningColor = "Red";
                if ([1, 3, 7, 9].includes(winningNumber)) winningColor = "Green";
                else if (winningNumber === 0) winningColor = "Red-Violet";
                else if (winningNumber === 5) winningColor = "Green-Violet";

                const winningSize = winningNumber >= 5 ? "Big" : "Small";

                // 7. इस नतीजे को रिजल्ट टेबल में हमेशा के लिए सेव करना
                const newResult = new GameResult({
                    gameMode: '30s',
                    periodId: finishedPeriod,
                    winningNumber,
                    winningColor,
                    winningSize
                });
                await newResult.save();

                // 8. जीतने वाले यूजर्स को पैसा बांटना (Payout Logic)
                for (let bet of allBets) {
                    let isWin = false;
                    let multiplier = 2; // डिफ़ॉल्ट दोगुना पैसा (रंगों के लिए)

                    if (bet.betOn == winningNumber) {
                        isWin = true;
                        multiplier = 9; // नंबर जीतने पर 9 गुना पैसा
                    } else if (bet.betOn === 'Green' && ['Green', 'Green-Violet'].includes(winningColor)) {
                        isWin = true;
                        if (winningColor === 'Green-Violet') multiplier = 1.5; // हाफ विन रूल
                    } else if (bet.betOn === 'Red' && ['Red', 'Red-Violet'].includes(winningColor)) {
                        isWin = true;
                        if (winningColor === 'Red-Violet') multiplier = 1.5;
                    } else if (bet.betOn === 'Violet' && ['Red-Violet', 'Green-Violet'].includes(winningColor)) {
                        isWin = true;
                        multiplier = 4.5;
                    } else if (bet.betOn === winningSize) {
                        isWin = true;
                        multiplier = 2;
                    }

                    if (isWin) {
                        const winAmount = bet.amount * multiplier;
                        bet.status = "Win";
                        bet.winAmount = winAmount;
                        await bet.save();

                        // यूजर के वॉलेट में पैसे बढ़ाना
                        await User.findOneAndUpdate({ phone: bet.phone }, { $inc: { balance: winAmount } });
                    } else {
                        bet.status = "Loss";
                        await bet.save();
                    }
                }

                console.log(`Period ${finishedPeriod} Done. Winner: ${winningNumber} (${winningColor})`);

            } catch (err) {
                console.error("Error in game engine execution:", err);
            }
        }
    }, 1000);
}

// सर्वर स्टार्ट होने पर इंजन को चालू करना
start30sGameEngine();

// === यूजर द्वारा बेट लगाने का सुरक्षित रास्ता ===
app.post('/api/place-bet', async (req, res) => {
    try {
        const { phone, gameMode, betOn, amount } = req.body;

        // 1. जरूरी डेटा की जांच करना
        if (!phone || !gameMode || !betOn || !amount || amount <= 0) {
            return res.json({ success: false, message: "गलत डेटा या अमाउंट!" });
        }

        // 2. यूजर को डेटाबेस में खोजना
        const user = await User.findOne({ phone: phone.trim() });
        if (!user) {
            return res.json({ success: false, message: "यूजर नहीं मिला!" });
        }

        // 3. 5 सेकंड का लॉक रूल चेक करना
        // अगर 30 सेकंड वाले गेम में टाइमर 5 सेकंड या उससे कम है, तो बेट रिजेक्ट करें
        if (gameMode === '30s' && timeRemaining30s <= 5) {
            return res.json({ success: false, message: "समय समाप्त! बेटिंग बंद हो चुकी है।" });
        }

        // 4. बैलेंस की जांच करना
        if (user.balance < amount) {
            return res.json({ success: false, message: "बैलेंस कम है! कृपया डिपॉजिट करें।" });
        }

        // 5. यूजर के वॉलेट से पैसे काटना
        user.balance -= amount;
        await user.save();

        // 6. डेटाबेस में बेट का रिकॉर्ड सेव करना
        const newBet = new Bet({
            phone: phone.trim(),
            gameMode,
            periodId: currentPeriod30s, // यह ऑटोमैटिक लाइव पीरियड आईडी उठा लेगा
            betOn,
            amount
        });
        await newBet.save();

        // 7. सफलता का मैसेज और नया बैलेंस फ्रंटएंड को भेजना
        res.json({
            success: true,
            message: "बेट सफलतापूर्वक लग गई!",
            newBalance: user.balance
        });

    } catch (err) {
        console.error("Bet placement error:", err);
        res.status(500).json({ success: false, message: "सर्वर त्रुटि! बेट नहीं लग पाई।" });
    }
});

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Database Connected Successfully!");
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => console.error("Database Connection Error:", err));
    