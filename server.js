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

app.use(express.static(path.join(__dirname, '')));

// === USER SCHEMA ===
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    inviteCode: { type: String, default: "" },
    balance: { type: Number, default: 70 }, 
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

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

// === LOGIN ROUTE ===
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone: phone.trim(), password: password.trim() });
        if (!user) {
            return res.json({ success: false, message: "Invalid phone number or password!" });
        }
        res.json({ 
            success: true, 
            phone: user.phone, 
            balance: user.balance, 
            message: "Login successful!" 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during login!" });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Database Connected Successfully!");
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => console.error("Database Connection Error:", err));
    