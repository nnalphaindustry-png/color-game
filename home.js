const API_URL = window.location.origin; // सर्वर का एड्रेस ऑटोमैटिक लेने के लिए

document.addEventListener("DOMContentLoaded", () => {
    // 1. लॉगिन किए हुए यूजर का फोन नंबर चेक करना
    let loggedUser = localStorage.getItem('user_phone');
    
    if (!loggedUser) {
        // अगर कोई बिना लॉगिन किए डायरेक्ट आएगा तो उसे वापस लॉगिन (index.html) पर भेज देगा
        alert("Please login first!");
        window.location.href = "index.html";
        return;
    }

    // 2. डेटाबेस से लाइव बैलेंस लेकर आना
    fetchUserBalance(loggedUser);
    
    // 3. बैनर स्लाइडर को ऑटोमैटिक चलाना (जो पहले डिस्कस हुआ था)
    startBannerSlider();
});

// डेटाबेस से लाइव बैलेंस लाने का फंक्शन
async function fetchUserBalance(phone) {
    try {
        let response = await fetch(`${API_URL}/api/balance/${phone}`);
        let data = await response.json();
        
        if (data.success) {
            // स्क्रीन पर डेटाबेस वाला बैलेंस दिखाना (शुरुआत में ₹0.00 रहेगा)
            document.getElementById('home-balance').innerText = parseFloat(data.balance).toFixed(2);
        } else {
            console.error("Balance fetch error:", data.message);
        }
    } catch (error) {
        console.error("Server error while fetching balance:", error);
    }
}

// बैलेंस रिफ्रेश करने का फंक्शन (अगर यूजर रिफ्रेश दबाए)
function refreshBalance() {
    let loggedUser = localStorage.getItem('user_phone');
    let btn = document.querySelector('.refresh-btn');
    
    if (btn) btn.style.transform = "rotate(360deg)"; // आइकॉन को घुमाना
    
    setTimeout(() => {
        if (loggedUser) {
            fetchUserBalance(loggedUser);
        }
        if (btn) btn.style.transform = "rotate(0deg)";
        alert("Balance Updated from Database!");
    }, 500);
}

// ऑटोमैटिक बैनर स्लाइडर का लॉजिक (5 फोटोज के लिए)
function startBannerSlider() {
    const slider = document.getElementById('slider');
    if (!slider) return;
    
    let currentIndex = 0;
    const totalBanners = 5;

    setInterval(() => {
        currentIndex++;
        if (currentIndex >= totalBanners) {
            currentIndex = 0;
        }
        let offset = currentIndex * -20; // 5 बैनर के हिसाब से 20% शिफ्ट
        slider.style.transform = `translateX(${offset}%)`;
    }, 3000); // हर 3 सेकंड में बैनर बदलेगा
}

// 🆕 अपडेटेड फंक्शन: जो होमपेज के क्लिक से मोड को सुरक्षित गेम पेज पर भेजेगा
function openGame(modeKey) {
    if (!modeKey) modeKey = '30s'; // अगर कोई मोड न मिले तो डिफ़ॉल्ट 30s
    window.location.href = `game.html?mode=${modeKey}`;
}

