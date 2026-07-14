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

// === USER SCHEMA & MODEL ===
// गेम का सारा एक्स्ट्रा स्कीमा (Bet, Period) यहाँ से हटा दिया गया है
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, default: "" },
    balance: { type: Number, default: 70 }, // नए यूज़र को मिलने वाला डिफ़ॉल्ट बैलेंस
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// === ROUTES / APIS ===

// 1. डेटाबेस कनेक्शन स्टेटस चेक करने के लिए
app.get('/api/db-status', (req, res) => {
    res.json({ success: mongoose.connection.readyState === 1 });
});

// 2. नया रजिस्ट्रेशन (Register API)
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, inviteCode } = req.body;
        
        // चेक करें कि यह नंबर पहले से रजिस्टर्ड तो नहीं है
        const exists = await User.findOne({ phone: phone.trim() });
        if (exists) {
            return res.json({ success: false, message: "Already registered!" });
        }
        
        // नया यूज़र डेटाबेस में सेव करें
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
        
        // डेटाबेस में पुराने रिकॉर्ड से फ़ोन नंबर मैच करें
        const user = await User.findOne({ phone: phone.trim() });
        
        // अगर यूज़र नहीं मिला या पासवर्ड गलत हुआ
        if (!user || user.password !== password.trim()) {
            return res.json({ success: false, message: "Invalid credentials!" });
        }
        
        // लॉगिन सफल होने पर यूज़र का डेटा भेजें
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

// 4. यूज़र का बैलेंस चेक करने के लिए (डैशबोर्ड पर दिखाने के लिए)
app.get('/api/balance/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        res.json({ success: !!user, balance: user ? user.balance : 0 });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

// === STATIC FILES SERVING ===
// यह आपके फ्रंटएंड HTML पेजों (index.html, home.html) को लोड करने में मदद करेगा
app.use(express.static(path.join(__dirname, '')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === SERVER START & DATABASE CONNECTION ===
const PORT = process.env.PORT || 3000;

// आपके .env फ़ाइल से MONGO_URI लेकर डेटाबेस कनेक्ट करेगा
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected Successfully!");
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error("Database connection error:", err);
    });
